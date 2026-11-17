"""A synthetic rates market: every interest-rate curve the hosted demo prices on, from one stated generator.

No number here comes from a publisher. The hosted demo holds no licence for any benchmark, and some of them need
one to build a curve from or to value with (17 November 2026: the Bank of England's SONIA policy, SIX's SARON
licensing FAQ). So the demo does not read SOFR, €STR, SONIA, SARON or TONA fixings, nor government yields, to
make its curves: it makes them. A self-hosted desk connects its own market data and none of this is used.

The generator, in full:

  * A curve is a Nelson–Siegel par curve, y(t) = β0 + β1·f1(t/τ) + β2·f2(t/τ), with f1(x) = (1 − e^−x)/x and
    f2(x) = f1(x) − e^−x, in per cent, t in years. β0 is the long end, β0 + β1 the overnight rate, β2 the hump.
  * The four parameters of each currency were set by hand on 17 November 2026 (PARAMS) to look like a market of
    that time. They are the desk's own round numbers and follow nothing after that date.
  * Each business day three factors move the curve: level (β0), slope (β1) and curvature (β2). A factor is an
    AR(1) of standard normal shocks, F_d = Σ_{k=0..K} φ^k · σ · ε_{d−k} over business days, with the same φ and K
    for all and a daily σ per factor (SIGMA_BP). The shock of (currency, factor, day) is drawn from a hash of
    those three and a seed, mixed with a shock every currency shares (GLOBAL_SHARE of the variance), so curves
    of different currencies move together about as much as real ones do.

So a curve is a pure function of (curve, date). Today's quotes, any day's overnight fixing and a history of any
length come from the one function and agree with each other; nothing is stored to make them agree.

What it is not: a forecast, a market, or a model of any real rate. Levels drift around the hand-set parameters
and never follow a central bank; day-to-day moves are Gaussian, with no jumps and no meeting dates.
"""
from __future__ import annotations

import hashlib
import math
from datetime import date, timedelta

SET_ON = date(2026, 11, 17)             # the day PARAMS were set by hand
SEED = "rijeka synthetic rates 1"

# curve id: (β0 long end %, β1 = overnight − long end %, β2 hump %, τ years). Hand-set, round, the desk's own.
PARAMS: dict[str, tuple[float, float, float, float]] = {
    "USD_SOFR":  (4.30, -0.45, -1.00, 2.0),
    "EUR_ESTR":  (2.90, -0.95, -0.60, 2.5),
    "GBP_SONIA": (4.45, -0.50, -0.90, 2.0),
    "CHF_SARON": (0.80, -0.75, -0.30, 3.0),
    "JPY_TONAR": (2.40, -1.90, -0.50, 4.0),
}

FACTORS = ("level", "slope", "curvature")
SIGMA_BP = {"level": 3.5, "slope": 2.0, "curvature": 1.5}      # one business day's shock, in basis points
PHI = 0.985                                                    # what is left of a shock a business day later
K = 400                                                        # business days a shock is carried (φ^400 ≈ 0.2 %)
GLOBAL_SHARE = 0.5                                             # of a shock's variance, shared by every currency

SOURCE = "DEMO · synthetic rates market: a stated generator, no publisher's data"


def is_business_day(d: date) -> bool:
    return d.weekday() < 5


def _normal(*key) -> float:
    """A standard normal from a hash of the key: the same key, the same number, on any machine."""
    h = hashlib.sha256("|".join(str(k) for k in (SEED, *key)).encode()).digest()
    u1 = (int.from_bytes(h[:8], "big") + 1) / (2 ** 64 + 1)        # in (0, 1)
    u2 = int.from_bytes(h[8:16], "big") / 2 ** 64
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def shock(curve: str, factor: str, d: date) -> float:
    """The standard normal shock of one curve's factor on one business day: part shared, part its own."""
    return math.sqrt(GLOBAL_SHARE) * _normal("all", factor, d.toordinal()) + math.sqrt(1.0 - GLOBAL_SHARE) * _normal(curve, factor, d.toordinal())


def _business_days_back(d: date, n: int) -> list[date]:
    """The last n business days up to and including d (d itself if it is one), latest first."""
    out, x = [], d
    while len(out) < n:
        if is_business_day(x):
            out.append(x)
        x -= timedelta(days=1)
    return out


def factors(curve: str, d: date) -> dict[str, float]:
    """The three factors on date d, in per cent. A weekend or holiday carries the last business day's."""
    days = _business_days_back(d, K + 1)
    return {f: sum(PHI ** k * SIGMA_BP[f] / 100.0 * shock(curve, f, x) for k, x in enumerate(days)) for f in FACTORS}


def _ns(t: float, b0: float, b1: float, b2: float, tau: float) -> float:
    x = max(t, 1e-6) / tau
    f1 = (1.0 - math.exp(-x)) / x
    return b0 + b1 * f1 + b2 * (f1 - math.exp(-x))


def par_rate(curve: str, d: date, years: float, _f: dict[str, float] | None = None) -> float:
    """The curve's rate at a maturity in years on date d, in per cent."""
    b0, b1, b2, tau = PARAMS[curve]
    f = _f if _f is not None else factors(curve, d)
    return _ns(years, b0 + f["level"], b1 + f["slope"], b2 + f["curvature"], tau)


def overnight(curve: str, d: date) -> float:
    """The overnight rate of date d, in per cent: the curve's own short end, which is also that day's fixing."""
    return par_rate(curve, d, 1.0 / 365.0)


def curve_rates(curve: str, d: date, years: list[float]) -> list[float]:
    f = factors(curve, d)
    return [par_rate(curve, d, y, f) for y in years]


def history(curve: str, years: list[float], start: date, end: date) -> list[tuple[date, list[float]]]:
    """The curve at the given maturities on every business day from start to end: the same numbers par_rate gives
    day by day, carried along the days so a long history costs one pass."""
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    days = [x for x in days if is_business_day(x)]
    if not days:
        return []
    b0, b1, b2, tau = PARAMS[curve]
    window = _business_days_back(days[0], K + 1)                   # latest first
    eps = {f: [shock(curve, f, x) for x in window] for f in FACTORS}
    out = []
    for i, d in enumerate(days):
        if i:
            for f in FACTORS:
                eps[f].insert(0, shock(curve, f, d))
                eps[f].pop()
        fac = {f: sum(PHI ** k * SIGMA_BP[f] / 100.0 * e for k, e in enumerate(eps[f])) for f in FACTORS}
        out.append((d, [_ns(y, b0 + fac["level"], b1 + fac["slope"], b2 + fac["curvature"], tau) for y in years]))
    return out
