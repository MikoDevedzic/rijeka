"""
Rijeka — /api/pricer/ routes
Sprint 3D: IR Swap NPV, Greeks, cashflow generation.

POST /api/pricer/price              price a trade, return NPV + legs + Greeks
POST /api/pricer/cashflows/generate generate and store cashflow schedule to DB

Curve inputs for Sprint 3D:
  User passes flat rates per curve_id.
  Sprint 4: replace with bootstrapped curves from market data.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import date, datetime
from decimal import Decimal
import uuid

from db.session import get_db
from db.models import TradeLeg, Trade, Cashflow
from middleware.auth import verify_token
from pricing.curve import Curve
from pricing.ir_swap import price_swap, SwapResult
from pricing.greeks import compute_greeks
from pricing.day_count import dcf as calc_dcf

router = APIRouter(prefix="/api/pricer", tags=["pricer"])

WRITE_ROLES = {"trader", "admin"}


# ── Schemas ───────────────────────────────────────────────────

class CurveInput(BaseModel):
    """Flat curve input for Sprint 3D. Sprint 4 will replace with pillar quotes."""
    curve_id:  str
    flat_rate: float            # e.g. 0.045 = 4.5%


class PriceRequest(BaseModel):
    trade_id:        str
    valuation_date:  Optional[date] = None  # defaults to today
    curves:          List[CurveInput]       # one per curve_id used by the trade


class CashflowGenerateRequest(BaseModel):
    trade_id:       str
    valuation_date: Optional[date] = None
    curves:         List[CurveInput]


class CashflowOut(BaseModel):
    leg_id:       str
    period_start: date
    period_end:   date
    payment_date: date
    fixing_date:  Optional[date]
    currency:     str
    notional:     float
    rate:         float
    dcf:          float
    amount:       float
    pv:           float


class LegOut(BaseModel):
    leg_id:     str
    leg_ref:    str
    leg_type:   str
    direction:  str
    currency:   str
    pv:         float
    cashflows:  List[CashflowOut]


class PriceResponse(BaseModel):
    trade_id:  str
    npv:       float
    pv01:      float
    dv01:      float
    theta:     float
    legs:      List[LegOut]
    error:     Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────

def _build_curves(curve_inputs: List[CurveInput], val_date: date) -> Dict[str, Curve]:
    curves = {}
    for ci in curve_inputs:
        curves[ci.curve_id] = Curve(val_date, flat_rate=ci.flat_rate)
    # Always ensure a "default" fallback
    if "default" not in curves and curve_inputs:
        curves["default"] = Curve(val_date, flat_rate=curve_inputs[0].flat_rate)
    return curves


def _legs_to_dicts(legs) -> List[dict]:
    result = []
    for leg in legs:
        result.append({
            "id":                str(leg.id),
            "leg_ref":           leg.leg_ref,
            "leg_type":          leg.leg_type,
            "direction":         leg.direction,
            "currency":          leg.currency,
            "notional":          float(leg.notional or 0),
            "effective_date":    leg.effective_date,
            "maturity_date":     leg.maturity_date,
            "day_count":         leg.day_count,
            "payment_frequency": leg.payment_frequency,
            "bdc":               leg.bdc,
            "payment_lag":       leg.payment_lag or 0,
            "stub_type":         leg.stub_type,
            "first_period_start": leg.first_period_start,
            "last_period_end":   leg.last_period_end,
            "fixed_rate":        float(leg.fixed_rate or 0),
            "spread":            float(leg.spread or 0),
            "discount_curve_id": leg.discount_curve_id,
            "forecast_curve_id": leg.forecast_curve_id,
            "notional_type":     leg.notional_type,
        })
    return result


# ── Routes ────────────────────────────────────────────────────

@router.post("/price", response_model=PriceResponse)
def price_trade(
    body: PriceRequest,
    db:   Session = Depends(get_db),
    user: dict    = Depends(verify_token),
):
    """
    Price a trade. Returns NPV, per-leg PVs, projected cashflows, and Greeks.
    Curves are passed as flat rates (Sprint 3D stub). Bootstrap in Sprint 4.
    """
    val_date = body.valuation_date or date.today()

    # Load legs from DB
    legs_db = (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == body.trade_id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )
    if not legs_db:
        raise HTTPException(status_code=404, detail="No legs found for this trade.")

    # If no curves provided, use a 4% flat default so something shows up
    if not body.curves:
        raise HTTPException(
            status_code=422,
            detail="At least one curve input required. Pass flat_rate per curve_id."
        )

    curves = _build_curves(body.curves, val_date)
    legs   = _legs_to_dicts(legs_db)

    result = price_swap(body.trade_id, legs, curves, val_date)
    if result.error:
        raise HTTPException(status_code=422, detail=result.error)

    greeks = compute_greeks(body.trade_id, legs, curves, val_date, base_npv=result.npv)

    legs_out = []
    for lr in result.legs:
        cfs_out = [CashflowOut(
            leg_id=lr.leg_id,
            period_start=cf.period_start,
            period_end=cf.period_end,
            payment_date=cf.payment_date,
            fixing_date=cf.fixing_date,
            currency=cf.currency,
            notional=cf.notional,
            rate=cf.rate,
            dcf=cf.dcf,
            amount=cf.amount,
            pv=cf.pv,
        ) for cf in lr.cashflows]
        legs_out.append(LegOut(
            leg_id=lr.leg_id,
            leg_ref=lr.leg_ref,
            leg_type=lr.leg_type,
            direction=lr.direction,
            currency=lr.currency,
            pv=lr.pv,
            cashflows=cfs_out,
        ))

    return PriceResponse(
        trade_id=body.trade_id,
        npv=result.npv,
        pv01=greeks.pv01,
        dv01=greeks.dv01,
        theta=greeks.theta,
        legs=legs_out,
    )


@router.post("/cashflows/generate", status_code=201)
def generate_and_store_cashflows(
    body: CashflowGenerateRequest,
    db:   Session = Depends(get_db),
    user: dict    = Depends(verify_token),
):
    """
    Generate cashflow schedule for a trade and write to cashflows table.
    Wipes existing PROJECTED cashflows for the trade first (reprice).
    Returns count of cashflows written.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Requires Trader or Admin role.")

    val_date = body.valuation_date or date.today()

    legs_db = (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == body.trade_id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )
    if not legs_db:
        raise HTTPException(status_code=404, detail="No legs found.")

    if not body.curves:
        raise HTTPException(status_code=422, detail="At least one curve input required.")

    curves = _build_curves(body.curves, val_date)
    legs   = _legs_to_dicts(legs_db)
    result = price_swap(body.trade_id, legs, curves, val_date)
    if result.error:
        raise HTTPException(status_code=422, detail=result.error)

    # Wipe PROJECTED only
    db.query(Cashflow).filter(
        Cashflow.trade_id == body.trade_id,
        Cashflow.status == "PROJECTED"
    ).delete(synchronize_session=False)

    count = 0
    for lr in result.legs:
        for cf in lr.cashflows:
            row = Cashflow(
                id=uuid.uuid4(),
                trade_id=body.trade_id,
                leg_id=lr.leg_id,
                period_start=cf.period_start,
                period_end=cf.period_end,
                payment_date=cf.payment_date,
                fixing_date=cf.fixing_date,
                currency=cf.currency,
                notional=Decimal(str(cf.notional)),
                rate=Decimal(str(round(cf.rate, 8))),
                dcf=Decimal(str(round(cf.dcf, 8))),
                amount=Decimal(str(round(cf.amount, 6))),
                status="PROJECTED",
            )
            db.add(row)
            count += 1

    db.commit()
    return {"trade_id": body.trade_id, "cashflows_written": count}
