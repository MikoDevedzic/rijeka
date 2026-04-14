"""
Rijeka — pricer routes (Sprint 4G)

POST /price                      Price a trade -> NPV + Greeks + per-leg PVs
POST /cashflows/generate         Generate + persist cashflow schedule
POST /api/price/par-rate         Solve for par coupon on our bootstrapped curve
"""

import json as _json
import math as _math
from datetime import date, timedelta
from decimal import Decimal
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
from pricing.ir_swap import price_swap, price_leg
from pricing.swaption import price_swaption, _N

router = APIRouter()


# ── OIS day count convention per curve ────────────────────────────────────────
# ACT/360 : USD SOFR, EUR ESTR, CHF SARON, SEK SWESTR
# ACT/365F: GBP SONIA, JPY TONAR, AUD AONIA, CAD CORRA, NOK NOWA, NZD, SGD, HKD
CURVE_DC = {
    'USD_SOFR':   'ACT/360',
    'EUR_ESTR':   'ACT/360',
    'GBP_SONIA':  'ACT/365F',
    'JPY_TONAR':  'ACT/365F',
    'CHF_SARON':  'ACT/360',
    'AUD_AONIA':  'ACT/365F',
    'CAD_CORRA':  'ACT/365F',
    'SGD_SORA':   'ACT/365F',
    'SEK_SWESTR': 'ACT/360',
    'NOK_NOWA':   'ACT/365F',
    'NZD_NZIONA': 'ACT/365F',
    'HKD_HONIA':  'ACT/365F',
    'DKK_DESTR':  'ACT/360',
    'MXN_TIIE':   'ACT/360',
}

# Settlement calendar per curve (for bootstrap period generation)
CURVE_CAL = {
    'USD_SOFR':   'NEW_YORK',
    'EUR_ESTR':   'TARGET',
    'GBP_SONIA':  'LONDON',
    'JPY_TONAR':  'TOKYO',
    'CHF_SARON':  'ZURICH',
    'AUD_AONIA':  'SYDNEY',
    'CAD_CORRA':  'TORONTO',
    'SGD_SORA':   'NEW_YORK',
    'SEK_SWESTR': 'NEW_YORK',
    'NOK_NOWA':   'NEW_YORK',
    'NZD_NZIONA': 'NEW_YORK',
    'HKD_HONIA':  'NEW_YORK',
    'DKK_DESTR':  'TARGET',
    'MXN_TIIE':   'NEW_YORK',
}

# Settlement days per curve (0=GBP/AUD, 1=CAD, 2=most others)
CURVE_SPOT_LAG = {
    'USD_SOFR':   2,
    'EUR_ESTR':   2,
    'GBP_SONIA':  0,
    'JPY_TONAR':  2,
    'CHF_SARON':  2,
    'AUD_AONIA':  0,
    'CAD_CORRA':  1,
    'SGD_SORA':   2,
    'SEK_SWESTR': 2,
    'NOK_NOWA':   2,
    'NZD_NZIONA': 0,
    'HKD_HONIA':  2,
    'DKK_DESTR':  2,
    'MXN_TIIE':   1,
}

# CCY derived from curve_id
CURVE_CCY = {
    'USD_SOFR':   'USD',
    'EUR_ESTR':   'EUR',
    'GBP_SONIA':  'GBP',
    'JPY_TONAR':  'JPY',
    'CHF_SARON':  'CHF',
    'AUD_AONIA':  'AUD',
    'CAD_CORRA':  'CAD',
    'SGD_SORA':   'SGD',
    'SEK_SWESTR': 'SEK',
    'NOK_NOWA':   'NOK',
    'NZD_NZIONA': 'NZD',
    'HKD_HONIA':  'HKD',
    'DKK_DESTR':  'DKK',
    'MXN_TIIE':   'MXN',
}

# Settlement days per currency (for par rate solver)
CCY_SETTLE = {
    'USD': 2, 'EUR': 2, 'GBP': 0, 'JPY': 2,
    'CHF': 2, 'AUD': 0, 'CAD': 1, 'NZD': 0,
    'SGD': 2, 'HKD': 2, 'NOK': 2, 'SEK': 2,
    'DKK': 2, 'MXN': 1,
}


# ── Input models ──────────────────────────────────────────────────────────────

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


class ParRateRequest(BaseModel):
    curve_id:          str
    valuation_date:    Optional[date] = None
    effective_date:    str
    maturity_date:     str
    currency:          str  = 'USD'
    notional:          float = 10_000_000
    fixed_pay_freq:    str  = 'ANNUAL'
    fixed_day_count:   str  = 'ACT/360'
    fixed_bdc:         str  = 'MOD_FOLLOWING'
    fixed_payment_lag: int  = 2
    direction:         str  = 'PAY'
    float_index:       str  = 'SOFR'
    float_reset_freq:  str  = 'DAILY'
    float_pay_freq:    str  = 'ANNUAL'
    float_day_count:   str  = 'ACT/360'
    float_bdc:         str  = 'MOD_FOLLOWING'
    float_payment_lag: int  = 2
    spread:            float = 0.0
    leverage:          float = 1.0


# ── Helpers ───────────────────────────────────────────────────────────────────

def _leg_to_dict(leg: TradeLeg) -> dict:
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
        "fixed_rate_schedule": leg.fixed_rate_schedule if leg.fixed_rate_schedule else None,
        "notional_schedule":   leg.notional_schedule  if leg.notional_schedule  else None,
    }


def _require_trader(user: dict) -> None:
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")


def _build_curve(ci: CurveInput, valuation_date: date, db: Session) -> Curve:
    """
    Build a Curve. Priority:
      1. quotes[] with >= 2 entries -> bootstrap
      2. flat_rate                  -> flat forward
      3. DB latest snapshot         -> bootstrap from saved market data
    """
    curve_dc       = CURVE_DC.get(ci.curve_id, 'ACT/360')
    curve_cal      = CURVE_CAL.get(ci.curve_id, 'NEW_YORK')
    curve_spot_lag = CURVE_SPOT_LAG.get(ci.curve_id, 2)
    curve_ccy      = CURVE_CCY.get(ci.curve_id, 'USD')

    valid_quotes = [q for q in (ci.quotes or []) if q.rate is not None]
    if len(valid_quotes) >= 2:
        dicts = []
        for q in valid_quotes:
            qt = q.quote_type
            dc = "ACT/360" if qt == "DEPOSIT" else curve_dc
            dicts.append({
                "tenor":      q.tenor,
                "quote_type": qt,
                "rate":       q.rate,
                "day_count":  dc,
                "calendar":   curve_cal,
                "currency":   curve_ccy,
                "spot_lag":   curve_spot_lag,
            })
        return bootstrap_from_dicts(valuation_date, dicts)

    if ci.flat_rate is not None:
        return Curve(valuation_date=valuation_date, flat_rate=float(ci.flat_rate))

    # DB snapshot
    try:
        result = db.execute(
            text("SELECT quotes FROM market_data_snapshots WHERE curve_id = :cid ORDER BY valuation_date DESC LIMIT 1"),
            {"cid": ci.curve_id}
        )
        row = result.fetchone()
        if row and row.quotes:
            raw = row.quotes if isinstance(row.quotes, list) else _json.loads(row.quotes)
            db_quotes = []
            for q in raw:
                if not q.get("enabled", True) or q.get("rate") is None:
                    continue
                qt = _map_qt(q.get("quote_type", "OIS"))
                dc = "ACT/360" if qt == "DEPOSIT" else curve_dc
                db_quotes.append({
                    "tenor":      q.get("tenor"),
                    "quote_type": qt,
                    "rate":       float(q.get("rate", 0)) / 100,
                    "day_count":  dc,
                    "calendar":   curve_cal,
                    "currency":   curve_ccy,
                    "spot_lag":   curve_spot_lag,
                })
            print(f"[PRICER] DB snapshot for '{ci.curve_id}': {len(db_quotes)} quotes, "
                  f"dc={curve_dc}, cal={curve_cal}, spot_lag={curve_spot_lag}, "
                  f"first={db_quotes[0] if db_quotes else None}")
            if len(db_quotes) >= 2:
                return bootstrap_from_dicts(valuation_date, db_quotes)
    except Exception as _db_err:
        print(f"[PRICER] DB curve load failed for '{ci.curve_id}': {_db_err}")

    raise ValueError(
        f"Curve '{ci.curve_id}': no quotes, flat_rate, or saved snapshot. "
        f"Go to MARKET DATA and click SAVE TO DB."
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
    return "db-snapshot"


_IR = {"IR_SWAP","OIS_SWAP","BASIS_SWAP","XCCY_SWAP","CAPPED_SWAP","FLOORED_SWAP",
       "COLLARED_SWAP","CALLABLE_SWAP","CANCELLABLE_SWAP","IR_SWAPTION",
       "BERMUDAN_SWAPTION","INTEREST_RATE_CAP","INTEREST_RATE_FLOOR",
       "INTEREST_RATE_COLLAR","FRA"}
_FX = {"FX_FORWARD","NDF"}


# ── Par rate bisection solver ─────────────────────────────────────────────────

def _solve_par_rate(
    fixed_leg: dict,
    float_leg: dict,
    curves: dict,
    valuation_date: date,
) -> float:
    """Bisection: find fixed rate making NPV = 0. Converges to $0.01 within 60 iterations."""
    def npv_at_rate(rate: float) -> float:
        fl = dict(fixed_leg)
        fl["fixed_rate"] = rate
        disc_id = fl.get("discount_curve_id", "USD_SOFR")
        fore_id = float_leg.get("forecast_curve_id", disc_id)
        disc_c  = curves.get(disc_id) or list(curves.values())[0]
        fore_c  = curves.get(fore_id) or disc_c
        lr_fix  = price_leg(fl,        disc_c, None,   valuation_date)
        lr_flt  = price_leg(float_leg, disc_c, fore_c, valuation_date)
        return lr_fix.pv + lr_flt.pv

    lo, hi  = 0.00001, 0.20000
    npv_lo  = npv_at_rate(lo)
    for _ in range(60):
        mid     = (lo + hi) / 2.0
        npv_mid = npv_at_rate(mid)
        if abs(npv_mid) < 0.01:
            return mid
        if npv_lo * npv_mid < 0:
            hi = mid
        else:
            lo = mid; npv_lo = npv_mid
    return (lo + hi) / 2.0


# ── POST /api/price/par-rate ──────────────────────────────────────────────────

@router.post("/api/price/par-rate")
async def compute_par_rate(
    req: ParRateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    _require_trader(user)
    val_date = req.valuation_date or date.today()
    ci = CurveInput(curve_id=req.curve_id, quotes=[])
    try:
        curve = _build_curve(ci, val_date, db)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Cannot build curve: {e}")

    curves = {req.curve_id: curve}
    import uuid
    fixed_dir = req.direction
    float_dir = "RECEIVE" if fixed_dir == "PAY" else "PAY"
    fixed_leg = {
        "id": str(uuid.uuid4()), "leg_ref": "FIXED-1", "leg_type": "FIXED",
        "direction": fixed_dir, "currency": req.currency,
        "notional": req.notional, "notional_type": "BULLET",
        "effective_date": req.effective_date, "maturity_date": req.maturity_date,
        "day_count": req.fixed_day_count, "payment_frequency": req.fixed_pay_freq,
        "bdc": req.fixed_bdc, "stub_type": "SHORT_FRONT",
        "payment_lag": req.fixed_payment_lag,
        "fixed_rate": 0.0, "spread": 0.0,
        "discount_curve_id": req.curve_id, "forecast_curve_id": None,
    }
    float_leg = {
        "id": str(uuid.uuid4()), "leg_ref": "FLOAT-1", "leg_type": "FLOAT",
        "direction": float_dir, "currency": req.currency,
        "notional": req.notional, "notional_type": "BULLET",
        "effective_date": req.effective_date, "maturity_date": req.maturity_date,
        "day_count": req.float_day_count, "payment_frequency": req.float_pay_freq,
        "reset_frequency": req.float_reset_freq,
        "bdc": req.float_bdc, "stub_type": "SHORT_FRONT",
        "payment_lag": req.float_payment_lag,
        "fixed_rate": 0.0, "spread": req.spread, "leverage": req.leverage,
        "discount_curve_id": req.curve_id, "forecast_curve_id": req.curve_id,
    }
    try:
        par_rate = _solve_par_rate(fixed_leg, float_leg, curves, val_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Par rate solver error: {e}")

    fixed_leg["fixed_rate"] = par_rate
    disc_c = curves[req.curve_id]
    lr_fix = price_leg(fixed_leg, disc_c, None,   val_date)
    lr_flt = price_leg(float_leg, disc_c, disc_c, val_date)
    npv_check = lr_fix.pv + lr_flt.pv
    return {
        "par_rate":      round(par_rate * 100, 6),
        "par_rate_dec":  par_rate,
        "npv_check":     round(npv_check, 2),
        "curve_id":      req.curve_id,
        "valuation_date": str(val_date),
        "effective_date": req.effective_date,
        "maturity_date":  req.maturity_date,
    }


# ── POST /price ───────────────────────────────────────────────────────────────

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
        raise HTTPException(status_code=422, detail="Trade has no legs")

    legs = [_leg_to_dict(leg) for leg in orm_legs]
    curves: dict = {}
    for ci in request.curves:
        try:
            curves[ci.curve_id] = _build_curve(ci, val_date, db)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Curve '{ci.curve_id}': {exc}")

    if not curves:
        raise HTTPException(status_code=422, detail="At least one curve required")

    # Curve pillars for UI display
    curve_pillars = {}
    for cid, curve in curves.items():
        pils = []
        for d, df_val in curve._df_pillars:
            t = (d - val_date).days / 365.25
            if t <= 0 or df_val <= 0:
                continue
            zero_rate = -_math.log(df_val) / t if t > 0 else 0.0
            pils.append({
                "date":      d.isoformat(),
                "zero_rate": round(zero_rate * 100, 4),
                "df":        round(df_val, 8),
                "t":         round(t, 4),
            })
        curve_pillars[cid] = pils

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
            "pv":        float(lr.pv)        if lr.pv is not None else None,
            "ir01":      float(lr.ir01)      if hasattr(lr, 'ir01') else None,
            "ir01_disc": float(lr.ir01_disc) if hasattr(lr, 'ir01_disc') else None,
            "cashflows": [
                {
                    "period_start":  cf.period_start.isoformat()  if cf.period_start  else None,
                    "period_end":    cf.period_end.isoformat()     if cf.period_end    else None,
                    "payment_date":  cf.payment_date.isoformat()   if cf.payment_date  else None,
                    "fixing_date":   cf.fixing_date.isoformat()    if getattr(cf, "fixing_date", None) else None,
                    "notional":      float(cf.notional)  if cf.notional  is not None else None,
                    "rate":          float(cf.rate)      if cf.rate      is not None else None,
                    "dcf":           float(cf.dcf)       if cf.dcf       is not None else None,
                    "amount":        float(cf.amount)    if cf.amount    is not None else None,
                    "pv":            float(cf.pv)        if hasattr(cf, 'pv') and cf.pv is not None else None,
                    "df":            float(cf.df)        if hasattr(cf, 'df') and cf.df is not None else None,
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
        "npv":       float(result.npv)       if result.npv is not None else None,
        "ir01":      float(greeks.ir01)      if greeks and greeks.ir01 is not None else None,
        "ir01_disc": float(greeks.ir01_disc) if greeks and greeks.ir01_disc is not None else None,
        "theta":     float(greeks.theta)     if greeks and greeks.theta is not None else None,
        "gamma":     float(greeks.gamma)     if greeks and hasattr(greeks, 'gamma') and greeks.gamma is not None else None,
        "legs":      [_lr(lr) for lr in result.legs],
    }


# ── POST /price/preview ───────────────────────────────────────────────────────
# Stateless pricer — takes legs directly, no trade_id, no DB write.
# Used by the pre-trade PRICE button. Never creates blotter entries.

class LegPreview(BaseModel):
    id:                 Optional[str]   = None
    leg_ref:            Optional[str]   = None
    leg_seq:            Optional[int]   = 0
    leg_type:           str             = "FIXED"
    direction:          str             = "PAY"
    currency:           str             = "USD"
    notional:           float           = 10_000_000
    notional_type:      Optional[str]   = "BULLET"
    effective_date:     Optional[str]   = None
    maturity_date:      Optional[str]   = None
    first_period_start: Optional[str]   = None
    last_period_end:    Optional[str]   = None
    day_count:          Optional[str]   = "ACT/360"
    payment_frequency:  Optional[str]   = "ANNUAL"
    reset_frequency:    Optional[str]   = None
    bdc:                Optional[str]   = "MOD_FOLLOWING"
    stub_type:          Optional[str]   = "SHORT_FRONT"
    payment_lag:        Optional[int]   = 2
    fixed_rate:         Optional[float] = 0.0
    spread:             Optional[float] = 0.0
    leverage:           Optional[float] = 1.0
    forecast_curve_id:  Optional[str]   = None
    discount_curve_id:  Optional[str]   = None
    ois_compounding:    Optional[str]   = None
    cap_rate:           Optional[float] = None
    floor_rate:         Optional[float] = None
    fixed_rate_schedule: Optional[list]  = None
    notional_schedule:   Optional[list]  = None
    spread_schedule:     Optional[list]  = None


class PreviewRequest(BaseModel):
    legs:            List[LegPreview]
    valuation_date:  Optional[date] = None
    curves:          List[CurveInput]


@router.post("/price/preview")
async def price_preview(
    request: PreviewRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Stateless pre-trade pricer. Accepts legs directly — no trade in DB required.
    Returns identical response shape as POST /price.
    Used by the PRICE button in TradeBookingWindow.
    """
    _require_trader(user)
    val_date = request.valuation_date or date.today()

    # Build curves
    curves: dict = {}
    for ci in request.curves:
        try:
            curves[ci.curve_id] = _build_curve(ci, val_date, db)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Curve '{ci.curve_id}': {exc}")

    if not curves:
        raise HTTPException(status_code=422, detail="At least one curve required")

    # Convert Pydantic models to dicts (same shape as _leg_to_dict)
    import uuid as _uuid
    legs = []
    for i, lp in enumerate(request.legs):
        legs.append({
            "id":                str(lp.id) if lp.id else str(_uuid.uuid4()),
            "leg_ref":           lp.leg_ref or f"LEG-{i+1}",
            "leg_seq":           lp.leg_seq or i,
            "leg_type":          lp.leg_type,
            "direction":         lp.direction,
            "currency":          lp.currency,
            "notional":          float(lp.notional),
            "notional_type":     lp.notional_type or "BULLET",
            "effective_date":    lp.effective_date,
            "maturity_date":     lp.maturity_date,
            "first_period_start": lp.first_period_start,
            "last_period_end":   lp.last_period_end,
            "day_count":         lp.day_count or "ACT/360",
            "payment_frequency": lp.payment_frequency or "ANNUAL",
            "reset_frequency":   lp.reset_frequency,
            "bdc":               lp.bdc or "MOD_FOLLOWING",
            "stub_type":         lp.stub_type or "SHORT_FRONT",
            "payment_lag":       int(lp.payment_lag) if lp.payment_lag is not None else 2,
            "fixed_rate":        float(lp.fixed_rate) if lp.fixed_rate is not None else 0.0,
            "spread":            float(lp.spread) if lp.spread is not None else 0.0,
            "leverage":          float(lp.leverage) if lp.leverage is not None else 1.0,
            "forecast_curve_id": lp.forecast_curve_id,
            "discount_curve_id": lp.discount_curve_id,
            "ois_compounding":   lp.ois_compounding,
            "cap_rate":          lp.cap_rate,
            "floor_rate":        lp.floor_rate,
            "fixed_rate_schedule": lp.fixed_rate_schedule if lp.fixed_rate_schedule else None,
            "notional_schedule":   lp.notional_schedule if lp.notional_schedule else None,
            "spread_schedule":     lp.spread_schedule     if lp.spread_schedule     else None,
        })

    # Price
    try:
        result = price_swap(
            trade_id="preview",
            legs=legs,
            curves=curves,
            valuation_date=val_date,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pricing error: {exc}")

    # Greeks
    greeks = None
    try:
        greeks = compute_greeks(
            trade_id="preview",
            legs=legs,
            curves=curves,
            valuation_date=val_date,
            base_npv=float(result.npv or 0),
        )
    except Exception:
        pass

    # Curve pillars for UI display
    curve_pillars = {}
    for cid, curve in curves.items():
        pils = []
        for d, df_val in curve._df_pillars:
            t = (d - val_date).days / 365.25
            if t <= 0 or df_val <= 0:
                continue
            zero_rate = -_math.log(df_val) / t if t > 0 else 0.0
            pils.append({
                "date":      d.isoformat(),
                "zero_rate": round(zero_rate * 100, 4),
                "df":        round(df_val, 8),
                "t":         round(t, 4),
            })
        curve_pillars[cid] = pils

    def _lr(lr):
        return {
            "leg_id":    str(lr.leg_id),
            "leg_ref":   lr.leg_ref,
            "leg_type":  lr.leg_type,
            "direction": lr.direction,
            "currency":  lr.currency,
            "pv":        float(lr.pv)        if lr.pv is not None else None,
            "ir01":      float(lr.ir01)      if hasattr(lr, 'ir01') else None,
            "ir01_disc": float(lr.ir01_disc) if hasattr(lr, 'ir01_disc') else None,
            "cashflows": [
                {
                    "period_start":  cf.period_start.isoformat()  if cf.period_start  else None,
                    "period_end":    cf.period_end.isoformat()     if cf.period_end    else None,
                    "payment_date":  cf.payment_date.isoformat()   if cf.payment_date  else None,
                    "fixing_date":   cf.fixing_date.isoformat()    if getattr(cf, "fixing_date", None) else None,
                    "notional":      float(cf.notional)  if cf.notional  is not None else None,
                    "rate":          float(cf.rate)      if cf.rate      is not None else None,
                    "dcf":           float(cf.dcf)       if cf.dcf       is not None else None,
                    "amount":        float(cf.amount)    if cf.amount    is not None else None,
                    "pv":            float(cf.pv)        if hasattr(cf, 'pv') and cf.pv is not None else None,
                    "df":            float(cf.df)        if hasattr(cf, 'df') and cf.df is not None else None,
                    "zero_rate":     float(cf.zero_rate) if hasattr(cf, 'zero_rate') and cf.zero_rate is not None else None,
                }
                for cf in (lr.cashflows or [])
            ],
        }

    return {
        "trade_id":       "preview",
        "valuation_date": val_date.isoformat(),
        "curve_mode":     _curve_mode(request.curves),
        "curve_pillars":  curve_pillars,
        "npv":       float(result.npv)       if result.npv is not None else None,
        "ir01":      float(greeks.ir01)      if greeks and greeks.ir01 is not None else None,
        "ir01_disc": float(greeks.ir01_disc) if greeks and greeks.ir01_disc is not None else None,
        "theta":     float(greeks.theta)     if greeks and greeks.theta is not None else None,
        "gamma":     float(greeks.gamma)     if greeks and hasattr(greeks, 'gamma') and greeks.gamma is not None else None,
        "legs":      [_lr(lr) for lr in result.legs],
    }


# ── POST /api/price/swaption ──────────────────────────────────────────────────
# Stateless European swaption pricer — Black/Bachelier normal vol + HW1F check.
# No DB writes. Used by the PRICE button when IR_SWAPTION is selected.

class SwaptionRequest(BaseModel):
    # Trade economics
    notional:       float         = 10_000_000
    expiry_y:       float         = 1.0        # option expiry in years
    tenor_y:        float         = 5.0        # underlying swap tenor in years
    strike:         Optional[float] = None     # if None → ATM (= forward rate)
    vol_bp:         float         = 86.5       # normal vol in bp
    is_payer:       bool          = True       # True = payer swaption
    pay_freq_y:     float         = 1.0        # coupon frequency (1=annual, 0.5=semi)
    valuation_date: Optional[date] = None
    # Underlying swap dates — carry T+2 spot lag from frontend, match Bloomberg
    effective_date: Optional[date] = None     # underlying swap start (post-expiry + T+2)
    maturity_date:  Optional[date] = None     # underlying swap end
    # Curve
    curve_id:       str           = "USD_SOFR"
    # Optional: inline shocked curve quotes for scenario repricing
    # [{"tenor": "5Y", "quote_type": "OIS_SWAP", "rate": 0.041}]
    shocked_quotes: Optional[list] = None
    # HW1F cross-check — if None skips cross-check
    hw1f_a:         Optional[float] = None
    hw1f_sigma_bp:  Optional[float] = None
    hw1f_theta:     Optional[float] = None


@router.post("/api/price/swaption")
async def price_swaption_route(
    req: SwaptionRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Price a European swaption using Black/Bachelier normal vol.
    Optionally cross-checks against HW1F model vol from latest calibration.
    """
    _require_trader(user)
    val_date = req.valuation_date or date.today()

    # Build discount curve — use shocked_quotes if provided (scenario repricing)
    base_quotes = [CurveQuote(**q) for q in req.shocked_quotes] if req.shocked_quotes else []
    ci = CurveInput(curve_id=req.curve_id, quotes=base_quotes)
    try:
        curve = _build_curve(ci, val_date, db)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Curve error: {exc}")

    # Resolve strike — ATM if not provided
    strike = req.strike
    if strike is None:
        from pricing.swaption import _annuity_and_forward
        try:
            _, fwd, _ = _annuity_and_forward(
                req.expiry_y, req.tenor_y, curve,
                req.pay_freq_y, val_date,
                swap_effective_date=req.effective_date,
                swap_maturity_date=req.maturity_date,
            )
            strike = fwd
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"ATM forward error: {exc}")

    # HW1F params — from request or load latest calibration
    hw1f_params = None
    hw1f_a      = req.hw1f_a
    hw1f_sig    = req.hw1f_sigma_bp
    hw1f_theta  = req.hw1f_theta

    if hw1f_a is None or hw1f_sig is None:
        try:
            row = db.execute(
                text("""
                    SELECT a, sigma_bp, theta FROM xva_calibration
                    WHERE curve_id = 'USD_SWVOL_ATM' AND model = 'HW1F'
                    ORDER BY valuation_date DESC, created_at DESC
                    LIMIT 1
                """)
            ).fetchone()
            if row:
                hw1f_a     = row.a
                hw1f_sig   = row.sigma_bp
                hw1f_theta = hw1f_theta or row.theta or 0.0365
        except Exception:
            pass

    if hw1f_a and hw1f_sig:
        hw1f_params = {
            'a':        hw1f_a,
            'sigma_bp': hw1f_sig,
            'theta':    hw1f_theta or 0.0365,
        }

    # Price
    try:
        result = price_swaption(
            notional             = req.notional,
            expiry_y             = req.expiry_y,
            tenor_y              = req.tenor_y,
            strike               = strike,
            vol_bp               = req.vol_bp,
            is_payer             = req.is_payer,
            discount_curve       = curve,
            pay_freq_y           = req.pay_freq_y,
            valuation_date       = val_date,
            hw1f_params          = hw1f_params,
            swap_effective_date  = req.effective_date,
            swap_maturity_date   = req.maturity_date,
            db                   = db,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pricing error: {exc}")

    if result.error:
        raise HTTPException(status_code=422, detail=result.error)

    return {
        "instrument":     "IR_SWAPTION",
        "valuation_date": val_date.isoformat(),
        "curve_id":       req.curve_id,
        "notional":       req.notional,
        "expiry_y":       req.expiry_y,
        "tenor_y":        req.tenor_y,
        "strike":         round(strike, 8),
        "strike_pct":     round(strike * 100, 6),
        "vol_bp":         req.vol_bp,
        "is_payer":       req.is_payer,
        "settlement":     "PHYSICAL",
        # Analytics
        "npv":               round(result.npv, 2),
        "vega":              round(result.vega, 2),
        "ir01":              round(result.ir01, 2),
        "theta":             round(result.theta, 2),
        # ── Second-order Greeks ─────────────────────────────────────────────
        "volga":             round(result.volga, 4),        # $ per (1bp)² vol convexity
        "vanna":             round(result.vanna, 4),        # $ per 1bp rate × 1bp vol
        "dollar_gamma":      round(result.dollar_gamma, 4), # $ per (1bp)² rate convexity
        "break_even_vol_bp": round(result.break_even_vol_bp, 3), # bp/day vol to cover theta
        "delta_hedge_notl":  round(result.delta_hedge_notl, 0),  # IRS hedge notional
        "vega_pct_premium":  round(result.vega_pct_premium, 2),  # vega as % of premium
        # ── Curve analytics ──────────────────────────────────────────────────
        "forward_rate":   round(result.forward_rate, 8),
        "forward_pct":    round(result.forward_rate * 100, 6),
        "annuity":        round(result.annuity, 2),
        "d":              round(result.d, 6),
        "n_d":            round(_N(result.d), 6) if result.d is not None else None,
        "moneyness_bp":   round((result.forward_rate - strike) * 10000, 2),
        # HW1F cross-check
        "hw1f_vol_bp":    round(result.hw1f_vol_bp, 3) if result.hw1f_vol_bp else None,
        "hw1f_npv":       result.hw1f_npv,
        "hw1f_error_bp":  result.hw1f_error_bp,
        "hw1f_params":    hw1f_params,
        # SABR vol surface
        "sabr_vol_bp":    result.sabr_vol_bp,
        "is_sabr_vol":    result.is_sabr_vol,
        "vol_tier":       getattr(result, "vol_tier", "MANUAL"),
        # Debug intermediates — exact values for model validation / Excel replication
        "_debug":         getattr(result, "_debug", None),
    }


# ── POST /cashflows/generate ──────────────────────────────────────────────────

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

    # ── IR_SWAPTION: shift leg dates to forward start ─────────────────────────
    # A swaption delivers into a forward-starting swap. The cashflow schedule
    # must start at expiry date, not today. Shift effective/maturity dates by
    # swaption_expiry_y years so price_swap generates the correct forward schedule.
    if request.swaption_expiry_y and trade.instrument_type == "IR_SWAPTION":
        expiry_days = int(request.swaption_expiry_y * 365.25)
        for leg in legs:
            try:
                eff = date.fromisoformat(leg["effective_date"]) if leg.get("effective_date") else val_date
                mat = date.fromisoformat(leg["maturity_date"])  if leg.get("maturity_date")  else val_date
                leg["effective_date"] = str(eff + timedelta(days=expiry_days))
                leg["maturity_date"]  = str(mat + timedelta(days=expiry_days))
            except Exception:
                pass

    curves: dict = {}
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
                rate=float(cf.rate)    if cf.rate    is not None else None,
                dcf=float(cf.dcf)     if cf.dcf     is not None else None,
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
