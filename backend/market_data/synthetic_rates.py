"""A synthetic rates market: every interest-rate curve the hosted demo prices on, from one stated generator.

No number here comes from a publisher. The hosted demo holds no licence for any benchmark, and some of them need
one to build a curve from or to value with (17 November 2026: the Bank of England's SONIA policy, SIX's SARON
licensing FAQ). So the demo does not read SOFR, €STR, SONIA, SARON or TONA fixings, nor government yields, to
make its curves: it makes them. A self-hosted desk connects its own market data and none of this is used.

The generator, in full (the methodology has the same text; a reader can rebuild any curve to the digit from it):

  * A curve is a Nelson–Siegel par curve, y(t) = β0 + β1·f1(t/τ) + β2·f2(t/τ), with f1(x) = (1 − e^−x)/x and
    f2(x) = f1(x) − e^−x, in per cent, t in years. β0 is the long end, β0 + β1 the overnight rate, β2 the hump.
  * The four parameters of each currency were set by hand on 17 November 2026 (PARAMS, SET_ON) to look like a
    market of that time. On that day the curve IS its parameters. They follow nothing after that date.
  * On every other business day three factors have moved the curve: level (added to β0), slope (β1) and
    curvature (β2). A factor is zero on SET_ON and walks away from it one business day at a time, forwards and
    backwards: F(next day out) = φ · F(day nearer SET_ON) + σ · scale · ε(that day out), in per cent. φ is the
    same for all (PHI: a mean reversion of 5 % a year, the exposure engine's policy), σ is a daily shock per
    factor (SIGMA_BP), scale a number per currency (VOL_SCALE).
  * ε of (curve, factor, day) is a standard normal: sqrt(GLOBAL_SHARE) · n("all", factor, day) +
    sqrt(1 − GLOBAL_SHARE) · n(curve, factor, day), so every currency shares half of each shock's variance.
    n(key...) is made from the SHA-256 of the text "SEED|key|key|...", the day as its proleptic Gregorian
    ordinal: u1 = (first 8 bytes as a big-endian integer + 1) / (2^64 + 1), u2 = (next 8 bytes) / 2^64,
    n = sqrt(−2 ln u1) · cos(2π u2).
  * A business day is Monday to Friday (no holiday calendar). A weekend carries Friday's curve.

So a curve is a pure function of (curve, date). Today's quotes, any day's overnight fixing and a history of any
length come from the one function and agree with each other; nothing is stored to make them agree.

What it is not: a forecast, a market, or a model of any real rate. The curve starts from hand-set levels and
wanders from them like a slowly mean-reverting random walk (about 80 bp of level in two years, at most some 180 bp
in the long run, both times the currency's scale); day-to-day moves are Gaussian, with no jumps and no meeting
dates; the Swiss franc curve sits near zero and its short end is below zero about as often as above.
"""
from __future__ import annotations

import hashlib
import math
from datetime import date, timedelta

SET_ON = date(2026, 11, 17)             # the day PARAMS were set by hand: the curve of that day is its parameters
SEED = "rijeka synthetic rates 1"

# curve id: (β0 long end %, β1 = overnight − long end %, β2 hump %, τ years). Hand-set, round, the desk's own.
PARAMS: dict[str, tuple[float, float, float, float]] = {
    "USD_SOFR":  (4.30, -0.45, -1.00, 2.0),
    "EUR_ESTR":  (2.90, -0.95, -0.60, 2.5),
    "GBP_SONIA": (4.45, -0.50, -0.90, 2.0),
    "CHF_SARON": (0.80, -0.75, -0.30, 3.0),
    "JPY_TONAR": (2.40, -1.90, -0.50, 4.0),
}
# how much of the daily shock each currency takes: hand-set, so the currencies do not all move alike
VOL_SCALE: dict[str, float] = {"USD_SOFR": 1.00, "EUR_ESTR": 0.85, "GBP_SONIA": 1.05, "CHF_SARON": 0.60, "JPY_TONAR": 0.50}

FACTORS = ("level", "slope", "curvature")
SIGMA_BP = {"level": 3.5, "slope": 2.0, "curvature": 1.5}      # one business day's shock, in basis points, at scale 1
MEAN_REVERSION = 0.05                                          # a year: the exposure engine's policy (ccr/calibration.py)
PHI = math.exp(-MEAN_REVERSION / 252.0)                        # what is left of a factor a business day further from SET_ON
GLOBAL_SHARE = 0.5                                             # of a shock's variance, shared by every currency

SOURCE = "DEMO · synthetic rates market: a stated generator, no publisher's data"


def is_business_day(d: date) -> bool:
    return d.weekday() < 5


def _business_day(d: date) -> date:
    """d, or the last business day before it."""
    while not is_business_day(d):
        d -= timedelta(days=1)
    return d


def _normal(*key) -> float:
    """A standard normal from a hash of the key: the same key, the same number, on any machine."""
    h = hashlib.sha256("|".join(str(k) for k in (SEED, *key)).encode()).digest()
    u1 = (int.from_bytes(h[:8], "big") + 1) / (2 ** 64 + 1)        # in (0, 1)
    u2 = int.from_bytes(h[8:16], "big") / 2 ** 64
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def shock(curve: str, factor: str, d: date) -> float:
    """The standard normal shock of one curve's factor on one business day: part shared, part its own."""
    return math.sqrt(GLOBAL_SHARE) * _normal("all", factor, d.toordinal()) + math.sqrt(1.0 - GLOBAL_SHARE) * _normal(curve, factor, d.toordinal())


def _walk(curve: str, to: date):
    """Every business day from SET_ON out to `to` (after it or before it), with the three factors on each, nearest
    first; SET_ON itself, where they are zero, is not yielded."""
    anchor = _business_day(SET_ON)
    step = timedelta(days=1 if to > anchor else -1)
    scale = VOL_SCALE[curve]
    f = {k: 0.0 for k in FACTORS}
    d = anchor
    while d != to:
        d += step
        if not is_business_day(d):
            continue
        f = {k: PHI * f[k] + SIGMA_BP[k] / 100.0 * scale * shock(curve, k, d) for k in FACTORS}
        yield d, f


def factors(curve: str, d: date) -> dict[str, float]:
    """The three factors on date d, in per cent: zero on SET_ON. A weekend carries the last business day's."""
    d = _business_day(d)
    out = {k: 0.0 for k in FACTORS}
    for _x, f in _walk(curve, d):
        out = f
    return out


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
    day by day, from one walk out of SET_ON each way."""
    if end < start:
        return []
    anchor = _business_day(SET_ON)
    by_day: dict[date, dict[str, float]] = {anchor: {k: 0.0 for k in FACTORS}}
    if start < anchor:
        by_day.update(_walk(curve, _business_day(start)))
    if end > anchor:
        by_day.update(_walk(curve, _business_day(end)))
    b0, b1, b2, tau = PARAMS[curve]
    out = []
    for i in range((end - start).days + 1):
        d = start + timedelta(days=i)
        if is_business_day(d):
            f = by_day[d]
            out.append((d, [_ns(y, b0 + f["level"], b1 + f["slope"], b2 + f["curvature"], tau) for y in years]))
    return out
