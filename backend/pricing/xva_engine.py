"""
Rijeka — XVA waterfall engine.

Turns simulated MtM paths into exposure profiles and the XVA waterfall
(CVA, DVA, FVA, FBA, KVA, MVA) under a given CSA. Pure numpy; no I/O.
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


# ── ISDA SIMM — IR delta risk weights, regular-volatility currencies ─────────
# (USD/EUR/GBP). Units are bp, matching a sensitivity expressed as $ per bp,
# so IM = RW x |IR01| comes out in dollars. Calibrated to a 10bd MPoR.
SIMM_IR_RW = [
    (0.0384, 109.0),  # 2w
    (0.0833, 105.0),  # 1m
    (0.25,    90.0),  # 3m
    (0.50,    71.0),  # 6m
    (1.0,     66.0),
    (2.0,     66.0),
    (3.0,     64.0),
    (5.0,     61.0),
    (10.0,    61.0),
    (15.0,    61.0),
    (20.0,    61.0),
    (30.0,    64.0),
]

# SA-CCR constants
SF_IR  = 0.005    # supervisory factor, interest-rate asset class
ALPHA  = 1.4      # SA-CCR alpha
CAP_R  = 0.08     # capital / RWA


def simm_ir_risk_weight(maturity_y: float) -> float:
    """Linearly interpolated SIMM IR delta risk weight (bp) for a tenor in years."""
    pts = SIMM_IR_RW
    if maturity_y <= pts[0][0]:
        return pts[0][1]
    if maturity_y >= pts[-1][0]:
        return pts[-1][1]
    for (t0, w0), (t1, w1) in zip(pts, pts[1:]):
        if t0 <= maturity_y <= t1:
            f = (maturity_y - t0) / (t1 - t0)
            return w0 + f * (w1 - w0)
    return pts[-1][1]


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
    ftp_bp:          float = 55.0
    ftp_curve:       Optional[list] = None
    fba_ratio:       float = 0.55
    hurdle_rate:     float = 0.12
    capital_model:   str   = "sa_ccr"      # sa_ccr | cem | imm
    counterparty_rw: float = 1.0
    wwr_multiplier:  float = 1.0
    ir01:            Optional[float] = None    # $ per bp — drives SIMM IM
    simm_im_m:       Optional[float] = None    # explicit IM in $M (overrides SIMM)


@dataclass
class WaterfallResult:
    ee:   List[float]
    ene:  List[float]
    pfe:  List[float]
    ee_gross:  List[float]          # before collateral / IM
    ene_gross: List[float]
    collateral_mean: List[float]    # mean VM held, our perspective (+ = received)
    im_profile: List[float]         # IM posted / received (symmetric), per step
    exposure_paths: np.ndarray      # residual V − C (for visualisation)
    cva: float
    dva: float
    fva: float
    fba: float
    kva: float
    mva: float
    ead_0: float
    capital_0: float
    im_0: float
    simm_rw: float                  # MPoR-scaled risk weight actually used
    simm_rw_10d: float              # published (10bd) weight for reference
    mf_0: float                     # SA-CCR maturity factor at t=0
    bridge_noise: Optional[np.ndarray] = None   # the standard normals drawn for the margin-period bridge (n_paths, T)
    # the capital legs (pricing/capital.py): zero unless `capital` was passed
    kva_ccr: float = 0.0            # the CCR-capital leg of KVA (today's KVA when no CVA weight is given)
    kva_cva: float = 0.0            # the BA-CVA capital leg (MAR50.14–50.15) along the path
    k_cva_0: float = 0.0            # K_CVA at t = 0
    rwa_0: float = 0.0              # RW × EAD at t = 0
    addon_0: float = 0.0            # the aggregate SA-CCR add-on at t = 0
    rc_0: float = 0.0               # the replacement cost at t = 0
    multiplier_0: float = 1.0
    v_mean_0: float = 0.0           # mean mark at the first grid point (for the leverage exposure)
    coll_mean_0: float = 0.0        # mean variation margin held at the first grid point
    colva: float = 0.0              # carry of the variation margin held, against cash at OIS: + benefit, − cost
    regulatory_margined: bool = False

    @property
    def xva_total(self) -> float:
        return self.cva + self.dva + self.fva + self.fba + self.kva + self.mva + self.colva


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
) -> WaterfallResult:
    """
    Exposure profiles and XVA under `csa`. `paths` are MtM from our side
    (positive = counterparty owes us). p0_grid[k] = P(0, k·dt).

    `csa` is the economic CSA (what is exchanged: CVA, DVA, FVA, FBA, MVA). `reg_csa`, when given, is the
    regulatory CSA (pricing/collateral.py: recognised collateral at its haircut) and drives the SA-CCR branch;
    None means the two are the same, as before. `saccr` is the netting set as SaccrTrade rows
    (pricing/sa_ccr.py): the add-on is then the multi-class CRE52 add-on along the grid; None keeps the
    single-factor interest-rate add-on. `addon_profiles` is (add-on per grid step, the same unmargined or None),
    worked out by the caller: a package of legs hands in the sum of its legs' single-factor add-ons
    (pricing/fx_xva.package_xva); ignored when `saccr` is given. `capital` is a CapitalInputs (pricing/capital.py): the risk weight and
    hurdle replace the params' and the BA-CVA capital leg joins KVA; None keeps today's KVA exactly.
    """
    n_paths, T = paths.shape
    reg = reg_csa if reg_csa is not None else csa
    DT  = params.dt
    N   = params.notional
    M0  = params.maturity_y
    rng = rng or np.random.default_rng(seed=43)

    # ── Initial margin ───────────────────────────────────────────────────────
    rw_10d = simm_ir_risk_weight(M0)
    rw     = rw_10d * csa.simm_mpor_scale
    if not csa.im_exchanged:
        im_0 = 0.0
    elif params.simm_im_m is not None:
        im_0 = params.simm_im_m * 1e6
    elif params.ir01 is not None:
        im_0 = abs(params.ir01) * rw
    else:
        # Fallback when the caller has no IR01: IR01 ~ N x annuity x 1bp
        th = params.theta
        ann_0 = ((1.0 - math.exp(-th * M0)) / th if th > 0 else M0)
        im_0  = abs(N * ann_0 * 1e-4) * rw
    im_profile = [im_0 * max(M0 - (i + 1) * DT, 0.0) / M0 if M0 > 0 else 0.0
                  for i in range(T)]
    im_arr = np.asarray(im_profile)

    # ── Collateral and residual exposure ─────────────────────────────────────
    bridge = np.zeros_like(paths)
    v_lag = lagged_values(paths, v0, DT, csa.mpor_years, rng, noise_out=bridge) if csa.collateralised else None
    coll  = collateral_held(v_lag, csa) if v_lag is not None else np.zeros_like(paths)
    resid = paths - coll

    e_pos = np.maximum(resid - im_arr[None, :], 0.0)
    e_neg = np.minimum(resid + im_arr[None, :], 0.0)

    ee   = np.mean(e_pos, axis=0)
    ene  = np.mean(e_neg, axis=0)
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
    nica_arr = im_arr if reg.im_exchanged else np.zeros_like(im_arr)
    if saccr is not None:
        from pricing.sa_ccr import addon_profile
        grid_t = [(i + 1) * DT for i in range(T)]
        addon_grid = addon_profile(saccr, reg, grid_t)
        addon_grid_unm = addon_profile(saccr, CSA.uncollateralised(), grid_t) if reg.sa_ccr_margined else None
    elif addon_profiles is not None:
        addon_grid, addon_grid_unm = addon_profiles
    else:
        addon_grid = addon_grid_unm = None

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

    cva = dva = fva = fba = kva = mva = colva = 0.0
    qcp = qow = 1.0
    ead_0 = cap_0 = mf_0 = 0.0

    for i in range(T):
        t    = (i + 1) * DT
        disc = p0_grid[i + 1]
        cp_s = interp_spread(params.cp_cds_curve,  params.cp_cds_bp,  t)
        ow_s = interp_spread(params.own_cds_curve, params.own_cds_bp, t)
        ftp_t = interp_spread(params.ftp_curve, params.ftp_bp, t) if params.ftp_curve else ftp_flat
        fba_s = ftp_t * params.fba_ratio

        # Credit triangle: hazard = spread / LGD
        nqcp = math.exp(-(cp_s / lgd)     * t) if lgd     > 0 else 0.0
        nqow = math.exp(-(ow_s / own_lgd) * t) if own_lgd > 0 else 0.0

        # ColVA: the carry of the variation margin against cash at OIS (the discounting's own rate). Posted margin in
        # an asset yielding more than OIS earns the excess; held margin in an asset yielding less than the OIS rebate
        # costs the shortfall. Cash on both sides: zero.
        if s_post != 0.0 or s_recv != 0.0:
            colva += (post_mean[i] * s_post + recv_mean[i] * s_recv) * DT * disc
        cva += lgd     * ee[i]       * (qcp - nqcp) * disc * wwr
        dva -= own_lgd * abs(ene[i]) * (qow - nqow) * disc
        fva += ftp_t   * ee[i]       * DT * disc
        fba -= fba_s   * abs(ene[i]) * DT * disc

        # ── Capital profile → KVA ────────────────────────────────────────────
        m_t = max(M0 - t, 0.0)
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
                mult = min(1.0, 0.05 + 0.95 * math.exp(min(v_for_mult / (1.9 * addon), 50.0)))
            else:
                mult = 1.0
            if params.capital_model == "imm":
                ead_t = ALPHA * ee[i]
            elif params.capital_model == "cem":
                ead_t = rc_t + SF_IR * N * mf_t
            else:
                ead_t = ALPHA * (rc_t + mult * addon)
                if reg.sa_ccr_margined:
                    # CRE52.2: a margined netting set's EAD is capped at the same set unmargined (its collateral
                    # held, the unmargined maturity factor, RC = max(V − C, 0)); a large threshold or MTA floor
                    # cannot make margining worse than no margining
                    mf_u = math.sqrt(min(max(m_t, 10.0 / 250.0), 1.0))          # CRE52.48: M floored at ten business days
                    addon_u = addon_grid_unm[i] if addon_grid_unm is not None else SF_IR * N * sd_t * mf_u
                    v_u = float(resid_reg_mean[i]) - float(nica_arr[i])
                    mult_u = min(1.0, 0.05 + 0.95 * math.exp(min(v_u / (1.9 * addon_u), 50.0))) if addon_u > 0 else 1.0
                    ead_u = ALPHA * (max(v_u, 0.0) + mult_u * addon_u)
                    if ead_u < ead_t:
                        ead_t = ead_u
            k_t  = CAP_R * rw_cp * ead_t
            kva_ccr += hurdle * k_t * DT * disc
            if s_c > 0.0:
                # MAR50.15: SCVA = (1/α) S_c M EAD DF(M); MAR50.14: one counterparty, K = 0.65 · SCVA
                df_m = (1.0 - math.exp(-0.05 * m_t)) / (0.05 * m_t)
                k_cva_t = 0.65 * (1.0 / ALPHA) * s_c * m_t * ead_t * df_m
                kva_cva += hurdle * k_cva_t * DT * disc
            else:
                k_cva_t = 0.0
            kva += hurdle * (k_t + k_cva_t) * DT * disc
            if i == 0:
                ead_0, cap_0, mf_0 = ead_t, k_t, mf_t
                k_cva_0, rwa_0, addon_0, rc_0, mult_0 = k_cva_t, rw_cp * ead_t, addon, rc_t, mult

            # IM posted is funded at ftp less any yield the collateral earns
            mva -= im_arr[i] * max(ftp_t - pickup, 0.0) * DT * disc

        qcp, qow = nqcp, nqow

    return WaterfallResult(
        ee=ee.tolist(), ene=ene.tolist(), pfe=pfe.tolist(),
        ee_gross=ee_g.tolist(), ene_gross=ene_g.tolist(),
        collateral_mean=coll_mean.tolist(), im_profile=im_profile,
        exposure_paths=resid, bridge_noise=bridge,
        cva=-abs(cva), dva=abs(dva), fva=-abs(fva), fba=abs(fba),
        kva=-abs(kva), mva=-abs(mva), colva=float(colva),
        ead_0=ead_0, capital_0=cap_0, im_0=im_0,
        simm_rw=rw, simm_rw_10d=rw_10d, mf_0=mf_0,
        kva_ccr=-abs(kva_ccr), kva_cva=-abs(kva_cva), k_cva_0=k_cva_0, rwa_0=rwa_0, addon_0=addon_0, rc_0=rc_0,
        multiplier_0=mult_0, v_mean_0=float(v_mean[0]) if T else 0.0, coll_mean_0=float(coll_mean[0]) if T else 0.0,
        regulatory_margined=bool(reg.sa_ccr_margined),
    )
