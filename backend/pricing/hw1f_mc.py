"""Hull-White one-factor Monte Carlo for a swap's MtM paths: the simulation the XVA route runs, as a
pure function, so the Excel replication can carry the same random draws and rebuild every path.

Exact-fit form: r(t) = x(t) + α(t), x a zero-mean Ornstein–Uhlenbeck process stepped exactly,
    x(t+Δ) = x(t)·e^{−aΔ} + σ·√((1 − e^{−2aΔ})/2a)·Z,
    α(t)   = f(0,t) + (σ²/2a²)(1 − e^{−at})²,
and bonds reconstituted off the market curve, P(t,T) = A(t,T)·e^{−B(t,T)·r(t)} with
    B(t,T) = (1 − e^{−a(T−t)})/a,
    ln A   = ln(P(0,T)/P(0,t)) + B·f(0,t) − (σ²/4a)(1 − e^{−2at})·B².
On the monthly grid the receiver swap's value per path is (K·annuity − (1 − P(t,T_M)))·N with the
annuity Σ_j Δ·P(t, t_{j+1}) over the remaining steps; a payer is its mirror."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np


@dataclass
class SwapPaths:
    paths: np.ndarray        # (n_paths, T): MtM at t_{i+1}, from our side
    ann_mean: np.ndarray     # (T,): mean annuity per step, for the TV anchor
    z: np.ndarray            # (n_paths, T): the standard normals drawn, step by step
    x: np.ndarray            # (n_paths, T): the OU deviation after each step
    alpha: np.ndarray        # (T,): α(t_{i+1})
    p0_grid: list            # P(0, k·Δ), k = 0..T+1
    f0_grid: list            # f(0, k·Δ), k = 0..T


def grids(p0: Callable[[float], float], T: int, DT: float, theta: float) -> tuple[list, list]:
    """P(0, t) and the instantaneous forward f(0, t) on the simulation grid, from a discount function."""
    p0_grid = [p0(k * DT) for k in range(T + 2)]
    f0_grid = []
    for k in range(T + 1):
        a_df, b_df = p0_grid[k], p0_grid[k + 1]
        f0_grid.append(-math.log(b_df / a_df) / DT if (a_df > 0 and b_df > 0) else theta)
    return p0_grid, f0_grid


def simulate_swap_paths(a: float, sigma: float, p0_grid: list, f0_grid: list, T: int, DT: float, N: float, K: float,
                        n_paths: int, direction: str = "PAY", seed: int = 42, rng: Optional[np.random.Generator] = None) -> SwapPaths:
    rng = rng or np.random.default_rng(seed=seed)
    std_dt = sigma * math.sqrt((1 - math.exp(-2 * a * DT)) / (2 * a))
    paths = np.zeros((n_paths, T)); ann_mean = np.zeros(T)
    zs = np.zeros((n_paths, T)); xs = np.zeros((n_paths, T)); alphas = np.zeros(T)
    x = np.zeros(n_paths)
    for i in range(T):
        z = rng.standard_normal(n_paths)
        x = x * math.exp(-a * DT) + std_dt * z
        t_step = (i + 1) * DT
        alpha = f0_grid[i + 1] + (sigma * sigma / (2 * a * a)) * (1 - math.exp(-a * t_step)) ** 2
        r = x + alpha
        zs[:, i], xs[:, i], alphas[i] = z, x, alpha
        t_now = (i + 1) * DT
        rem = T - (i + 1)
        if rem <= 0:
            paths[:, i] = 0.0
            continue
        p0_t, f0_t = p0_grid[i + 1], f0_grid[i + 1]
        e2at = 1.0 - math.exp(-2.0 * a * t_now)
        ann = np.zeros(n_paths)
        for j in range(i + 1, T):
            tau = (j + 1) * DT - t_now
            B = (1 - math.exp(-a * tau)) / a
            log_A = math.log(p0_grid[j + 1] / p0_t) + B * f0_t - (sigma * sigma / (4 * a)) * e2at * B * B
            ann += DT * np.exp(log_A - B * r)
        tau_m = T * DT - t_now
        B_m = (1 - math.exp(-a * tau_m)) / a
        log_Am = math.log(p0_grid[T] / p0_t) + B_m * f0_t - (sigma * sigma / (4 * a)) * e2at * B_m * B_m
        df_m = np.exp(log_Am - B_m * r)
        ann_mean[i] = float(np.mean(ann))
        paths[:, i] = (K * ann - (1 - df_m)) * N
    if str(direction).upper() == "PAY":
        paths = -paths
    return SwapPaths(paths=paths, ann_mean=ann_mean, z=zs, x=xs, alpha=alphas, p0_grid=list(p0_grid), f0_grid=list(f0_grid))
