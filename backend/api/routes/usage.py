"""
Usage: where people go and where they stop, without cookies or a third party.

POST /api/public/hit        the app's beacon: {event, route, release}. Public, ≤ 1 KB, 120 a
                            minute per address. The visitor is a hash of address + user agent +
                            day + a server secret: it rotates daily, is never written back to
                            the browser, and cannot be reversed. No cookie is set.
GET  /api/ops/usage         signed-in: the last 14 days per day — visitors, views, sign-ups
                            started (beacon), accounts created (auth.users), trades booked,
                            confirmations, anchors (trade_events) — and totals.
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
    salt = secret if secret is not None else (os.environ.get("RIJEKA_CRON_SECRET") or os.environ.get("RIJEKA_USAGE_SALT") or "rijeka")
    return hashlib.sha256(f"{ip}|{ua}|{day.isoformat()}|{salt}".encode()).hexdigest()[:16]


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


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
    return usage(db)
