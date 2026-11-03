"""The sensitivity per pillar: one quote of one input moved by one unit, the trades that read it repriced through
the production pricers, the change summed in USD. The same valuer memo as the P&L explain and the risk ladder,
so a trade is priced once per market."""
from __future__ import annotations

from datetime import date
from typing import Any, Callable, Optional

from ipv.inputs import bumped, pillars_of


def pillar_ladder(trades: list, d: date, mkt, curve_id: str, valuer: Callable, fx_to_usd: Callable[[str], float],
                  pillars: Optional[list[dict]] = None, units: float = 1.0) -> dict[str, float]:
    """{pillar key: USD change of the trades' value for +1 unit of that pillar}."""
    quotes = mkt.quotes(curve_id)
    if not quotes:
        return {}
    pls = pillars if pillars is not None else pillars_of(curve_id, quotes)
    base: dict[str, tuple[float, float]] = {}
    for t in trades:
        v = valuer(t, d, mkt)
        base[str(t.id)] = (float(v["npv"]), float(fx_to_usd(v["ccy"]) or 0.0))
    out: dict[str, float] = {}
    for p in pls:
        m = mkt.override(curve_id, bumped(curve_id, quotes, p["key"], units))
        s = 0.0
        for t in trades:
            npv0, k = base[str(t.id)]
            s += (float(valuer(t, d, m)["npv"]) - npv0) * k
        out[p["key"]] = s / units
    return out


def first_order(sensitivities: dict[str, float], shifts: dict[str, float]) -> dict[str, Any]:
    """Σ sensitivity × shift over the pillars with a shift, and the per-pillar terms."""
    terms = {k: sensitivities.get(k, 0.0) * sh for k, sh in shifts.items()}
    return {"total": sum(terms.values()), "by_pillar": terms}
