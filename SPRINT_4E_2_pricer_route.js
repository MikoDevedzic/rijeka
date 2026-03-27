// SPRINT_4E_2_pricer_route.js
// Writes: backend/api/routes/pricer.py
// Adds: CurveInput.quotes[] support alongside flat_rate (backward compat)
// Run from Rijeka root: node SPRINT_4E_2_pricer_route.js

const fs = require('fs');
const path = require('path');

const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

const content = `"""
Rijeka — pricer routes (Sprint 4E: curve bootstrap)

POST /api/pricer/price
  Price a trade: returns NPV, PV01, DV01, Theta, per-leg PVs and cashflows.

POST /api/pricer/cashflows/generate
  Generate and persist the cashflow schedule for a trade.

Curve inputs accept either:
  Sprint 3 (flat): { curve_id: "USD_SOFR", flat_rate: 0.0525 }
  Sprint 4 (market): { curve_id: "USD_SOFR", quotes: [{tenor, quote_type, rate}, ...] }
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.models import Cashflow, Trade, TradeLeg
from db.session import get_db
from middleware.auth import verify_token
from pricing.bootstrap import bootstrap_from_dicts
from pricing.curve import Curve
from pricing.fx_forward import price_fx_forward
from pricing.greeks import compute_greeks
from pricing.ir_swap import price_swap

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Input / output models
# ─────────────────────────────────────────────────────────────────────────────

class CurveQuote(BaseModel):
    """Single market quote for curve bootstrap (Sprint 4)."""
    tenor: str
    quote_type: str          # DEPOSIT | OIS_SWAP | IRS | FRA | FUTURES
    rate: float              # decimal, e.g. 0.0525 = 5.25%
    fra_start_tenor: Optional[str] = None
    day_count: Optional[str] = None


class CurveInput(BaseModel):
    """
    Curve specification for one curve_id.
    Provide EITHER flat_rate (Sprint 3) OR quotes[] (Sprint 4 bootstrap).
    If both present, quotes[] takes precedence when >= 2 quotes supplied.
    """
    curve_id: str
    flat_rate: Optional[float] = None
    quotes: Optional[List[CurveQuote]] = None


class PriceRequest(BaseModel):
    trade_id: str
    valuation_date: Optional[date] = None   # defaults to date.today()
    curves: List[CurveInput]


class CashflowGenRequest(BaseModel):
    trade_id: str
    valuation_date: Optional[date] = None
    curves: List[CurveInput]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

_IR_INSTRUMENTS = {
    "IR_SWAP", "OIS_SWAP", "BASIS_SWAP", "XCCY_SWAP",
    "CAPPED_SWAP", "FLOORED_SWAP", "COLLARED_SWAP",
    "CALLABLE_SWAP", "CANCELLABLE_SWAP",
    "IR_SWAPTION", "BERMUDAN_SWAPTION",
    "INTEREST_RATE_CAP", "INTEREST_RATE_FLOOR", "INTEREST_RATE_COLLAR",
    "FRA",
}

_FX_INSTRUMENTS = {"FX_FORWARD", "NDF"}


def _build_curve(ci: CurveInput, valuation_date: date) -> Curve:
    """
    Build a Curve object from a CurveInput.
    quotes[] wins when at least 2 filled quotes are present.
    Falls back to flat_rate for backward compatibility.
    """
    valid_quotes = [q for q in (ci.quotes or []) if q.rate is not None]
    if len(valid_quotes) >= 2:
        return bootstrap_from_dicts(
            valuation_date,
            [q.dict() for q in valid_quotes],
        )
    if ci.flat_rate is not None:
        return Curve(valuation_date=valuation_date, flat_rate=float(ci.flat_rate))
    raise ValueError(
        f"Curve '{ci.curve_id}': supply flat_rate (Sprint 3) "
        "or at least 2 quotes (Sprint 4 bootstrap)"
    )


def _require_trader(user: dict) -> None:
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")


def _curve_mode(curves: List[CurveInput]) -> str:
    for ci in curves:
        if ci.quotes and len([q for q in ci.quotes if q.rate is not None]) >= 2:
            return "bootstrapped"
    return "flat"


def _leg_result_to_dict(lr) -> dict:
    return {
        "leg_id": str(lr.leg_id),
        "leg_ref": lr.leg_ref,
        "leg_type": lr.leg_type,
        "direction": lr.direction,
        "currency": lr.currency,
        "pv": float(lr.pv) if lr.pv is not None else None,
        "cashflows": [
            {
                "period_start":  cf.period_start.isoformat()  if cf.period_start  else None,
                "period_end":    cf.period_end.isoformat()    if cf.period_end    else None,
                "payment_date":  cf.payment_date.isoformat()  if cf.payment_date  else None,
                "fixing_date":   cf.fixing_date.isoformat()   if getattr(cf, "fixing_date", None) else None,
                "rate":   float(cf.rate)   if cf.rate   is not None else None,
                "dcf":    float(cf.dcf)    if cf.dcf    is not None else None,
                "amount": float(cf.amount) if cf.amount is not None else None,
            }
            for cf in (lr.cashflows or [])
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/pricer/price
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/price")
async def price_trade(
    request: PriceRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Price a trade. Returns NPV, Greeks, per-leg PVs and projected cashflows.
    Accepts both flat-rate (Sprint 3) and bootstrapped (Sprint 4) curve inputs.
    Role: TRADER or ADMIN.
    """
    _require_trader(user)

    val_date = request.valuation_date or date.today()

    # Load trade
    trade = db.query(Trade).filter(Trade.id == request.trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    # Load legs
    legs = (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == request.trade_id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )
    if not legs:
        raise HTTPException(status_code=422, detail="Trade has no legs — book legs first")

    # Build curves
    curves: dict[str, Curve] = {}
    for ci in request.curves:
        try:
            curves[ci.curve_id] = _build_curve(ci, val_date)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Curve '{ci.curve_id}': {exc}")

    if not curves:
        raise HTTPException(status_code=422, detail="At least one curve required")

    # Price
    instrument = trade.instrument_type
    try:
        if instrument in _FX_INSTRUMENTS:
            result = price_fx_forward(
                trade_id=str(trade.id),
                legs=legs,
                curves=curves,
                valuation_date=val_date,
            )
        else:
            # IR_SWAP family + fallback for all other instruments
            result = price_swap(
                trade_id=str(trade.id),
                legs=legs,
                curves=curves,
                valuation_date=val_date,
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pricing error: {exc}")

    # Greeks
    try:
        base_npv = float(result.npv) if result.npv is not None else 0.0
        greeks = compute_greeks(
            trade_id=str(trade.id),
            legs=legs,
            curves=curves,
            valuation_date=val_date,
            base_npv=base_npv,
        )
    except Exception:
        greeks = None

    return {
        "trade_id":       str(trade.id),
        "valuation_date": val_date.isoformat(),
        "curve_mode":     _curve_mode(request.curves),
        "npv":   float(result.npv)    if result.npv   is not None else None,
        "pv01":  float(greeks.pv01)   if greeks and greeks.pv01  is not None else None,
        "dv01":  float(greeks.dv01)   if greeks and greeks.dv01  is not None else None,
        "theta": float(greeks.theta)  if greeks and greeks.theta is not None else None,
        "legs":  [_leg_result_to_dict(lr) for lr in result.legs],
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/pricer/cashflows/generate
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/cashflows/generate")
async def generate_cashflows(
    request: CashflowGenRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Generate and persist the cashflow schedule for a trade.
    Wipes existing PROJECTED cashflows before writing new ones.
    CONFIRMED / SETTLED cashflows are preserved.
    Role: TRADER or ADMIN.
    """
    _require_trader(user)

    val_date = request.valuation_date or date.today()

    trade = db.query(Trade).filter(Trade.id == request.trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    legs = (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == request.trade_id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )
    if not legs:
        raise HTTPException(status_code=422, detail="Trade has no legs")

    curves: dict[str, Curve] = {}
    for ci in request.curves:
        try:
            curves[ci.curve_id] = _build_curve(ci, val_date)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Curve '{ci.curve_id}': {exc}")

    try:
        result = price_swap(
            trade_id=str(trade.id),
            legs=legs,
            curves=curves,
            valuation_date=val_date,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Schedule generation error: {exc}")

    # Wipe PROJECTED cashflows only
    db.query(Cashflow).filter(
        Cashflow.trade_id == request.trade_id,
        Cashflow.status == "PROJECTED",
    ).delete(synchronize_session=False)

    # Write fresh schedule
    written = 0
    for lr in result.legs:
        for cf in (lr.cashflows or []):
            cashflow = Cashflow(
                trade_id=request.trade_id,
                leg_id=str(lr.leg_id),
                period_start=cf.period_start,
                period_end=cf.period_end,
                payment_date=cf.payment_date,
                fixing_date=getattr(cf, "fixing_date", None),
                currency=lr.currency,
                notional=getattr(cf, "notional", None),
                rate=float(cf.rate) if cf.rate is not None else None,
                dcf=float(cf.dcf)   if cf.dcf  is not None else None,
                amount=float(cf.amount) if cf.amount is not None else 0.0,
                status="PROJECTED",
            )
            db.add(cashflow)
            written += 1

    db.commit()

    return {
        "trade_id":         str(trade.id),
        "cashflows_written": written,
        "curve_mode":       _curve_mode(request.curves),
        "valuation_date":   val_date.isoformat(),
    }
`;

const dest = path.join(RIJEKA, 'backend', 'api', 'routes', 'pricer.py');
fs.writeFileSync(dest, content, 'utf8');
console.log('✓ Written: ' + dest);
