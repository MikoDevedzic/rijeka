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


def _driver(n_paths: int, steps: int, dt: float, seed: int, sigma: float, pillars: Optional[list]):
    """The standard normals drawn, the grid, the step vols and M: the driftless lognormal every forward of the pair
    rides (F_t = F_0 · M_t, E[M_t] = 1). With a surface, the step vols give Var(ln M_t) the ATM variance at every
    grid date; without one, a flat sigma."""
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n_paths, steps))
    t = np.arange(1, steps + 1) * dt
    if pillars:
        from pricing.fx_vol import step_vols
        sv = np.array(step_vols(pillars, t))
        m = np.exp(np.cumsum(-0.5 * sv ** 2 * dt + sv * math.sqrt(dt) * z, axis=1))
    else:
        sv = np.full(steps, sigma)
        w = np.cumsum(z, axis=1) * math.sqrt(dt)
        m = np.exp(-0.5 * sigma ** 2 * t + sigma * w)
    return z, t, sv, m


def _forward_sigma(inp: ForwardXvaInput) -> float:
    return (inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair)) / 100.0


def _forward_values(inp: ForwardXvaInput, steps: int, dt: float, m: np.ndarray) -> tuple[np.ndarray, float, dict]:
    """A forward's MtM from our side on a grid of `steps` × dt driven by M, and V0. Nothing after it settles
    (a grid longer than the forward: a package, simulate_package_paths)."""
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    t = np.arange(1, steps + 1) * dt
    f_t = inp.forward * m
    # DF_q(t, T) = DF_q(0, T) / DF_q(0, t) with the flat continuous zero to T as the curve proxy
    p0 = [math.exp(-inp.quote_zero * k * dt) for k in range(steps + 2)]
    df_t_T = np.array([inp.df_quote_t / p0[k] for k in range(1, steps + 1)])
    paths = sign * inp.base_notional * (f_t - inp.strike) * df_t_T[None, :]
    if t[-1] > inp.t_years + 1e-9:
        paths = np.where((t <= inp.t_years + 1e-9)[None, :], paths, 0.0)
    v0 = sign * inp.base_notional * (inp.forward - inp.strike) * inp.df_quote_t
    return paths, v0, {"f_t": f_t, "df_t_T": df_t_T, "p0": p0}


def simulate_paths(inp: ForwardXvaInput, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None) -> tuple[np.ndarray, list[float], float]:
    """MtM paths from our side on the monthly grid, P(0, k·dt) on the quote curve, and V0.
    noise_out, when given, receives the standard normals drawn (z, n_paths × steps) and the forward paths (f_t),
    so the Excel replication can rebuild every path from the engine's own draws."""
    steps, dt = monthly_grid(inp.t_years)
    sigma = _forward_sigma(inp)
    z, _, sv, m = _driver(n_paths, steps, dt, seed, sigma, inp.pillars)
    paths, v0, x = _forward_values(inp, steps, dt, m)
    if noise_out is not None:
        noise_out.update(z=z, f_t=x["f_t"], df_t_T=x["df_t_T"], sigma=sigma, steps=steps, dt=dt, step_vols=sv)
    return paths, x["p0"], v0


def forward_xva(inp: ForwardXvaInput, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0,
                own_cds_bp: float = 42.0, ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40,
                own_lgd: float = 0.40, hurdle_rate: float = 0.12, capital_model: str = "sa_ccr",
                counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None, own_cds_curve=None,
                ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None,
                simm_im_m: Optional[float] = None) -> tuple[WaterfallResult, dict]:
    paths, p0, v0 = simulate_paths(inp, n_paths=n_paths, seed=seed, noise_out=noise_out)
    steps, dt = monthly_grid(inp.t_years)
    rw = im_risk_weight(inp.pair)
    im_m = simm_im_m if simm_im_m is not None else (abs(inp.spot01 or 0.0) * rw / 1e6 if inp.spot01 is not None else None)
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
            "p0_grid": [float(x) for x in p0], "_paths": paths}       # the MtM paths, for the ticket's chart (not serialised as such)
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


def _option_values(inp: OptionXvaInput, steps: int, dt: float, m: np.ndarray) -> tuple[np.ndarray, float, dict]:
    """An option's value from our side on a grid of `steps` × dt driven by M, and V0. Nothing after it settles
    (a grid longer than the option: a package, simulate_package_paths)."""
    from pricing.fx_exotic import knocked_so_far, value, value_on_paths, value_on_paths_vols
    from pricing.fx_vol import path_vols
    n_paths = m.shape[0]
    sigma = float(inp.vol)
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    r_q = float(inp.quote_zero)
    r_b = r_q - math.log(max(inp.forward, 1e-12) / max(inp.spot, 1e-12)) / max(inp.t_settle, 1e-9)   # the carry the forward implies
    t = np.arange(1, steps + 1) * dt
    f_t = inp.forward * m                                                      # the forward to settlement, driftless
    s_t = f_t * np.exp(-(r_q - r_b) * (inp.t_settle - t))                      # the spot it implies with deterministic rates
    p0 = [math.exp(-r_q * k * dt) for k in range(steps + 2)]
    df_t_T = np.array([inp.df_quote_t / p0[k] for k in range(1, steps + 1)])
    spec = inp.spec
    scale = inp.base_notional if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else 1.0
    barrier_like = spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH")
    i_exp = next((k for k in range(steps) if t[k] >= inp.t_expiry - 1e-9), steps - 1)
    V = np.zeros((n_paths, steps))
    for k in range(steps):
        if t[k] > inp.t_settle + 1e-9:
            break                                                               # settled: nothing left of it
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
    return V, v0, {"f_t": f_t, "s_t": s_t, "df_t_T": df_t_T, "p0": p0, "r_b": r_b, "i_exp": i_exp}


def simulate_option_paths(inp: OptionXvaInput, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None) -> tuple[np.ndarray, list[float], float]:
    """Option value paths from our side on the monthly grid to settlement, P(0, k·dt) on the quote curve, V0."""
    steps, dt = monthly_grid(inp.t_settle)
    sigma = float(inp.vol)
    z, _, sv, m = _driver(n_paths, steps, dt, seed, sigma, inp.pillars)
    V, v0, x = _option_values(inp, steps, dt, m)
    if noise_out is not None:
        noise_out.update(z=z, f_t=x["f_t"], s_t=x["s_t"], df_t_T=x["df_t_T"], sigma=sigma, steps=steps, dt=dt, r_b=x["r_b"], i_exp=x["i_exp"], step_vols=sv)
    return V, x["p0"], v0


def option_xva(inp: OptionXvaInput, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0, own_cds_bp: float = 42.0,
               ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40, own_lgd: float = 0.40, hurdle_rate: float = 0.12,
               capital_model: str = "sa_ccr", counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None,
               own_cds_curve=None, ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None,
               simm_im_m: Optional[float] = None) -> tuple[WaterfallResult, dict]:
    paths, p0, v0 = simulate_option_paths(inp, n_paths=n_paths, seed=seed, noise_out=noise_out)
    steps, dt = monthly_grid(inp.t_settle)
    rw = im_risk_weight(inp.pair)
    im_m = simm_im_m if simm_im_m is not None else (abs(inp.spot01 or 0.0) * rw / 1e6 if inp.spot01 is not None else None)
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
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "style": spec.style, "p0_grid": [float(x) for x in p0],
            "model": f"lognormal spot{' with the surface' + chr(39) + 's term structure' if inp.pillars else ' at the option' + chr(39) + 's vol'}; {spec.style.replace('_', ' ').lower()} valued on each path with the style's closed form "
                     f"(the credit engine's model); payoff fixed at expiry, discounted to settlement"
                     + ("; barriers monitored at the grid points" if spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH") else "")
                     + ("; American valued as European on the paths (a lower bound)" if spec.style == "AMERICAN" else ""),
            "_paths": paths}
    return wf, meta


# ── A package: several legs on one pair, one set of paths ────────────────────────────────────────

def _is_option(leg) -> bool:
    return isinstance(leg, OptionXvaInput)


def _horizon(leg) -> float:
    return float(leg.t_settle if _is_option(leg) else leg.t_years)


def _leg_notional(leg) -> float:
    """The notional the leg's own run hands the waterfall (forward_xva, option_xva)."""
    if not _is_option(leg):
        return abs(leg.base_notional * leg.forward)
    if leg.spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER"):
        return max(abs(leg.base_notional * leg.forward), 1.0)
    return max(abs(float(leg.spec.payout or 0.0)), 1.0)


def simulate_package_paths(legs: list, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None) -> tuple[np.ndarray, list[float], float, list[dict]]:
    """The package's value paths from our side: every leg valued by its own engine (a forward's MtM, an option's
    style in closed form) on ONE grid, monthly to the longest settlement, and ONE driver M, so the legs net
    path by path. Each leg's forward is F_i(0)·M_t: one factor, carry deterministic, so every forward of the pair
    is a martingale and each leg starts at its own price. The driver's vol is the surface's ATM term structure
    when a leg carries the surface, else the longest leg's own vol held flat; an option is valued at its own vol
    either way. A leg is nothing after it settles. A package of one leg is that leg's own run, draw for draw.
    Returns the paths, P(0, k·dt) on the longest leg's quote zero, V0 and a row per leg (v0, horizon)."""
    if not legs:
        raise ValueError("a package needs at least one leg")
    if len({str(l.pair).upper() for l in legs}) != 1:
        raise ValueError("every leg of a package is on the same pair")
    longest = max(legs, key=_horizon)
    steps, dt = monthly_grid(_horizon(longest))
    pillars = next((l.pillars for l in legs if l.pillars), None)
    sigma = float(longest.vol) if _is_option(longest) else _forward_sigma(longest)
    z, t, sv, m = _driver(n_paths, steps, dt, seed, sigma, pillars)
    p0 = [math.exp(-float(longest.quote_zero) * k * dt) for k in range(steps + 2)]
    V = np.zeros((n_paths, steps))
    v0, rows = 0.0, []
    for leg in legs:
        Vi, v0i, _ = (_option_values if _is_option(leg) else _forward_values)(leg, steps, dt, m)
        V = V + Vi
        v0 += v0i
        rows.append({"v0": float(v0i), "horizon": _horizon(leg), "option": _is_option(leg), "paths": Vi})
    if noise_out is not None:
        noise_out.update(z=z, m=m, sigma=sigma, steps=steps, dt=dt, step_vols=sv)
    return V, p0, v0, rows


def package_addons(legs: list, csa: CSA, steps: int, dt: float) -> tuple[list[float], Optional[list[float]]]:
    """The capital add-on along the grid: the sum of each leg's own single-factor add-on while it is alive
    (SF × N_i × supervisory duration × maturity factor of its remaining life: what run_waterfall computes for a
    leg on its own), and the same unmargined for the CRE52.2 cap. No offset between legs in the add-on: the
    replacement cost nets on the paths, the add-on does not."""
    from pricing.xva_engine import SF_IR
    grid, unm = [], []
    for i in range(steps):
        t = (i + 1) * dt
        a = u = 0.0
        for leg in legs:
            m_t = max(_horizon(leg) - t, 0.0)
            if m_t <= 0:
                continue
            sd = (1.0 - math.exp(-0.05 * m_t)) / 0.05
            n = _leg_notional(leg)
            a += SF_IR * n * sd * csa.sa_ccr_maturity_factor(m_t)
            u += SF_IR * n * sd * math.sqrt(min(max(m_t, 10.0 / 250.0), 1.0))
        grid.append(a)
        unm.append(u)
    return grid, (unm if csa.sa_ccr_margined else None)


def package_xva(legs: list, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0, own_cds_bp: float = 42.0,
                ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40, own_lgd: float = 0.40, hurdle_rate: float = 0.12,
                capital_model: str = "sa_ccr", counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None,
                own_cds_curve=None, ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None,
                simm_im_m: Optional[float] = None) -> tuple[WaterfallResult, dict]:
    """XVA of a package of legs on one pair as one netting set: the summed paths through the same waterfall.
    Initial margin on the NET spot sensitivity of the legs; the capital add-on as package_addons."""
    paths, p0, v0, rows = simulate_package_paths(legs, n_paths=n_paths, seed=seed, noise_out=noise_out)
    longest = max(legs, key=_horizon)
    steps, dt = monthly_grid(_horizon(longest))
    rw = im_risk_weight(longest.pair)
    known = [l.spot01 for l in legs if l.spot01 is not None]
    im_m = simm_im_m if simm_im_m is not None else (abs(sum(known)) * rw / 1e6 if known else None)
    params = WaterfallParams(
        notional=sum(_leg_notional(l) for l in legs), maturity_y=_horizon(longest), dt=dt, theta=max(float(longest.quote_zero), 1e-6),
        lgd=lgd, own_lgd=own_lgd, cp_cds_bp=cp_cds_bp, own_cds_bp=own_cds_bp, cp_cds_curve=cp_cds_curve,
        own_cds_curve=own_cds_curve, ftp_bp=ftp_bp, ftp_curve=ftp_curve, fba_ratio=fba_ratio, hurdle_rate=hurdle_rate,
        capital_model=capital_model, counterparty_rw=counterparty_rw, wwr_multiplier=wwr_multiplier,
        ir01=None, simm_im_m=im_m,
    )
    wf = run_waterfall(paths, v0, p0, params, csa, addon_profiles=package_addons(legs, csa, steps, dt),
                       **({"rng": waterfall_rng} if waterfall_rng is not None else {}))
    pillars = next((l.pillars for l in legs if l.pillars), None)
    sigma = float(longest.vol) if _is_option(longest) else _forward_sigma(longest)
    styles = sorted({l.spec.style for l in legs if _is_option(l)})
    meta = {"vol_pct": sigma * 100.0,
            "vol_source": "the longest leg's vol" + (f" ({longest.vol_source})" if getattr(longest, "vol_source", None) else ""),
            "vol_mode": ("ATM term structure of the surface for the paths" + ("; each option at the smile of each path's moneyness (sticky-delta)" if styles else "")) if pillars
                        else "flat (the longest leg's vol for the paths" + ("; each option at its own vol" if styles else "") + ")",
            "im_rw_per_pct": rw, "im_basis": ("SIMM FX delta weight" if rw == SIMM_FX_RW_G10 else "assumption: digital asset, outside SIMM") + ", on the net spot sensitivity of the legs",
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "p0_grid": [float(x) for x in p0], "_paths": paths, "_legs": rows,
            "model": f"{len(legs)} legs on one set of paths: every forward of the pair is its own forward times one lognormal driver, "
                     "so the legs net path by path; each leg valued as on its own (a forward's mark, an option's style in closed form); "
                     "a leg is nothing after it settles; the capital add-on is the sum of the legs' add-ons"
                     + ("; barriers monitored at the grid points" if any(s in ("BARRIER", "DOUBLE_BARRIER", "TOUCH") for s in styles) else "")
                     + ("; American valued as European on the paths (a lower bound)" if "AMERICAN" in styles else "")}
    return wf, meta
