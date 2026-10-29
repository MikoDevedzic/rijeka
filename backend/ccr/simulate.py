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
from dataclasses import dataclass
from datetime import date
from typing import Callable

import numpy as np

from ccr.calibration import Calibration
from pnl.market import Market
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
    dt = 1.0 / 12.0
    grid = [asof] + [add_months(asof, k) for k in range(1, T + 1)]
    t = np.arange(T + 1) * dt
    rng = np.random.default_rng(seed)
    order = calib.order
    L = np.linalg.cholesky(calib.corr + 1e-10 * np.eye(len(order)))
    z = rng.standard_normal((T, n_paths, len(order)))
    z = z @ L.T                                                     # correlated shocks per step
    x: dict[str, np.ndarray] = {}; r: dict[str, np.ndarray] = {}; s: dict[str, np.ndarray] = {}; p0: dict = {}
    for j, key in enumerate(order):
        f = calib.factors[key]
        if f.kind == "RATES":
            a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
            std = sig * math.sqrt((1 - math.exp(-2 * a * dt)) / (2 * a))
            xs = np.zeros((n_paths, T + 1))
            for i in range(1, T + 1):
                xs[:, i] = xs[:, i - 1] * math.exp(-a * dt) + std * z[i - 1, :, j]
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
            w = np.cumsum(z[:, :, j], axis=0).T * math.sqrt(dt)        # (paths, T)
            w = np.concatenate([np.zeros((n_paths, 1)), w], axis=1)
            s[key] = spots[key] * np.exp((mu - 0.5 * sig ** 2) * t[None, :] + sig * w)
    return Paths(grid=grid, t=t, x=x, r=r, s=s, p0=p0, calib=calib, n_paths=n_paths)


def bond(paths: Paths, key: str, i: int, T_years: float) -> np.ndarray:
    """P(t_i, T) on every path for the RATES factor `key`, T in years from as-of."""
    f = paths.calib.factors[key]
    a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
    t_i = float(paths.t[i]); tau = max(T_years - t_i, 0.0)
    if tau <= 0:
        return np.ones(paths.n_paths)
    B = (1 - math.exp(-a * tau)) / a
    pf = paths.p0[key]
    ratio = pf(T_years) / max(pf(t_i), 1e-12)
    var = (sig ** 2) / (4 * a) * B * B * (1 - math.exp(-2 * a * t_i))
    return ratio * np.exp(-B * paths.x[key][:, i] - var)
