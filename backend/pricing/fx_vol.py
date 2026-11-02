"""Rijeka — FX volatility surface, as the market quotes it.

A pair's surface is saved as a {PAIR}_VOL snapshot with, per tenor, three quotes in volatility
points (% per year): the at-the-money vol (ATM), the 25-delta risk reversal (RR25 = σ_25Δcall −
σ_25Δput) and the 25-delta butterfly (BF25 = (σ_25Δcall + σ_25Δput)/2 − ATM). Example quotes:

    [{"tenor": "1M", "quote_type": "ATM", "rate": 7.20}, {"tenor": "1M", "quote_type": "RR25", "rate": -0.35},
     {"tenor": "1M", "quote_type": "BF25", "rate": 0.20}, ...]

Smile. Across strikes the vol is a quadratic in the forward delta of a call (Malz, 1997):

    σ(Δ) = ATM − 2·RR25·(Δ − ½) + 16·BF25·(Δ − ½)²

which reproduces the three quotes exactly (Δ = ½ → ATM; Δ = ¼ → ATM + BF + RR/2; Δ = ¾ → ATM + BF −
RR/2) and is the simplest curve through them. The delta is the premium-excluded forward delta Φ(d1),
which depends on the vol, so the vol is found by a fixed point from ATM (it converges in a few
steps). Beyond the 10-delta wings the quadratic is extrapolated as it stands; that is a stated
limitation, as is the choice of delta convention (premium-included deltas are the market standard
for USD-base pairs and would move strikes slightly).

Term. ATM, RR25 and BF25 are each interpolated linearly in time between quoted tenors and held flat
beyond them; the smile is then built at the option's own expiry. (Linear in vol, not variance: the
quotes are a desk's inputs and a trader reads them that way; the difference is small at these
maturities and is noted in the methodology.)

Tiers. SURFACE when the pair has a snapshot with ATM at two tenors or more; ATM when it has ATM
quotes but no RR/BF; DEFAULT when there is no snapshot (a flat per-pair level, stated in the
response); OVERRIDE when the request names a vol.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from pricing.fx_option import forward_delta

TENOR_YEARS = {"ON": 1 / 365, "1W": 7 / 365, "2W": 14 / 365, "3W": 21 / 365, "1M": 1 / 12, "2M": 2 / 12, "3M": 3 / 12, "4M": 4 / 12,
               "6M": 0.5, "9M": 0.75, "1Y": 1.0, "18M": 1.5, "2Y": 2.0, "3Y": 3.0, "5Y": 5.0}
DEFAULT_VOL_PCT = {"EURUSD": 7.5, "GBPUSD": 8.5, "AUDUSD": 10.0, "USDJPY": 10.0, "USDCHF": 7.5, "USDCAD": 6.5}
DEFAULT_FALLBACK_PCT = 10.0
QUOTE_TYPES = ("ATM", "RR25", "BF25")


@dataclass
class Pillar:
    t: float
    atm: float            # decimal
    rr: float             # decimal
    bf: float             # decimal
    smile: bool = True    # False when the tenor quotes an ATM only: it carries no information on RR/BF


def parse_surface(quotes) -> list[Pillar]:
    """[Pillar] sorted by time from a {PAIR}_VOL snapshot's quotes; tenors without an ATM are dropped."""
    by: dict[str, dict[str, float]] = {}
    for q in quotes or []:
        if not q.get("enabled", True) or q.get("rate") is None:
            continue
        t = str(q.get("tenor", "")).upper()
        qt = str(q.get("quote_type", "ATM")).upper()
        if t not in TENOR_YEARS or qt not in QUOTE_TYPES:
            continue
        try:
            by.setdefault(t, {})[qt] = float(q["rate"]) / 100.0
        except (TypeError, ValueError):
            continue
    out = [Pillar(TENOR_YEARS[t], v["ATM"], v.get("RR25", 0.0), v.get("BF25", 0.0), ("RR25" in v or "BF25" in v))
           for t, v in by.items() if "ATM" in v and v["ATM"] > 0]
    return sorted(out, key=lambda p: p.t)


def _lin(points: list[tuple[float, float]], T: float) -> float:
    """Linear in time between points, flat beyond them."""
    if T <= points[0][0]:
        return points[0][1]
    if T >= points[-1][0]:
        return points[-1][1]
    for (ta, va), (tb, vb) in zip(points, points[1:]):
        if ta <= T <= tb:
            return va + (T - ta) / (tb - ta) * (vb - va)
    return points[-1][1]


def _interp(pillars: list[Pillar], T: float) -> Pillar:
    """ATM over every pillar; RR and BF over the pillars that quote a smile (a tenor with an ATM alone
    says nothing about the skew, so it is skipped for RR/BF rather than read as zero)."""
    atm = _lin([(p.t, p.atm) for p in pillars], T)
    smiled = [p for p in pillars if p.smile]
    if not smiled:
        return Pillar(T, atm, 0.0, 0.0, False)
    return Pillar(T, atm, _lin([(p.t, p.rr) for p in smiled], T), _lin([(p.t, p.bf) for p in smiled], T), True)


def smile_vol(atm: float, rr: float, bf: float, call_delta: float) -> float:
    x = call_delta - 0.5
    return atm - 2.0 * rr * x + 16.0 * bf * x * x


def vol_at(pillars: list[Pillar], T: float, F: float, K: float, iterations: int = 8) -> float:
    """The smile vol (decimal) for strike K at expiry T: the fixed point of σ = smile(Δ_call(σ))."""
    p = _interp(pillars, T)
    if p.rr == 0.0 and p.bf == 0.0:
        return p.atm
    sigma = p.atm
    for _ in range(iterations):
        delta = forward_delta(F, K, T, sigma, call=True)
        nxt = smile_vol(p.atm, p.rr, p.bf, delta)
        if abs(nxt - sigma) < 1e-10:
            sigma = nxt
            break
        sigma = max(nxt, 1e-4)
    return sigma


def lookup_vol(quotes, pair: str, T: float, F: float, K: float, override_pct: Optional[float] = None) -> tuple[float, str, str]:
    """(vol decimal, tier, note). override_pct wins; else the pair's surface; else the pair's default level."""
    if override_pct is not None:
        return float(override_pct) / 100.0, "OVERRIDE", f"vol {float(override_pct):.2f}% from the request"
    pillars = parse_surface(quotes)
    if pillars:
        v = vol_at(pillars, T, F, K)
        smiled = any(p.smile for p in pillars)
        tier = "SURFACE" if smiled else "ATM"
        return v, tier, (f"{pair}_VOL: ATM/RR25/BF25 at {len(pillars)} tenors, Malz smile in delta" if smiled
                         else f"{pair}_VOL: ATM at {len(pillars)} tenors, no smile quoted")
    lvl = DEFAULT_VOL_PCT.get(pair.upper(), DEFAULT_FALLBACK_PCT)
    return lvl / 100.0, "DEFAULT", f"no {pair}_VOL snapshot: flat {lvl:.1f}% desk default"


def quotes_from_grid(grid: dict[str, dict[str, float]]) -> list[dict]:
    """{tenor: {ATM, RR25, BF25}} (vol points) -> snapshot quotes, tenors in time order."""
    out = []
    for t in sorted((k.upper() for k in grid), key=lambda k: TENOR_YEARS.get(k, 99)):
        row = grid[t] if t in grid else grid[t.lower()]
        if not isinstance(row, dict) or row.get("ATM") is None:
            continue
        for qt in QUOTE_TYPES:
            v = row.get(qt)
            if v is None:
                continue                  # a tenor quoted ATM-only carries no RR/BF row, so it does not read as a flat smile
            out.append({"tenor": t, "quote_type": qt, "rate": float(v), "enabled": True})
    return out


# ── Along a simulated path: the term structure and the smile at the path's moneyness ───────────────
#
# An option valued at a later date t with expiry T should carry (i) the ATM vol the surface implies for
# the remaining life, the forward vol from t to T (variance is additive: σ_f²·(T−t) = σ_T²·T − σ_t²·t), and
# (ii) the smile at the path's moneyness, read sticky-delta: the quoted RR and BF at the remaining tenor,
# the delta from the path's forward against the strike (the FX convention: the smile floats with the
# forward). The simulation itself steps the spot with the piecewise forward vols, so the variance of
# log S_t equals the surface's ATM variance at every grid date. Until 2 November 2026 one vol, today's at
# the original strike and expiry, was held along the whole path.

def atm_vol(pillars: list[Pillar], T: float) -> float:
    return _lin([(p.t, p.atm) for p in pillars], max(T, 0.0))


def atm_variance(pillars: list[Pillar], T: float) -> float:
    return atm_vol(pillars, T) ** 2 * max(T, 0.0)


def forward_vol(pillars: list[Pillar], t1: float, t2: float) -> float:
    """The ATM vol from t1 to t2 the surface implies; floored at a quarter of the spot vol to t2 where quoted
    vols fall fast enough to make the forward variance negative (a calendar arbitrage in the quotes)."""
    if t2 <= t1 + 1e-12:
        return atm_vol(pillars, t2)
    v = atm_variance(pillars, t2) - atm_variance(pillars, t1)
    floor = (0.25 * atm_vol(pillars, t2)) ** 2 * (t2 - t1)
    return float((max(v, floor) / (t2 - t1)) ** 0.5)


def step_vols(pillars: list[Pillar], grid_t) -> list[float]:
    """The vol to apply on each step of a grid 0 < t_1 < ... < t_n so that the cumulative variance at t_k is
    the surface's ATM variance at t_k."""
    out, prev = [], 0.0
    for tk in grid_t:
        out.append(forward_vol(pillars, prev, float(tk)))
        prev = float(tk)
    return out


def path_vols(pillars: list[Pillar], t: float, T: float, F, K: Optional[float], iterations: int = 6):
    """Per-path vol at date t for expiry T: ATM level = the forward vol t→T, smile = the quoted RR/BF at the
    remaining tenor read at the delta of each path's forward F (array) against K. No strike (a touch) → the
    ATM forward vol for every path."""
    import numpy as np
    from scipy.stats import norm
    F = np.asarray(F, dtype=float)
    tau = max(T - t, 1e-6)
    atm_f = forward_vol(pillars, t, T)
    pil = _interp(pillars, tau)
    if K is None or (pil.rr == 0.0 and pil.bf == 0.0):
        return np.full(F.shape, atm_f)
    sigma = np.full(F.shape, atm_f)
    for _ in range(iterations):
        sT = np.maximum(sigma, 1e-4) * tau ** 0.5
        delta = norm.cdf((np.log(F / K) + 0.5 * sT * sT) / sT)
        x = delta - 0.5
        sigma = np.maximum(atm_f - 2.0 * pil.rr * x + 16.0 * pil.bf * x * x, 1e-4)
    return sigma
