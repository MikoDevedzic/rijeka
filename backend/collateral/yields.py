"""What an instrument yields today, from market data: a CURVE instrument reads the short rate of its curve from the
account's latest snapshot (the one-year zero, continuously compounded, in bp); FIXED and NONE need no market."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Callable, Optional


def curve_rate_bp_fn(db, uid: str, mkt, asof: date) -> Callable[[str], Optional[float]]:
    """A memoised callback curve id → short rate in bp, None when the curve has no snapshot. Built lazily so an
    instrument list with no CURVE instruments costs nothing."""
    cache: dict[str, Optional[float]] = {}

    def rate(curve_id: str) -> Optional[float]:
        if curve_id in cache:
            return cache[curve_id]
        out: Optional[float] = None
        try:
            quotes = mkt.quotes(curve_id) if mkt is not None else None
            if quotes:
                from api.routes.pricer import _build_curve
                from pnl.valuation import _curve_input
                curve = _build_curve(_curve_input(curve_id, quotes), asof, db, uid)
                z = curve.zero_rate(asof + timedelta(days=365))
                out = float(z) * 1e4 if math.isfinite(z) else None
        except Exception:          # noqa: BLE001
            try:
                db.rollback()
            except Exception:      # noqa: BLE001
                pass
            out = None
        cache[curve_id] = out
        return out

    return rate


def resolve_all(instruments: dict, rate_fn: Optional[Callable[[str], Optional[float]]]) -> dict[str, float]:
    """{code: yield bp} for every instrument in the list."""
    return {code: inst.resolve_yield_bp(rate_fn) for code, inst in instruments.items()}
