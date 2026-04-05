"""
Rijeka — Curve Object
Sprint 4G: Direct DF storage — eliminates ln/exp round-trip precision loss.

Curve stores (pillar_date, discount_factor) pairs internally.
Interpolation: log-linear on DFs using calendar day fractions.
This matches the bootstrap's _interp_df exactly, ensuring NPV = $0 at par rate.

df(t)           = log-linear interpolation on stored DFs
zero_rate(d)    = -ln(df(d)) / ACT365F(val, d)   [derived, not stored]
forward_rate    = (df(d1)/df(d2) - 1) / ACT365F(d1, d2)
"""

import math
from datetime import date
from typing import List, Tuple, Optional

from pricing.day_count import act365f


class Curve:
    """
    Interpolated discount curve storing DFs directly.

    Parameters
    ----------
    valuation_date : date
    df_pillars : list of (pillar_date, discount_factor)
        Primary constructor. DFs must be <= 1.0, positive.
        e.g. [(date(2026,4,7), 0.9998), (date(2027,4,7), 0.9633), ...]
    pillars : list of (pillar_date, zero_rate)
        Legacy constructor. Converted to DFs internally.
    flat_rate : float | None
        Flat curve at this continuously-compounded zero rate.
    """

    def __init__(
        self,
        valuation_date: date,
        df_pillars: Optional[List[Tuple[date, float]]] = None,
        pillars: Optional[List[Tuple[date, float]]] = None,
        flat_rate: Optional[float] = None,
    ):
        self.valuation_date = valuation_date

        if flat_rate is not None:
            # Flat curve — two sentinel pillars
            far = date(valuation_date.year + 60, valuation_date.month, valuation_date.day)
            T_far = float(act365f(valuation_date, far))
            self._df_pillars: List[Tuple[date, float]] = [
                (valuation_date, 1.0),
                (far, math.exp(-flat_rate * T_far)),
            ]

        elif df_pillars is not None:
            # Primary: DFs supplied directly from bootstrap
            # Ensure val_date anchor present
            pairs = sorted(df_pillars, key=lambda x: x[0])
            if not pairs or pairs[0][0] != valuation_date:
                pairs = [(valuation_date, 1.0)] + pairs
            self._df_pillars = pairs

        elif pillars is not None:
            # Legacy: zero rates supplied — convert to DFs
            pairs = sorted(pillars, key=lambda x: x[0])
            self._df_pillars = [(valuation_date, 1.0)]
            for d, r in pairs:
                if d <= valuation_date:
                    continue
                T = float(act365f(valuation_date, d))
                df = math.exp(-r * T) if T > 0 else 1.0
                self._df_pillars.append((d, df))

        else:
            raise ValueError("Curve requires df_pillars, pillars, or flat_rate.")

    # ── Core methods ──────────────────────────────────────────────────────────

    def df(self, d: date) -> float:
        """
        Discount factor from valuation_date to d.
        Log-linear interpolation using calendar day fractions —
        identical to bootstrap._interp_df for exact NPV = $0 at par rate.
        """
        if d <= self.valuation_date:
            return 1.0
        return self._interp_df(d)

    def zero_rate(self, d: date) -> float:
        """Continuously-compounded zero rate to d. Derived from DF."""
        if d <= self.valuation_date:
            return 0.0
        T = float(act365f(self.valuation_date, d))
        if T <= 0:
            return 0.0
        df_val = self._interp_df(d)
        if df_val <= 0:
            return 0.0
        return -math.log(df_val) / T

    def forward_rate(self, d1: date, d2: date) -> float:
        """
        Simply-compounded forward rate for period [d1, d2].
        forward = (df(d1)/df(d2) - 1) / ACT365F(d1, d2)
        """
        if d1 >= d2:
            return 0.0
        df1 = self.df(d1)
        df2 = self.df(d2)
        if df2 <= 0:
            return 0.0
        T = float(act365f(d1, d2))
        if T <= 0:
            return 0.0
        return (df1 / df2 - 1.0) / T

    # ── Interpolation ─────────────────────────────────────────────────────────

    def _interp_df(self, d: date) -> float:
        """
        Log-linear interpolation on stored DFs using calendar day fractions.
        Matches bootstrap._interp_df exactly — same method, same result.
        """
        pil = self._df_pillars

        if not pil:
            return 1.0
        if d <= pil[0][0]:
            return pil[0][1]

        # Flat extrapolation beyond last pillar via constant zero rate
        if d >= pil[-1][0]:
            d0, df0 = pil[-1]
            origin = pil[0][0]
            t0 = max((d0 - origin).days, 1) / 365.25
            t1 = (d - origin).days / 365.25
            r = -math.log(df0) / t0 if df0 > 0 and t0 > 0 else 0.0
            return math.exp(-r * t1)

        # Binary search for surrounding pillars
        lo, hi = 0, len(pil) - 1
        while lo + 1 < hi:
            mid = (lo + hi) // 2
            if pil[mid][0] <= d:
                lo = mid
            else:
                hi = mid

        d0, df0 = pil[lo]
        d1, df1 = pil[hi]
        days_total = max((d1 - d0).days, 1)
        days_query = (d - d0).days
        t = days_query / days_total   # calendar day fraction — matches bootstrap

        if df0 <= 0 or df1 <= 0:
            return max(df0, df1)

        # Log-linear: df = exp((1-t)*ln(df0) + t*ln(df1))
        return math.exp((1.0 - t) * math.log(df0) + t * math.log(df1))

    # ── Shift (for Greeks) ────────────────────────────────────────────────────

    def shifted(self, bump_bps: float) -> "Curve":
        """
        Return a new curve with all zero rates shifted by bump_bps basis points.
        Converts DF -> r -> shift -> r_new -> DF_new.
        """
        shift = bump_bps / 10_000.0
        new_pillars: List[Tuple[date, float]] = []
        for d, df_val in self._df_pillars:
            if d == self.valuation_date:
                new_pillars.append((d, 1.0))
                continue
            T = float(act365f(self.valuation_date, d))
            if T <= 0 or df_val <= 0:
                new_pillars.append((d, df_val))
                continue
            r = -math.log(df_val) / T
            r_new = r + shift
            new_pillars.append((d, math.exp(-r_new * T)))
        return Curve(self.valuation_date, df_pillars=new_pillars)
