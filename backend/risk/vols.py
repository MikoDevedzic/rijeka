"""Volatility surfaces with a history, for the demo: the public sources quote no implied vols, so the
synthetic surfaces (market_data/demo_feed.py) are scaled day by day with the realised vol of the public
series they sit on. The term structure, skew and butterfly stay parametric; the level moves with
what the spot or the rate actually did, so a surface has daily changes a VaR can sample and a day's
vega P&L has something to explain. Every row is labelled as such.

    ATM_pair(t, d) = ATM_param(t) · clip( sqrt( RV_w(t)(d) / RV_ref(d) ), ½, 2 )
    RV_w  = annualised standard deviation of the last w daily log returns of the pair's spot, w the
            tenor's window in observations (1W → 5, 1M → 21, … 1Y → 252; 2Y capped at 252)
    RV_ref = the same over every observation on file up to d (at least 60; otherwise the ratio is 1)

The swaption ATM grid is scaled the same way with the 3-month realised vol of the 5Y par rate in bp
against its long-run value. Risk reversals and butterflies are left as quoted."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from market_data import demo_feed as feed
from risk import history as H

SOURCE = "DEMO · synthetic surface, level scaled by trailing realised vol of the public series (RR/BF fixed)"
WINDOW = {"1W": 5, "1M": 21, "2M": 42, "3M": 63, "6M": 126, "9M": 189, "1Y": 252, "2Y": 252}
SWVOL_WINDOW, SWVOL_TENOR = 63, "5Y"
MIN_REF = 60
LOOKBACK_DAYS = 420          # calendar days of series read before the first date built, for the longest window


def realised_vol(values: list[float], window: int, log_returns: bool = True) -> Optional[float]:
    """Annualised standard deviation of the last `window` changes (log returns, or differences)."""
    xs = values[-(window + 1):]
    if len(xs) < max(10, window // 2) + 1:
        return None
    ch = [math.log(b / a) if log_returns else (b - a) for a, b in zip(xs, xs[1:]) if (a > 0 and b > 0) or not log_returns]
    if len(ch) < 2:
        return None
    m = sum(ch) / len(ch)
    var = sum((c - m) ** 2 for c in ch) / (len(ch) - 1)
    return math.sqrt(var * 252.0)


def scale(values: list[float], window: int, log_returns: bool = True) -> float:
    """sqrt(RV_window / RV_reference), clipped to [½, 2]; 1 when there is too little history."""
    ref = realised_vol(values, max(len(values) - 1, 0), log_returns) if len(values) > MIN_REF else None
    rv = realised_vol(values, window, log_returns)
    if not ref or not rv:
        return 1.0
    return min(2.0, max(0.5, math.sqrt(rv / ref)))


def fx_surface(pair: str, spots: list[float]) -> list[dict]:
    """Today's synthetic surface for the pair, its ATM levels scaled by the spot's realised vol."""
    out = []
    for q in feed.build_fx_vols(pair):
        if q["quote_type"] == "ATM":
            q = {**q, "rate": round(q["rate"] * scale(spots, WINDOW[q["tenor"]]), 3)}
        out.append(q)
    return out


def swvol_surface(par_5y_pct: list[float]) -> list[dict]:
    k = scale([100.0 * x for x in par_5y_pct], SWVOL_WINDOW, log_returns=False)     # bp changes of the 5Y par rate
    return [{**q, "rate": round(q["rate"] * k, 2)} for q in feed.build_swvol_atm()]


def history_days(db: Session, user_id, start: date, end: date) -> dict[str, dict[date, list[dict]]]:
    """{surface id: {date: quotes}} for every date in [start, end] the underlying series has."""
    out: dict[str, dict[date, list[dict]]] = {}
    since = start - timedelta(days=LOOKBACK_DAYS)
    for pair in feed.VOL_LEVELS:                                   # G10 pairs and the digital assets alike
        ser = [(d, q["SPOT"]) for d, q in H.series(db, user_id, f"{pair}_SPOT", since, end) if q.get("SPOT")]
        prices = [p for _, p in ser]
        for i, (d, _) in enumerate(ser):
            if start <= d <= end:
                out.setdefault(f"{pair}_VOL", {})[d] = fx_surface(pair, prices[: i + 1])
    ser = [(d, q[SWVOL_TENOR]) for d, q in H.series(db, user_id, "USD_SOFR", since, end) if q.get(SWVOL_TENOR) is not None]
    rates = [r for _, r in ser]
    for i, (d, _) in enumerate(ser):
        if start <= d <= end:
            out.setdefault("USD_SWVOL_ATM", {})[d] = swvol_surface(rates[: i + 1])
    return out


def refresh(db: Session, user_id, d: date) -> dict[str, int]:
    """Replace the day's parametric surfaces with the history-scaled ones (the daily rebuild's last step)."""
    days = history_days(db, user_id, d, d)
    return H.store(db, user_id, days, overwrite=True, source=SOURCE)
