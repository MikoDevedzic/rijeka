"""
Rijeka — pricer routes (Sprint 4E/4F)

POST /price                    Price a trade → NPV + Greeks + per-leg PVs
POST /cashflows/generate       Generate + persist cashflow schedule
"""

import json as _json
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
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
# Input models
# ─────────────────────────────────────────────────────────────────────────────

class CurveQuote(BaseModel):
    tenor: str
    quote_type: str
    rate: float
    fra_start_tenor: Optional[str] = None
    day_count: Optional[str] = None


class CurveInput(BaseModel):
    curve_id: str
    flat_rate: Optional[float] = None
    quotes: Optional[List[CurveQuote]] = None


class PriceRequest(BaseModel):
    trade_id: str
    valuation_date: Optional[date] = None
    curves: List[CurveInput]


class CashflowGenRequest(BaseModel):
    trade_id: str
    valuation_date: Optional[date] = None
    curves: List[CurveInput]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _leg_to_dict(leg: TradeLeg) -> dict:
    """Convert SQLAlchemy TradeLeg ORM object to plain dict for pricing engine."""
    return {
        "id":                str(leg.id) if leg.id else "",
        "leg_ref":           leg.leg_ref or "",
        "leg_seq":           leg.leg_seq or 0,
        "leg_type":          leg.leg_type or "FIXED",
        "direction":         leg.direction or "PAY",
        "currency":          leg.currency or "USD",
        "notional":          float(leg.notional) if leg.notional is not None else 0.0,
        "notional_type":     leg.notional_type or "BULLET",
        "effective_date":    str(leg.effective_date) if leg.effective_date else None,
        "maturity_date":     str(leg.maturity_date) if leg.maturity_date else None,
        "first_period_start": str(leg.first_period_start) if leg.first_period_start else None,
        "last_period_end":   str(leg.last_period_end) if leg.last_period_end else None,
        "day_count":         leg.day_count or "ACT/360",
        "payment_frequency": leg.payment_frequency or "QUARTERLY",
        "reset_frequency":   leg.reset_frequency,
        "bdc":               leg.bdc or "MOD_FOLLOWING",
        "stub_type":         leg.stub_type or "SHORT_FRONT",
        "payment_lag":       int(leg.payment_lag) if leg.payment_lag is not None else 0,
        "fixed_rate":        float(leg.fixed_rate) if leg.fixed_rate is not None else 0.0,
        "spread":            float(leg.spread) if leg.spread is not None else 0.0,
        "forecast_curve_id": leg.forecast_curve_id,
        "discount_curve_id": leg.discount_curve_id,
        "cap_rate":          float(leg.cap_rate) if leg.cap_rate is not None else None,
        "floor_rate":        float(leg.floor_rate) if leg.floor_rate is not None else None,
        "leverage":          float(leg.leverage) if leg.leverage is not None else 1.0,
        "ois_compounding":   leg.ois_compounding,
    }


def _require_trader(user: dict) -> None:
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")


def _build_curve(ci: CurveInput, valuation_date: date, db: Session) -> Curve:
    """
    Build a Curve. Priority:
      1. quotes[] with >= 2 entries  → bootstrap
      2. flat_rate                   → flat forward
      3. DB latest snapshot          → bootstrap from saved market data
      4. None of the above           → raise ValueError
    """
    valid_quotes = [q for q in (ci.quotes or []) if q.rate is not None]
    if len(valid_quotes) >= 2:
        return bootstrap_from_dicts(valuation_date, [q.dict() for q in valid_quotes])

    if ci.flat_rate is not None:
        return Curve(valuation_date=valuation_date, flat_rate=float(ci.flat_rate))

    # Try DB snapshot
    try:
        result = db.execute(
            text("SELECT quotes FROM market_data_snapshots WHERE curve_id = :cid ORDER BY valuation_date DESC LIMIT 1"),
            {"cid": ci.curve_id}
        )
        row = result.fetchone()
        if row and row.quotes:
            raw = row.quotes if isinstance(row.quotes, list) else _json.loads(row.quotes)
            db_quotes = [
                {
                    "tenor":      q.get("tenor"),
                    "quote_type": _map_qt(q.get("quote_type", "OIS")),
                    "rate":       float(q.get("rate", 0)) / 100,
                }
                for q in raw
                if q.get("enabled", True) and q.get("rate") is not None
            ]
            if len(db_quotes) >= 2:
                return bootstrap_from_dicts(valuation_date, db_quotes)
    except Exception:
        pass

    raise ValueError(
        f"Curve '{ci.curve_id}': no quotes, flat_rate, or saved market data. "
        f"Go to MARKET DATA workspace and click SAVE TO DB."
    )


def _map_qt(qt: str) -> str:
    return {
        "OISDeposit": "DEPOSIT", "OIS": "OIS_SWAP", "BASIS": "IRS",
        "FRA": "FRA", "FUTURES": "FUTURES", "Deposit": "DEPOSIT", "IRS": "IRS",
    }.get(qt, "OIS_SWAP")


def _curve_mode(curves: List[CurveInput]) -> str:
    for ci in curves:
        if ci.quotes and len([q for q in ci.quotes if q.rate is not None]) >= 2:
            return "bootstrapped"
    return "flat"


_IR = {"IR_SWAP","OIS_SWAP","BASIS_SWAP","XCCY_SWAP","CAPPED_SWAP","FLOORED_SWAP",
       "COLLARED_SWAP","CALLABLE_SWAP","CANCELLABLE_SWAP","IR_SWAPTION",
       "BERMUDAN_SWAPTION","INTEREST_RATE_CAP","INTEREST_RATE_FLOOR",
       "INTEREST_RATE_COLLAR","FRA"}
_FX = {"FX_FORWARD","NDF"}


# ─────────────────────────────────────────────────────────────────────────────
# POST /price
# ─────────────────────────────────────────────────────────────────────────────



@router.post("/price")
async def price_trade(
    request: PriceRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    _require_trader(user)
    val_date = request.valuation_date or date.today()

    trade = db.query(Trade).filter(Trade.id == request.trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    orm_legs = (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == request.trade_id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )
    if not orm_legs:
        raise HTTPException(status_code=422, detail="Trade has no legs — book legs first")

    # Convert ORM objects to plain dicts for the pricing engine
    legs = [_leg_to_dict(leg) for leg in orm_legs]

    # Build curves
    curves: dict[str, Curve] = {}
    for ci in request.curves:
        try:
            curves[ci.curve_id] = _build_curve(ci, val_date, db)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Curve '{ci.curve_id}': {exc}")

    if not curves:
        raise HTTPException(status_code=422, detail="At least one curve required")

    # Serialize curve pillars for transparency panel
    curve_pillars = {}
    for cid, curve in curves.items():
        pils = []
        for d, r in curve._pillars:
            t = (d - val_date).days / 365.25
            if t <= 0:
                continue
            import math as _math
            df_val = _math.exp(-r * t)
            pils.append({
                "date":      d.isoformat(),
                "zero_rate": round(r * 100, 4),      # as %
                "df":        round(df_val, 6),
                "t":         round(t, 4),
            })
        curve_pillars[cid] = pils

    # Price
    try:
        if trade.instrument_type in _FX:
            result = price_fx_forward(
                trade_id=str(trade.id), legs=legs, curves=curves, valuation_date=val_date
            )
        else:
            result = price_swap(
                trade_id=str(trade.id), legs=legs, curves=curves, valuation_date=val_date
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pricing error: {exc}")

    # Greeks
    greeks = None
    try:
        greeks = compute_greeks(
            trade_id=str(trade.id), legs=legs, curves=curves,
            valuation_date=val_date, base_npv=float(result.npv or 0)
        )
    except Exception:
        pass

    def _lr(lr):
        return {
            "leg_id":    str(lr.leg_id),
            "leg_ref":   lr.leg_ref,
            "leg_type":  lr.leg_type,
            "direction": lr.direction,
            "currency":  lr.currency,
            "pv":        float(lr.pv)        if lr.pv        is not None else None,
            "ir01":      float(lr.ir01)      if hasattr(lr, 'ir01')      else None,
            "ir01_disc": float(lr.ir01_disc) if hasattr(lr, 'ir01_disc') else None,
            "cashflows": [
                {
                    "period_start":  cf.period_start.isoformat()  if cf.period_start  else None,
                    "period_end":    cf.period_end.isoformat()    if cf.period_end    else None,
                    "payment_date":  cf.payment_date.isoformat()  if cf.payment_date  else None,
                    "fixing_date":   cf.fixing_date.isoformat()   if getattr(cf, "fixing_date", None) else None,
                    "rate":          float(cf.rate)      if cf.rate      is not None else None,
                    "dcf":           float(cf.dcf)       if cf.dcf       is not None else None,
                    "amount":        float(cf.amount)    if cf.amount    is not None else None,
                    "df":            float(cf.df)        if hasattr(cf, 'df')        and cf.df        is not None else None,
                    "zero_rate":     float(cf.zero_rate) if hasattr(cf, 'zero_rate') and cf.zero_rate is not None else None,
                }
                for cf in (lr.cashflows or [])
            ],
        }

    return {

        "trade_id":       str(trade.id),
        "valuation_date": val_date.isoformat(),
        "curve_mode":     _curve_mode(request.curves),
        "curve_pillars":  curve_pillars,
        "npv":   float(result.npv)   if result.npv   is not None else None,
        "ir01":  float(greeks.ir01)  if greeks and greeks.ir01  is not None else None,
        "ir01_disc":  float(greeks.ir01_disc)  if greeks and greeks.ir01_disc  is not None else None,
        "theta": float(greeks.theta) if greeks and greeks.theta is not None else None,
        "legs":  [_lr(lr) for lr in result.legs],
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /cashflows/generate
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/cashflows/generate")
async def generate_cashflows(
    request: CashflowGenRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    _require_trader(user)
    val_date = request.valuation_date or date.today()

    trade = db.query(Trade).filter(Trade.id == request.trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    orm_legs = (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == request.trade_id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )
    if not orm_legs:
        raise HTTPException(status_code=422, detail="Trade has no legs")

    legs = [_leg_to_dict(leg) for leg in orm_legs]

    curves: dict[str, Curve] = {}
    for ci in request.curves:
        try:
            curves[ci.curve_id] = _build_curve(ci, val_date, db)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Curve '{ci.curve_id}': {exc}")

    try:
        result = price_swap(
            trade_id=str(trade.id), legs=legs, curves=curves, valuation_date=val_date
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Schedule generation error: {exc}")

    # Wipe PROJECTED only
    db.query(Cashflow).filter(
        Cashflow.trade_id == request.trade_id,
        Cashflow.status == "PROJECTED",
    ).delete(synchronize_session=False)

    written = 0
    for lr in result.legs:
        for cf in (lr.cashflows or []):
            db.add(Cashflow(
                trade_id=request.trade_id,
                leg_id=str(lr.leg_id),
                period_start=cf.period_start,
                period_end=cf.period_end,
                payment_date=cf.payment_date,
                fixing_date=getattr(cf, "fixing_date", None),
                currency=lr.currency,
                notional=getattr(cf, "notional", None),
                rate=float(cf.rate)   if cf.rate   is not None else None,
                dcf=float(cf.dcf)    if cf.dcf    is not None else None,
                amount=float(cf.amount) if cf.amount is not None else 0.0,
                status="PROJECTED",
            ))
            written += 1

    db.commit()
    return {

        "trade_id":          str(trade.id),
        "cashflows_written": written,
        "curve_mode":        _curve_mode(request.curves),
        "valuation_date":    val_date.isoformat(),
    }
