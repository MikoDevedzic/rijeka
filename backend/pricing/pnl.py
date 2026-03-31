"""
RIJEKA - PNL Attribution Engine
Sprint 5A: THETA_PNL computed. IR01_PNL/CARRY/ROLLDOWN stubbed until Sprint 5B.
Sprint 5B: Wire delta_rate_bps from market_data_snapshots diff.
Sprint 5C: IR_VEGA_PNL requires vol surface.
Risk taxonomy: IR01/IR01_DISC/THETA/GAMMA. Never PV01/DV01.
"""

from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class PNLAttribution:
    trade_id:         str
    snapshot_date:    str
    currency:         str
    npv:              float = 0.0
    ir01:             float = 0.0
    ir01_disc:        float = 0.0
    theta:            float = 0.0
    gamma:            float = 0.0
    delta_rate_bps:   float = 0.0
    delta_disc_bps:   float = 0.0
    total_pnl:        Optional[float] = None
    carry:            float = 0.0
    rolldown:         float = 0.0
    theta_pnl:        float = 0.0
    ir01_pnl:         float = 0.0
    ir01_disc_pnl:    float = 0.0
    gamma_pnl:        float = 0.0
    fx01_pnl:         float = 0.0
    xccy01_pnl:       float = 0.0
    basis01_pnl:      float = 0.0
    ir_vega_pnl:      float = 0.0
    cs01_pnl:         float = 0.0
    unexplained:      float = 0.0

    @property
    def attributed_total(self):
        return (
            self.carry + self.rolldown + self.theta_pnl +
            self.ir01_pnl + self.gamma_pnl +
            self.fx01_pnl + self.xccy01_pnl + self.basis01_pnl +
            self.ir_vega_pnl + self.cs01_pnl + self.unexplained
        )


def compute_attribution(
    npv_today, npv_yesterday,
    ir01, ir01_disc, theta, gamma,
    delta_rate_bps=0.0, delta_disc_bps=0.0,
    carry=0.0, rolldown=0.0,
    trade_id="", snapshot_date="", currency="USD",
):
    """
    Sprint 5A: total_pnl = carry + rolldown + theta_pnl + ir01_pnl + gamma_pnl + unexplained
    ir01_disc_pnl is a drill-down sub-component, NOT additive to ir01_pnl.
    delta_rate_bps = 0 until Sprint 5B wires market_data_snapshots diff.
    """
    total_pnl     = npv_today - npv_yesterday
    theta_pnl     = theta
    ir01_pnl      = ir01      * delta_rate_bps
    ir01_disc_pnl = ir01_disc * delta_disc_bps
    gamma_pnl     = 0.5 * gamma * (delta_rate_bps ** 2) if gamma else 0.0
    attributed    = carry + rolldown + theta_pnl + ir01_pnl + gamma_pnl
    unexplained   = total_pnl - attributed

    if total_pnl != 0 and abs(unexplained) > 500:
        pct = abs(unexplained / total_pnl) * 100
        if pct > 10:
            logger.warning(
                "PNL unexplained=%.0f (%.1f pct) trade=%s date=%s"
                " -- expected for XCCY/swaptions until Sprint 5B/5C.",
                unexplained, pct, trade_id, snapshot_date
            )

    return PNLAttribution(
        trade_id=trade_id, snapshot_date=snapshot_date, currency=currency,
        npv=npv_today, ir01=ir01, ir01_disc=ir01_disc,
        theta=theta, gamma=gamma,
        delta_rate_bps=delta_rate_bps, delta_disc_bps=delta_disc_bps,
        total_pnl=total_pnl, carry=carry, rolldown=rolldown,
        theta_pnl=theta_pnl, ir01_pnl=ir01_pnl, ir01_disc_pnl=ir01_disc_pnl,
        gamma_pnl=gamma_pnl, unexplained=unexplained,
    )


def get_parallel_rate_move(quotes_today, quotes_yesterday):
    """
    Parallel rate move (bps) between two pillar quote lists.
    Rates stored as pct in market_data_snapshots (e.g. 5.310 = 5.310 pct).
    Shift bps = (rate_today - rate_yesterday) * 100.
    Returns 0.0 if either snapshot missing.
    """
    if not quotes_today or not quotes_yesterday:
        return 0.0
    today_map = {q["tenor"]: q["rate"] for q in quotes_today  if q.get("enabled", True)}
    yest_map  = {q["tenor"]: q["rate"] for q in quotes_yesterday if q.get("enabled", True)}
    common    = set(today_map.keys()) & set(yest_map.keys())
    if not common:
        return 0.0
    shifts = [(today_map[t] - yest_map[t]) * 100 for t in common]
    return sum(shifts) / len(shifts)