"""
Rijeka — XVA waterfall engine.

Turns simulated MtM paths into exposure profiles and the XVA waterfall
(CVA, DVA, FCA, FBA, KVA, MVA, ColVA) under a given CSA. Pure numpy; no I/O.

Funding: FCA is the cost of funding what is owed to us and is not collateralised, FBA the benefit where we owe,
and FVA is the two together (FVA = FCA + FBA). Until 0.41.0 the cost alone was called FVA here and on every
screen; the figures are the same, the names are the ones the taxonomy fixes. (`WaterfallResult.fva` is the sum.
The key `fva` in an API response is not, yet: api/routes/xva.py LEGACY_FVA.)
The route (api/routes/xva.py) generates the paths and hands them here.

Grid convention (inherited from the route)
------------------------------------------
    paths[:, i]  = MtM at t_{i+1} = (i+1)·dt, i = 0..T-1, from OUR side
    v0           = MtM at t = 0 (the pricer's TV, or the model's own t=0 value)
    p0_grid[k]   = P(0, k·dt), k = 0..T+1
    disc(i)      = p0_grid[i+1]

Collateral lag (MPoR)
---------------------
VM held at t is what was called against V(t − δ), δ = MPoR. δ is generally
shorter than a grid step, so V(t − δ) is not on the grid. It is sampled
from the Brownian bridge between the two surrounding grid values:

    V(t−δ) | V(t−dt), V(t)  ~  N( V(t−dt) + w·ΔV ,  w(1−w)·s² )
    w = (dt − δ) / dt,  ΔV = V(t) − V(t−dt),  s² = Var(ΔV) across paths

This preserves the variance of the margin-period move (δ/dt · s²), which
linear interpolation alone would understate by a factor δ/dt.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

from pricing.csa import CSA


# ── Initial margin ───────────────────────────────────────────────────────────
# Rijeka does not compute ISDA SIMM: SIMM is ISDA's licensed methodology and its risk weights are not in this
# code. Initial margin is either an amount the desk sets (a firm with a SIMM licence enters its own figure) or
# the engine's own estimate from its simulated paths, at the confidence the margin rules for non-centrally
# cleared derivatives name (BCBS-IOSCO, "Margin requirements for non-centrally cleared derivatives": a
# one-tailed 99 per cent interval over the margin horizon). The estimate is this engine's model, not a
# regulatory or an ISDA figure.
IM_CONFIDENCE = 99.0


def model_im(paths: np.ndarray, v_lag: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(IM we would call, IM we would post) at every grid date: the 99th percentile, across paths, of the rise
    and of the fall in the set's value over the margin period ending at that date (V_i − V(t_i − δ)), about its
    mean. The mean is what every path does over the period (a scheduled payment, the passage of time): not a
    risk and not margined. Never negative."""
    move = paths - v_lag
    move = move - move.mean(axis=0, keepdims=True)
    return (np.maximum(np.percentile(move, IM_CONFIDENCE, axis=0), 0.0),
            np.maximum(np.percentile(-move, IM_CONFIDENCE, axis=0), 0.0))


# SA-CCR constants
SF_IR  = 0.005    # supervisory factor, interest-rate asset class
ALPHA  = 1.4      # SA-CCR alpha
CAP_R  = 0.08     # capital / RWA


def interp_spread(curve: Optional[list], flat_bp: float, t: float) -> float:
    """Linear interpolation of a spread term structure [{t, spread_bp}] at t, decimal."""
    if not curve:
        return flat_bp / 10000.0
    pts = sorted(curve, key=lambda x: x['t'])
    if t <= pts[0]['t']:
        return pts[0]['spread_bp'] / 10000.0
    if t >= pts[-1]['t']:
        return pts[-1]['spread_bp'] / 10000.0
    for a, b in zip(pts, pts[1:]):
        if a['t'] <= t <= b['t']:
            w = (t - a['t']) / (b['t'] - a['t'])
            return (a['spread_bp'] * (1 - w) + b['spread_bp'] * w) / 10000.0
    return flat_bp / 10000.0


def step_spread(curve: Optional[list], flat_bp: float, t0: float, t1: float) -> float:
    """The spread that applies over the step (t0, t1] of a curve quoted by tenor, as a decimal.

    A spread quoted for a tenor covers the whole of (0, t): it is a term spread, as the credit triangle reads a CDS
    curve (survival to t is exp(-s(t)/LGD * t)). The rate that applies over one step is then the forward between its
    two dates, [s(t1)*t1 - s(t0)*t0] / (t1 - t0). The funding curve is read the same way as the credit curve, so the
    two can be compared step by step. A flat spread is itself; a step whose forward would be negative (a steeply
    inverted curve) is charged nothing."""
    if not curve:
        return flat_bp / 10000.0
    s1 = interp_spread(curve, flat_bp, t1)
    s0 = interp_spread(curve, flat_bp, t0) if t0 > 0 else s1
    return max((s1 * t1 - s0 * t0) / (t1 - t0), 0.0) if t1 > t0 else s1


@dataclass
class WaterfallParams:
    notional:        float
    maturity_y:      float
    dt:              float
    theta:           float
    lgd:             float = 0.40
    own_lgd:         float = 0.40
    cp_cds_bp:       float = 85.0
    own_cds_bp:      float = 42.0
    cp_cds_curve:    Optional[list] = None
    own_cds_curve:   Optional[list] = None
    ftp_bp:          float = 55.0             # the desk's funding spread over OIS: its own credit spread plus a funding basis
    ftp_curve:       Optional[list] = None
    hurdle_rate:     float = 0.12
    capital_model:   str   = "sa_ccr"      # sa_ccr | cem | imm
    counterparty_rw: float = 1.0
    wwr_multiplier:  float = 1.0
    im_amount:       Optional[float] = None    # initial margin set by the desk, in the trade's currency, each way,
                                               # held for the life; None = the engine's estimate (model_im)


@dataclass
class WaterfallResult:
    ee:   List[float]
    ene:  List[float]
    pfe:  List[float]
    ee_gross:  List[float]          # before collateral / IM
    ene_gross: List[float]
    collateral_mean: List[float]    # mean VM held, our perspective (+ = received)
    im_profile: List[float]         # IM we post, per step (what MVA funds)
    exposure_paths: np.ndarray      # residual V − C (for visualisation)
    cva: float
    dva: float
    fca: float                      # funding cost adjustment (called `fva` until 0.41.0): the whole funding spread on what we are owed
    fba: float                      # funding benefit: the funding BASIS (funding spread less our own credit spread) on what we owe
    kva: float
    mva: float
    ead_0: float
    capital_0: float
    im_0: float
    mf_0: float                     # SA-CCR maturity factor over the first step
    bridge_noise: Optional[np.ndarray] = None   # the standard normals drawn for the margin-period bridge (n_paths, T)
    # the capital legs (pricing/capital.py): zero unless `capital` was passed
    kva_ccr: float = 0.0            # the CCR-capital leg of KVA (today's KVA when no CVA weight is given)
    kva_cva: float = 0.0            # the BA-CVA capital leg (MAR50.14–50.15) along the path
    # The capital stock: the first grid step's figures, with the remaining life read at the middle of that step and
    # the replacement cost and margin at its end. Not the valuation date's: on a short trade they depend on the grid.
    k_cva_0: float = 0.0            # K_CVA over the first step
    rwa_0: float = 0.0              # RW × EAD over the first step
    addon_0: float = 0.0            # the aggregate SA-CCR add-on over the first step
    rc_0: float = 0.0               # the replacement cost at the first grid point
    multiplier_0: float = 1.0
    v_mean_0: float = 0.0           # mean mark at the first grid point (for the leverage exposure)
    coll_mean_0: float = 0.0        # mean variation margin held at the first grid point
    colva: float = 0.0              # carry of the variation margin held, against cash at OIS: + benefit, − cost
    regulatory_margined: bool = False
    # wrong-way risk (path_survival): what CVA and DVA would be with default independent of the market; None when
    # the run had no link, so cva and dva ARE the independent figures
    cva_independent: Optional[float] = None
    dva_independent: Optional[float] = None
    # first to default (0.50.0): cva and dva above charge a party's default only while the other has not defaulted
    # first. These are the same sums without that weight (each party charged as if the other could not default):
    # what the engine reported until 0.50.0, and what a system that quotes unilateral CVA and DVA reports.
    cva_unilateral: float = 0.0
    dva_unilateral: float = 0.0
    im_received_profile: Optional[List[float]] = None   # IM we call, per step (what stands between us and their default)
    im_basis: str = "none"          # where the margin came from: none | set by the desk | the engine's estimate

    @property
    def xva_total(self) -> float:
        return self.cva + self.dva + self.fca + self.fba + self.kva + self.mva + self.colva

    @property
    def fva(self) -> float:
        """Funding valuation adjustment: the cost and the benefit together."""
        return self.fca + self.fba


# ── Wrong-way risk ───────────────────────────────────────────────────────────

def hazard_beta(hazard_if_halves: float) -> float:
    """The exponent b of h ∝ exp(b·x), x = ln(market variable / its forward), from the desk's input: the multiple
    the default intensity takes when the variable halves. 1 = independent (b = 0); 2 = the intensity doubles when
    it halves (b = −1) and halves when it doubles; below 1 = the intensity falls with the variable."""
    k = float(hazard_if_halves)
    if not (k > 0 and math.isfinite(k)):
        raise ValueError("the hazard multiple must be a positive number")
    return -math.log(k) / math.log(2.0)


def path_survival(x: np.ndarray, beta: float, q_mkt: List[float], dt: float) -> np.ndarray:
    """
    Survival to every grid date on every path when the default intensity moves with a market variable:
    Hull and White, "CVA and Wrong-Way Risk", Financial Analysts Journal 68(5), 2012.

        h_i(p) = c_i · exp(beta · x_i(p)),      q_i(p) = q_{i−1}(p) · exp(−h_i(p) · dt)

    x is (n_paths, T): the variable on the grid (here ln of the driver, the asset against its forward). c_i is
    solved date by date so that the MEAN survival across paths is the market's, q_mkt[i]: the credit curve is
    repriced exactly and beta only moves default probability between paths. Returns (n_paths, T + 1), column 0
    all ones. beta = 0 gives q_mkt on every path. Where the market curve implies no default in a step (its
    survival does not fall), no path defaults in it.
    """
    n, T = x.shape
    w = np.exp(np.clip(beta * np.asarray(x, dtype=float), -60.0, 60.0)) * dt
    q = np.ones((n, T + 1))
    for i in range(T):
        prev = q[:, i]
        base = float(prev.mean())
        target = float(q_mkt[i])
        if target <= 0.0:
            q[:, i + 1] = 0.0
            continue
        if target >= base - 1e-15:
            q[:, i + 1] = prev
            continue
        wi = w[:, i]
        c = max(-math.log(target / base) / max(float(np.dot(prev, wi)) / (base * n), 1e-300), 0.0)     # first-order start
        for _ in range(80):                   # Newton on f(c) = mean(prev · exp(−c·w)) − target: decreasing and convex
            e = prev * np.exp(-c * wi)
            f = float(e.mean()) - target
            if abs(f) < 1e-15:
                break
            step = f / float((e * wi).mean())
            c = c + step if c + step > 0 else c / 2.0
        q[:, i + 1] = prev * np.exp(-c * wi)
    return q


# ── Collateral ───────────────────────────────────────────────────────────────

def lagged_values(paths: np.ndarray, v0: float, dt: float, lag_y: float,
                  rng: np.random.Generator, noise_out: Optional[np.ndarray] = None) -> np.ndarray:
    """
    V(t_i − δ) for every grid time t_i = (i+1)·dt, via Brownian bridge.

    Returns an array the same shape as `paths`. Times before 0 clamp to v0
    (the trade is margined to its inception MtM).
    """
    n_paths, T = paths.shape
    if lag_y <= 0:
        return paths.copy()

    # Values on the extended grid including t=0
    ext = np.concatenate([np.full((n_paths, 1), v0), paths], axis=1)   # ext[:, k] = V(k·dt)

    steps_back = lag_y / dt
    k_full = int(math.floor(steps_back + 1e-12))
    frac   = steps_back - k_full                    # remaining fraction of a step

    out = np.empty_like(paths)
    for i in range(T):
        k = i + 1                                   # grid index of t_i in `ext`
        j = k - k_full                              # index of the grid point at or after t_i − δ
        if frac < 1e-12:
            out[:, i] = ext[:, max(j, 0)]
            continue
        # t_i − δ lies in (t_{j-1}, t_j); w = position measured from t_{j-1}
        w  = 1.0 - frac
        hi = ext[:, max(j, 0)]
        lo = ext[:, max(j - 1, 0)]
        dv = hi - lo
        s2 = float(np.var(dv))
        z = rng.standard_normal(n_paths)
        if noise_out is not None:
            noise_out[:, i] = z                     # the draw itself; the replication rescales it the same way
        noise = z * math.sqrt(max(w * (1.0 - w) * s2, 0.0))
        out[:, i] = lo + w * dv + noise
    return out


def collateral_held(v_lag: np.ndarray, csa: CSA) -> np.ndarray:
    """
    VM held against lagged MtM, our perspective (+ = we hold their collateral).
    Thresholds and MTA applied per the CSA.
    """
    if not csa.collateralised:
        return np.zeros_like(v_lag)
    recv = np.maximum(v_lag - csa.threshold_cp, 0.0)
    post = np.maximum(-v_lag - csa.threshold_own, 0.0)
    c = recv - post
    if csa.mta > 0:
        c = np.where(np.abs(c) < csa.mta, 0.0, c)
    return c


# ── Waterfall ────────────────────────────────────────────────────────────────

def run_waterfall(
    paths:   np.ndarray,
    v0:      float,
    p0_grid: List[float],
    params:  WaterfallParams,
    csa:     CSA,
    rng:     Optional[np.random.Generator] = None,
    *,
    reg_csa: Optional[CSA] = None,
    capital=None,
    saccr: Optional[list] = None,
    addon_profiles: Optional[tuple] = None,
    apply_multiplier: bool = True,
    wrong_way: Optional[dict] = None,
    settled: Optional[np.ndarray] = None,
    lag_values=None,
    average_exposure: bool = False,
) -> WaterfallResult:
    """
    Exposure profiles and XVA under `csa`. `paths` are MtM from our side
    (positive = counterparty owes us). p0_grid[k] = P(0, k·dt).

    `csa` is the economic CSA (what is exchanged: CVA, DVA, FCA, FBA, MVA). `reg_csa`, when given, is the
    regulatory CSA (pricing/collateral.py: recognised collateral at its haircut) and drives the SA-CCR branch;
    None means the two are the same, as before. `saccr` is the netting set as SaccrTrade rows
    (pricing/sa_ccr.py): the add-on is then the multi-class CRE52 add-on along the grid; None keeps the
    single-factor interest-rate add-on. `addon_profiles` is (add-on per grid step, the same unmargined or None,
    the CEM add-on per grid step or None), worked out by the caller: a package of legs hands in the sum of its
    legs' single-factor add-ons (pricing/fx_xva.package_xva); with `saccr` given only its CEM element is read. `apply_multiplier` False takes
    the add-on whole, without the CRE52.23 multiplier: a Group 2b cryptoasset, whose exposure is α·(RC + PFE)
    with the PFE a fixed share of notional (SCO60.99). `wrong_way` is wrong-way risk:
    {"x": (n_paths, T) the market variable on the grid, "beta_cp": b, "beta_own": b} (hazard_beta, path_survival).
    CVA is then LGD · Σ E[exposure_i · default probability in step i ON THAT PATH] and DVA likewise with our own
    default; the result also carries both with default independent of the market. None, or both betas zero, is
    today's calculation exactly. `settled` is (n_paths, T): the cash that has settled out of the set by each grid
    date, per path (a leg of a package that has paid). The value a margin period earlier is then read on the set
    with that cash still in it, and the cash taken off again: a settlement is a payment, not a move, so it is
    neither margined nor left standing as collateral for a step. None: no leg settles before the end. `lag_values`
    is the caller's own value of the set a margin period before every grid date, with what has settled still in
    it: lag_values(lag_years, rng, noise_out) -> (n_paths, T), drawing one standard normal per path and date from
    `rng` as lagged_values does. A caller that knows what drives the value hands it in (pricing/fx_xva.exact_lag:
    the asset bridged between grid dates where it is lognormal, the trade valued there); None is the bridge
    between the grid values themselves (lagged_values), which is Gaussian whatever the value is. `capital` is a CapitalInputs (pricing/capital.py): the risk weight and
    hurdle replace the params' and the BA-CVA capital leg joins KVA; None keeps today's KVA exactly.

    `average_exposure`: CVA, DVA, FCA and FBA are charged on the exposure averaged across each step (the mean of
    the step's two ends, the first step starting from today's exposure) and not on the exposure at the step's end.
    The exposure of a forward grows like the square root of time, and reading it at each step's end overstates
    the charge: by a quarter on a one-month trade on two steps. The profiles reported (ee, ene, pfe) stay the
    values at the grid dates. Currency and digital-asset tickets pass True (pricing/fx_xva.py, 0.28.0); a swap's
    waterfall and the netting-set engine keep the step's end.
    """
    n_paths, T = paths.shape
    reg = reg_csa if reg_csa is not None else csa
    DT  = params.dt
    N   = params.notional
    M0  = params.maturity_y
    rng = rng or np.random.default_rng(seed=43)

    # ── Collateral ───────────────────────────────────────────────────────────
    bridge = np.zeros_like(paths)
    whole = paths if settled is None else paths + settled        # the set with what has settled still in it: no jump at a settlement
    def lag_of(gen, noise=None):
        if lag_values is not None:
            return lag_values(csa.mpor_years, gen, noise)
        return lagged_values(whole, v0, DT, csa.mpor_years, gen, noise_out=noise)
    v_lag = lag_of(rng, bridge) if csa.collateralised else None
    if v_lag is not None and settled is not None:
        v_lag = v_lag - settled
    coll  = collateral_held(v_lag, csa) if v_lag is not None else np.zeros_like(paths)
    resid = paths - coll

    # ── Initial margin: the desk's amount, or the engine's estimate (model_im) ─
    im_recv = im_post = np.zeros(T)
    im_basis = "none"
    if csa.im_exchanged and params.im_amount is not None:
        im_recv = im_post = np.full(T, abs(float(params.im_amount)))
        im_basis = "set by the desk, each way, held for the life"
    elif csa.im_exchanged and T:
        # the value a margin period earlier: the lag already drawn for the variation margin, else one of its own
        # (its own generator, so no other number of the run depends on whether IM is exchanged)
        lag = v_lag if v_lag is not None else lag_of(np.random.default_rng(seed=44)) - (0.0 if settled is None else settled)
        im_recv, im_post = model_im(paths, lag)
        im_basis = (f"the engine's estimate: the {IM_CONFIDENCE:g}th percentile move of the value over the margin period "
                    f"({csa.mpor_days:g} business days), each way; not ISDA SIMM")
    im_0 = float(im_post[0]) if T else 0.0
    im_profile = [float(x) for x in im_post]

    # ── Residual exposure ────────────────────────────────────────────────────
    e_pos = np.maximum(resid - im_recv[None, :], 0.0)
    e_neg = np.minimum(resid + im_post[None, :], 0.0)

    ee   = np.mean(e_pos, axis=0)
    ene  = np.mean(e_neg, axis=0)
    # What the four exposure charges read at step i: the step's end, or the mean of its two ends. Today's exposure
    # is today's value less the collateral that value calls (there is no earlier value to lag to), with the first
    # date's initial margin.
    if average_exposure and T:
        r0 = float(v0) - float(collateral_held(np.array([[float(v0)]]), csa)[0, 0]) if csa.collateralised else float(v0)
        p0_, n0_ = max(r0 - float(im_recv[0]), 0.0), min(r0 + float(im_post[0]), 0.0)
        # A step starts where the last one ended, less what was paid on that date: a leg of a package stands at the
        # amount it settled on its date and is gone after, so the step after it must not start with it still owed
        # (Emmy, 12 Nov 2026: half the paid leg would have been charged for one more step).
        if settled is not None and T > 1:
            start = resid[:, :-1] - (settled[:, 1:] - settled[:, :-1])
            s_pos = np.maximum(start - im_recv[None, :-1], 0.0)
            s_neg = np.minimum(start + im_post[None, :-1], 0.0)
        else:
            s_pos, s_neg = e_pos[:, :-1], e_neg[:, :-1]
        c_pos = 0.5 * (np.column_stack((np.full(n_paths, p0_), s_pos)) + e_pos)
        c_neg = 0.5 * (np.column_stack((np.full(n_paths, n0_), s_neg)) + e_neg)
        ee_c, ene_c = np.mean(c_pos, axis=0), np.mean(c_neg, axis=0)
    else:
        c_pos, c_neg, ee_c, ene_c = e_pos, e_neg, ee, ene
    pfe  = np.percentile(resid, 95, axis=0)
    ee_g = np.mean(np.maximum(paths, 0.0), axis=0)
    ene_g= np.mean(np.minimum(paths, 0.0), axis=0)
    coll_mean  = np.mean(coll, axis=0)
    recv_mean  = np.mean(np.maximum(coll, 0.0), axis=0)      # their collateral we hold
    post_mean  = np.mean(np.maximum(-coll, 0.0), axis=0)     # ours they hold

    # the regulatory view of the collateral: recognised at its haircut, or nothing
    if reg.sa_ccr_margined and csa.collateralised:
        coll_reg_mean = coll_mean * (1.0 - reg.collateral_haircut)
    else:
        coll_reg_mean = np.zeros_like(coll_mean)
    v_mean = np.mean(paths, axis=0)
    resid_reg_mean = v_mean - coll_reg_mean
    nica_arr = im_recv if reg.im_exchanged else np.zeros(T)      # the margin we hold: independent collateral
    if saccr is not None:
        from pricing.sa_ccr import addon_profile
        grid_t = [(i + 0.5) * DT for i in range(T)]            # the middle of each step: see the capital profile below
        addon_grid = addon_profile(saccr, reg, grid_t)
        addon_grid_unm = addon_profile(saccr, CSA.uncollateralised(), grid_t) if reg.sa_ccr_margined else None
        addon_cem = addon_profiles[2] if addon_profiles is not None and len(addon_profiles) > 2 else None
    elif addon_profiles is not None:
        addon_grid, addon_grid_unm = addon_profiles[0], addon_profiles[1]
        addon_cem = addon_profiles[2] if len(addon_profiles) > 2 else None
    else:
        addon_grid = addon_grid_unm = addon_cem = None

    # ── Waterfall loop ───────────────────────────────────────────────────────
    lgd, own_lgd = params.lgd, params.own_lgd
    hurdle, wwr  = params.hurdle_rate, params.wwr_multiplier
    rw_cp        = params.counterparty_rw
    s_c          = 0.0
    if capital is not None:
        rw_cp, hurdle, s_c = float(capital.rw), float(capital.hurdle), float(capital.s_c)
    kva_ccr = kva_cva = 0.0
    k_cva_0 = rwa_0 = addon_0 = rc_0 = 0.0
    mult_0 = 1.0
    ftp_flat     = params.ftp_bp / 10000.0
    pickup       = csa.im_yield_pickup_bp / 10000.0
    s_post       = float(getattr(csa, "vm_post_carry_bp", 0.0) or 0.0) / 10000.0     # the VM we post earns this over OIS
    s_recv       = float(getattr(csa, "vm_recv_carry_bp", 0.0) or 0.0) / 10000.0     # the VM we hold earns this over the OIS we rebate

    cva = dva = fca = fba = kva = mva = colva = 0.0
    # wrong-way risk: default probability per step on each path, the credit curves repriced on average
    b_cp = float((wrong_way or {}).get("beta_cp") or 0.0)
    b_ow = float((wrong_way or {}).get("beta_own") or 0.0)
    dpd_cp = dpd_ow = None
    s_cp_path = s_ow_path = None          # survival on each path, (n_paths, T + 1), for a party whose default is linked
    cva_ind = dva_ind = cva_uni = dva_uni = 0.0
    if wrong_way is not None and (b_cp != 0.0 or b_ow != 0.0):
        x_w = np.asarray(wrong_way["x"], dtype=float)
        if x_w.shape != paths.shape:
            raise ValueError(f"wrong_way x is {x_w.shape}, the paths are {paths.shape}")

        def _mkt(curve, flat, l):
            return [math.exp(-(interp_spread(curve, flat, (k + 1) * DT) / l) * (k + 1) * DT) if l > 0 else 0.0 for k in range(T)]
        if b_cp != 0.0:
            s_cp_path = path_survival(x_w, b_cp, _mkt(params.cp_cds_curve, params.cp_cds_bp, lgd), DT)
            dpd_cp = s_cp_path[:, :-1] - s_cp_path[:, 1:]
        if b_ow != 0.0:
            s_ow_path = path_survival(x_w, b_ow, _mkt(params.own_cds_curve, params.own_cds_bp, own_lgd), DT)
            dpd_ow = s_ow_path[:, :-1] - s_ow_path[:, 1:]
    qcp = qow = 1.0
    ead_0 = cap_0 = mf_0 = 0.0

    for i in range(T):
        t    = (i + 1) * DT
        disc = p0_grid[i + 1]
        cp_s = interp_spread(params.cp_cds_curve,  params.cp_cds_bp,  t)
        ow_s = interp_spread(params.own_cds_curve, params.own_cds_bp, t)
        # the funding spread over this step: the forward of a curve quoted by tenor (step_spread), a flat spread as it is
        ftp_t = step_spread(params.ftp_curve, params.ftp_bp, t - DT, t) if params.ftp_curve else ftp_flat
        # The funding benefit and DVA are not two benefits. On what we owe, DVA already credits us with our own credit
        # spread (own LGD x default probability is that spread over the step). The funding spread is that credit spread
        # plus a basis (what our funding costs beyond our credit: liquidity), so a benefit at the whole funding spread
        # would count the credit part a second time. FBA is therefore charged at the basis alone, floored at zero:
        # a desk that funds at its credit spread has no funding benefit beyond its DVA. (Morini and Prampolini, "Risky Funding:
        # A Unified Framework for Counterparty and Liquidity Charges"; Burgard and Kjaer, "In the Balance" and "Funding
        # Strategies, Funding Costs", Risk. Until 0.49.0 the benefit was a fixed 55 % of the funding spread, whatever
        # the desk's own spread was.) The cost is not netted: on what we are owed the credit is the counterparty's (CVA).

        # Credit triangle: hazard = spread / LGD. Survival never rises: where a curve would have it rise (a steeply
        # inverted curve) it is held where it stood, as path_survival holds it, so that step defaults nobody and the
        # default probabilities of all the steps sum to one less the lowest survival, never more.
        nqcp = min(math.exp(-(cp_s / lgd)     * t) if lgd     > 0 else 0.0, qcp)
        nqow = min(math.exp(-(ow_s / own_lgd) * t) if own_lgd > 0 else 0.0, qow)
        dq_cp, dq_ow = qcp - nqcp, qow - nqow
        # Our own credit spread over this step, as DVA charges it: own LGD x the step's hazard, which on a curve
        # quoted by tenor is the forward spread and on a flat one the spread itself. The basis is the funding spread
        # of the same step less that, so what DVA credits and what FBA credits add to the funding spread, step by step.
        # (a flat spread is taken as it is: read back through a logarithm it would differ in the last digits, and a
        # desk that funds exactly at its credit spread would show a benefit of a millionth of a cent)
        own_t = own_lgd * (-math.log(nqow / qow)) / DT if (params.own_cds_curve and qow > 0 and nqow > 0) else ow_s
        basis_t = max(ftp_t - own_t, 0.0)
        # Funding is paid and earned only while the trade is alive: neither party has defaulted. The step is weighted
        # by the chance both survive it, read at its middle, on the curves as the market has them (default independent
        # of the market here, also when CVA and DVA carry wrong-way risk).
        alive = 0.5 * (qcp * qow + nqcp * nqow)

        # ColVA: the carry of the variation margin against cash at OIS (the discounting's own rate). Posted margin in
        # an asset yielding more than OIS earns the excess; held margin in an asset yielding less than the OIS rebate
        # costs the shortfall. Cash on both sides: zero.
        if s_post != 0.0 or s_recv != 0.0:
            colva += (post_mean[i] * s_post + recv_mean[i] * s_recv) * DT * disc
        # Every adjustment is accumulated with its own sign (a cost negative, a benefit positive) and reported as it
        # was accumulated: nothing is made positive or negative at the end, so a sign that came out wrong would show.
        # ee_c is what we are owed (>= 0), ene_c what we owe (<= 0).
        #
        # First to default (0.50.0). The counterparty's default costs us only if we have not defaulted before it,
        # and our own default is a gain to us only if the counterparty has not defaulted before us:
        #     CVA = −LGD_cp  · E[ 1{τ_cp ≤ T, τ_cp < τ_own} · D(τ_cp)  · V⁺(τ_cp) ]
        #     DVA = +LGD_own · E[ 1{τ_own ≤ T, τ_own < τ_cp} · D(τ_own) · V⁻(τ_own) ]
        # With the two defaults independent of each other (given the market path), the condition is the other
        # party's survival at the moment of default: each step's default probability is weighted by the other's
        # survival at the middle of the step, the rule the funding legs' weight already uses. Where a party's default
        # is linked to the market (path_survival) its survival is read on each path, in its own default probability
        # and in the weight on the other's. (Brigo and Capponi, "Bilateral counterparty risk valuation with
        # stochastic dynamical models", 2008; Gregory, "The xVA Challenge"; in Burgard and Kjaer the same
        # weight comes from discounting at r + λ_own + λ_cp.) Until 0.50.0 neither carried the weight, so the
        # own-credit part of the funding benefit, which is in DVA, was weighted by our survival alone while the
        # basis part, in FBA, was weighted by both parties'.
        mid_cp, mid_ow = 0.5 * (qcp + nqcp), 0.5 * (qow + nqow)
        if s_cp_path is None and s_ow_path is None:
            cva_uni -= lgd     * ee_c[i]    * dq_cp * disc * wwr
            dva_uni += own_lgd * (-ene_c[i]) * dq_ow * disc
            cva -= lgd     * ee_c[i]    * dq_cp * mid_ow * disc * wwr
            dva += own_lgd * (-ene_c[i]) * dq_ow * mid_cp * disc
        else:
            d_cp = dpd_cp[:, i] if dpd_cp is not None else dq_cp                 # default in the step: per path, or the curve's
            d_ow = dpd_ow[:, i] if dpd_ow is not None else dq_ow
            m_cp = 0.5 * (s_cp_path[:, i] + s_cp_path[:, i + 1]) if s_cp_path is not None else mid_cp
            m_ow = 0.5 * (s_ow_path[:, i] + s_ow_path[:, i + 1]) if s_ow_path is not None else mid_ow
            cva_uni -= lgd     * float(np.mean(c_pos[:, i]  * d_cp)) * disc * wwr
            dva_uni += own_lgd * float(np.mean(-c_neg[:, i] * d_ow)) * disc
            cva -= lgd     * float(np.mean(c_pos[:, i]  * d_cp * m_ow)) * disc * wwr
            dva += own_lgd * float(np.mean(-c_neg[:, i] * d_ow * m_cp)) * disc
            # What a tied party's charge would be with ITS default independent of the market and the other party as
            # it is: its default probability from the curve, the weight still the other's survival (on the path
            # when the other is tied too). So the difference from the charge is that party's link alone, also when
            # both are tied. (The independent reviewer, 17 November 2026: with both links off in this figure, the
            # screen's "if independent" beside a weakly tied counterparty also took out a strongly tied desk's
            # effect on the weight, and could name the wrong direction.)
            cva_ind -= lgd     * float(np.mean(c_pos[:, i]  * m_ow)) * dq_cp * disc * wwr
            dva_ind += own_lgd * float(np.mean(-c_neg[:, i] * m_cp)) * dq_ow * disc
        fca -= ftp_t   * ee_c[i]     * alive * DT * disc
        fba += basis_t * (-ene_c[i]) * alive * DT * disc

        # ── Capital profile → KVA ────────────────────────────────────────────
        # Capital and initial margin are held through the step, so the remaining life is read at the middle of it:
        # the step that ends on the maturity is charged like every other. (Until 0.27.0 it was read at the step's
        # end, where it is zero on the last step: that step carried no capital and no margin funding, which on a
        # monthly grid is half the KVA of a one-month trade whose add-on does not shrink to nothing at maturity.)
        m_t = max(M0 - t + 0.5 * DT, 0.0)
        if m_t > 0:
            sd_t  = (1.0 - math.exp(-0.05 * m_t)) / 0.05          # supervisory duration
            mf_t  = reg.sa_ccr_maturity_factor(m_t)
            addon = addon_grid[i] if addon_grid is not None else SF_IR * N * sd_t * mf_t
            if reg.sa_ccr_margined:
                nica = float(nica_arr[i])
                rc_t = max(float(resid_reg_mean[i]),
                           reg.threshold_cp + reg.mta - nica, 0.0)
                v_for_mult = float(resid_reg_mean[i]) - nica
            else:
                rc_t = max(float(resid_reg_mean[i]), 0.0)
                v_for_mult = float(resid_reg_mean[i])
            if addon > 0:
                # the multiplier is capped at 1, so the exponent can be capped without changing it: an exposure far
                # above the add-on (a digital's payout against a tiny add-on) must not overflow
                mult = min(1.0, 0.05 + 0.95 * math.exp(min(v_for_mult / (1.9 * addon), 50.0))) if apply_multiplier else 1.0
            else:
                mult = 1.0
            if params.capital_model == "imm":
                ead_t = ALPHA * ee[i]
            elif params.capital_model == "cem":
                ead_t = rc_t + (addon_cem[i] if addon_cem is not None else SF_IR * N * mf_t)
            else:
                ead_t = ALPHA * (rc_t + mult * addon)
                if reg.sa_ccr_margined:
                    # CRE52.2: a margined netting set's EAD is capped at the same set unmargined (its collateral
                    # held, the unmargined maturity factor, RC = max(V − C, 0)); a large threshold or MTA floor
                    # cannot make margining worse than no margining
                    mf_u = math.sqrt(min(max(m_t, 10.0 / 250.0), 1.0))          # CRE52.48: M floored at ten business days
                    addon_u = addon_grid_unm[i] if addon_grid_unm is not None else SF_IR * N * sd_t * mf_u
                    v_u = float(resid_reg_mean[i]) - float(nica_arr[i])
                    mult_u = min(1.0, 0.05 + 0.95 * math.exp(min(v_u / (1.9 * addon_u), 50.0))) if (addon_u > 0 and apply_multiplier) else 1.0
                    ead_u = ALPHA * (max(v_u, 0.0) + mult_u * addon_u)
                    if ead_u < ead_t:
                        ead_t = ead_u
            k_t  = CAP_R * rw_cp * ead_t
            kva_ccr -= hurdle * k_t * DT * disc
            if s_c > 0.0:
                # MAR50.15: SCVA = (1/α) S_c M EAD DF(M); MAR50.14: one counterparty, K = 0.65 · SCVA
                df_m = (1.0 - math.exp(-0.05 * m_t)) / (0.05 * m_t)
                k_cva_t = 0.65 * (1.0 / ALPHA) * s_c * m_t * ead_t * df_m
                kva_cva -= hurdle * k_cva_t * DT * disc
            else:
                k_cva_t = 0.0
            kva -= hurdle * (k_t + k_cva_t) * DT * disc
            if i == 0:
                ead_0, cap_0, mf_0 = ead_t, k_t, mf_t
                k_cva_0, rwa_0, addon_0, rc_0, mult_0 = k_cva_t, rw_cp * ead_t, addon, rc_t, mult

            # IM posted is funded at ftp less any yield the collateral earns
            mva -= im_post[i] * max(ftp_t - pickup, 0.0) * DT * disc

        qcp, qow = nqcp, nqow

    return WaterfallResult(
        ee=ee.tolist(), ene=ene.tolist(), pfe=pfe.tolist(),
        ee_gross=ee_g.tolist(), ene_gross=ene_g.tolist(),
        collateral_mean=coll_mean.tolist(), im_profile=im_profile,
        exposure_paths=resid, bridge_noise=bridge,
        cva=float(cva), dva=float(dva), fca=float(fca), fba=float(fba),
        kva=float(kva), mva=float(mva), colva=float(colva),
        ead_0=ead_0, capital_0=cap_0, im_0=im_0,
        mf_0=mf_0, im_received_profile=[float(x) for x in im_recv], im_basis=im_basis,
        kva_ccr=float(kva_ccr), kva_cva=float(kva_cva), k_cva_0=k_cva_0, rwa_0=rwa_0, addon_0=addon_0, rc_0=rc_0,
        multiplier_0=mult_0, v_mean_0=float(v_mean[0]) if T else 0.0, coll_mean_0=float(coll_mean[0]) if T else 0.0,
        regulatory_margined=bool(reg.sa_ccr_margined),
        # a party that is not tied has no independent figure of its own: its charge is already on its curve (it
        # still moves a little with the OTHER party's link, through the weight; the run without any link is that
        # run, not a figure of this one)
        cva_independent=(float(cva_ind) if dpd_cp is not None else None),
        dva_independent=(float(dva_ind) if dpd_ow is not None else None),
        cva_unilateral=float(cva_uni), dva_unilateral=float(dva_uni),
    )
