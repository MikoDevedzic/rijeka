"""What the book is valued on, and each input's pillars.

The dependency list is derived from the trades, never from a catalogue: `pnl.valuation.trade_curves` and
`spot_curve` name the curves, funding levels, vol surfaces and spots each trade reads. A pillar is one quote of
the input: a tenor on a curve, an expiry × tenor point on a swaption grid ("1Yx5Y"), a tenor and quote type on
an FX surface ("1Y|RR25"), the single SPOT row of a spot."""
from __future__ import annotations

from typing import Any

from pnl.explain import tenor_years
from pnl.market import quote_key

KINDS = ("RATES", "FUNDING", "SWAPTION_VOL", "FX_VOL", "SPOT")
UNIT_OF = {"RATES": "bp", "FUNDING": "bp", "SWAPTION_VOL": "vol_bp", "FX_VOL": "vol_pt", "SPOT": "pct"}
UNIT_LABEL = {"bp": "bp", "vol_bp": "bp of normal vol", "vol_pt": "vol points", "pct": "% of spot"}
# the quote's own unit → the IPV unit: rates quotes are in %, so 1 bp is 0.01; swaption vols in bp, FX vols in points
QUOTE_PER_UNIT = {"bp": 0.01, "vol_bp": 1.0, "vol_pt": 1.0, "pct": None}       # pct: relative, handled in shift()


def kind_of(curve_id: str) -> str:
    c = str(curve_id or "").upper()
    if c.endswith("_SWVOL_ATM"):
        return "SWAPTION_VOL"
    if c.endswith("_VOL"):
        return "FX_VOL"
    if c.endswith("_SPOT"):
        return "SPOT"
    if c.endswith("_FUNDING") or c.endswith("_FLAT"):
        return "FUNDING"
    return "RATES"


def unit_of(curve_id: str) -> str:
    return UNIT_OF[kind_of(curve_id)]


def dependencies(trades: list) -> dict[str, list[str]]:
    """{curve_id: [trade ids]} over the trades: every curve, funding level, surface and spot they read."""
    from pnl.valuation import spot_curve, trade_curves
    out: dict[str, list[str]] = {}
    for t in trades:
        keys = list(trade_curves(t))
        sc = spot_curve(t)
        if sc:
            keys.append(sc)
        for k in keys:
            if k:
                out.setdefault(k, []).append(str(t.id))
    return out


def pillar_key(curve_id: str, q: dict) -> str:
    """The pillar's identity within its input (pnl.market.quote_key): the tenor, plus the quote type where a tenor
    carries several rows (an FX surface's ATM, RR25 and BF25)."""
    tenor, qt = quote_key(q)
    if kind_of(curve_id) == "FX_VOL" and qt:
        return f"{tenor}|{qt}"
    return str(tenor)


def pillars_of(curve_id: str, quotes: list[dict] | None) -> list[dict[str, Any]]:
    """The input's pillars in time order: key, tenor, quote type, years, the quote's value."""
    out = []
    for q in quotes or []:
        if q.get("rate") is None or not q.get("enabled", True):
            continue
        tenor, qt = quote_key(q)
        out.append({"key": pillar_key(curve_id, q), "tenor": str(tenor), "quote_type": qt or "", "years": tenor_years(str(tenor)), "value": float(q["rate"])})
    out.sort(key=lambda p: (p["years"], p["tenor"], p["quote_type"]))
    return out


def find_quote(quotes: list[dict], curve_id: str, key: str) -> dict | None:
    for q in quotes or []:
        if pillar_key(curve_id, q) == key:
            return q
    return None


def shift(curve_id: str, desk_value: float, other_value: float) -> float:
    """other − desk in the input's IPV unit: bp for rates and funding (quotes in %), bp of normal vol for swaptions,
    vol points for FX surfaces, % of the desk's spot for a spot."""
    u = unit_of(curve_id)
    if u == "pct":
        return (other_value / desk_value - 1.0) * 100.0 if desk_value else 0.0
    return (other_value - desk_value) / QUOTE_PER_UNIT[u]


def bumped(curve_id: str, quotes: list[dict], key: str, units: float = 1.0) -> list[dict]:
    """The quotes with one pillar moved by `units` of the input's unit (1 bp, 1 bp of vol, 1 vol point, 1 % of spot)."""
    u = unit_of(curve_id)
    out = []
    for q in quotes or []:
        if pillar_key(curve_id, q) == key:
            r = float(q["rate"])
            out.append({**q, "rate": r * (1.0 + units / 100.0) if u == "pct" else r + units * QUOTE_PER_UNIT[u]})
        else:
            out.append(dict(q))
    return out


def with_overrides(curve_id: str, quotes: list[dict], overrides: dict[str, float]) -> list[dict]:
    """The quotes with the given pillars set to their override values (the quote's own unit)."""
    out = []
    for q in quotes or []:
        k = pillar_key(curve_id, q)
        out.append({**q, "rate": float(overrides[k])} if k in overrides else dict(q))
    return out
