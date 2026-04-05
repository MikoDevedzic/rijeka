"""
Rijeka — Greeks / Risk Sensitivities
Sprint 3D: bump-and-reprice framework.
Sprint 4G: renamed IR01→IR01, IR01_DISC→IR01_DISC. Fixed IR01_DISC calculation.

RISK TAXONOMY (Rijeka Standard — see Architecture Section 26):
  IR01       — parallel +1bp shift on ALL rate curves (discount + forecast)
               = full interest rate sensitivity
  IR01_DISC  — parallel +1bp shift on DISCOUNT curves only, forecast held flat
               = pure discounting effect. Typically 10-20% of IR01 for vanilla IRS.
  IR01_FCAST — IR01 - IR01_DISC = pure forecasting effect (not computed here,
               derived by caller if needed)
  THETA      — NPV(T+1day) - NPV(T), all curves fixed

KEY: When discount_curve_id == forecast_curve_id (single-curve mode),
     IR01_DISC must use a SEPARATE bumped copy for discounting while keeping
     an UNBUMPED copy for forecasting. This is what makes IR01_DISC < IR01.
"""

import math
from datetime import date, timedelta
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from pricing.curve import Curve
from pricing.ir_swap import price_swap


@dataclass
class Greeks:
    ir01:       float   # parallel +1bp all curves → ΔNPV
    ir01_disc:  float   # parallel +1bp discount curves only → ΔNPV
    theta:      float   # 1-day time decay
    gamma:      float   # dollar convexity: NPV(+1bp) + NPV(−1bp) − 2·NPV(0)


def compute_greeks(
    trade_id:       str,
    legs:           List[Dict[str, Any]],
    curves:         Dict[str, Curve],
    valuation_date: date,
    base_npv:       Optional[float] = None,
) -> Greeks:
    """
    Compute IR01, IR01_DISC, Theta for a swap.

    IR01_DISC fix: when the same curve is used for discount and forecast,
    we build a split curve dict where the discount role is bumped but the
    forecast role uses the original unbumped curve. This correctly isolates
    the discounting sensitivity from the forecasting sensitivity.
    """
    if base_npv is None:
        base = price_swap(trade_id, legs, curves, valuation_date)
        base_npv = float(base.npv or 0)

    # ── IR01: shift ALL curves +1bp ──────────────────────────────────────────
    bumped_all = {k: v.shifted(1.0) for k, v in curves.items()}
    ir01_result = price_swap(trade_id, legs, bumped_all, valuation_date)
    ir01 = float(ir01_result.npv or 0) - base_npv

    # Gamma: dollar convexity for 1bp parallel move
    bumped_down  = {k: v.shifted(-1.0) for k, v in curves.items()}
    gamma_result = price_swap(trade_id, legs, bumped_down, valuation_date)
    gamma        = float(ir01_result.npv or 0) + float(gamma_result.npv or 0) - 2.0 * base_npv

    # ── IR01_DISC: shift DISCOUNT curves only, keep forecast curves flat ─────
    # Step 1: identify which curve IDs are used for discounting vs forecasting
    disc_ids = set()
    fcast_ids = set()
    for leg in legs:
        d = leg.get("discount_curve_id") or "default"
        f = leg.get("forecast_curve_id") or d
        disc_ids.add(d)
        fcast_ids.add(f)

    # Step 2: build curve dict where:
    #   - discount curves → bumped
    #   - forecast-only curves → unbumped
    #   - curves used for BOTH → need split: bump for discount role, unbump for forecast role
    #
    # We implement this by passing a modified curves dict AND modifying how
    # price_swap uses curves. Since price_swap uses curves[leg.discount_curve_id]
    # and curves[leg.forecast_curve_id], we need to give discount and forecast
    # different keys when they're the same curve.
    #
    # Strategy: for any curve used as BOTH disc and fcast, create a bumped copy
    # keyed as "{cid}__disc_bumped" and patch the legs to reference it for discounting.

    shared_ids = disc_ids & fcast_ids  # curves used for both roles

    if not shared_ids:
        # Simple case: discount and forecast are different curves
        bumped_disc = dict(curves)
        for cid in disc_ids:
            if cid in bumped_disc:
                bumped_disc[cid] = bumped_disc[cid].shifted(1.0)
        disc_result = price_swap(trade_id, legs, bumped_disc, valuation_date)
    else:
        # Complex case: same curve used for disc + fcast
        # Create bumped copies with suffix, patch legs temporarily
        bumped_disc = dict(curves)
        for cid in shared_ids:
            if cid in bumped_disc:
                bumped_disc[cid + "__disc"] = bumped_disc[cid].shifted(1.0)

        # Patch legs: redirect discount_curve_id to bumped copy
        patched_legs = []
        for leg in legs:
            d = leg.get("discount_curve_id") or "default"
            if d in shared_ids:
                patched = dict(leg)
                patched["discount_curve_id"] = d + "__disc"
                patched_legs.append(patched)
            else:
                patched_legs.append(leg)

        disc_result = price_swap(trade_id, patched_legs, bumped_disc, valuation_date)

    ir01_disc = float(disc_result.npv or 0) - base_npv

    # ── Theta: price as of tomorrow ──────────────────────────────────────────
    # Correct roll: extract zero rates from today's pillars, reanchor from tomorrow.
    # Keeps the SAME market zero rates — only time has passed.
    # Wrong approach: Curve(tomorrow, df_pillars=v._df_pillars) reuses absolute DFs
    # unchanged, so NPV(tomorrow) == NPV(today) and theta = $0.
    def _roll_curve(curve: Curve, new_val_date: date) -> Curve:
        new_pillars = []
        for d, df_val in curve._df_pillars:
            if d <= curve.valuation_date:
                continue
            t_old = (d - curve.valuation_date).days / 365.25
            if t_old <= 0 or df_val <= 0:
                continue
            r = -math.log(df_val) / t_old
            t_new = (d - new_val_date).days / 365.25
            if t_new <= 0:
                continue
            new_pillars.append((d, math.exp(-r * t_new)))
        return Curve(new_val_date, df_pillars=new_pillars)

    tomorrow     = valuation_date + timedelta(days=1)
    theta_curves = {k: _roll_curve(v, tomorrow) for k, v in curves.items()}
    theta_result = price_swap(trade_id, legs, theta_curves, tomorrow)
    theta        = float(theta_result.npv or 0) - base_npv

    return Greeks(ir01=ir01, ir01_disc=ir01_disc, theta=theta, gamma=gamma)
