"""
Rijeka — Curve Object
Sprint 3D: flat-forward stub curves.
Sprint 4+: bootstrapped from deposit/futures/swap quotes.

Curve stores (pillar_date, zero_rate) pairs.
Discount factors: df(t) = exp(-r * T)  where T = act365f(valuation_date, t)
Interpolation: log-linear on discount factors (= linear on zero rates for this DCF).
Forward rate between d1, d2: (df(d1)/df(d2) - 1) / dcf(d1, d2)
"""

import math
from datetime import date
from decimal import Decimal
from typing import List, Tuple, Optional

from pricing.day_count import act365f


class Curve:
    """
    Interpolated discount curve.

    Parameters
    ----------
    valuation_date : date
    pillars : list of (pillar_date, zero_rate_decimal)
        e.g. [(date(2026,6,27), 0.045), (date(2027,3,27), 0.0455), ...]
    flat_rate : float | None
        If provided, curve is flat at this rate (overrides pillars).
    """

    def __init__(
        self,
        valuation_date: date,
        pillars: Optional[List[Tuple[date, float]]] = None,
        flat_rate: Optional[float] = None,
    ):
        self.valuation_date = valuation_date

        if flat_rate is not None:
            # Flat curve — two pillars far enough apart
            self._pillars = [
                (valuation_date, flat_rate),
                (date(valuation_date.year + 50, valuation_date.month, valuation_date.day), flat_rate),
            ]
        elif pillars:
            # Sort by date
            self._pillars = sorted(pillars, key=lambda x: x[0])
        else:
            raise ValueError("Curve requires either flat_rate or pillars.")

    # ── Core methods ─────────────────────────────────────────

    def df(self, d: date) -> float:
        """Discount factor from valuation_date to d."""
        if d <= self.valuation_date:
            return 1.0
        T = float(act365f(self.valuation_date, d))
        r = self._interp_rate(d)
        return math.exp(-r * T)

    def forward_rate(self, d1: date, d2: date) -> float:
        """
        Simply-compounded forward rate for period [d1, d2].
        forward = (df(d1)/df(d2) - 1) / T  where T = act365f(d1, d2)
        """
        if d1 >= d2:
            return 0.0
        df1 = self.df(d1)
        df2 = self.df(d2)
        if df2 == 0:
            return 0.0
        T = float(act365f(d1, d2))
        if T == 0:
            return 0.0
        return (df1 / df2 - 1.0) / T

    def zero_rate(self, d: date) -> float:
        """Continuously-compounded zero rate to d."""
        if d <= self.valuation_date:
            return self._pillars[0][1]
        return self._interp_rate(d)

    # ── Interpolation ────────────────────────────────────────

    def _interp_rate(self, d: date) -> float:
        """Log-linear interpolation (= linear on zero rates * T)."""
        dates  = [p[0] for p in self._pillars]
        rates  = [p[1] for p in self._pillars]

        if d <= dates[0]:
            return rates[0]
        if d >= dates[-1]:
            return rates[-1]

        # Find surrounding pillars
        for i in range(len(dates) - 1):
            if dates[i] <= d < dates[i + 1]:
                t  = float(act365f(self.valuation_date, d))
                t1 = float(act365f(self.valuation_date, dates[i]))
                t2 = float(act365f(self.valuation_date, dates[i + 1]))
                if t2 == t1:
                    return rates[i]
                # Interpolate on r*T (log-linear on df)
                rt1 = rates[i]     * t1
                rt2 = rates[i + 1] * t2
                if t == 0:
                    return rates[i]
                rt = rt1 + (rt2 - rt1) * (t - t1) / (t2 - t1)
                return rt / t

        return rates[-1]

    # ── Shift (for Greeks) ───────────────────────────────────

    def shifted(self, bump_bps: float) -> "Curve":
        """Return a new curve with all rates shifted by bump_bps basis points."""
        shift = bump_bps / 10000.0
        new_pillars = [(d, r + shift) for d, r in self._pillars]
        return Curve(self.valuation_date, pillars=new_pillars)
