"""
Operations: is every scheduled batch current, and what is breaking in browsers?

GET /api/ops/health is public and carries no account data: for each batch the
cron drives it reports the last run and whether that is recent enough. The
cron's final step calls it and fails the workflow run when anything is stale,
so GitHub mails the repository owner; the desk's inbox shows the same item to
signed-in users, because a stale batch is their stale page.

POST /api/ops/client-error takes uncaught browser errors from the app (window
errors, unhandled promises, React boundaries). They live in memory on this
process only: the last 200, with a count per (message, route) over 24 hours,
60 a minute per client address and 4 KB a report, tokens stripped. The health
body carries the summary as `client_errors`; it is information for the
operator and never fails the cron.
"""
from __future__ import annotations

import logging
import re
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token

router = APIRouter(prefix="/api/ops", tags=["ops"])
log = logging.getLogger(__name__)

CACHE_SECONDS = 60
_cache: dict[str, Any] = {"at": 0.0, "body": None}


def previous_business_day(d: date) -> date:
    d = d - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


# name, sql for the last run, rule ("hours", n) or ("business_day",), what it feeds
CHECKS = [
    ("news", "SELECT max(created_at) FROM news_items", ("hours", 3), "the NEWS room"),
    ("spots", "SELECT max(created_at) FROM market_data_snapshots WHERE curve_id LIKE '%\\_SPOT'", ("hours", 3), "FX and crypto spot"),
    ("market_data", "SELECT max(valuation_date) FROM market_data_snapshots WHERE curve_id = 'USD_SOFR'", ("business_day",), "curves and vols"),
    ("pnl", "SELECT max(pnl_date) FROM pnl_daily", ("business_day",), "P&L"),
    ("risk", "SELECT max(risk_date) FROM risk_daily", ("business_day",), "market risk"),
    ("ccr", "SELECT max(run_date) FROM ccr_daily", ("business_day",), "counterparty credit"),
]


def _as_utc(v) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return None


def evaluate(db: Session, now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    floor = previous_business_day(now.date())
    checks: dict[str, dict] = {}
    for name, sql, rule, feeds in CHECKS:
        try:
            last = db.execute(text(sql)).scalar()
        except Exception as e:            # noqa: BLE001 — a missing table is a stale batch, not a crash
            log.debug("ops: %s failed: %s", name, e)
            db.rollback()
            last = None
        if rule[0] == "hours":
            dt = _as_utc(last)
            ok = dt is not None and (now - dt) <= timedelta(hours=rule[1])
            rule_text = f"within {rule[1]}h"
        else:
            d = last.date() if isinstance(last, datetime) else last
            ok = isinstance(d, date) and d >= floor
            rule_text = f"on or after {floor.isoformat()}"
        checks[name] = {"ok": bool(ok), "last": last.isoformat() if last is not None else None,
                        "rule": rule_text, "feeds": feeds}
    return {"ok": all(c["ok"] for c in checks.values()), "checked_at": now.isoformat(), "checks": checks}


def health(db: Session) -> dict:
    """Cached for a minute: the inbox of every signed-in user asks too."""
    if _cache["body"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
        return _cache["body"]
    body = evaluate(db)
    _cache.update(at=time.time(), body=body)
    return body


def stale_batches(db: Session) -> list[dict]:
    """[{name, feeds, last}] for the inbox; empty when everything is current."""
    try:
        h = health(db)
    except Exception as e:                # noqa: BLE001
        log.debug("ops: health failed: %s", e)
        return []
    return [{"name": k, **v} for k, v in h["checks"].items() if not v["ok"]]


@router.get("/health")
def ops_health(db: Session = Depends(get_db)):
    """Batch freshness and the commit this process runs (Render's RENDER_GIT_COMMIT): the release-sync
    workflow reads `commit` to move the branch the frontend deploys from. The bare /health path belongs
    to the curves router, which is why the commit lives here. Browser error text is not in this public
    body (anyone can post it); it is served to signed-in users by /client-errors."""
    import os
    return {**health(db), "client_errors": {"last_24h": client_error_summary()["last_24h"]},
            "commit": os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or None}


@router.get("/client-errors")
def ops_client_errors(user: dict = Depends(verify_token)):
    return client_error_summary()


# ── browser errors ───────────────────────────────────────────────────────────
ERR_KEEP = 200                      # ring buffer of reports
ERR_WINDOW_SECONDS = 24 * 3600      # the summary's horizon
ERR_PER_MINUTE = 60                 # per client address; beyond it reports are dropped silently
ERR_MAX_BODY = 4096                 # bytes
ERR_FIELD = 1000                    # characters kept per text field (stack gets 4x)
_errors: deque = deque(maxlen=ERR_KEEP)
_rate: dict[str, deque] = {}
_TOKEN_RE = re.compile(r"(Bearer\s+[A-Za-z0-9._~+/=-]+|eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2})")


def scrub(text_: Any, limit: int = ERR_FIELD) -> str:
    """Anything shaped like a bearer token or a JWT is replaced before it is kept."""
    return _TOKEN_RE.sub("[token]", str(text_ or ""))[:limit]


def _client_ip(request: Request) -> str:
    # uvicorn runs with --proxy-headers, so request.client already holds the address the trusted
    # proxy saw; reading X-Forwarded-For ourselves would let a client prepend any hop it likes
    return request.client.host if request.client else "unknown"


def _allow(ip: str, now: float) -> bool:
    q = _rate.setdefault(ip, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= ERR_PER_MINUTE:
        return False
    q.append(now)
    if len(_rate) > 2000:               # forget quiet addresses
        for k in [k for k, v in _rate.items() if not v or now - v[-1] > 60]:
            _rate.pop(k, None)
    return True


def record_client_error(body: dict, ip: str, now: Optional[float] = None) -> bool:
    now = now or time.time()
    if not _allow(ip, now):
        return False
    _errors.append({"at": now, "message": scrub(body.get("message")), "stack": scrub(body.get("stack"), ERR_FIELD * 4),
                    "url": scrub(body.get("url"), 300), "route": scrub(body.get("route"), 200) or "/",
                    "user_agent": scrub(body.get("user_agent"), 200), "release": scrub(body.get("release"), 60),
                    "source": scrub(body.get("source"), 20) or "window", "client_at": scrub(body.get("at"), 40)})
    return True


def client_error_summary(now: Optional[float] = None) -> dict:
    now = now or time.time()
    recent = [e for e in _errors if now - e["at"] <= ERR_WINDOW_SECONDS]
    groups: dict[tuple[str, str], dict] = {}
    for e in recent:
        g = groups.setdefault((e["message"][:200], e["route"]), {"message": e["message"][:200], "route": e["route"], "count": 0, "last": 0.0,
                                                                  "source": e["source"], "release": e["release"]})
        g["count"] += 1
        g["last"] = max(g["last"], e["at"])
    top = sorted(groups.values(), key=lambda g: (-g["count"], -g["last"]))[:5]
    for g in top:
        g["last"] = datetime.fromtimestamp(g["last"], tz=timezone.utc).isoformat()
    return {"last_24h": len(recent), "distinct": len(groups), "top": top, "kept": len(_errors), "limit_per_minute": ERR_PER_MINUTE}


@router.post("/client-error", status_code=202)
async def ops_client_error(request: Request):
    raw = await request.body()
    if len(raw) > ERR_MAX_BODY:
        return {"accepted": False, "reason": "too large"}
    try:
        import json
        body = json.loads(raw or b"{}")
        if not isinstance(body, dict):
            raise ValueError("not an object")
    except Exception:                 # noqa: BLE001 — a malformed report is dropped, never an error back to a failing page
        return {"accepted": False, "reason": "malformed"}
    ok = record_client_error(body, _client_ip(request))
    return {"accepted": ok}
