"""
XVA for FX and crypto forwards, through the same waterfall as the rates book.

A forward's mark-to-market at time t is ±N·(F_t − K)·DF_q(t, T). Under the
T-forward measure F_t is driftless and lognormal with a flat volatility σ, so
the exposure paths are simulated directly (no rate model is needed) and
handed to pricing.xva_engine.run_waterfall, which applies the CSA, initial
margin and the CVA / DVA / FVA / FBA / KVA / MVA integrals exactly as it does
for a swap. σ is the pair's surface, or a desk input, or the default below
for a pair with none, and the run says which.

Initial margin is an amount the desk sets, or the engine's own estimate from
these paths (xva_engine.model_im). It is not ISDA SIMM, which is licensed.

Capital: the add-on is SA-CCR's for the asset class of the pair (saccr_rows):
foreign exchange (CRE52), a Group 2a cryptoasset (SCO60.98) or a Group 2b
cryptoasset (SCO60.99).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, WaterfallResult, hazard_beta, run_waterfall

# Flat annualised vols by pair, percent: desk inputs for the demo, not market data.
DEFAULT_VOL_PCT = {
    "EURUSD": 7.5, "GBPUSD": 8.0, "USDJPY": 10.0, "USDCHF": 8.0, "AUDUSD": 10.0, "USDCAD": 7.0,
    "BTCUSD": 55.0, "ETHUSD": 70.0, "SOLUSD": 90.0,
}
G10 = {"USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "SEK", "NOK"}
# Which Basel group a digital asset is run under when the desk does not say (SCO60.55: Group 2a needs a
# regulated derivative or ETF, USD 10bn of market capitalisation, USD 50m of daily volume and a year of prices,
# shown to the supervisor; everything else is 2b). The default is this engine's reading, the desk's to change.
GROUP_2A_DEFAULT = {"BTC", "ETH"}


def default_vol_pct(pair: str) -> float:
    return DEFAULT_VOL_PCT.get(pair.upper(), 60.0 if pair[:3].upper() not in G10 else 9.0)


def is_crypto(pair: str) -> bool:
    return pair[:3].upper() not in G10


def crypto_group_of(pair: str, group: Optional[str] = None) -> Optional[str]:
    """'2a' or '2b' for a digital asset (the desk's choice, else the default above); None for a currency pair."""
    if not is_crypto(pair):
        return None
    g = str(group or "").lower().replace("group", "").strip()
    if g in ("2a", "2b"):
        return g
    if g:
        raise ValueError("crypto_group must be 2a or 2b")
    return "2a" if pair[:3].upper() in GROUP_2A_DEFAULT else "2b"


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
    spot01: Optional[float] = None   # PV for +1 % spot
    spot: Optional[float] = None     # today's spot, for the SA-CCR notional (CRE52.35); None = the forward stands in
    vol_source: Optional[str] = None # where vol_pct came from (the pair's surface, a desk input); None = the demo default
    pillars: Optional[list] = None   # the pair's surface (fx_vol.parse_surface): the paths step with its ATM term structure
    regimes: bool = True             # a digital asset's vol regimes (pricing/vol_regimes)   ; False: one vol, for comparison


def monthly_grid(t_years: float) -> tuple[int, float]:
    """Monthly steps to settlement; a short forward still gets at least two steps."""
    steps = max(2, int(math.ceil(t_years * 12)))
    return steps, t_years / steps


def regimes_meta(leg, vol_pct: float) -> Optional[dict]:
    """What a run says about its vol regimes: the two levels at this ticket's vol, how often and how long, and where
    the parameters come from. None when the level has one vol (a currency pair, or regimes turned off)."""
    reg = _regimes(leg)
    return reg.describe(vol_pct) if reg is not None else None


def _regimes(leg):
    """The vol regimes of the leg's asset, when it has them and the leg has not turned them off."""
    from pricing.vol_regimes import regimes_of
    return regimes_of(leg.pair) if getattr(leg, "regimes", True) else None


def _driver(n_paths: int, steps: int, dt: float, seed: int, sigma: float, pillars: Optional[list], regimes=None):
    """The standard normals drawn, the grid, the step vols, M and the variance clock: the driftless level every
    forward of the pair rides (F_t = F_0 · M_t, E[M_t] = 1). With a surface, the step vols give Var(ln M_t) the ATM
    variance at every grid date; without one, a flat sigma. With `regimes` (a digital asset: pricing/vol_regimes)
    the variance a step accumulates is the step vol's times what the path's days in each regime add up to, mean
    one: given that clock the level is lognormal as before, and the same standard normals drive it. The clock is
    None without regimes."""
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n_paths, steps))
    t = np.arange(1, steps + 1) * dt
    ck = None
    if regimes is not None:
        from pricing.vol_regimes import clock, step_variance
        from pricing.fx_vol import step_vols
        ck = clock(regimes, n_paths, steps, dt, seed)
        sv = np.array(step_vols(pillars, t)) if pillars else np.full(steps, sigma)
        var = (sv ** 2 * dt)[None, :] * step_variance(ck)
        m = np.exp(np.cumsum(-0.5 * var + np.sqrt(var) * z, axis=1))
    elif pillars:
        from pricing.fx_vol import step_vols
        sv = np.array(step_vols(pillars, t))
        m = np.exp(np.cumsum(-0.5 * sv ** 2 * dt + sv * math.sqrt(dt) * z, axis=1))
    else:
        sv = np.full(steps, sigma)
        w = np.cumsum(z, axis=1) * math.sqrt(dt)
        m = np.exp(-0.5 * sigma ** 2 * t + sigma * w)
    return z, t, sv, m, ck


def _settle_step(t: np.ndarray, t_settle: float) -> int:
    """The first grid date at or after a settlement; the last one when the grid ends before it."""
    return next((k for k in range(len(t)) if t[k] >= t_settle - 1e-9), len(t) - 1)


def _forward_sigma(inp: ForwardXvaInput) -> float:
    return (inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair)) / 100.0


def _forward_values(inp: ForwardXvaInput, steps: int, dt: float, m: np.ndarray) -> tuple[np.ndarray, float, dict]:
    """A forward's MtM from our side on a grid of `steps` × dt driven by M, and V0. On a grid longer than the
    forward (a package, simulate_package_paths) it stays to the first grid date at or after its settlement, where it
    is its settled amount, and is nothing after: a settlement between two grid dates is read at the later one."""
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    t = np.arange(1, steps + 1) * dt
    f_t = inp.forward * m
    # DF_q(t, T) = DF_q(0, T) / DF_q(0, t) with the flat continuous zero to T as the curve proxy
    p0 = [math.exp(-inp.quote_zero * k * dt) for k in range(steps + 2)]
    df_t_T = np.array([inp.df_quote_t / p0[k] for k in range(1, steps + 1)])
    paths = sign * inp.base_notional * (f_t - inp.strike) * df_t_T[None, :]
    if t[-1] > inp.t_years + 1e-9:
        k_set = _settle_step(t, inp.t_years)
        if t[k_set] > inp.t_years + 1e-9:
            paths[:, k_set] = sign * inp.base_notional * (f_t[:, k_set] - inp.strike)      # settled: no discounting left
        paths[:, k_set + 1:] = 0.0
    v0 = sign * inp.base_notional * (inp.forward - inp.strike) * inp.df_quote_t
    return paths, v0, {"f_t": f_t, "df_t_T": df_t_T, "p0": p0}


def wwr_of(x: np.ndarray, cp_hazard_if_halves: float, own_hazard_if_halves: float) -> Optional[dict]:
    """The waterfall's wrong-way input from the desk's two numbers (the multiple each party's default intensity
    takes when the asset halves against its forward); None when both are 1, default independent of the asset."""
    b_cp, b_ow = hazard_beta(cp_hazard_if_halves), hazard_beta(own_hazard_if_halves)
    if b_cp == 0.0 and b_ow == 0.0:
        return None
    return {"x": x, "beta_cp": b_cp, "beta_own": b_ow}


def wwr_meta(wf: WaterfallResult, cp_hazard_if_halves: float, own_hazard_if_halves: float) -> Optional[dict]:
    if wf.cva_independent is None and wf.dva_independent is None:
        return None
    # a party that was not linked has no separate independent figure: its charge IS the independent one
    return {"cp_hazard_if_halves": float(cp_hazard_if_halves), "own_hazard_if_halves": float(own_hazard_if_halves),
            "cva_independent": wf.cva_independent if wf.cva_independent is not None else wf.cva,
            "dva_independent": wf.dva_independent if wf.dva_independent is not None else wf.dva,
            "model": "default intensity h = c(t)·(asset / its forward)^b on each path, c(t) solved so the mean survival is the "
                     "credit curve's (Hull and White 2012); b = −log2 of the multiple typed"}


# ── The value a margin period earlier, exactly ───────────────────────────────────────────────────
#
# Collateral and initial margin read the set's value a margin period before each grid date. The waterfall's own
# routine (xva_engine.lagged_values) bridges between the grid VALUES as if they were Gaussian. A forward's value is
# a multiple of a lognormal level, and at a digital asset's vol the difference is not small: against a simulation
# that draws the level at both dates the margin we would call read 9 to 18 % low at 55 to 110 % vol
# (tests/test_fx_xva_lag.py). Here the level itself is drawn where it is exact, and every leg is valued on it.

def _lagged_driver(m: np.ndarray, sv: np.ndarray, dt: float, lag_y: float, rng: np.random.Generator,
                   noise_out: Optional[np.ndarray] = None, ck: Optional[np.ndarray] = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """M at t_i − δ for every grid date t_i = (i+1)·dt, the time itself, and j: t_i − δ lies strictly inside
    (t_{j−1}, t_j), t_k = k·dt (j ≤ 0: before today). For a margin period that is not a whole number of steps
    (exact_lag sends the other case to the grid values themselves). Inside a step ln M is a Brownian motion with
    the step's vol, so given the two grid levels either side it is a bridge: mean on the straight line between
    them, variance σ_j²·w(1−w)·dt. Before today the level is today's (1). One standard normal per path and date
    is drawn from `rng`, as lagged_values draws them.
    With a variance clock `ck` (a digital asset's vol regimes) the bridge is the same one on the clock: the share
    of the step's variance that came before the date takes the place of the share of its time, per path, and the
    step's variance is the path's own. Nothing more is drawn."""
    n_paths, T = m.shape
    lnm = np.concatenate([np.zeros((n_paths, 1)), np.log(m)], axis=1)          # lnm[:, k] = ln M(k·dt)
    steps_back = lag_y / dt
    k_full = int(math.floor(steps_back + 1e-12))
    frac = steps_back - k_full
    out = np.ones_like(m)
    t_lag = np.maximum((np.arange(1, T + 1) - steps_back) * dt, 0.0)
    j_of = np.arange(1, T + 1) - k_full
    for i in range(T):
        j = int(j_of[i])
        z = rng.standard_normal(n_paths)
        if noise_out is not None:
            noise_out[:, i] = z
        if j <= 0:
            continue                                                           # before today: the level of today
        w = 1.0 - frac
        lo, hi = lnm[:, j - 1], lnm[:, j]
        if ck is None:
            out[:, i] = np.exp(lo + w * (hi - lo) + z * float(sv[j - 1]) * math.sqrt(w * (1.0 - w) * dt))
        else:
            from pricing.vol_regimes import share_before
            om = share_before(ck, j - 1, w)
            var_j = float(sv[j - 1]) ** 2 * dt * ck[:, j - 1, :].mean(axis=1, dtype=np.float64)
            out[:, i] = np.exp(lo + om * (hi - lo) + z * np.sqrt(var_j * om * (1.0 - om)))
    return out, t_lag, j_of


def _forward_lag(inp: ForwardXvaInput, vi: np.ndarray, v0: float, steps: int, dt: float,
                 m_lag: np.ndarray, t_lag: np.ndarray, j_of: np.ndarray) -> np.ndarray:
    """A forward's value at each t_i − δ on the level there: side·N·(F₀·M − K)·DF_q(t, T). Before today it is
    today's value; once the grid date it settles on has passed it is the amount it settled at (vi at that date)."""
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    t = np.arange(1, steps + 1) * dt
    k_set = _settle_step(t, inp.t_years)
    out = np.empty_like(m_lag)
    for i in range(steps):
        j = int(j_of[i])
        if j <= 0:
            out[:, i] = v0
        elif j - 1 > k_set:                                                    # the step after its settlement date
            out[:, i] = vi[:, k_set]
        else:
            df = inp.df_quote_t / math.exp(-inp.quote_zero * min(float(t_lag[i]), inp.t_years))
            out[:, i] = sign * inp.base_notional * (inp.forward * m_lag[:, i] - inp.strike) * df
    return out


def _option_lag(inp: OptionXvaInput, vi: np.ndarray, v0: float, x: dict, steps: int, dt: float,
                m_lag: np.ndarray, t_lag: np.ndarray, j_of: np.ndarray) -> np.ndarray:
    """An option's value at each t_i − δ: the style's closed form on the spot there with the time left. After
    the expiry's grid date the payoff is fixed and only discounting is left; once settled, the amount it paid.

    Two approximations, both the paths' own and both stated in docs/xva.md. (1) In the step that ends on the
    expiry's grid date the time left runs to that date, where the paths fix the payoff, not to the expiry itself
    (the two differ when the expiry is not a grid date: a currency option's two days to settlement). (2) A barrier
    or a touch carries the knock state the grid dates BEFORE t_i − δ have seen, and is then valued by a closed form
    that monitors continuously: a path that is beyond the barrier at t_i − δ and has not knocked on the grid is
    valued as knocked there, though about a third of such paths are back inside at the next grid date and alive.
    Near the barrier that overstates the move over the margin period (the validator, 11 November 2026: 9 % of
    paths at the second month of a six-month up-barrier at 115 % of spot and 80 % vol; valued instead at the
    barrier the margin called moved 13 % at that date and 2 to 3 % later). It goes when the paths monitor between
    grid dates."""
    from pricing.fx_exotic import knocked_so_far, value_on_paths, value_on_paths_vols
    from pricing.fx_vol import path_vols
    n_paths = m_lag.shape[0]
    sigma = float(inp.vol)
    sign = 1.0 if str(inp.direction).upper() == "BUY" else -1.0
    r_q, r_b, s_t, i_exp = float(inp.quote_zero), float(x["r_b"]), x["s_t"], int(x["i_exp"])
    t = np.arange(1, steps + 1) * dt
    k_set = _settle_step(t, inp.t_settle)
    spec = inp.spec
    scale = inp.base_notional if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else 1.0
    barrier_like = spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH")
    out = np.empty_like(m_lag)
    for i in range(steps):
        j = int(j_of[i])                                                       # t_lag in (t_{j−1}, t_j]; grid date t_j is column j − 1
        if j <= 0:
            out[:, i] = v0
            continue
        if j - 1 > k_set:
            out[:, i] = vi[:, k_set]
            continue
        knocked = np.zeros(n_paths, dtype=bool)
        if barrier_like:
            seen = min(j - 2, i_exp)                                           # the last grid column at or before t_{j−1}
            hist = np.concatenate([np.full((n_paths, 1), inp.spot), s_t[:, :seen + 1]], axis=1) if seen >= 0 else np.full((n_paths, 1), inp.spot)
            knocked = knocked_so_far(spec, hist)
        tl = float(t_lag[i])
        df = inp.df_quote_t / math.exp(-r_q * min(tl, inp.t_settle))
        if j - 1 > i_exp:                                                      # after the expiry's grid date: the payoff is fixed
            out[:, i] = sign * scale * _payoff_at_expiry(spec, s_t[:, i_exp], knocked_so_far(spec, np.concatenate([np.full((n_paths, 1), inp.spot), s_t[:, :i_exp + 1]], axis=1)) if barrier_like else knocked) * df
            continue
        s_lag = inp.forward * m_lag[:, i] * math.exp(-(r_q - r_b) * (inp.t_settle - tl))
        tau = (float(t[i_exp]) if j - 1 == i_exp else inp.t_expiry) - tl       # in the expiry's own step: to the date the paths fix the payoff on
        if tau <= 1e-9:
            out[:, i] = sign * scale * _payoff_at_expiry(spec, s_lag, knocked) * df
        elif inp.pillars:
            f_exp = s_lag * math.exp((r_q - r_b) * tau)
            sig = path_vols(inp.pillars, tl, tl + tau, f_exp, spec.strike if spec.style != "TOUCH" else None)
            out[:, i] = sign * scale * value_on_paths_vols(spec, s_lag, r_q, r_b, sig, tau, knocked, 1.0)
        else:
            out[:, i] = sign * scale * value_on_paths(spec, s_lag, r_q, r_b, sigma, tau, knocked, 1.0)
    return out


def exact_lag(legs: list, parts: list, steps: int, dt: float, m: np.ndarray, sv: np.ndarray, whole: np.ndarray, v0: float,
              ck: Optional[np.ndarray] = None):
    """The set's value a margin period before every grid date, for run_waterfall(lag_values=): the driver drawn
    at that time (_lagged_driver), every leg valued on it (_forward_lag, _option_lag), and the legs added. `parts`
    is, per leg, (its value paths, its value today, what its engine returned beside them). A leg that has settled
    stands at the amount it paid, as the waterfall's `settled` has it. `whole` is the set's value on the grid with
    what has settled still in it, and `v0` its value today: a margin period of a whole number of steps is read
    off those, with nothing drawn."""
    from pricing.xva_engine import lagged_values

    def lag(lag_y: float, rng: np.random.Generator, noise_out: Optional[np.ndarray] = None) -> np.ndarray:
        back = lag_y / dt
        if lag_y <= 0 or back - math.floor(back + 1e-12) < 1e-12:
            return lagged_values(whole, v0, dt, lag_y, rng, noise_out=noise_out)
        m_lag, t_lag, j_of = _lagged_driver(m, sv, dt, lag_y, rng, noise_out, ck)
        total = np.zeros_like(m)
        for leg, (vi, v0i, x) in zip(legs, parts):
            total = total + (_option_lag(leg, vi, v0i, x, steps, dt, m_lag, t_lag, j_of) if _is_option(leg)
                             else _forward_lag(leg, vi, v0i, steps, dt, m_lag, t_lag, j_of))
        return total
    return lag


def simulate_paths(inp: ForwardXvaInput, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None) -> tuple[np.ndarray, list[float], float]:
    """MtM paths from our side on the monthly grid, P(0, k·dt) on the quote curve, and V0.
    noise_out, when given, receives the standard normals drawn (z, n_paths × steps) and the forward paths (f_t),
    so the Excel replication can rebuild every path from the engine's own draws."""
    steps, dt = monthly_grid(inp.t_years)
    sigma = _forward_sigma(inp)
    z, _, sv, m, ck = _driver(n_paths, steps, dt, seed, sigma, inp.pillars, _regimes(inp))
    paths, v0, x = _forward_values(inp, steps, dt, m)
    if noise_out is not None:
        noise_out.update(z=z, f_t=x["f_t"], df_t_T=x["df_t_T"], sigma=sigma, steps=steps, dt=dt, step_vols=sv, clock=ck,
                         lag=exact_lag([inp], [(paths, v0, x)], steps, dt, m, sv, paths, v0, ck))
    return paths, x["p0"], v0


def forward_xva(inp: ForwardXvaInput, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0,
                own_cds_bp: float = 42.0, ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40,
                own_lgd: float = 0.40, hurdle_rate: float = 0.12, capital_model: str = "sa_ccr",
                counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None, own_cds_curve=None,
                ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None,
                im_amount: Optional[float] = None, cp_hazard_if_halves: float = 1.0, own_hazard_if_halves: float = 1.0,
                crypto_group: Optional[str] = None) -> tuple[WaterfallResult, dict]:
    noise_out = noise_out if noise_out is not None else {}
    paths, p0, v0 = simulate_paths(inp, n_paths=n_paths, seed=seed, noise_out=noise_out)
    wwr = wwr_of(np.log(noise_out["f_t"] / inp.forward), cp_hazard_if_halves, own_hazard_if_halves)
    steps, dt = monthly_grid(inp.t_years)
    cap = capital_inputs([inp], csa, steps, dt, capital_model, crypto_group)
    params = WaterfallParams(
        notional=abs(inp.base_notional * inp.forward), maturity_y=inp.t_years, dt=dt, theta=max(inp.quote_zero, 1e-6),
        lgd=lgd, own_lgd=own_lgd, cp_cds_bp=cp_cds_bp, own_cds_bp=own_cds_bp, cp_cds_curve=cp_cds_curve,
        own_cds_curve=own_cds_curve, ftp_bp=ftp_bp, ftp_curve=ftp_curve, fba_ratio=fba_ratio, hurdle_rate=hurdle_rate,
        capital_model=capital_model, counterparty_rw=counterparty_rw, wwr_multiplier=wwr_multiplier,
        im_amount=im_amount,
    )
    wf = run_waterfall(paths, v0, p0, params, csa, wrong_way=wwr, lag_values=noise_out["lag"], **cap["kwargs"],
                       **({"rng": waterfall_rng} if waterfall_rng is not None else {}))
    nz = {}
    if inp.pillars:
        _, _, _ = simulate_paths(inp, n_paths=2, seed=seed, noise_out=nz)      # the step vols, for the record
    meta = {"vol_pct": inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair),
            "vol_source": (inp.vol_source or "desk input") if inp.vol_pct is not None else "demo default (no surface for this pair)",
            "vol_mode": "ATM term structure of the surface (step vols)" if inp.pillars else "flat",
            "step_vols_pct": [round(float(v) * 100, 3) for v in nz["step_vols"]] if inp.pillars else None,
            "im_basis": wf.im_basis, "capital_basis": cap["basis"], "crypto_group": cap["group"],
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "model": "lognormal forward at the surface's ATM vol to settlement, same waterfall as rates"
                                                                           + ("; day by day the vol moves between regimes (a stress of days on a level of weeks) whose variance on average is the ticket's" if _regimes(inp) else ""),
            "vol_regimes": regimes_meta(inp, inp.vol_pct if inp.vol_pct is not None else default_vol_pct(inp.pair)),
            "p0_grid": [float(x) for x in p0], "_paths": paths,       # the MtM paths, for the ticket's chart (not serialised as such)
            "wwr": wwr_meta(wf, cp_hazard_if_halves, own_hazard_if_halves)}
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
    regimes: bool = True             # a digital asset's vol regimes (pricing/vol_regimes)   ; False: one vol, for comparison


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
    """An option's value from our side on a grid of `steps` × dt driven by M, and V0. On a grid longer than the
    option (a package, simulate_package_paths) it stays to the first grid date at or after its settlement, where it
    is its payoff, and is nothing after: an expiry or a settlement between two grid dates is read at the later one."""
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
    k_set = _settle_step(t, inp.t_settle)
    V = np.zeros((n_paths, steps))
    for k in range(k_set + 1):                                                  # nothing after it has settled
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
            V[:, k] = sign * scale * _payoff_at_expiry(spec, s_t[:, i_exp], knocked) * (df_t_T[k] if t[k] <= inp.t_settle + 1e-9 else 1.0)
    v0 = sign * scale * float(value(spec, inp.spot, r_q, r_b, sigma, inp.t_expiry, 1.0))
    return V, v0, {"f_t": f_t, "s_t": s_t, "df_t_T": df_t_T, "p0": p0, "r_b": r_b, "i_exp": i_exp}


def simulate_option_paths(inp: OptionXvaInput, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None) -> tuple[np.ndarray, list[float], float]:
    """Option value paths from our side on the monthly grid to settlement, P(0, k·dt) on the quote curve, V0."""
    steps, dt = monthly_grid(inp.t_settle)
    sigma = float(inp.vol)
    z, _, sv, m, ck = _driver(n_paths, steps, dt, seed, sigma, inp.pillars, _regimes(inp))
    V, v0, x = _option_values(inp, steps, dt, m)
    if noise_out is not None:
        noise_out.update(z=z, f_t=x["f_t"], s_t=x["s_t"], df_t_T=x["df_t_T"], sigma=sigma, steps=steps, dt=dt, r_b=x["r_b"], i_exp=x["i_exp"], step_vols=sv, clock=ck,
                         lag=exact_lag([inp], [(V, v0, x)], steps, dt, m, sv, V, v0, ck))
    return V, x["p0"], v0


def option_xva(inp: OptionXvaInput, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0, own_cds_bp: float = 42.0,
               ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40, own_lgd: float = 0.40, hurdle_rate: float = 0.12,
               capital_model: str = "sa_ccr", counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None,
               own_cds_curve=None, ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None,
               im_amount: Optional[float] = None, cp_hazard_if_halves: float = 1.0, own_hazard_if_halves: float = 1.0,
               crypto_group: Optional[str] = None) -> tuple[WaterfallResult, dict]:
    noise_out = noise_out if noise_out is not None else {}
    paths, p0, v0 = simulate_option_paths(inp, n_paths=n_paths, seed=seed, noise_out=noise_out)
    wwr = wwr_of(np.log(noise_out["f_t"] / inp.forward), cp_hazard_if_halves, own_hazard_if_halves)
    steps, dt = monthly_grid(inp.t_settle)
    cap = capital_inputs([inp], csa, steps, dt, capital_model, crypto_group)
    spec = inp.spec
    notional = abs(inp.base_notional * inp.forward) if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else abs(float(spec.payout or 0.0))
    params = WaterfallParams(
        notional=max(notional, 1.0), maturity_y=inp.t_settle, dt=dt, theta=max(inp.quote_zero, 1e-6),
        lgd=lgd, own_lgd=own_lgd, cp_cds_bp=cp_cds_bp, own_cds_bp=own_cds_bp, cp_cds_curve=cp_cds_curve,
        own_cds_curve=own_cds_curve, ftp_bp=ftp_bp, ftp_curve=ftp_curve, fba_ratio=fba_ratio, hurdle_rate=hurdle_rate,
        capital_model=capital_model, counterparty_rw=counterparty_rw, wwr_multiplier=wwr_multiplier,
        im_amount=im_amount,
    )
    wf = run_waterfall(paths, v0, p0, params, csa, wrong_way=wwr, lag_values=noise_out["lag"], **cap["kwargs"],
                       **({"rng": waterfall_rng} if waterfall_rng is not None else {}))
    meta = {"vol_pct": inp.vol * 100.0, "vol_source": inp.vol_source or "the pair's surface at the option's expiry and strike",
            "vol_mode": "ATM term structure for the paths, the smile at each path's moneyness (sticky-delta)" if inp.pillars else "flat (today's vol at the strike, held along the path)",
            "im_basis": wf.im_basis, "capital_basis": cap["basis"], "crypto_group": cap["group"],
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "style": spec.style, "p0_grid": [float(x) for x in p0],
            "model": f"lognormal spot{' with the surface' + chr(39) + 's term structure' if inp.pillars else ' at the option' + chr(39) + 's vol'}; {spec.style.replace('_', ' ').lower()} valued on each path with the style's closed form "
                     f"(the credit engine's model); payoff fixed at expiry, discounted to settlement"
                     + ("; barriers monitored at the grid points" if spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH") else "")
                     + ("; day by day the spot's vol moves between regimes (a stress of days on a level of weeks) whose variance on average is the surface's; the option is still marked at the surface's vol" if _regimes(inp) else "")
                     + ("; American valued as European on the paths (a lower bound)" if spec.style == "AMERICAN" else ""),
            "vol_regimes": regimes_meta(inp, inp.vol * 100.0),
            "_paths": paths, "wwr": wwr_meta(wf, cp_hazard_if_halves, own_hazard_if_halves)}
    return wf, meta


# ── A package: several legs on one pair, one set of paths ────────────────────────────────────────

class _ColumnOnly:
    """One column of a leg's value paths, read as vi[:, k]: the lag reads nothing else of them, and a package of
    many long legs should not keep a matrix per leg."""
    def __init__(self, column: np.ndarray, k: int):
        self.column, self.k = column, k

    def __getitem__(self, key):
        rows, k = key
        if k != self.k:
            raise IndexError(f"only column {self.k} of this leg's paths was kept")
        return self.column[rows]


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


def simulate_package_paths(legs: list, n_paths: int = 2000, seed: int = 42, noise_out: Optional[dict] = None,
                           keep_leg_paths: bool = False) -> tuple[np.ndarray, list[float], float, list[dict]]:
    """The package's value paths from our side: every leg valued by its own engine (a forward's MtM, an option's
    style in closed form) on ONE grid, monthly to the longest settlement, and ONE driver M, so the legs net
    path by path. Each leg's forward is F_i(0)·M_t: one factor, carry deterministic, so every forward of the pair
    is a martingale and each leg starts at its own price. The driver's vol is the surface's ATM term structure
    when a leg carries the surface, else the longest leg's own vol held flat; an option is valued at its own vol
    either way. A leg stays to the first grid date at or after its settlement (its settled amount there) and is
    nothing after, so a settlement between two grid dates is carried up to a step longer, never dropped.
    A package of one leg is that leg's own run, draw for draw.
    Returns the paths, P(0, k·dt) on the longest leg's quote zero, V0 and a row per leg (v0, horizon, the peak of
    its own expected positive exposure; its paths too when keep_leg_paths, which a caller with many long legs
    should not ask for: one matrix per leg)."""
    if not legs:
        raise ValueError("a package needs at least one leg")
    if len({str(l.pair).upper() for l in legs}) != 1:
        raise ValueError("every leg of a package is on the same pair")
    longest = max(legs, key=_horizon)
    steps, dt = monthly_grid(_horizon(longest))
    pillars = next((l.pillars for l in legs if l.pillars), None)
    sigma = float(longest.vol) if _is_option(longest) else _forward_sigma(longest)
    z, t, sv, m, ck = _driver(n_paths, steps, dt, seed, sigma, pillars, None if any(not getattr(l, "regimes", True) for l in legs) else _regimes(longest))
    p0 = [math.exp(-float(longest.quote_zero) * k * dt) for k in range(steps + 2)]
    V = np.zeros((n_paths, steps))
    settled = np.zeros((n_paths, steps))          # the cash that has settled out of the set by each date, per path
    v0, rows, parts = 0.0, [], []
    for leg in legs:
        Vi, v0i, xi = (_option_values if _is_option(leg) else _forward_values)(leg, steps, dt, m)
        k_last = _settle_step(t, _horizon(leg))
        # what the lag needs of this leg: its value on its settlement's grid date (one column, not the matrix) and, for
        # an option, its spots on the grid (a matrix per option leg, held until the run's noise_out is dropped)
        parts.append((Vi if keep_leg_paths else _ColumnOnly(Vi[:, k_last].copy(), k_last), v0i,
                      {k: xi[k] for k in ("r_b", "s_t", "i_exp") if k in xi}))
        V = V + Vi
        v0 += v0i
        k_set = _settle_step(t, _horizon(leg))
        if k_set < steps - 1:
            settled[:, k_set + 1:] += Vi[:, k_set][:, None]      # its value at its last date is what it paid
        rows.append({"v0": float(v0i), "horizon": _horizon(leg), "option": _is_option(leg),
                     "ee_gross_peak": float(np.max(np.mean(np.maximum(Vi, 0.0), axis=0))), **({"paths": Vi} if keep_leg_paths else {})})
    if noise_out is not None:
        noise_out.update(z=z, m=m, sigma=sigma, steps=steps, dt=dt, step_vols=sv, clock=ck, settled=settled if settled.any() else None,
                         lag=exact_lag(legs, parts, steps, dt, m, sv, V + settled, v0, ck))
    return V, p0, v0, rows


def package_addons(legs: list, csa: CSA, steps: int, dt: float) -> tuple[list[float], Optional[list[float]], list[float]]:
    """The capital add-on along the grid: the sum of each leg's own single-factor add-on while it is alive
    (SF × N_i × supervisory duration × maturity factor of its remaining life: what run_waterfall computes for a
    leg on its own), the same unmargined for the CRE52.2 cap, and the same for the CEM branch (SF × N_i × maturity
    factor). No offset between legs in the add-on: the replacement cost nets on the paths, the add-on does not."""
    from pricing.xva_engine import SF_IR
    grid, unm, cem = [], [], []
    for i in range(steps):
        t = (i + 1) * dt
        a = u = c = 0.0
        for leg in legs:
            m_t = max(_horizon(leg) - t, 0.0)
            if m_t <= 0:
                continue
            sd = (1.0 - math.exp(-0.05 * m_t)) / 0.05
            n = _leg_notional(leg)
            mf = csa.sa_ccr_maturity_factor(m_t)
            a += SF_IR * n * sd * mf
            u += SF_IR * n * sd * math.sqrt(min(max(m_t, 10.0 / 250.0), 1.0))
            c += SF_IR * n * mf
        grid.append(a)
        unm.append(u)
        cem.append(c)
    return grid, (unm if csa.sa_ccr_margined else None), cem


def saccr_rows(legs: list) -> list:
    """The legs as SA-CCR trades of their asset class (pricing/sa_ccr.py): foreign exchange (CRE52.35: the foreign
    leg in the domestic currency, at spot) or the cryptoasset class of SCO60.98 (the notional in fiat), one
    hedging set per pair; a forward at δ = ±1, an option at the supervisory delta of its strike with the class's
    supervisory volatility (CRE52.40; a barrier or a digital at its vanilla delta), an option with no strike (a
    touch) at ±1. A style whose size is a payout, not a notional, enters at its payout: the rules name no
    notional for it, and this is the engine's reading."""
    from pricing.sa_ccr import SUPERVISORY, SaccrTrade, supervisory_delta
    rows = []
    for n, leg in enumerate(legs, start=1):
        ac = "CRYPTO" if is_crypto(leg.pair) else "FX"
        bought = str(leg.direction).upper() == "BUY"
        if not _is_option(leg):
            N = abs(leg.base_notional) * float(leg.spot or leg.forward)
            rows.append(SaccrTrade(ac, leg.pair.upper(), N, 0.0, leg.t_years, leg.t_years, 1.0 if bought else -1.0, trade_ref=f"LEG {n}"))
            continue
        spec = leg.spec
        vanilla_size = spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER")
        N = abs(leg.base_notional) * float(leg.spot) if vanilla_size else abs(float(spec.payout or 0.0))
        K = float(spec.strike or 0.0)
        if K > 0 and spec.style != "TOUCH":
            delta = supervisory_delta(spec.option_type, bought, float(leg.spot), K, max(leg.t_expiry, 1.0 / 365.0), SUPERVISORY[ac]["vol"])
        else:
            delta = 1.0 if bought else -1.0
        rows.append(SaccrTrade(ac, leg.pair.upper(), N, 0.0, leg.t_settle, leg.t_settle, delta, trade_ref=f"LEG {n}"))
    return rows


def capital_inputs(legs: list, csa: CSA, steps: int, dt: float, capital_model: str, crypto_group: Optional[str]) -> dict:
    """What the waterfall's capital leg takes for these legs: {"kwargs": for run_waterfall, "basis": the rule in
    words, "group": '2a' | '2b' | None}. Under SA-CCR: the FX class for a currency pair; the crypto class for a
    Group 2a asset; for a Group 2b asset 50 % of each trade's gross notional while it is alive, taken whole (no
    hedging set, no multiplier: SCO60.99). The older CEM branch and the internal-model branch are as they were,
    with a package's legs each at their own remaining life."""
    pair = legs[0].pair
    group = crypto_group_of(pair, crypto_group)
    chosen = bool(str(crypto_group or "").strip())
    whose = "" if group is None else (" · set by the desk" if chosen else
                                      f" · the engine's default for {pair[:3].upper()}: a cryptoasset is Group 2b unless the bank has shown its supervisor the "
                                      "hedging recognition criteria (SCO60.55)" if group == "2a" else f" · the engine's default for {pair[:3].upper()} (SCO60.55)")
    cem = package_addons(legs, csa, steps, dt)[2] if len(legs) > 1 else None
    model = str(capital_model or "sa_ccr").lower()
    if model != "sa_ccr":
        return {"kwargs": {"addon_profiles": (None, None, cem)} if cem is not None else {}, "group": group,
                "basis": "CEM as this engine has it (0.5 % of notional × maturity factor)" if model == "cem" else "internal model: α × expected exposure"}
    rows = saccr_rows(legs)
    if group == "2b":
        grid = [sum(0.5 * r.notional for r in rows if r.maturity_y - (i + 1) * dt > 0) for i in range(steps)]
        return {"kwargs": {"addon_profiles": (grid, grid, cem), "apply_multiplier": False}, "group": group,
                "basis": "Group 2b cryptoasset: exposure = α × (replacement cost + 50 % of each trade's gross notional), no hedging set, no multiplier (SCO60.99)" + whose}
    return {"kwargs": {"saccr": rows, **({"addon_profiles": (None, None, cem)} if cem is not None else {})}, "group": group,
            "basis": ("Group 2a cryptoasset: SA-CCR with the crypto class, supervisory factor 32 %, option volatility 120 % (SCO60.98)" + whose if group == "2a"
                      else "SA-CCR, foreign exchange class, supervisory factor 4 % (CRE52.72)")}


def package_xva(legs: list, csa: CSA, *, n_paths: int = 2000, cp_cds_bp: float = 85.0, own_cds_bp: float = 42.0,
                ftp_bp: float = 55.0, fba_ratio: float = 0.55, lgd: float = 0.40, own_lgd: float = 0.40, hurdle_rate: float = 0.12,
                capital_model: str = "sa_ccr", counterparty_rw: float = 1.0, wwr_multiplier: float = 1.0, cp_cds_curve=None,
                own_cds_curve=None, ftp_curve=None, seed: int = 42, noise_out: Optional[dict] = None, waterfall_rng=None,
                im_amount: Optional[float] = None, cp_hazard_if_halves: float = 1.0, own_hazard_if_halves: float = 1.0,
                crypto_group: Optional[str] = None) -> tuple[WaterfallResult, dict]:
    """XVA of a package of legs on one pair as one netting set: the summed paths through the same waterfall.
    Initial margin is the desk's amount or the engine's estimate from the package's own paths, so it follows the
    legs as they settle; the capital add-on is SA-CCR's on the legs together (capital_inputs)."""
    noise_out = noise_out if noise_out is not None else {}
    paths, p0, v0, rows = simulate_package_paths(legs, n_paths=n_paths, seed=seed, noise_out=noise_out)
    wwr = wwr_of(np.log(noise_out["m"]), cp_hazard_if_halves, own_hazard_if_halves)
    longest = max(legs, key=_horizon)
    steps, dt = monthly_grid(_horizon(longest))
    cap = capital_inputs(legs, csa, steps, dt, capital_model, crypto_group)
    params = WaterfallParams(
        notional=sum(_leg_notional(l) for l in legs), maturity_y=_horizon(longest), dt=dt, theta=max(float(longest.quote_zero), 1e-6),
        lgd=lgd, own_lgd=own_lgd, cp_cds_bp=cp_cds_bp, own_cds_bp=own_cds_bp, cp_cds_curve=cp_cds_curve,
        own_cds_curve=own_cds_curve, ftp_bp=ftp_bp, ftp_curve=ftp_curve, fba_ratio=fba_ratio, hurdle_rate=hurdle_rate,
        capital_model=capital_model, counterparty_rw=counterparty_rw, wwr_multiplier=wwr_multiplier,
        im_amount=im_amount,
    )
    wf = run_waterfall(paths, v0, p0, params, csa, wrong_way=wwr, settled=noise_out.get("settled"), lag_values=noise_out["lag"], **cap["kwargs"],
                       **({"rng": waterfall_rng} if waterfall_rng is not None else {}))
    pillars = next((l.pillars for l in legs if l.pillars), None)
    sigma = float(longest.vol) if _is_option(longest) else _forward_sigma(longest)
    styles = sorted({l.spec.style for l in legs if _is_option(l)})
    meta = {"vol_pct": sigma * 100.0,
            "vol_source": "the longest leg's vol" + (f" ({longest.vol_source})" if getattr(longest, "vol_source", None) else ""),
            "vol_mode": ("ATM term structure of the surface for the paths" + ("; each option at the smile of each path's moneyness (sticky-delta)" if styles else "")) if pillars
                        else "flat (the longest leg's vol for the paths" + ("; each option at its own vol" if styles else "") + ")",
            "im_basis": wf.im_basis, "capital_basis": cap["basis"], "crypto_group": cap["group"],
            "steps": steps, "dt": dt, "n_paths": n_paths, "v0": v0, "p0_grid": [float(x) for x in p0], "_paths": paths, "_legs": rows,
            "wwr": wwr_meta(wf, cp_hazard_if_halves, own_hazard_if_halves),
            "model": f"{len(legs)} legs on one set of paths: every forward of the pair is its own forward times one lognormal driver, "
                     "so the legs net path by path; each leg valued as on its own (a forward's mark, an option's style in closed form); "
                     "a leg stays to the first grid date at or after its settlement and is nothing after"
                     + ("; barriers monitored at the grid points" if any(s in ("BARRIER", "DOUBLE_BARRIER", "TOUCH") for s in styles) else "")
                     + ("; American valued as European on the paths (a lower bound)" if "AMERICAN" in styles else "")
                     + ("; day by day the driver's vol moves between regimes (a stress of days on a level of weeks) with the same variance on average" if noise_out.get("clock") is not None else ""),
            "vol_regimes": regimes_meta(longest, sigma * 100.0) if noise_out.get("clock") is not None else None}
    return wf, meta
