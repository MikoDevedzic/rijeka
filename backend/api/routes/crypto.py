"""
Digital assets — spot, funding and the CRYPTO_FORWARD pricer.

    GET  /api/crypto/spot                 latest spot and funding snapshots for this account
    POST /api/crypto/spot/snap            pull BTC/ETH/SOL spot from a public exchange API, save as snapshots
    POST /api/crypto/spot/tick            same, for the demo template account (X-Rijeka-Cron), so new
                                          visitors get fresh spot
    POST /api/crypto/forward/price        price a non-deliverable forward from parameters (no booking)

Market data lives in market_data_snapshots like everything else, per user:
    {ASSET}USD_SPOT     quotes [{"tenor": "SPOT", "rate": <USD per unit>}]     source IMPORT (public feed)
    {ASSET}_FUNDING     quotes [{"tenor": "FLAT", "rate": <% p.a., continuous>}]  source MANUAL (desk input)

Spot comes from Coinbase's public price endpoint: no key, no licence, and
a visitor's copy of it carries no restricted data. Funding defaults to 0 %
until the desk sets it; the response says which source each input came from.

Booked CRYPTO_FORWARD trades are priced from trade.terms by price_booked()
when POST /api/price/trade meets one (the trade has no legs).
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import date
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.models import Trade
from db.session import get_db
from middleware.auth import verify_token
from pricing.crypto_forward import price_crypto_forward

log = logging.getLogger("rijeka.crypto")
router = APIRouter(prefix="/api/crypto", tags=["crypto"])

ASSETS = ("BTC", "ETH", "SOL")
SPOT_URL = "https://api.coinbase.com/v2/prices/{asset}-USD/spot"
SPOT_SOURCE_NAME = "Coinbase spot (public)"


def _require_trader(user: dict) -> None:
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")


# ── market data ────────────────────────────────────────────────────────────

def fetch_spot(assets=ASSETS, timeout: float = 8.0) -> dict[str, float]:
    """USD per unit from the public endpoint; raises if nothing could be read."""
    out: dict[str, float] = {}
    with httpx.Client(timeout=timeout, headers={"User-Agent": "rijeka/0.4 (+https://rijeka.app)"}) as c:
        for a in assets:
            try:
                r = c.get(SPOT_URL.format(asset=a))
                r.raise_for_status()
                out[a] = float(r.json()["data"]["amount"])
            except Exception as e:
                log.warning("spot %s failed: %s", a, e)
    if not out:
        raise RuntimeError("no spot prices could be fetched")
    return out


def save_spot(db: Session, user_id, prices: dict[str, float], as_of: Optional[date] = None) -> int:
    as_of = as_of or date.today()
    n = 0
    for a, px in prices.items():
        cid = f"{a}USD_SPOT"
        quotes = [{"tenor": "SPOT", "quote_type": "SPOT", "rate": px, "enabled": True}]
        # one row per curve and day: replace today's if it exists, so a re-snap is idempotent
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
                   {"u": user_id, "c": cid, "d": as_of})
        db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                        "VALUES (:c, :d, CAST(:q AS jsonb), 'IMPORT', :u, :u)"),
                   {"c": cid, "d": as_of, "q": _dumps(quotes), "u": user_id})
        n += 1
    db.commit()
    return n


def _dumps(v) -> str:
    import json
    return json.dumps(v)


def latest_snapshot(db: Session, user_id, curve_id: str):
    return db.execute(text("SELECT valuation_date, quotes, source FROM market_data_snapshots "
                           "WHERE user_id = :u AND curve_id = :c ORDER BY valuation_date DESC LIMIT 1"),
                      {"u": user_id, "c": curve_id}).first()


def _quote(row, tenor: str) -> Optional[float]:
    if not row or not row.quotes:
        return None
    for q in row.quotes:
        if q.get("tenor") == tenor and q.get("rate") is not None and q.get("enabled", True):
            return float(q["rate"])
    return None


def spot_and_funding(db: Session, user_id, asset: str) -> dict[str, Any]:
    s = latest_snapshot(db, user_id, f"{asset}USD_SPOT")
    f = latest_snapshot(db, user_id, f"{asset}_FUNDING")
    return {
        "asset": asset,
        "spot": _quote(s, "SPOT"),
        "spot_as_of": s.valuation_date.isoformat() if s else None,
        "spot_source": s.source if s else None,
        "funding_pct": _quote(f, "FLAT"),
        "funding_as_of": f.valuation_date.isoformat() if f else None,
    }


@router.get("/spot")
def get_spot(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return {"assets": [spot_and_funding(db, user["sub"], a) for a in ASSETS], "feed": SPOT_SOURCE_NAME}


@router.post("/spot/snap")
def snap_spot(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _require_trader(user)
    try:
        prices = fetch_spot()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"spot feed unavailable: {e}")
    n = save_spot(db, uuid.UUID(user["sub"]), prices)
    return {"saved": n, "prices": prices, "as_of": date.today().isoformat(), "feed": SPOT_SOURCE_NAME}


@router.post("/spot/tick")
def tick_spot(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None, alias="X-Rijeka-Cron")):
    """Cron: refresh the demo template's spot so provisioned visitors copy today's price."""
    secret = os.getenv("RIJEKA_CRON_SECRET", "")
    if not secret or x_rijeka_cron != secret:
        raise HTTPException(status_code=401, detail="bad cron secret")
    from api.routes.demo import _template_user_id
    uid = _template_user_id(db)
    if uid is None:
        raise HTTPException(status_code=422, detail="RIJEKA_DEMO_TEMPLATE_EMAIL is not set or has no account")
    try:
        prices = fetch_spot()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"spot feed unavailable: {e}")
    return {"saved": save_spot(db, uid, prices), "prices": prices}


class FundingRequest(BaseModel):
    digital_asset: str
    rate_pct: float = Field(..., description="asset funding / staking rate, % p.a. continuous (can be negative)")


@router.post("/funding")
def set_funding(req: FundingRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Desk input: today's funding rate for one asset, saved as a MANUAL snapshot."""
    _require_trader(user)
    asset = req.digital_asset.upper()
    if asset not in ASSETS:
        raise HTTPException(status_code=422, detail=f"digital_asset must be one of {', '.join(ASSETS)}")
    uid, cid, today = uuid.UUID(user["sub"]), f"{asset}_FUNDING", date.today()
    quotes = [{"tenor": "FLAT", "quote_type": "FUNDING", "rate": float(req.rate_pct), "enabled": True}]
    db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
               {"u": uid, "c": cid, "d": today})
    db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                    "VALUES (:c, :d, CAST(:q AS jsonb), 'MANUAL', :u, :u)"), {"c": cid, "d": today, "q": _dumps(quotes), "u": uid})
    db.commit()
    return spot_and_funding(db, uid, asset)


# ── pricing ────────────────────────────────────────────────────────────────

class ForwardPriceRequest(BaseModel):
    digital_asset: str = Field(..., examples=["BTC"])
    notional_amount: float = Field(..., gt=0, description="units of the asset")
    settlement_date: date
    valuation_date: Optional[date] = None
    forward_price: Optional[float] = Field(None, description="contract price K in USD; omitted = at the fair forward")
    direction: str = "BUY"
    spot: Optional[float] = Field(None, gt=0, description="override the saved spot")
    asset_rate_pct: Optional[float] = Field(None, description="override the saved funding rate, % p.a. continuous")


def _usd_curve(db: Session, user_id: str, val_date: date):
    # the pricer's own loader, so crypto discounts off exactly the curve the swaps use
    from api.routes.pricer import _build_curve, CurveInput
    try:
        return _build_curve(CurveInput(curve_id="USD_SOFR"), val_date, db, user_id)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"USD_SOFR: {e}")


def _inputs(db: Session, user_id: str, asset: str, spot: Optional[float], rate_pct: Optional[float]) -> dict:
    md = spot_and_funding(db, user_id, asset)
    if spot is not None:
        s, s_src = float(spot), "request"
    elif md["spot"] is not None:
        s, s_src = md["spot"], f"snapshot {md['spot_as_of']}"
    else:
        raise HTTPException(status_code=422, detail=f"No {asset} spot saved. Click SNAP SPOT (Configurations → Digital assets) or pass spot.")
    if rate_pct is not None:
        r, r_src = float(rate_pct) / 100.0, "request"
    elif md["funding_pct"] is not None:
        r, r_src = md["funding_pct"] / 100.0, f"snapshot {md['funding_as_of']}"
    else:
        r, r_src = 0.0, "default 0%"
    return {"spot": s, "spot_source": s_src, "asset_rate": r, "asset_rate_source": r_src}


def _result_json(res, inputs: dict, val_date: date, curve) -> dict:
    d = res.__dict__.copy()
    d.update(valuation_date=val_date.isoformat(), spot_source=inputs["spot_source"],
             asset_rate_source=inputs["asset_rate_source"], asset_rate_pct=res.asset_rate * 100,
             usd_curve="USD_SOFR", usd_curve_snapshot=getattr(curve, "snapshot_date", None) and str(curve.snapshot_date),
             model="covered interest parity: F = S·DF_USD/DF_asset; NPV = ±N·(F−K)·DF_USD; ACT/365")
    return d


@router.post("/forward/price")
def price_forward(req: ForwardPriceRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    asset = req.digital_asset.upper()
    if asset not in ASSETS:
        raise HTTPException(status_code=422, detail=f"digital_asset must be one of {', '.join(ASSETS)}")
    val_date = req.valuation_date or date.today()
    inputs = _inputs(db, user["sub"], asset, req.spot, req.asset_rate_pct)
    curve = _usd_curve(db, user["sub"], val_date)
    try:
        res = price_crypto_forward(digital_asset=asset, notional_amount=req.notional_amount, forward_price=req.forward_price,
                                   spot=inputs["spot"], valuation_date=val_date, settlement_date=req.settlement_date,
                                   usd_curve=curve, asset_rate=inputs["asset_rate"], direction=req.direction)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _result_json(res, inputs, val_date, curve)


def price_booked(trade: Trade, db: Session, user: dict, val_date: date) -> dict:
    """A booked CRYPTO_FORWARD, from trade.terms (the canonical record's fields)."""
    t = dict(trade.terms or {})
    asset = str(t.get("digital_asset") or "").upper()
    if asset not in ASSETS:
        raise HTTPException(status_code=422, detail="trade.terms.digital_asset must be BTC, ETH or SOL")
    try:
        notional = float(t.get("notional_amount") or trade.notional or 0)
        K = float(t["forward_price"]) if t.get("forward_price") not in (None, "") else None
        settle = date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"trade.terms is missing or malformed: {e}")
    inputs = _inputs(db, user["sub"], asset, None, None)
    curve = _usd_curve(db, user["sub"], val_date)
    try:
        res = price_crypto_forward(digital_asset=asset, notional_amount=notional, forward_price=K, spot=inputs["spot"],
                                   valuation_date=val_date, settlement_date=settle, usd_curve=curve,
                                   asset_rate=inputs["asset_rate"], direction=str(t.get("direction") or "BUY"))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    out = _result_json(res, inputs, val_date, curve)
    out.update(trade_id=str(trade.id), trade_ref=trade.trade_ref, instrument_type="CRYPTO_FORWARD",
               npv_ccy="USD", legs=[])
    return out
