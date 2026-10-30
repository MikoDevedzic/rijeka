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
import threading
import time
from typing import Any, Optional

from fastapi import HTTPException, APIRouter, Depends
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
            "SELECT curve_id, valuation_date, quotes, source FROM market_data_snapshots "
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
    return {"curve_id": row.curve_id, "valuation_date": row.valuation_date.isoformat(), "quotes": quotes,
            "source": row.source}


def _headlines(db: Session, n: int = 8) -> list[dict]:
    """The newest public headlines (title, source, link): what the NEWS room shows."""
    try:
        from api.routes.news import summary_columns
        cols = "summary, summary_basis" if summary_columns(db) else "NULL AS summary, NULL AS summary_basis"
        rows = db.execute(text(
            f"SELECT title, source, url, published_at, {cols} FROM news_items "
            "ORDER BY coalesce(published_at, created_at) DESC LIMIT :n"), {"n": n}).all()
        return [{"title": r.title, "source": r.source, "url": r.url,
                 "published_at": r.published_at.isoformat() if r.published_at else None,
                 "summary": r.summary, "summary_basis": r.summary_basis} for r in rows]
    except Exception as e:
        log.debug("pulse headlines failed: %s", e)
        db.rollback()
        return []


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
        "headlines": _headlines(db),
        "chain": _chain(),
        "demo": bool(os.getenv("RIJEKA_DEMO_PROVISION")),
        # Where the demo's numbers come from (public sources, synthetic vols): see market_data/demo_feed.py.
        "market_data": {"kind": "demo", "providers": [x["provider"] for x in _demo_sources()]},
    }


def _demo_sources() -> list[dict]:
    try:
        from market_data.demo_feed import SOURCES
        return SOURCES
    except Exception:       # noqa: BLE001
        return []


_refreshing = threading.Lock()


def _refresh_in_background() -> None:
    """Rebuild the pulse on a worker thread with its own session; never on a request."""
    if not _refreshing.acquire(blocking=False):
        return
    def run():
        from db.session import SessionLocal
        db = SessionLocal()
        try:
            body = build(db)
            _cache.update(at=time.monotonic(), body=body)
        except Exception as e:
            log.warning("pulse refresh failed: %s", e)
        finally:
            db.close()
            _refreshing.release()
    threading.Thread(target=run, name="pulse-refresh", daemon=True).start()


@router.get("/pulse")
def pulse(db: Session = Depends(get_db)):
    """Stale-while-revalidate: a visitor always gets the last numbers at once;
    the Sepolia block lookup and the queries run behind them."""
    now = time.monotonic()
    if _cache["body"] is None:
        body = build(db)                     # very first call after boot
        _cache.update(at=now, body=body)
        return body
    if now - _cache["at"] >= TTL_SECONDS:
        _refresh_in_background()
    return _cache["body"]


def warm() -> None:
    """Called at startup so the first visitor never waits either."""
    _refresh_in_background()


# ── the public register of confirmations ───────────────────────────────────
#
# Every confirmation anchored through this instance, newest first: the hash,
# the block and transaction, the two LEIs, whether both parties signed with
# their own keys, and the product. Nothing a counterparty could not read off
# the chain already, plus the product and asset class so the list means
# something. No refs, no notionals, no names.

_REG_SQL = """
SELECT e.payload, e.created_at, e.trade_id, t.asset_class, t.instrument_type, t.structure
FROM trade_events e JOIN trades t ON t.id = e.trade_id
WHERE e.event_type = 'CONFIRMED' AND e.confirmation_hash IS NOT NULL
ORDER BY e.created_at DESC LIMIT :n
"""
_reg_cache: dict[str, Any] = {"at": 0.0, "body": None, "n": 0}


def _register(db: Session, n: int) -> dict:
    rows = []
    try:
        for r in db.execute(text(_REG_SQL), {"n": n}):
            att = (r.payload or {}).get("attestation") or {}
            anchor = att.get("anchor") or {}
            if not anchor.get("anchored"):
                continue
            parties = att.get("parties") or {}
            own, cp = parties.get("own") or {}, parties.get("counterparty") or {}
            rows.append({
                "trade_hash": att.get("trade_hash"),
                "block_number": anchor.get("block_number"), "tx_hash": anchor.get("tx_hash"),
                "explorer_tx": anchor.get("explorer_tx"), "chain_id": anchor.get("chain_id"), "registry": anchor.get("registry"),
                "confirmed_at": anchor.get("confirmed_at"),
                "parties": sorted([x for x in (own.get("lei"), cp.get("lei")) if x]),
                "addresses": [own.get("address"), cp.get("address")],
                "bilateral": bool(att.get("bilateral")),
                "key_sources": [own.get("key_source"), cp.get("key_source")],
                "asset_class": r.asset_class, "instrument_type": r.instrument_type, "structure": r.structure,
                "schema_version": att.get("schema_version"),
            })
    except Exception as e:
        log.debug("register failed: %s", e)
        db.rollback()
    total = _scalar(db, "SELECT count(*) FROM trade_events WHERE event_type = 'CONFIRMED' AND confirmation_hash IS NOT NULL")
    bilateral = _scalar(db, "SELECT count(*) FROM trade_events WHERE event_type = 'CONFIRMED' AND confirmation_hash IS NOT NULL "
                            "AND (payload->'attestation'->>'bilateral') = 'true'")
    return {"total": total, "bilateral": bilateral, "confirmations": rows}


_pp_cache: dict[str, dict] = {}


@router.get("/policy-path")
def policy_path(ccy: str = "USD", db: Session = Depends(get_db)):
    """Public: the market-implied overnight-rate path for one currency from the demo curve,
    with the Fed's SEP medians for USD. Cached for TTL_SECONDS per currency."""
    from market_data import policy_path as pp
    ccy = (ccy or "USD").upper()
    if ccy not in pp.CCY:
        raise HTTPException(status_code=404, detail=f"unknown currency {ccy}; one of {', '.join(pp.CCY)}")
    now = time.time()
    hit = _pp_cache.get(ccy)
    if hit and now - hit["at"] < TTL_SECONDS:
        return hit["body"]
    meta = pp.CCY[ccy]
    uid = _template_user_id(db)
    row = None
    if uid is not None:
        try:
            row = db.execute(text(
                "SELECT valuation_date, quotes, source FROM market_data_snapshots "
                "WHERE user_id = :u AND curve_id = :c AND valuation_date <= current_date "
                f"AND {_LICENSED_SOURCE_SQL} ORDER BY valuation_date DESC LIMIT 1"), {"u": uid, "c": meta["curve"]}).first()
        except Exception as e:      # noqa: BLE001
            log.debug("policy path query failed: %s", e); db.rollback()
    body: dict[str, Any] = {"ccy": ccy, "bank": meta["bank"], "fixing_name": meta["fixing"], "curve_id": meta["curve"],
                            "as_of": None, "source": None, "fixing": None, "term_structure": False, "path": [], "cumulative_bp": {}, "meetings": []}
    if row is not None:
        try:
            body.update(pp.implied_path(list(row.quotes or []), row.valuation_date, meta["basis"], ccy=ccy))
        except Exception as e:      # noqa: BLE001 — a curve that will not bootstrap shows the fixing only
            log.warning("policy path %s failed: %s", ccy, e)
        body.update(as_of=row.valuation_date.isoformat(), source=row.source)
    if ccy == "USD":
        body["dots"] = pp.fed_dots()
    _pp_cache[ccy] = {"at": now, "body": body}
    return body


@router.get("/confirmations")
def confirmations(limit: int = 50, db: Session = Depends(get_db)):
    n = max(1, min(int(limit), 200))
    now = time.monotonic()
    if _reg_cache["body"] is not None and _reg_cache["n"] == n and now - _reg_cache["at"] < TTL_SECONDS:
        return _reg_cache["body"]
    body = _register(db, n)
    _reg_cache.update(at=now, body=body, n=n)
    return body


@router.get("/calendar")
def calendar_week_ahead():
    """The week ahead: decisions and releases across USD, EUR, GBP, CHF, JPY with last prints and actuals.
    Public, no account data, cached for half an hour (see market_data/calendar.py for every source)."""
    from market_data.calendar import cached_week_ahead
    return cached_week_ahead()
