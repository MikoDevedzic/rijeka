"""
Rijeka — IR Swap Pricer
Sprint 3D: fixed NPV + float NPV, full ISDA schedule.
Sprint 4G: per-leg IR01/IR01_DISC, df/zero_rate in CashflowResult.
Sprint 5B: ZERO_COUPON leg type, STEP_UP via fixed_rate_schedule.
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
    rate:          float
    dcf:           float
    amount:        float
    pv:            float
    df:            float = 1.0
    zero_rate:     float = 0.0


@dataclass
class LegResult:
    leg_id:     str
    leg_ref:    str
    leg_type:   str
    direction:  str
    currency:   str
    pv:         float
    cashflows:  List[CashflowResult] = field(default_factory=list)
    ir01:       float = 0.0
    ir01_disc:  float = 0.0


@dataclass
class SwapResult:
    trade_id:   str
    npv:        float
    legs:       List[LegResult] = field(default_factory=list)
    error:      Optional[str] = None


def _parse_date(v):
    if not v:
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def _resolve_step_up_rate(fixed_rate_schedule, period_start: date, default_rate: float) -> float:
    """
    Given a step-up schedule (list of {date, rate} or dict {date_str: rate}),
    return the applicable rate for period_start.
    Rule: last schedule entry where entry.date <= period_start.
    Falls back to default_rate if no entry qualifies.
    """
    if not fixed_rate_schedule:
        return default_rate
    # Normalise to list of (date, rate) tuples
    if isinstance(fixed_rate_schedule, dict):
        entries = [(k, float(v)) for k, v in fixed_rate_schedule.items()]
    else:
        entries = [
            (
                e.get("date") or e.get("effective_date"),
                float(e.get("rate", default_rate))
            )
            for e in fixed_rate_schedule
        ]
    parsed = []
    for d, r in entries:
        pd = _parse_date(d)
        if pd:
            parsed.append((pd, r))
    parsed.sort(key=lambda x: x[0])
    applicable = default_rate
    for entry_date, entry_rate in parsed:
        if entry_date <= period_start:
            applicable = entry_rate
    return applicable


def _resolve_spread_schedule(spread_schedule, period_start, default_spread: float) -> float:
    """
    Given a spread schedule (list of {date, spread} or dict {date_str: spread}),
    return the applicable spread (as decimal) for period_start.
    Rule: last schedule entry where entry.date <= period_start.
    Falls back to default_spread if no entry qualifies.
    Spread values in schedule are already in decimal (converted from bp in frontend).
    """
    if not spread_schedule:
        return default_spread
    if isinstance(spread_schedule, dict):
        entries = [(k, float(v)) for k, v in spread_schedule.items()]
    else:
        entries = [
            (
                e.get("date") or e.get("effective_date"),
                float(e.get("spread", default_spread))
            )
            for e in spread_schedule
        ]
    parsed = []
    for d, r in entries:
        pd = _parse_date(d)
        if pd:
            parsed.append((pd, r))
    parsed.sort(key=lambda x: x[0])
    applicable = default_spread
    for entry_date, entry_rate in parsed:
        if entry_date <= period_start:
            applicable = entry_rate
    return applicable


def price_leg(
    leg:            Dict[str, Any],
    discount_curve: Curve,
    forecast_curve: Optional[Curve],
    valuation_date: date,
) -> LegResult:
    leg_id      = str(leg.get("id", ""))
    leg_ref     = leg.get("leg_ref", "")
    leg_type    = (leg.get("leg_type") or "FIXED").upper()
    direction   = (leg.get("direction") or "PAY").upper()
    currency    = leg.get("currency", "USD")
    notional    = float(leg.get("notional") or 0)
    day_count   = leg.get("day_count") or "ACT/360"
    frequency   = leg.get("payment_frequency") or "QUARTERLY"
    bdc         = leg.get("bdc") or "MOD_FOLLOWING"
    payment_lag = int(leg.get("payment_lag") or 0)
    stub_type   = leg.get("stub_type") or "SHORT_FRONT"
    fixed_rate  = float(leg.get("fixed_rate") or 0)
    spread      = float(leg.get("spread") or 0)
    fixed_rate_schedule  = leg.get("fixed_rate_schedule") or None
    spread_schedule      = leg.get("spread_schedule") or None

    eff = _parse_date(leg.get("effective_date"))
    mat = _parse_date(leg.get("maturity_date"))
    fps = _parse_date(leg.get("first_period_start"))
    lpe = _parse_date(leg.get("last_period_end"))

    if not eff or not mat:
        return LegResult(leg_id=leg_id, leg_ref=leg_ref, leg_type=leg_type,
                         direction=direction, currency=currency, pv=0.0)

    sign = -1.0 if direction == "PAY" else 1.0

    # ── ZERO COUPON: single terminal cashflow ──────────────────────────────────
    # Amount = N x ((1 + r)^T - 1), compounded annually ACT/365F
    # IR01 is computed correctly by price_swap bumped curve logic
    if leg_type == "ZERO_COUPON":
        T       = calc_dcf(eff, mat, "ACT/365F")
        amount  = notional * ((1.0 + fixed_rate) ** T - 1.0)
        df_mat  = discount_curve.df(mat)
        zero_r  = discount_curve.zero_rate(mat)
        pv_cf   = amount * df_mat * sign
        cf = CashflowResult(
            period_start=eff, period_end=mat, payment_date=mat,
            fixing_date=None, currency=currency, notional=notional,
            rate=fixed_rate, dcf=T, amount=amount,
            pv=pv_cf, df=df_mat, zero_rate=zero_r,
        )
        return LegResult(
            leg_id=leg_id, leg_ref=leg_ref, leg_type=leg_type,
            direction=direction, currency=currency,
            pv=pv_cf, cashflows=[cf],
        )

    # ── Standard periodic schedule ─────────────────────────────────────────────
    is_float = leg_type in ("FLOAT", "CMS", "OIS")

    periods = generate_schedule(
        effective_date=eff, maturity_date=mat,
        frequency=frequency, day_count=day_count,
        notional=Decimal(str(notional)), bdc=bdc,
        payment_lag=payment_lag, stub_type=stub_type,
        first_period_start=fps, last_period_end=lpe,
        is_float=is_float,
    )

    cashflows = []
    leg_pv = 0.0

    for p in periods:
        if p.payment_date < valuation_date:
            continue
        # Discount to period_end — consistent with bootstrap annuity -> NPV=$0 at par
        df     = discount_curve.df(p.period_end)
        zero_r = discount_curve.zero_rate(p.payment_date)

        if is_float:
            fc   = forecast_curve or discount_curve
            df1  = fc.df(p.period_start)
            df2  = fc.df(p.period_end)
            tau  = float(p.dcf)
            fwd  = (df1 / df2 - 1.0) / tau if tau > 0 and df2 > 1e-10 else 0.0
            # Spread schedule: per-period spread override
            eff_spread = _resolve_spread_schedule(spread_schedule, p.period_start, spread) if spread_schedule else spread
            rate = fwd + eff_spread
        else:
            # Step-up: resolve rate per period from schedule if present
            if fixed_rate_schedule:
                rate = _resolve_step_up_rate(fixed_rate_schedule, p.period_start, fixed_rate)
            else:
                rate = fixed_rate

        amount = float(p.notional) * rate * float(p.dcf)
        pv_cf  = amount * df
        cashflows.append(CashflowResult(
            period_start=p.period_start, period_end=p.period_end,
            payment_date=p.payment_date,
            fixing_date=p.fixing_date if hasattr(p, 'fixing_date') else None,
            currency=currency, notional=float(p.notional),
            rate=rate, dcf=float(p.dcf), amount=amount,
            pv=pv_cf * sign, df=df, zero_rate=zero_r,
        ))
        leg_pv += pv_cf * sign

    return LegResult(
        leg_id=leg_id, leg_ref=leg_ref, leg_type=leg_type,
        direction=direction, currency=currency,
        pv=leg_pv, cashflows=cashflows,
    )


def price_swap(
    trade_id:       str,
    legs:           List[Dict[str, Any]],
    curves:         Dict[str, Curve],
    valuation_date: date,
) -> SwapResult:
    """
    Price a multi-leg swap. Computes per-leg IR01 and IR01_DISC.

    IR01      — bump ALL curves +1bp, reprice leg -> delta PNL
    IR01_DISC — bump ONLY discount curve +1bp, keep forecast flat -> delta PNL
                When disc == forecast curve, we create a split copy so
                forecasting is unaffected by the discount bump.
    """
    if not curves:
        return SwapResult(trade_id=trade_id, npv=0.0,
                          error="No curves provided")

    # Pre-compute bumped curves for greeks
    bumped_all = {k: v.shifted(1.0) for k, v in curves.items()}

    # For IR01_DISC: disc curves bumped, forecast curves NOT bumped
    bumped_disc_curves = dict(curves)
    for k, v in curves.items():
        bumped_disc_curves[k + "__disc"] = v.shifted(1.0)

    leg_results = []

    for leg in legs:
        disc_id = leg.get("discount_curve_id") or "default"
        fore_id = leg.get("forecast_curve_id") or disc_id

        disc_curve = curves.get(disc_id) or curves.get("default")
        fore_curve = curves.get(fore_id) or curves.get("default")

        if not disc_curve:
            return SwapResult(trade_id=trade_id, npv=0.0,
                              error=f"Discount curve '{disc_id}' not found.")

        # Base price
        lr = price_leg(leg, disc_curve, fore_curve, valuation_date)

        # IR01: bump all curves
        disc_bumped = bumped_all.get(disc_id) or bumped_all.get("default")
        fore_bumped = bumped_all.get(fore_id) or bumped_all.get("default")
        lr_all = price_leg(leg, disc_bumped, fore_bumped, valuation_date)
        lr.ir01 = lr_all.pv - lr.pv

        # IR01_DISC: bump only discount, keep forecast flat
        disc_only = bumped_disc_curves.get(disc_id + "__disc") or bumped_disc_curves.get("default__disc")
        fore_flat = curves.get(fore_id) or curves.get("default")
        lr_disc = price_leg(leg, disc_only, fore_flat, valuation_date) if disc_only else lr
        lr.ir01_disc = lr_disc.pv - lr.pv

        leg_results.append(lr)

    total_npv = sum(r.pv for r in leg_results)
    return SwapResult(trade_id=trade_id, npv=total_npv, legs=leg_results)
