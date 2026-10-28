"""
Unauthenticated numbers for the sign-in page: what the desk is doing right
now, with nothing that belongs to a user.

    GET /api/public/pulse

Returns the demo template's latest USD SOFR par curve and ATM swaption vol
grid (public sources only,
the same filter demo provisioning applies), how many confirmations carry an
on-chain hash, the registry and the latest Sepolia block, and the last 24
hours of Market News. Cached in-process for a minute; every field is
optional so a slow RPC or an empty table never breaks the page.
"""
import logging
import os
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from api.routes.demo import _template_user_id, _LICENSED_SOURCE_SQL

log = logging.getLogger("rijeka.public")
router = APIRouter(prefix="/api/public", tags=["public"])

TTL_SECONDS = 60
_cache: dict[str, Any] = {"at": 0.0, "body": None}


def _scalar(db: Session, sql: str, **p) -> Optional[int]:
    try:
        return int(db.execute(text(sql), p).scalar() or 0)
    except Exception as e:           # a missing table on a self-host is not an error here
        log.debug("pulse query failed: %s", e)
        db.rollback()
        return None


def _snapshot(db: Session, uid, curve_id: str) -> Optional[dict]:
    """Latest public snapshot of one curve: tenor and rate only."""
    if uid is None:
        return None
    try:
        row = db.execute(text(
            "SELECT curve_id, valuation_date, quotes FROM market_data_snapshots "
            "WHERE user_id = :u AND curve_id = :c AND valuation_date <= current_date "
            f"AND {_LICENSED_SOURCE_SQL} ORDER BY valuation_date DESC LIMIT 1"), {"u": uid, "c": curve_id}).first()
    except Exception as e:
        log.debug("pulse curve failed: %s", e)
        db.rollback()
        return None
    if row is None:
        return None
    quotes = [{"tenor": q.get("tenor"), "rate": q.get("rate")}
              for q in (row.quotes or []) if q.get("enabled", True) and q.get("rate") is not None]
    return {"curve_id": row.curve_id, "valuation_date": row.valuation_date.isoformat(), "quotes": quotes}


def _chain() -> dict:
    out: dict[str, Any] = {"anchored": False}
    try:
        from chain.attestation import get_backend
        be = get_backend()
        out.update(anchored=True, chain_id=getattr(be, "chain_id", None),
                   registry=getattr(be, "registry", None), explorer=getattr(be, "explorer", None))
        w3 = getattr(be, "w3", None)
        if w3 is not None:
            out["latest_block"] = int(w3.eth.block_number)
    except Exception as e:
        log.debug("pulse chain failed: %s", e)
    return out


def build(db: Session) -> dict:
    uid = _template_user_id(db)
    return {
        "curve": _snapshot(db, uid, "USD_SOFR"),
        "vol": _snapshot(db, uid, "USD_SWVOL_ATM"),      # expiry x tenor ATM normal vols, "1Yx5Y" tenors
        "curves": _scalar(db, "SELECT count(DISTINCT curve_id) FROM market_data_snapshots "
                              "WHERE user_id = :u AND curve_id NOT LIKE 'TEST-%'", u=uid) if uid else None,
        "confirmations": _scalar(db, "SELECT count(*) FROM trade_events "
                                     "WHERE event_type = 'CONFIRMED' AND confirmation_hash IS NOT NULL"),
        "news_24h": _scalar(db, "SELECT count(*) FROM news_items WHERE created_at > now() - interval '24 hours'"),
        "chain": _chain(),
        "demo": bool(os.getenv("RIJEKA_DEMO_PROVISION")),
    }


@router.get("/pulse")
def pulse(db: Session = Depends(get_db)):
    now = time.monotonic()
    if _cache["body"] is not None and now - _cache["at"] < TTL_SECONDS:
        return _cache["body"]
    body = build(db)
    _cache.update(at=now, body=body)
    return body
