"""
XVA for FX and crypto forwards, through the same waterfall as the rates book.

A forward's mark-to-market at time t is ±N·(F_t − K)·DF_q(t, T). Under the
T-forward measure F_t is driftless and lognormal with a flat volatility σ, so
the exposure paths are simulated directly (no rate model is needed) and
handed to pricing.xva_engine.run_waterfall, which applies the CSA, initial
margin and the CVA / DVA / FVA / FBA / KVA / MVA integrals exactly as it does
for a swap. σ is a desk input per pair: the demo has no public vol surface
for FX or digital assets, and the defaults below say so.

Initial margin: SIMM's FX delta risk weight is applied to the spot
sensitivity (FX01, PV for +1 % spot) instead of the IR weight on IR01.
Digital assets are outside SIMM; the weight used is an assumption, labelled.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, WaterfallResult, run_waterfall

# Flat annualised vols by pair, percent: desk inputs for the demo, not market data.
DEFAULT_VOL_PCT = {
    "EURUSD": 7.5, "GBPUSD": 8.0, "USDJPY": 10.0, "USDCHF": 8.0, "AUDUSD": 10.0, "USDCAD": 7.0,
    "BTCUSD": 55.0, "ETHUSD": 70.0, "SOLUSD": 90.0,
}
# SIMM FX delta risk weight (per 1 % spot) for G10 pairs; digital assets are not in SIMM.
SIMM_FX_RW_G10 = 7.4
CRYPTO_RW_ASSUMPTION = 35.0
G10 = {"USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "SEK", "NOK"}


def default_vol_pct(pair: str) -> float:
    return DEFAULT_VOL_PCT.get(pair.upper(), 60.0 if pair[:3].upper() not in G10 else 9.0)


def im_risk_weight(pair: str) -> float:
    base = pair[:3].upper()
    return SIMM_FX_RW_G10 if base in G10 else CRYPTO_RW_ASSUMPTION


@dataclass
class ForwardXvaInput:
    pair: str
    base_notional: float
    forward: float              # fair forward today, quote per base
    strike: float               # contract rate K
    t_years: float              # to settlement
    df_quote_t: float           # DF_q(0, T) on the quote (settlement) curve
    quote_zero: float           # continuous zero to T on the quote curve (for DF_q(0, t) along the grid)
    direction: str = "BUY"      # of the base currency
    vol_pct: Optional[float] = None
    spot01: Optional[float] = None   # PV for +1 % spot, drives SIMM-style IM


def monthly_grid(t_years: float) -> tuple[int, float]:
    """Monthly steps to settlement; a short forward still gets at least two steps."""
    steps = max(2, int(math.ceil(t_years * 12)))
    return steps, t_years / steps


def simulate_paths(inp: ForwardXvaInput, n_paths: int = 2000, seed: int = 42) -> tuple[np.ndarray, list[float], float]:
    """MtM paths from our side on the monthly grid, P(0, k·dt) on the quote curve, and V0."""
    steps, dt = monthly_grid(inp.t_years)
    sigma = (inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair)) / 100.0
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n_paths, steps))
    t = np.arange(1, steps + 1) * dt
    w = np.cumsum(z, axis=1) * math.sqrt(dt)
    f_t = inp.forward * np.exp(-0.5 * sigma ** 2 * t + sigma * w)
    # DF_q(t, T) = DF_q(0, T) / DF_q(0, t) with the flat continuous zero to T as the curve proxy
    p0 = [math.exp(-inp.quote_zero * k * dt) for k in range(steps + 2)]
    df_t_T = np.array([inp.df_quote_t / p0[k] for k in range(1, steps + 1)])
    paths = sign * inp.base_notional * (f_t - inp.strike) * df_t_T[None, :]
    v0 = sign * inp.base_notional * (inp.forward - inp.strike) * inp.df_quote_t
    return paths, p0, v0


def forward_xva(inp: ForwardXvaInput, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0,
                own_cds_bp: float = 42.0, ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40,
                own_lgd: float = 0.40, hurdle_rate: float = 0.12, capital_model: str = "sa_ccr",
                counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None, own_cds_curve=None,
                ftp_curve=None) -> tuple[WaterfallResult, dict]:
    paths, p0, v0 = simulate_paths(inp, n_paths=n_paths)
    steps, dt = monthly_grid(inp.t_years)
    rw = im_risk_weight(inp.pair)
    im_m = abs(inp.spot01 or 0.0) * rw / 1e6 if inp.spot01 is not None else None
    params = WaterfallParams(
        notional=abs(inp.base_notional * inp.forward), maturity_y=inp.t_years, dt=dt, theta=max(inp.quote_zero, 1e-6),
        lgd=lgd, own_lgd=own_lgd, cp_cds_bp=cp_cds_bp, own_cds_bp=own_cds_bp, cp_cds_curve=cp_cds_curve,
        own_cds_curve=own_cds_curve, ftp_bp=ftp_bp, ftp_curve=ftp_curve, fba_ratio=fba_ratio, hurdle_rate=hurdle_rate,
        capital_model=capital_model, counterparty_rw=counterparty_rw, wwr_multiplier=wwr_multiplier,
        ir01=None, simm_im_m=im_m,
    )
    wf = run_waterfall(paths, v0, p0, params, csa)
    meta = {"vol_pct": inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair),
            "vol_source": "desk input" if inp.vol_pct is not None else "demo default (no public vol surface)",
            "im_rw_per_pct": rw, "im_basis": "SIMM FX delta weight" if rw == SIMM_FX_RW_G10 else "assumption: digital asset, outside SIMM",
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "model": "lognormal forward, flat vol, same waterfall as rates"}
    return wf, meta
