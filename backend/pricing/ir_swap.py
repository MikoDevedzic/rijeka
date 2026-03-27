"""
Rijeka — IR Swap Pricer
Sprint 3D: fixed NPV + float NPV, full ISDA schedule.

Instruments: IR_SWAP, OIS_SWAP, BASIS_SWAP, XCCY_SWAP (simplified),
             FRA, ZERO_COUPON_SWAP, STEP_UP_SWAP, CMS_SWAP

NPV convention:
  PAY fixed leg  → fixed_pv is NEGATIVE (cash out), float_pv is POSITIVE
  RECEIVE fixed  → fixed_pv is POSITIVE, float_pv is NEGATIVE
  Total NPV from OUR perspective = sum of all leg PVs with sign
"""

from datetime import date
from decimal import Decimal
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

from pricing.schedule import generate_schedule, CouponPeriod
from pricing.curve import Curve
from pricing.day_count import dcf as calc_dcf


@dataclass
class CashflowResult:
    period_start:  date
    period_end:    date
    payment_date:  date
    fixing_date:   Optional[date]
    currency:      str
    notional:      float
    rate:          float        # fixed rate or projected forward rate
    dcf:           float
    amount:        float        # notional * rate * dcf
    pv:            float        # amount * df(payment_date)
    df:            float = 1.0  # discount factor to payment_date
    zero_rate:     float = 0.0  # continuously-compounded zero rate to payment_date


@dataclass
class LegResult:
    leg_id:     str
    leg_ref:    str
    leg_type:   str             # FIXED | FLOAT
    direction:  str             # PAY | RECEIVE
    currency:   str
    pv:         float           # present value (signed: negative=pay, positive=receive)
    cashflows:  List[CashflowResult] = field(default_factory=list)


@dataclass
class SwapResult:
    trade_id:   str
    npv:        float           # total NPV from our perspective
    legs:       List[LegResult] = field(default_factory=list)
    pv01:       float = 0.0     # computed separately by greeks.py
    error:      Optional[str]  = None


def price_leg(
    leg:             Dict[str, Any],
    discount_curve:  Curve,
    forecast_curve:  Optional[Curve],
    valuation_date:  date,
) -> LegResult:
    """
    Price a single leg.

    leg dict keys (mirrors trade_legs row):
      id, leg_ref, leg_type, direction, currency, notional,
      effective_date, maturity_date, day_count, payment_frequency,
      bdc, payment_lag, stub_type, first_period_start, last_period_end,
      fixed_rate, spread, forecast_curve_id, notional_type, notional_schedule
    """
    leg_id       = str(leg.get("id", ""))
    leg_ref      = leg.get("leg_ref", "")
    leg_type     = (leg.get("leg_type") or "FIXED").upper()
    direction    = (leg.get("direction") or "PAY").upper()
    currency     = leg.get("currency", "USD")
    notional     = float(leg.get("notional") or 0)
    day_count    = leg.get("day_count") or "ACT/360"
    frequency    = leg.get("payment_frequency") or "QUARTERLY"
    bdc          = leg.get("bdc") or "MOD_FOLLOWING"
    payment_lag  = int(leg.get("payment_lag") or 0)
    stub_type    = leg.get("stub_type") or "SHORT_FRONT"
    fixed_rate   = float(leg.get("fixed_rate") or 0)
    spread       = float(leg.get("spread") or 0)

    eff  = _parse_date(leg.get("effective_date"))
    mat  = _parse_date(leg.get("maturity_date"))
    fps  = _parse_date(leg.get("first_period_start"))
    lpe  = _parse_date(leg.get("last_period_end"))

    if not eff or not mat:
        return LegResult(leg_id=leg_id, leg_ref=leg_ref, leg_type=leg_type,
                         direction=direction, currency=currency, pv=0.0,
                         cashflows=[])

    is_float = leg_type in ("FLOAT", "CMS", "OIS")

    periods = generate_schedule(
        effective_date=eff,
        maturity_date=mat,
        frequency=frequency,
        day_count=day_count,
        notional=Decimal(str(notional)),
        bdc=bdc,
        payment_lag=payment_lag,
        stub_type=stub_type,
        first_period_start=fps,
        last_period_end=lpe,
        is_float=is_float,
    )

    cashflows = []
    leg_pv = 0.0

    for p in periods:
        if p.payment_date < valuation_date:
            continue  # skip settled cashflows

        df = discount_curve.df(p.payment_date)

        if is_float:
            fc = forecast_curve or discount_curve
            fwd = fc.forward_rate(p.period_start, p.period_end)
            rate = fwd + spread
        else:
            rate = fixed_rate

        amount = float(p.notional) * rate * float(p.dcf)
        pv_cf  = amount * df
        zero_r = discount_curve.zero_rate(p.payment_date)

        # Sign: PAY = negative PV from our perspective, RECEIVE = positive
        sign = -1.0 if direction == "PAY" else 1.0

        cashflows.append(CashflowResult(
            period_start=p.period_start,
            period_end=p.period_end,
            payment_date=p.payment_date,
            fixing_date=p.fixing_date,
            currency=currency,
            notional=float(p.notional),
            rate=rate,
            dcf=float(p.dcf),
            amount=amount,
            pv=pv_cf * sign,
        ))
        leg_pv += pv_cf * sign

    return LegResult(
        leg_id=leg_id,
        leg_ref=leg_ref,
        leg_type=leg_type,
        direction=direction,
        currency=currency,
        pv=leg_pv,
        cashflows=cashflows,
    )


def price_swap(
    trade_id:       str,
    legs:           List[Dict[str, Any]],
    curves:         Dict[str, Curve],   # curve_id → Curve
    valuation_date: date,
) -> SwapResult:
    """
    Price a multi-leg swap.
    curves dict must contain an entry for each leg's discount_curve_id
    and forecast_curve_id. Use curve_id "default" as fallback.
    """
    leg_results = []

    for leg in legs:
        disc_id = leg.get("discount_curve_id") or "default"
        fore_id = leg.get("forecast_curve_id") or disc_id

        disc_curve = curves.get(disc_id) or curves.get("default")
        fore_curve = curves.get(fore_id) or curves.get("default")

        if not disc_curve:
            return SwapResult(
                trade_id=trade_id,
                npv=0.0,
                error=f"Discount curve '{disc_id}' not provided."
            )

        result = price_leg(leg, disc_curve, fore_curve, valuation_date)
        leg_results.append(result)

    total_npv = sum(r.pv for r in leg_results)

    return SwapResult(
        trade_id=trade_id,
        npv=total_npv,
        legs=leg_results,
    )


# ── Helpers ──────────────────────────────────────────────────

def _parse_date(val) -> Optional[date]:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, str):
        try:
            from datetime import datetime
            return datetime.strptime(val[:10], "%Y-%m-%d").date()
        except Exception:
            return None
    return None
