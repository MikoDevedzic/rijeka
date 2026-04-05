# bloomberg.py — FastAPI routes for Bloomberg terminal integration
# Mounts at /api/bloomberg/...

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import date
import json

from db.session import get_db
from middleware.auth import verify_token
from pricing.bloomberg_client import (
    check_connection,
    snap_live,
    snap_historical,
    get_default_tickers,
    BLOOMBERG_AVAILABLE,
)

router = APIRouter()


class SnapRequest(BaseModel):
    curve_id: str
    snap_date: str
    tickers: list[dict]
    mode: str


class TickerOverrideRequest(BaseModel):
    curve_id: str
    overrides: list[dict]


@router.get("/bloomberg/status")
async def bloomberg_status():
    return check_connection()


@router.get("/bloomberg/tickers/{curve_id}")
async def get_tickers(
    curve_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    defaults = get_default_tickers(curve_id)

    try:
        rows = db.execute(
            text("SELECT tenor, ticker FROM bloomberg_ticker_overrides WHERE curve_id = :cid AND created_by = :uid"),
            {"cid": curve_id, "uid": user["sub"]},
        ).fetchall()
    except Exception:
        rows = []

    merged = dict(defaults)
    has_overrides = False
    for row in rows:
        merged[row.tenor] = row.ticker
        has_overrides = True

    return {
        "curve_id": curve_id,
        "tickers": merged,
        "has_overrides": has_overrides,
        "total_tenors": len(merged),
    }


@router.post("/bloomberg/snap")
async def bloomberg_snap(
    req: SnapRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    role = user.get("user_metadata", {}).get("role", "viewer")
    if role not in ("trader", "admin"):
        raise HTTPException(403, "TRADER or ADMIN role required to snap market data")

    if not BLOOMBERG_AVAILABLE:
        raise HTTPException(503, "blpapi not installed. Run: pip install blpapi --break-system-packages")

    if not req.tickers:
        raise HTTPException(422, "No tickers provided. Select BLOOMBERG source and wait for tickers to load.")

    ticker_list = [t["ticker"] for t in req.tickers]
    snap_date = date.fromisoformat(req.snap_date)

    try:
        if req.mode == "live":
            prices = snap_live(ticker_list)
        else:
            prices = snap_historical(ticker_list, snap_date)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    ticker_to_tenor = {t["ticker"]: t["tenor"] for t in req.tickers}
    quotes = []
    failed_tenors = []

    for ticker, price in prices.items():
        tenor = ticker_to_tenor.get(ticker)
        if tenor is None:
            continue
        if price is not None:
            quotes.append({
                "tenor": tenor,
                "quote_type": "SWAP",
                "rate": price,
                "ticker": ticker,
                "enabled": True,
            })
        else:
            failed_tenors.append(tenor)

    if not quotes:
        raise HTTPException(
            422,
            f"Bloomberg returned no prices. Check tickers are valid. Failed tenors: {failed_tenors}",
        )

    quotes_json = json.dumps(quotes)

    existing = db.execute(
        text("SELECT id FROM market_data_snapshots WHERE curve_id = :cid AND valuation_date = :dt"),
        {"cid": req.curve_id, "dt": snap_date},
    ).fetchone()

    if existing:
        db.execute(
            text("UPDATE market_data_snapshots SET quotes = :q, source = 'BLOOMBERG', created_by = :uid WHERE id = :id"),
            {"q": quotes_json, "uid": user["sub"], "id": str(existing.id)},
        )
    else:
        db.execute(
            text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by) VALUES (:cid, :dt, :q, 'BLOOMBERG', :uid)"),
            {"cid": req.curve_id, "dt": snap_date, "q": quotes_json, "uid": user["sub"]},
        )

    db.commit()

    return {
        "saved": True,
        "curve_id": req.curve_id,
        "snap_date": req.snap_date,
        "source": "BLOOMBERG",
        "quotes_saved": len(quotes),
        "failed_tenors": failed_tenors,
        "quotes": quotes,
    }


@router.post("/bloomberg/tickers/override")
async def save_ticker_overrides(
    req: TickerOverrideRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    for override in req.overrides:
        db.execute(
            text("INSERT INTO bloomberg_ticker_overrides (curve_id, tenor, ticker, created_by) VALUES (:cid, :tenor, :ticker, :uid) ON CONFLICT (curve_id, tenor, created_by) DO UPDATE SET ticker = :ticker"),
            {
                "cid": req.curve_id,
                "tenor": override["tenor"],
                "ticker": override["ticker"],
                "uid": user["sub"],
            },
        )
    db.commit()
    return {"saved": True, "count": len(req.overrides)}
