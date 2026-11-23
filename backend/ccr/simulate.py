"""Joint factor paths on a monthly grid, shared by every trade of a netting set.

Rates: a Hull-White one-factor deviation x per currency, dx = -a x dt + sigma dW. Bond
prices given x are affine and consistent with today's curve:
    P(t,T) = P(0,T)/P(0,t) · exp(-B(t,T) x_t - sigma²/(4a) · B(t,T)² · (1 - e^{-2at})),  B = (1 - e^{-a(T-t)})/a
so in the risk-neutral run the expected path follows the forwards. The real-world run
shifts x so the short rate has zero drift (E[r_t] = r_0) or the historical drift; the same
affine formula then values the trades on the realised rate.
Spots: S_t = S_0 · exp((mu - sigma²/2) t + sigma W_t), mu the rate differential (risk-neutral)
or zero / historical (real-world). Brownian motions are correlated by the calibration's matrix."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

import numpy as np

from ccr.calibration import Calibration
from pnl.explain import tenor_years  # noqa: F401  (kept for callers that bucket by tenor)


@dataclass
class Paths:
    grid: list[date]                        # t_0 = as-of, then monthly
    t: np.ndarray                           # years from as-of, shape (T+1,)
    x: dict[str, np.ndarray]                # RATES factor -> (paths, T+1) deviations
    r: dict[str, np.ndarray]                # RATES factor -> (paths, T+1) short rate
    s: dict[str, np.ndarray]                # SPOT factor -> (paths, T+1) spot
    p0: dict[str, Callable[[float], float]]  # RATES factor -> P(0, t) in years
    calib: Calibration
    n_paths: int
    seed: int = 7                           # the run's seed: a level inside a step is drawn from it (spot_between)
    inside: dict = field(default_factory=dict)   # (SPOT factor, step, day) -> the level there, once asked for


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year; m += 1
    import calendar
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def df_fn(curve, asof: date) -> Callable[[float], float]:
    """P(0, t) for t in years, from a bootstrapped Curve (log-linear between its pillars)."""
    def p(t: float) -> float:
        if t <= 0:
            return 1.0
        import datetime as _dt
        d = asof + _dt.timedelta(days=int(round(t * 365.25)))
        try:
            return float(curve.df(d))
        except Exception:
            return math.exp(-0.03 * t)
    return p


def simulate(calib: Calibration, curves: dict[str, object], spots: dict[str, float], spot_rates: dict[str, tuple[float, float]],
             asof: date, months: int, n_paths: int = 2000, seed: int = 7) -> Paths:
    """curves: RATES factor key -> Curve; spots: SPOT key -> S_0; spot_rates: SPOT key -> (r_quote, r_base) continuous."""
    T = max(1, months)
    grid = [asof] + [add_months(asof, k) for k in range(1, T + 1)]
    # Grid times on the clock every trade date uses (days / 365.25, ccr.valuation.years), so a fixing or
    # an expiry that falls on a grid date is at that grid point. Exact twelfths put a date one grid
    # point early (365/365.25 < 1) until 2026-11; each step uses its own length below.
    t = np.array([(g - asof).days / 365.25 for g in grid])
    dts = np.diff(t)
    rng = np.random.default_rng(seed)
    order = calib.order
    historical = calib.sampling == "HISTORICAL" and calib.panel is not None and calib.panel.shape[1] == len(order)
    if historical:
        # Historical simulation: each monthly step is a block of BLOCK_DAYS consecutive observed
        # daily changes, the same block for every factor (so the realised correlations, fat
        # tails and co-movements of the window are kept), demeaned so the drift is the stated
        # one and not the window's. inc has the units of the factors: rate change in decimals,
        # spot log return; it replaces sigma·sqrt(dt)·z below.
        inc = _block_increments(calib.panel, T, n_paths, rng)       # (T, paths, factors)
        z = None
    else:
        L = np.linalg.cholesky(calib.corr + 1e-10 * np.eye(len(order)))
        z = rng.standard_normal((T, n_paths, len(order)))
        z = z @ L.T                                                 # correlated shocks per step
    x: dict[str, np.ndarray] = {}; r: dict[str, np.ndarray] = {}; s: dict[str, np.ndarray] = {}; p0: dict = {}
    for j, key in enumerate(order):
        f = calib.factors[key]
        if f.kind == "RATES":
            a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
            xs = np.zeros((n_paths, T + 1))
            for i in range(1, T + 1):
                dt = float(dts[i - 1])
                std = sig * math.sqrt((1 - math.exp(-2 * a * dt)) / (2 * a))
                shock = inc[i - 1, :, j] if historical else std * z[i - 1, :, j]
                xs[:, i] = xs[:, i - 1] * math.exp(-a * dt) + shock
            pf = df_fn(curves[key], asof); p0[key] = pf
            # instantaneous forward and the HW alpha term: E[r_t] under the forward measure
            h = 1.0 / 365.25                                           # a one-day difference: the curve is dated
            fwd = np.array([-(math.log(pf(tt + h)) - math.log(pf(max(tt - h, 0.0)))) / (2 * h if tt > h else h) for tt in t])
            alpha = fwd + (sig ** 2) / (2 * a ** 2) * (1 - np.exp(-a * t)) ** 2
            if calib.measure == "RISK_NEUTRAL" or calib.drift_mode == "forward":
                rr = alpha[None, :] + xs
            else:
                r0 = alpha[0]
                target = r0 + (f.drift if calib.drift_mode == "historical" else 0.0) * t        # E[r_t]
                shift = target - alpha                                                           # move x so the mean follows the target
                xs = xs + shift[None, :]
                rr = alpha[None, :] + xs
            x[key], r[key] = xs, rr
        else:
            sig = max(f.sigma, 1e-6)
            rq, rb = spot_rates.get(key, (0.0, 0.0))
            mu = (rq - rb) if (calib.measure == "RISK_NEUTRAL" or calib.drift_mode == "forward") else (f.drift if calib.drift_mode == "historical" else 0.0)
            if historical:
                lw = np.cumsum(inc[:, :, j], axis=0).T                      # (paths, T) cumulative observed log returns
                lw = np.concatenate([np.zeros((n_paths, 1)), lw], axis=1)
                s[key] = spots[key] * np.exp(mu * t[None, :] + lw)
            elif getattr(f, "pillars", None):
                # the surface's ATM term structure: each step at its forward vol, so Var(ln S_t) is the ATM variance at t
                from pricing.fx_vol import step_vols
                sv = np.array(step_vols(f.pillars, t[1:]))                   # (T,)
                incr = (mu - 0.5 * sv ** 2)[:, None] * dts[:, None] + (sv * np.sqrt(dts))[:, None] * z[:, :, j]
                lw = np.concatenate([np.zeros((n_paths, 1)), np.cumsum(incr, axis=0).T], axis=1)
                s[key] = spots[key] * np.exp(lw)
            else:
                w = np.cumsum(z[:, :, j] * np.sqrt(dts)[:, None], axis=0).T  # (paths, T)
                w = np.concatenate([np.zeros((n_paths, 1)), w], axis=1)
                s[key] = spots[key] * np.exp((mu - 0.5 * sig ** 2) * t[None, :] + sig * w)
    return Paths(grid=grid, t=t, x=x, r=r, s=s, p0=p0, calib=calib, n_paths=n_paths, seed=seed)


INSIDE_TAG = 0x696E7364    # the stream of the levels inside a step, apart from the paths' own


def step_vol(paths: Paths, key: str, i: int) -> float:
    """The vol the spot factor `key` diffuses at inside step i (t_{i-1}, t_i]: the surface's forward vol for that
    step where the paths stepped on the factor's surface, else the factor's one vol. Under historical sampling the
    step is a block of observed days and no vol drew it: the factor's calibrated vol stands in for the spread
    inside the step. (The test for historical sampling is simulate()'s own.)"""
    c = paths.calib
    f = c.factors[key]
    historical = c.sampling == "HISTORICAL" and c.panel is not None and c.panel.shape[1] == len(c.order)
    if getattr(f, "pillars", None) and not historical:
        from pricing.fx_vol import step_vols
        return float(step_vols(f.pillars, paths.t[1:])[i - 1])
    return max(float(f.sigma), 1e-6)


def _step_normals(paths: Paths, i: int, D: int) -> tuple[list[str], np.ndarray]:
    """Step i's daily standard normals for every factor, (paths, D, factors), correlated as the paths' own shocks
    are (the calibration's matrix), with the factors' keys in the order of the columns: the spots, then the
    rates. Drawn from the run's seed and the step alone, so it is the same array whenever and for whichever factor
    it is asked. (The spots come first and are correlated among themselves by their own block's factor, so a
    spot's level inside a step is the number 0.65.0 drew, before a rate had one.)"""
    c = paths.calib
    spots = [k for k in c.order if c.factors[k].kind == "SPOT"]
    rates = [k for k in c.order if c.factors[k].kind != "SPOT"]
    keys = spots + rates
    idx = [c.order.index(k) for k in keys]
    corr = np.asarray(c.corr, dtype=float)[np.ix_(idx, idx)]
    ns = len(spots)
    rng = np.random.default_rng([int(paths.seed), INSIDE_TAG, i])
    z_s = rng.standard_normal((paths.n_paths, D, ns))
    out = np.empty((paths.n_paths, D, len(keys)))
    L_s = np.linalg.cholesky(corr[:ns, :ns] + 1e-10 * np.eye(ns)) if ns else np.zeros((0, 0))
    out[:, :, :ns] = z_s @ L_s.T
    if rates:
        z_r = rng.standard_normal((paths.n_paths, D, len(rates)))
        L = np.linalg.cholesky(corr + 1e-10 * np.eye(len(keys)))
        out[:, :, ns:] = z_s @ L[ns:, :ns].T + z_r @ L[ns:, ns:].T
    return keys, out


def _step_bridges(paths: Paths, i: int, D: int) -> tuple[list[str], np.ndarray]:
    """The daily bridges of step i for every factor, (paths, D, factors): a daily walk per factor less the straight
    line to its own end (what a spot's log does inside a step, about the line between its two grid levels)."""
    keys, z = _step_normals(paths, i, D)
    w = np.cumsum(z, axis=1)
    days = np.arange(1, D + 1)
    return keys, w - (days / D)[None, :, None] * w[:, -1:, :]


def _inside(paths: Paths, T_years: float):
    """Where a time falls on the grid: ("grid", j) on a grid date (or clamped to the first or last), else
    ("step", i, d, D): day d of the D days of step i, t_{i-1} < T < t_i."""
    t = paths.t
    for j in range(len(t)):
        if abs(float(t[j]) - T_years) <= 1e-9:
            return ("grid", j)
    if T_years <= 0.0:
        return ("grid", 0)
    if T_years >= float(t[-1]):
        return ("grid", len(t) - 1)
    i = int(np.searchsorted(t, T_years))
    D = (paths.grid[i] - paths.grid[i - 1]).days
    d = int(round((T_years - float(t[i - 1])) * 365.25))
    if D < 2 or d <= 0:
        return ("grid", i - 1)
    if d >= D:
        return ("grid", i)
    return ("step", i, d, D)


def rate_shift(paths: Paths, key: str, T_years: float) -> float:
    """What simulate() adds to a rate factor's deviation at time T in a real-world run so the mean short rate
    follows its target (today's rate, plus the factor's drift where the drift is the historical one) and not the
    forward curve; nothing in a risk-neutral or forward-drift run. The same formulas as simulate(), at any time."""
    c = paths.calib
    if c.measure == "RISK_NEUTRAL" or c.drift_mode == "forward":
        return 0.0
    f = c.factors[key]
    a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
    pf = paths.p0[key]
    h = 1.0 / 365.25

    def alpha(tt: float) -> float:
        fwd = -(math.log(pf(tt + h)) - math.log(pf(max(tt - h, 0.0)))) / (2 * h if tt > h else h)
        return fwd + (sig ** 2) / (2 * a ** 2) * (1 - math.exp(-a * tt)) ** 2
    target = alpha(0.0) + (f.drift if c.drift_mode == "historical" else 0.0) * T_years
    return target - alpha(T_years)


def ou_bridge(a: float, sig: float, d: int, D: int) -> dict:
    """The coefficients of an Ornstein-Uhlenbeck state on day d of a step of D days, given the states at both ends:
    mean = lo·decay_d + c_d·(hi − lo·decay_D), variance var (what is left over is normal with it)."""
    h = 1.0 / 365.25
    v = lambda n: sig ** 2 * (1 - math.exp(-2 * a * n * h)) / (2 * a)
    c_d = math.exp(-a * (D - d) * h) * v(d) / v(D)
    return {"d": d, "D": D, "decay_d": math.exp(-a * d * h), "decay_D": math.exp(-a * D * h), "c_d": c_d, "v_d": v(d), "v_D": v(D),
            "var": v(d) - c_d * c_d * v(D), "decay_1": math.exp(-a * h), "s_1": math.sqrt(v(1))}


def rate_between(paths: Paths, key: str, T_years: float) -> np.ndarray:
    """The deviation x of the rate factor `key` on every path at a time that is not a grid date (as paths.x holds it
    on the grid): the state the path passed through between the two grid states either side. x is an
    Ornstein-Uhlenbeck process, so given both ends it is normal about
    x_{i-1} e^{-a d h} + c_d (x_i - x_{i-1} e^{-a D h}),  c_d = e^{-a (D-d) h} v(d) / v(D),  v(n) = sigma^2 (1 - e^{-2 a n h}) / (2a),
    h one day, and what is left over is y_d - c_d y_D for a daily walk y of the same process from nothing, built on
    the step's normals for this factor (_step_normals: one draw per step for every factor, correlated as the paths
    are). In a real-world run the deterministic shift simulate() adds is taken off the two ends and put back at T
    (rate_shift). Under historical sampling the step is a block of observed days: the block's end is kept and the
    spread inside it is the factor's calibrated vol, an approximation. A time on a grid date is the grid's state."""
    where = _inside(paths, T_years)
    X = paths.x[key]
    if where[0] == "grid":
        return X[:, where[1]]
    _, i, d, D = where
    state = paths.inside.get((key, i, d))
    if state is None:
        f = paths.calib.factors[key]
        a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
        k = ou_bridge(a, sig, d, D)
        keys, z = _step_normals(paths, i, D)
        zk = z[:, :, keys.index(key)]
        y = np.zeros(paths.n_paths); y_d = None
        for n in range(1, D + 1):
            y = y * k["decay_1"] + k["s_1"] * zk[:, n - 1]
            if n == d:
                y_d = y.copy()
        lo = X[:, i - 1] - rate_shift(paths, key, float(paths.t[i - 1]))
        hi = X[:, i] - rate_shift(paths, key, float(paths.t[i]))
        mean = lo * k["decay_d"] + k["c_d"] * (hi - lo * k["decay_D"])
        state = mean + (y_d - k["c_d"] * y) + rate_shift(paths, key, T_years)
        paths.inside[(key, i, d)] = state
    return state


def spot_between(paths: Paths, key: str, T_years: float) -> np.ndarray:
    """The spot of factor `key` on every path at a time that is not a grid date: the level the path passed through
    between the two grid levels either side. In logs the path is a straight line between them (its drift is linear
    in time inside a step) plus a Brownian bridge at the step's vol, pinned to nothing at both ends:
    ln S(T) = ln S_{i-1} + rho (ln S_i - ln S_{i-1}) + sigma sqrt(1/365.25) b_d, rho = d/D for day d of the step's
    D days, b the bridge of a daily walk (variance d(1 - d/D)). The step's bridges are drawn by day for every spot
    factor at once, correlated as the paths' shocks are, from the run's seed and the step, so every date inside a
    step is a point of one path whatever order the dates are asked in, two trades with one date read one level,
    and two pairs move together inside a step as they do across it. (A rate's bonds are read on grid dates only,
    so no rate has a level inside a step.) A time on a grid date is the grid level; a time before the first grid
    date (an option already expired, not yet settled) is today's level. The levels asked for are kept on the
    paths, one column each; the step's draw is made again when another date in it is asked."""
    S = paths.s[key]
    where = _inside(paths, T_years)
    if where[0] == "grid":
        return S[:, where[1]]
    _, i, d, D = where
    level = paths.inside.get((key, i, d))
    if level is None:
        keys, b = _step_bridges(paths, i, D)
        rho = d / D
        lo, hi = np.log(S[:, i - 1]), np.log(S[:, i])
        level = np.exp(lo + rho * (hi - lo) + step_vol(paths, key, i) * math.sqrt(1.0 / 365.25) * b[:, d - 1, keys.index(key)])
        paths.inside[(key, i, d)] = level
    return level


BLOCK_DAYS = 21          # one month of business days per step


def _block_increments(panel: np.ndarray, T: int, n_paths: int, rng) -> np.ndarray:
    """(T, paths, factors): per step and path, the sum of a block of BLOCK_DAYS consecutive
    rows of the demeaned panel, the block starting at a uniformly drawn day (circular)."""
    n, k = panel.shape
    demeaned = panel - panel.mean(axis=0, keepdims=True)
    csum = np.vstack([np.zeros((1, k)), np.cumsum(np.vstack([demeaned, demeaned]), axis=0)])   # doubled for wrap-around
    starts = rng.integers(0, n, size=(T, n_paths))
    return csum[starts + BLOCK_DAYS] - csum[starts]


def bond(paths: Paths, key: str, i: int, T_years: float) -> np.ndarray:
    """P(t_i, T) on every path for the RATES factor `key`, T in years from as-of."""
    return bond_at(paths, key, float(paths.t[i]), paths.x[key][:, i], T_years)


def bond_at(paths: Paths, key: str, t_i: float, x: np.ndarray, T_years: float) -> np.ndarray:
    """P(t, T) on every path from the factor's deviation x at time t (years from as-of): on a grid date the grid's
    own column (bond), at an option's expiry inside a step the state the path passed through (rate_between)."""
    f = paths.calib.factors[key]
    a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
    tau = max(T_years - t_i, 0.0)
    if tau <= 0:
        return np.ones(paths.n_paths)
    B = (1 - math.exp(-a * tau)) / a
    pf = paths.p0[key]
    ratio = pf(T_years) / max(pf(t_i), 1e-12)
    var = (sig ** 2) / (4 * a) * B * B * (1 - math.exp(-2 * a * t_i))
    # The affine formula is in x = r − f(0,t) (Andersen–Piterbarg), which is the driftless OU deviation
    # stored in paths.x plus phi(t) = sigma²/(2a²)·(1 − e^{−at})², the convexity part of alpha. Using the
    # stored deviation alone priced every bond high by exp(B·phi): forward rates on the paths sat phi
    # below the curve (≈ 8bp at 5y, 27bp at 10y for a = 3%, sigma = 85bp) until 2026-11. The risk-neutral
    # martingale check in tests/reference/test_ref_ccr.py pins it.
    phi = (sig ** 2) / (2 * a * a) * (1 - math.exp(-a * t_i)) ** 2
    return ratio * np.exp(-B * (x + phi) - var)


def account(paths: Paths, key: str) -> np.ndarray:
    """One unit of cash rolled along each path at each grid step's own bond: A_0 = 1, A_{k+1} = A_k / P(t_k, t_{k+1}),
    shape (paths, T+1). It is the realised growth of money on the path, and 1/A discounts a value on the path back
    to today: a bond's discounted price is then a martingale from one grid date to the next by construction. Kept on the paths object: a
    netting set asks for it once per leg and date."""
    cache = paths.__dict__.setdefault("_account", {})
    if key not in cache:
        A = np.ones((paths.n_paths, len(paths.t)))
        for k in range(len(paths.t) - 1):
            A[:, k + 1] = A[:, k] / bond(paths, key, k, float(paths.t[k + 1]))
        cache[key] = A
    return cache[key]


def deflator(paths: Paths, key: str) -> np.ndarray:
    """On every path, the discount factor to each grid date after today over today's discount factor for that date:
    1 / (A_k · P(0, t_k)), shape (paths, T). Its expectation at every date is one (a bond's discounted price is a
    martingale on the account), so an expected exposure weighted by it and multiplied by P(0, t_k) is the expected
    exposure discounted on its own path, E[D(t_k) · V⁺(t_k)] (pricing.xva_engine.run_waterfall, `deflator`).

    It is returned with its sample mean set to one at every date (moment matching): the sample's own mean discount
    factor differs from P(0, t_k) by sampling error, which grows with the date and would otherwise be carried into
    every charge, also of an exposure that does not move with rates (the independent reviewer, 17 November 2026: a
    constant exposure must be charged as it was, and an incremental charge is a difference of runs). What is left
    is the co-movement of discounting and exposure, which is the point."""
    A = account(paths, key)
    p0 = np.array([max(float(paths.p0[key](float(x))), 1e-12) for x in paths.t[1:]])
    w = 1.0 / (A[:, 1:] * p0[None, :])
    return w / w.mean(axis=0, keepdims=True)


def growth(paths: Paths, key: str, a: float, b: float) -> np.ndarray:
    """What one unit placed at time a has grown to by time b (years from as-of, a <= b), on every path: the interest a
    floating period accrues between the two, with the unit. Between grid dates it grows with the account; from a to
    the next grid date, and from the last grid date before b to b, at the forward seen on the grid date before (so
    the discounted growth is a martingale, and the part inside a step is known at its start: the variance of the
    rate inside one step is not in it). A span before the as-of date has no path behind it: it grows at today's
    rate for a span of that length (the fixings themselves are not read here)."""
    n = paths.n_paths
    if b <= a + 1e-12:
        return np.ones(n)
    pre = 1.0
    if a < 0.0:
        if b <= 0.0:
            return np.full(n, 1.0 / max(paths.p0[key](b - a), 1e-12))
        pre, a = 1.0 / max(paths.p0[key](-a), 1e-12), 0.0
    t = paths.t
    last = len(t) - 1
    ja = min(int(np.searchsorted(t, a + 1e-12, side="right") - 1), last)      # the last grid date at or before a
    jb = min(int(np.searchsorted(t, b + 1e-12, side="right") - 1), last)
    if ja == jb:
        return pre * bond(paths, key, ja, a) / bond(paths, key, ja, b)
    A = account(paths, key)
    out = bond(paths, key, ja, a) / bond(paths, key, ja, float(t[ja + 1])) * A[:, jb] / A[:, ja + 1]
    if b > float(t[jb]) + 1e-12:
        out = out / bond(paths, key, jb, b)
    return pre * out


def accrued(paths: Paths, key: str, i: int, t_start: float) -> np.ndarray:
    """growth() from t_start to grid date i: what a floating period that began at t_start has accrued by then, with
    the unit."""
    return growth(paths, key, t_start, float(paths.t[i]))
