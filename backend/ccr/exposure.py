"""The counterparty's CSA on the netted value, then the exposure measures.

E⁺(t) = max(V − C − IM, 0) with C the variation margin held against the lagged value (the
same collateral model as the XVA engine), IM when the CSA exchanges it. EE is the mean of
E⁺, PFE_q its q-quantile across paths, EPE the time average of EE over the first year, the
peak the largest PFE and when. CVA comes from the risk-neutral paths through the XVA
waterfall with the counterparty's default spread."""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, collateral_held, lagged_values, run_waterfall, model_im

QUANTILES = (95.0, 97.5, 99.0)
BUCKETS = (("0-1Y", 0.0, 1.0001), ("1-5Y", 1.0001, 5.0001), ("5-10Y", 5.0001, 10.0001), ("10Y+", 10.0001, 1e9))


def mpor_from_terms(margin_frequency_days=None, disputed=False) -> float:
    """CRE52.50: re-margining every N business days gives an MPoR of 9 + N, floored at 10; CRE52.51: more than two
    margin disputes in two quarters doubles the floor."""
    n = int(margin_frequency_days or 1)
    mpor = max(10.0, 9.0 + n)
    return mpor * (2.0 if disputed else 1.0)


def csa_from_counterparty(cp) -> CSA:
    """The CSA as the counterparty record states it: NO_CSA → uncollateralised; VM or VM_IM → variation margin with the
    record's threshold and MTA, the MPoR from its margin frequency and dispute state (10bd when unset), IM when the
    type says so."""
    kind = str(getattr(cp, "csa_type", None) or "NO_CSA").upper()
    if kind in ("NO_CSA", "NONE", ""):
        return CSA.uncollateralised()
    thr = float(getattr(cp, "csa_threshold_m", None) or 0.0) * 1e6
    mta = float(getattr(cp, "csa_mta_k", None) or 0.0) * 1e3
    im = "IM" in kind
    mpor = mpor_from_terms(getattr(cp, "margin_frequency_days", None), bool(getattr(cp, "mpor_disputed", None) or False))
    return CSA(preset=kind, collateralised=True, threshold_cp=thr, threshold_own=thr, mta=mta, mpor_days=mpor, im_exchanged=im)


def paid_by(flows: Optional[np.ndarray]) -> Optional[np.ndarray]:
    """The jumps the payments have made in V by each grid date after the first, (paths or 1, T), from flows_per_step's
    array (one number per step, or per path and step); None for none."""
    if flows is None:
        return None
    fl = np.asarray(flows, dtype=float)
    return np.cumsum(fl if fl.ndim == 2 else fl[None, :], axis=1)[:, 1:]


def exposures(V: np.ndarray, t: np.ndarray, csa: CSA, seed: int = 11, flows: Optional[np.ndarray] = None) -> dict[str, Any]:
    """flows[i], or flows[path, i]: net trade flow paid in (t_{i−1}, t_i], as the jump it makes in V (one number per
    step, or one per path and step: a floating coupon is the path's own). The value a margin period back is drawn
    by a bridge between grid dates, and the bridge takes its noise from the spread of the step's change: with a
    coupon in the step that spread is the coupon's, not the market's. So the bridge is drawn on the value with
    its payments taken out, and the payments made by each date are put back: the margin call saw the payment or
    settles with it, and a coupon is not a market move over the margin period. (Until 0.51.0 the bridge was drawn
    on the value as it stood and the mean was put right afterwards: the noise of the coupon stayed, and the
    margined exposure at a payment date of a yearly swap stood up to several times what the market leaves over
    ten days. The model validator, 17 November 2026.)"""
    n_paths, T1 = V.shape
    dt = float(t[1] - t[0]) if T1 > 1 else 1 / 12
    rng = np.random.default_rng(seed)
    v0 = float(V[:, 0].mean())
    future = V[:, 1:]
    v_lag = None
    if csa.collateralised:
        paid = paid_by(flows)
        v_lag = lagged_values(future if paid is None else future - paid, v0, dt, csa.mpor_years, rng)
        if paid is not None:
            v_lag = v_lag + paid
        coll = collateral_held(v_lag, csa)
    else:
        coll = np.zeros_like(future)
    # the margin we would call: the engine's estimate from these paths (the 99th percentile rise over the margin period)
    if csa.im_exchanged and T1 > 1:
        lag = v_lag if v_lag is not None else lagged_values(future, v0, dt, csa.mpor_years, np.random.default_rng(seed + 33))
        im = model_im(future, lag)[0]
    else:
        im = np.zeros(T1 - 1)
    im0_usd = float(im[0]) if len(im) else 0.0
    resid = future - coll
    e_pos = np.maximum(resid - im[None, :], 0.0)
    ee = e_pos.mean(axis=0)
    pfe = {f"{q:g}": np.percentile(e_pos, q, axis=0) for q in QUANTILES}
    first_year = max(1, int(round(1.0 / dt)))
    epe = float(ee[:first_year].mean()) if len(ee) else 0.0
    k = int(np.argmax(pfe["95"])) if len(ee) else 0
    c0 = float(coll[:, 0].mean()) if csa.collateralised else 0.0
    buckets = {}
    for name, lo, hi in BUCKETS:
        idx = [i for i, tt in enumerate(t[1:]) if lo <= tt < hi]
        buckets[name] = float(pfe["95"][idx].max()) if idx else 0.0
    return {"v0_usd": v0, "collateral_now_usd": c0, "current_exposure_usd": max(v0 - c0, 0.0),
            "ee": ee.tolist(), "pfe": {q: a.tolist() for q, a in pfe.items()}, "epe_1y_usd": epe,
            "peak_pfe95_usd": float(pfe["95"][k]) if len(ee) else 0.0, "peak_at_years": float(t[1 + k]) if len(ee) else 0.0,
            "pfe95_by_bucket": buckets, "im0_usd": float(im0_usd), "mean_collateral": coll.mean(axis=0).tolist()}


def cva(V_rn: np.ndarray, t: np.ndarray, p0: list[float], csa: CSA, notional_usd: float, cp_cds_bp: float = 85.0, lgd: float = 0.40,
        flows: Optional[np.ndarray] = None, maturity_y: Optional[float] = None, deflator: Optional[np.ndarray] = None) -> dict[str, Any]:
    """The waterfall on the risk-neutral paths. The grid is monthly by the calendar and the waterfall takes one step
    length: the mean one (until 0.52.0 the first month's, 28 to 31 days, which set every later date a little off).
    `maturity_y` is the set's longest remaining life, for the capital add-on; the grid's end, a month later, when it
    is not given. `flows` (flows_per_step on the same paths) is given for a margined
    set: the waterfall then draws the value a margin period back with the payments taken out, as exposures() does
    (its `settled`: what has left the set by each date, here the payments' jumps with the sign turned). `deflator`
    (ccr.simulate.deflator on the same paths, the discounting currency's account) has the charges read on the
    exposure discounted on its own path (0.53.0)."""
    n_paths, T1 = V_rn.shape
    dt = float(t[-1]) / (T1 - 1) if T1 > 1 else 1 / 12
    v0 = float(V_rn[:, 0].mean())
    theta = -math.log(max(p0[-1], 1e-9)) / max(float(t[-1]), 1e-6)
    params = WaterfallParams(notional=max(notional_usd, 1.0), maturity_y=float(maturity_y) if maturity_y else float(t[-1]), dt=dt, theta=max(theta, 1e-6), cp_cds_bp=cp_cds_bp, lgd=lgd)
    paid = paid_by(flows) if csa.collateralised else None
    wf = run_waterfall(V_rn[:, 1:], v0, p0, params, csa, settled=None if paid is None else np.broadcast_to(-paid, V_rn[:, 1:].shape), deflator=deflator)
    f = lambda x: float(x)
    return {"cva_usd": f(wf.cva), "dva_usd": f(wf.dva), "fca_usd": f(wf.fca), "fba_usd": f(wf.fba), "fva_usd": f(wf.fca),          # the cost again, for an app from before 0.41.0 (api/routes/xva.py LEGACY_FVA); pnl/xva.py reads fca_usd
             "kva_usd": f(wf.kva), "mva_usd": f(wf.mva),
            "colva_usd": f(wf.colva), "total_usd": f(wf.cva + wf.dva + wf.fca + wf.fba + wf.kva + wf.mva + wf.colva), "cp_cds_bp": cp_cds_bp, "lgd": lgd,
            "ee_rn": [f(x) for x in wf.ee], "pfe95_rn": [f(x) for x in wf.pfe]}
