"""
Operations: is every scheduled batch current?

GET /api/ops/health is public and carries no account data: for each batch the
cron drives it reports the last run and whether that is recent enough. The
cron's final step calls it and fails the workflow run when anything is stale,
so GitHub mails the repository owner; the desk's inbox shows the same item to
signed-in users, because a stale batch is their stale page.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db

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
    return health(db)
