"""
Rijeka — Greeks
Sprint 3D: PV01, DV01 via bump-and-reprice.

PV01: parallel shift of ALL curves by +1bp → ΔNPV
DV01: parallel shift of discount curve only by +1bp → ΔNPV
Theta: (NPV(t+1day) - NPV(t)) / 1
"""

from datetime import date, timedelta
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from pricing.curve import Curve
from pricing.ir_swap import price_swap


@dataclass
class Greeks:
    pv01:  float   # parallel shift all curves +1bp
    dv01:  float   # shift discount curve only +1bp
    theta: float   # 1-day time decay


def compute_greeks(
    trade_id:       str,
    legs:           List[Dict[str, Any]],
    curves:         Dict[str, Curve],
    valuation_date: date,
    base_npv:       Optional[float] = None,
) -> Greeks:
    """
    Compute PV01, DV01, Theta for a swap.

    base_npv: if already computed, pass it in to avoid recomputing.
    """
    if base_npv is None:
        base = price_swap(trade_id, legs, curves, valuation_date)
        base_npv = base.npv

    # PV01 — shift all curves +1bp
    bumped_all = {k: v.shifted(1.0) for k, v in curves.items()}
    pv01_result = price_swap(trade_id, legs, bumped_all, valuation_date)
    pv01 = pv01_result.npv - base_npv

    # DV01 — shift discount curve only +1bp
    # Identify discount curves (any curve used as discount_curve_id on a leg)
    disc_ids = {leg.get("discount_curve_id") or "default" for leg in legs}
    bumped_disc = dict(curves)
    for cid in disc_ids:
        if cid in bumped_disc:
            bumped_disc[cid] = bumped_disc[cid].shifted(1.0)
    dv01_result = price_swap(trade_id, legs, bumped_disc, valuation_date)
    dv01 = dv01_result.npv - base_npv

    # Theta — price as of tomorrow
    tomorrow = valuation_date + timedelta(days=1)
    theta_curves = {k: Curve(tomorrow, pillars=v._pillars) for k, v in curves.items()}
    theta_result = price_swap(trade_id, legs, theta_curves, tomorrow)
    theta = theta_result.npv - base_npv

    return Greeks(pv01=pv01, dv01=dv01, theta=theta)
