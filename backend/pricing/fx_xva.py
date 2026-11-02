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
    vol_source: Optional[str] = None # where vol_pct came from (the pair's surface, a desk input); None = the demo default
    pillars: Optional[list] = None   # the pair's surface (fx_vol.parse_surface): the paths step with its ATM term structure


def monthly_grid(t_years: float) -> tuple[int, float]:
    """Monthly steps to settlement; a short forward still gets at least two steps."""
    steps = max(2, int(math.ceil(t_years * 12)))
    return steps, t_years / steps


def simulate_paths(inp: ForwardXvaInput, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None) -> tuple[np.ndarray, list[float], float]:
    """MtM paths from our side on the monthly grid, P(0, k·dt) on the quote curve, and V0.
    noise_out, when given, receives the standard normals drawn (z, n_paths × steps) and the forward paths (f_t),
    so the Excel replication can rebuild every path from the engine's own draws."""
    steps, dt = monthly_grid(inp.t_years)
    sigma = (inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair)) / 100.0
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n_paths, steps))
    t = np.arange(1, steps + 1) * dt
    if inp.pillars:
        # the surface's ATM term structure: step vols so that Var(ln F_t) is the ATM variance at every grid date
        from pricing.fx_vol import step_vols
        sv = np.array(step_vols(inp.pillars, t))
        f_t = inp.forward * np.exp(np.cumsum(-0.5 * sv ** 2 * dt + sv * math.sqrt(dt) * z, axis=1))
    else:
        sv = np.full(steps, sigma)
        w = np.cumsum(z, axis=1) * math.sqrt(dt)
        f_t = inp.forward * np.exp(-0.5 * sigma ** 2 * t + sigma * w)
    # DF_q(t, T) = DF_q(0, T) / DF_q(0, t) with the flat continuous zero to T as the curve proxy
    p0 = [math.exp(-inp.quote_zero * k * dt) for k in range(steps + 2)]
    df_t_T = np.array([inp.df_quote_t / p0[k] for k in range(1, steps + 1)])
    paths = sign * inp.base_notional * (f_t - inp.strike) * df_t_T[None, :]
    v0 = sign * inp.base_notional * (inp.forward - inp.strike) * inp.df_quote_t
    if noise_out is not None:
        noise_out.update(z=z, f_t=f_t, df_t_T=df_t_T, sigma=sigma, steps=steps, dt=dt, step_vols=sv)
    return paths, p0, v0


def forward_xva(inp: ForwardXvaInput, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0,
                own_cds_bp: float = 42.0, ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40,
                own_lgd: float = 0.40, hurdle_rate: float = 0.12, capital_model: str = "sa_ccr",
                counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None, own_cds_curve=None,
                ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None) -> tuple[WaterfallResult, dict]:
    paths, p0, v0 = simulate_paths(inp, n_paths=n_paths, seed=seed, noise_out=noise_out)
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
    wf = run_waterfall(paths, v0, p0, params, csa, **({"rng": waterfall_rng} if waterfall_rng is not None else {}))
    nz = {}
    if inp.pillars:
        _, _, _ = simulate_paths(inp, n_paths=2, seed=seed, noise_out=nz)      # the step vols, for the record
    meta = {"vol_pct": inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair),
            "vol_source": (inp.vol_source or "desk input") if inp.vol_pct is not None else "demo default (no surface for this pair)",
            "vol_mode": "ATM term structure of the surface (step vols)" if inp.pillars else "flat",
            "step_vols_pct": [round(float(v) * 100, 3) for v in nz["step_vols"]] if inp.pillars else None,
            "im_rw_per_pct": rw, "im_basis": "SIMM FX delta weight" if rw == SIMM_FX_RW_G10 else "assumption: digital asset, outside SIMM",
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "model": "lognormal forward at the surface's ATM vol to settlement, same waterfall as rates",
            "_paths": paths}       # the MtM paths, for the ticket's chart (not serialised as such)
    return wf, meta


# ── Options: the style's value along the same simulated paths ─────────────────────────────────────

@dataclass
class OptionXvaInput:
    """An FX or digital-asset option, any style. The spot is simulated lognormal at the option's vol; on each
    path the option is valued with the style's closed form (the credit engine's model, ccr/options.value_fx_option):
    before expiry the holder's value with the time left, barriers and touches carrying which paths have already
    knocked (monitored at the grid points: discrete where the pricer is continuous), an American option as its
    European (early exercise is not simulated: a lower bound); at and after expiry the payoff fixed at the expiry
    grid point and discounted to settlement. Bought: exposure one-sided and positive; sold: negative."""
    pair: str
    base_notional: float
    spot: float
    forward: float              # to settlement, quote per base
    t_expiry: float
    t_settle: float
    df_quote_t: float           # DF_q(0, T_settle)
    quote_zero: float           # continuous zero to settlement on the quote curve
    vol: float                  # decimal
    spec: object                # pricing.fx_exotic.ExoticSpec
    direction: str = "BUY"      # of the option
    spot01: Optional[float] = None
    vol_source: Optional[str] = None
    pillars: Optional[list] = None   # the pair's surface: term structure for the paths, the smile at each path's moneyness


def _payoff_at_expiry(spec, S_T: np.ndarray, knocked: np.ndarray) -> np.ndarray:
    from pricing.fx_exotic import ExoticSpec, _expired
    if spec.style in ("EUROPEAN", "AMERICAN", "DIGITAL"):
        return np.array([_expired(spec, float(x), 1.0) for x in S_T])
    if spec.style in ("BARRIER", "DOUBLE_BARRIER"):
        van = np.array([_expired(ExoticSpec("EUROPEAN", spec.option_type, strike=spec.strike), float(x), 1.0) for x in S_T])
        alive_pays = str(spec.barrier_type or "").endswith("OUT")
        return np.where(knocked != alive_pays, van, spec.rebate if spec.style == "BARRIER" else 0.0)
    hit_pays = spec.touch_type in ("ONE_TOUCH", "DOUBLE_ONE_TOUCH")          # TOUCH
    v = np.where(knocked == hit_pays, spec.payout, 0.0)
    return np.where(knocked, 0.0, v) if spec.pay_at_hit else v


def simulate_option_paths(inp: OptionXvaInput, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None) -> tuple[np.ndarray, list[float], float]:
    """Option value paths from our side on the monthly grid to settlement, P(0, k·dt) on the quote curve, V0."""
    from pricing.fx_exotic import knocked_so_far, value, value_on_paths, value_on_paths_vols
    from pricing.fx_vol import path_vols, step_vols
    steps, dt = monthly_grid(inp.t_settle)
    sigma = float(inp.vol)
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    r_q = float(inp.quote_zero)
    r_b = r_q - math.log(max(inp.forward, 1e-12) / max(inp.spot, 1e-12)) / max(inp.t_settle, 1e-9)   # the carry the forward implies
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n_paths, steps))
    t = np.arange(1, steps + 1) * dt
    if inp.pillars:
        sv = np.array(step_vols(inp.pillars, t))                                  # the surface's ATM term structure
        f_t = inp.forward * np.exp(np.cumsum(-0.5 * sv ** 2 * dt + sv * math.sqrt(dt) * z, axis=1))
    else:
        sv = np.full(steps, sigma)
        w = np.cumsum(z, axis=1) * math.sqrt(dt)
        f_t = inp.forward * np.exp(-0.5 * sigma ** 2 * t + sigma * w)         # the forward to settlement, driftless
    s_t = f_t * np.exp(-(r_q - r_b) * (inp.t_settle - t))                      # the spot it implies with deterministic rates
    p0 = [math.exp(-r_q * k * dt) for k in range(steps + 2)]
    df_t_T = np.array([inp.df_quote_t / p0[k] for k in range(1, steps + 1)])
    spec = inp.spec
    scale = inp.base_notional if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else 1.0
    barrier_like = spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH")
    i_exp = next((k for k in range(steps) if t[k] >= inp.t_expiry - 1e-9), steps - 1)
    V = np.zeros((n_paths, steps))
    for k in range(steps):
        j_last = min(k, i_exp)
        hist = np.concatenate([np.full((n_paths, 1), inp.spot), s_t[:, :j_last + 1]], axis=1)
        knocked = knocked_so_far(spec, hist) if barrier_like else np.zeros(n_paths, dtype=bool)
        if t[k] < inp.t_expiry - 1e-9:
            tau = inp.t_expiry - t[k]
            if inp.pillars:
                # the forward vol for the remaining life, the smile at each path's moneyness (sticky-delta)
                f_exp = s_t[:, k] * math.exp((r_q - r_b) * tau)
                sig_k = path_vols(inp.pillars, float(t[k]), inp.t_expiry, f_exp, spec.strike if spec.style != "TOUCH" else None)
                V[:, k] = sign * scale * value_on_paths_vols(spec, s_t[:, k], r_q, r_b, sig_k, tau, knocked, 1.0)
            else:
                V[:, k] = sign * scale * value_on_paths(spec, s_t[:, k], r_q, r_b, sigma, tau, knocked, 1.0)
        else:
            V[:, k] = sign * scale * _payoff_at_expiry(spec, s_t[:, i_exp], knocked) * df_t_T[k]
    v0 = sign * scale * float(value(spec, inp.spot, r_q, r_b, sigma, inp.t_expiry, 1.0))
    if noise_out is not None:
        noise_out.update(z=z, f_t=f_t, s_t=s_t, df_t_T=df_t_T, sigma=sigma, steps=steps, dt=dt, r_b=r_b, i_exp=i_exp, step_vols=sv)
    return V, p0, v0


def option_xva(inp: OptionXvaInput, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0, own_cds_bp: float = 42.0,
               ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40, own_lgd: float = 0.40, hurdle_rate: float = 0.12,
               capital_model: str = "sa_ccr", counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None,
               own_cds_curve=None, ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None) -> tuple[WaterfallResult, dict]:
    paths, p0, v0 = simulate_option_paths(inp, n_paths=n_paths, seed=seed, noise_out=noise_out)
    steps, dt = monthly_grid(inp.t_settle)
    rw = im_risk_weight(inp.pair)
    im_m = abs(inp.spot01 or 0.0) * rw / 1e6 if inp.spot01 is not None else None
    spec = inp.spec
    notional = abs(inp.base_notional * inp.forward) if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else abs(float(spec.payout or 0.0))
    params = WaterfallParams(
        notional=max(notional, 1.0), maturity_y=inp.t_settle, dt=dt, theta=max(inp.quote_zero, 1e-6),
        lgd=lgd, own_lgd=own_lgd, cp_cds_bp=cp_cds_bp, own_cds_bp=own_cds_bp, cp_cds_curve=cp_cds_curve,
        own_cds_curve=own_cds_curve, ftp_bp=ftp_bp, ftp_curve=ftp_curve, fba_ratio=fba_ratio, hurdle_rate=hurdle_rate,
        capital_model=capital_model, counterparty_rw=counterparty_rw, wwr_multiplier=wwr_multiplier,
        ir01=None, simm_im_m=im_m,
    )
    wf = run_waterfall(paths, v0, p0, params, csa, **({"rng": waterfall_rng} if waterfall_rng is not None else {}))
    meta = {"vol_pct": inp.vol * 100.0, "vol_source": inp.vol_source or "the pair's surface at the option's expiry and strike",
            "vol_mode": "ATM term structure for the paths, the smile at each path's moneyness (sticky-delta)" if inp.pillars else "flat (today's vol at the strike, held along the path)",
            "im_rw_per_pct": rw, "im_basis": "SIMM FX delta weight" if rw == SIMM_FX_RW_G10 else "assumption: digital asset, outside SIMM",
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "style": spec.style,
            "model": f"lognormal spot{' with the surface' + chr(39) + 's term structure' if inp.pillars else ' at the option' + chr(39) + 's vol'}; {spec.style.replace('_', ' ').lower()} valued on each path with the style's closed form "
                     f"(the credit engine's model); payoff fixed at expiry, discounted to settlement"
                     + ("; barriers monitored at the grid points" if spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH") else "")
                     + ("; American valued as European on the paths (a lower bound)" if spec.style == "AMERICAN" else ""),
            "_paths": paths}
    return wf, meta
