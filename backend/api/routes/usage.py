"""
Usage: where people go and where they stop, without cookies or a third party.

POST /api/public/hit        the app's beacon: {event, route, release}. Public, ≤ 1 KB, 120 a
                            minute per address. The visitor is a hash of address + user agent +
                            day + a server secret: it rotates daily, is never written back to
                            the browser, and cannot be reversed. No cookie is set.
GET  /api/ops/usage         signed-in: the last 14 days per day — visitors, views, sign-ups
                            started (beacon), accounts created (auth.users), trades booked,
                            confirmations, anchors (trade_events) — and totals.
POST /api/me/activity       signed-in: what only the browser knows a person did: {event: "view", route} when a
                            page is opened, {event: "priced", detail} when PRICE is pressed. Reduced to a fixed
                            list of words (activity/events.py); anything else is answered and not kept.
GET  /api/ops/adoption      admin: who came, who came back and what they used, per account (activity/):
                            the funnel, weeks, cohorts, features, and each account's own row.
Hits are stored in usage_hits (docs/migrations/2026-10-31_usage.sql); without the table they
are counted in memory and the page says so. The funnel's later steps come from the trading
tables themselves, so they need no beacon and survive restarts regardless.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from api.routes._roles import require_admin

log = logging.getLogger("rijeka.usage")
router = APIRouter(tags=["usage"])

EVENTS = {"view", "signup_started", "trade_booked_ui", "confirm_clicked"}
HIT_PER_MINUTE = 120
MEMORY_KEEP = 5000
DAYS = 14
_rate: dict[str, deque] = {}
_memory: deque = deque(maxlen=MEMORY_KEEP)
_table: dict[str, Any] = {"at": 0.0, "present": None}


def visitor_id(ip: str, ua: str, day: date, secret: Optional[str] = None) -> str:
    """Daily-rotating, one-way: the same person on the same day and device is one visitor."""
    salt = secret if secret is not None else (os.environ.get("RIJEKA_USAGE_SALT") or "rijeka-usage")   # a stable, non-privileged salt
    return hashlib.sha256(f"{ip}|{ua}|{day.isoformat()}|{salt}".encode()).hexdigest()[:16]


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"      # resolved by uvicorn's proxy-header handling


def _allow(ip: str, now: float) -> bool:
    q = _rate.setdefault(ip, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= HIT_PER_MINUTE:
        return False
    q.append(now)
    if len(_rate) > 5000:
        for k in [k for k, v in _rate.items() if not v or now - v[-1] > 60]:
            _rate.pop(k, None)
    return True


def table_present(db: Session) -> bool:
    if _table["present"] is not None and time.time() - _table["at"] < 300:
        return _table["present"]
    try:
        ok = bool(db.execute(text("SELECT to_regclass('public.usage_hits')")).scalar())
    except Exception:
        db.rollback(); ok = False
    _table.update(at=time.time(), present=ok)
    return ok


def record_hit(db: Session, event: str, route: str, visitor: str, release: str, now: Optional[datetime] = None) -> str:
    """Store a hit; returns 'db' or 'memory'."""
    now = now or datetime.now(timezone.utc)
    row = {"at": now, "event": event, "route": route[:200], "visitor": visitor, "release": (release or "")[:60]}
    if table_present(db):
        try:
            db.execute(text("INSERT INTO usage_hits (at, event, route, visitor, release) VALUES (:at, :event, :route, :visitor, :release)"), row)
            db.commit()
            return "db"
        except Exception as e:            # noqa: BLE001
            log.debug("usage insert failed: %s", e); db.rollback()
    _memory.append(row)
    return "memory"


@router.post("/api/public/hit", status_code=202)
async def hit(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    if len(raw) > 1024:
        return {"accepted": False}
    try:
        body = await request.json()
    except Exception:                     # noqa: BLE001
        return {"accepted": False}
    if not isinstance(body, dict) or body.get("event") not in EVENTS:
        return {"accepted": False}
    ip = _client_ip(request)
    if not _allow(ip, time.time()):
        return {"accepted": False}
    vid = visitor_id(ip, request.headers.get("user-agent", ""), date.today())
    where = record_hit(db, str(body["event"]), str(body.get("route") or "/"), vid, str(body.get("release") or ""))
    return {"accepted": True, "stored": where}


# ── the read-out ─────────────────────────────────────────────────────────────
def _hits_by_day(db: Session, since: date) -> dict[date, dict[str, Any]]:
    out: dict[date, dict[str, Any]] = {}
    rows = []
    if table_present(db):
        try:
            rows = db.execute(text("SELECT at, event, visitor FROM usage_hits WHERE at >= :s"), {"s": datetime(since.year, since.month, since.day, tzinfo=timezone.utc)}).all()
        except Exception as e:            # noqa: BLE001
            log.debug("usage read failed: %s", e); db.rollback(); rows = []
    rows = list(rows) + [(r["at"], r["event"], r["visitor"]) for r in _memory if r["at"].date() >= since]
    for at, event, visitor in rows:
        d = at.date() if isinstance(at, datetime) else at
        day = out.setdefault(d, {"views": 0, "visitors": set(), "signup_started": 0, "trade_booked_ui": 0, "confirm_clicked": 0})
        if event == "view":
            day["views"] += 1; day["visitors"].add(visitor)
        elif event in day:
            day[event] += 1
    return out


def _count_by_day(db: Session, sql: str, since: date) -> dict[date, int]:
    try:
        return {r[0]: int(r[1]) for r in db.execute(text(sql), {"s": since}).all()}
    except Exception as e:                # noqa: BLE001
        log.debug("usage count failed: %s", e); db.rollback(); return {}


SIGNUPS_SQL = "SELECT created_at::date d, count(*) FROM auth.users WHERE created_at >= :s AND email NOT LIKE '%@rijeka.test' GROUP BY 1"
TRADES_SQL = "SELECT created_at::date d, count(*) FROM trades WHERE created_at >= :s AND coalesce(trade_ref, '') NOT LIKE 'TEST-%' GROUP BY 1"
# confirmations and anchors are events on real trades: the RLS tests' TEST- trades are left out
CONFIRMS_SQL = ("SELECT e.tx_time::date d, count(*) FROM trade_events e JOIN trades t ON t.id = e.trade_id "
                "WHERE e.event_type = 'CONFIRMED' AND e.tx_time >= :s AND coalesce(t.trade_ref, '') NOT LIKE 'TEST-%' GROUP BY 1")
ANCHORS_SQL = ("SELECT e.tx_time::date d, count(*) FROM trade_events e JOIN trades t ON t.id = e.trade_id "
               "WHERE e.event_type = 'CONFIRMED' AND e.tx_time >= :s AND coalesce(t.trade_ref, '') NOT LIKE 'TEST-%' "
               "AND (e.payload->'attestation'->'anchor'->>'anchored') = 'true' GROUP BY 1")


def usage(db: Session, today: Optional[date] = None, days: int = DAYS) -> dict[str, Any]:
    today = today or date.today()
    since = today - timedelta(days=days - 1)
    hits = _hits_by_day(db, since)
    signups, trades, confirms, anchors = (_count_by_day(db, q, since) for q in (SIGNUPS_SQL, TRADES_SQL, CONFIRMS_SQL, ANCHORS_SQL))
    series = []
    for i in range(days):
        d = since + timedelta(days=i)
        h = hits.get(d, {})
        series.append({"date": d.isoformat(), "visitors": len(h.get("visitors", ())), "views": h.get("views", 0), "signup_started": h.get("signup_started", 0),
                       "signups": signups.get(d, 0), "trades": trades.get(d, 0), "confirms": confirms.get(d, 0), "anchors": anchors.get(d, 0)})
    totals = {k: sum(r[k] for r in series) for k in ("visitors", "views", "signup_started", "signups", "trades", "confirms", "anchors")}
    totals["visitors"] = len(set().union(*(h.get("visitors", set()) for h in hits.values()))) if hits else 0   # distinct over the window, not a sum of days
    return {"days": days, "from": since.isoformat(), "to": today.isoformat(), "series": series, "totals": totals,
            "hits_stored_in": "usage_hits" if table_present(db) else "memory (apply docs/migrations/2026-10-31_usage.sql to keep them)",
            "note": "Visitors are a daily-rotating hash of address, user agent and a server secret: no cookie, nothing stored in the browser. "
                    "Sign-ups, trades, confirmations and anchors are counted from the tables themselves; test accounts and test trades are excluded."}


@router.get("/api/ops/usage")
def ops_usage(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    require_admin(db, user)                     # platform-wide numbers, not one account's
    return usage(db)


# ── activity: per account ────────────────────────────────────────────────────
@router.post("/api/me/activity", status_code=202)
async def me_activity(request: Request, user: dict = Depends(verify_token)):
    """What the browser says a person did. Only the event and one word of a fixed list are kept; the page's address
    is reduced to its family and is not stored. Never an error for the app: an unknown event is answered and dropped."""
    from activity import store
    from activity.events import told
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > 1024:                   # said to be too long: not read at all
        return {"accepted": False}
    raw = await request.body()
    if len(raw) > 1024:
        return {"accepted": False}
    try:
        body = await request.json()
    except Exception:                     # noqa: BLE001
        return {"accepted": False}
    if not isinstance(body, dict):
        return {"accepted": False}
    kind = told(str(body.get("event") or ""), str(body.get("detail") or ""), str(body.get("route") or ""))
    if not kind:
        return {"accepted": False}
    return {"accepted": store.add(str(user["sub"]), kind[0], kind[1])}


# Accounts are the people who signed up: not the journeys' test accounts, and not the platform's own admins, whose
# use of the desk is the operator's and would be counted as adoption otherwise (an account is left out by the role
# it has today: one made an admin later takes its history out with it).
ACCOUNTS_SQL = ("SELECT u.id, u.email, u.created_at, f.name FROM auth.users u "
                "LEFT JOIN profiles p ON p.id = u.id LEFT JOIN firm_members m ON m.user_id = u.id LEFT JOIN firms f ON f.id = m.firm_id "
                "WHERE u.email NOT LIKE '%@rijeka.test' AND coalesce(lower(p.role), '') <> 'admin'")
# days in UTC, as the counters' days are; trade_events.user_id is the account whose act the event is
BOOKED_SQL = ("SELECT user_id, (created_at AT TIME ZONE 'utc')::date, count(*), min(created_at), max(created_at) FROM trades "
              "WHERE coalesce(trade_ref, '') NOT LIKE 'TEST-%' GROUP BY 1, 2")
CONFIRMED_SQL = ("SELECT e.user_id, (e.tx_time AT TIME ZONE 'utc')::date, count(*), min(e.tx_time), max(e.tx_time) "
                 "FROM trade_events e JOIN trades t ON t.id = e.trade_id "
                 "WHERE e.event_type = 'CONFIRMED' AND coalesce(t.trade_ref, '') NOT LIKE 'TEST-%' GROUP BY 1, 2")
ADOPTION_DAYS = 12 * 7 + 28                # the weeks, the cohorts and the features; what says "ever" reads the whole record


def _rows(db: Session, sql: str) -> Optional[list]:
    """The rows, or None when they could not be read (which the view says, instead of showing none)."""
    try:
        return list(db.execute(text(sql)).all())
    except Exception as e:                # noqa: BLE001
        log.warning("adoption read failed: %s", type(e).__name__); db.rollback()
        return None


def adoption(db: Session, today: Optional[date] = None) -> dict[str, Any]:
    from activity import store
    from activity.adoption import summarise
    today = today or datetime.now(timezone.utc).date()
    read = {"accounts": _rows(db, ACCOUNTS_SQL), "trades": _rows(db, BOOKED_SQL), "confirmations": _rows(db, CONFIRMED_SQL),
            "activity": store.rows_since(db, today - timedelta(days=ADOPTION_DAYS)), "the whole record": store.ever(db)}
    unread = [name for name, rows in read.items() if rows is None]
    per_day = lambda rows: [{"user_id": r[0], "day": r[1], "n": int(r[2]), "first_at": r[3], "last_at": r[4]} for r in rows or [] if r[0] is not None]   # noqa: E731
    body = summarise([{"id": r[0], "email": r[1], "created_at": r[2], "firm": r[3]} for r in read["accounts"] or []],
                     read["activity"] or [], read["the whole record"] or [], per_day(read["trades"]), per_day(read["confirmations"]),
                     today, tracking_since=store.first_day(db), recording=store.table_present(db))
    body["unread"] = unread                # what could not be read just now: the figures are short by it, not zero
    body["dropped"] = store.status(db)["dropped"]
    body["note"] = ("Accounts are sign-ups, without test accounts and the platform's admins. An account is active on a day it did something "
                    "deliberate: opened a page (loading the app again counts), pressed PRICE, ran, saved, sent, booked or confirmed; what the "
                    "app asks for by itself is not counted. Came back means active 24 hours or more after it was first active. Bookings and confirmations are counted from "
                    "the trading tables and go back to the first trade; everything else is counted from the day the activity table was applied.")
    if not body["recording"]:
        body["note"] += " The activity table is not applied (docs/migrations/2026-11-16_activity.sql): nothing but bookings and confirmations is recorded."
    return body


@router.get("/api/ops/adoption")
def ops_adoption(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    require_admin(db, user)
    return adoption(db)
