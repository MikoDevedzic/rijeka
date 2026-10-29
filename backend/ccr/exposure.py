"""The counterparty's CSA on the netted value, then the exposure measures.

E⁺(t) = max(V − C − IM, 0) with C the variation margin held against the lagged value (the
same collateral model as the XVA engine), IM when the CSA exchanges it. EE is the mean of
E⁺, PFE_q its q-quantile across paths, EPE the time average of EE over the first year, the
peak the largest PFE and when. CVA comes from the risk-neutral paths through the XVA
waterfall with the counterparty's default spread."""
from __future__ import annotations

import math
from datetime import date
from typing import Any, Optional

import numpy as np

from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, collateral_held, lagged_values, run_waterfall

QUANTILES = (95.0, 97.5, 99.0)
BUCKETS = (("0-1Y", 0.0, 1.0001), ("1-5Y", 1.0001, 5.0001), ("5-10Y", 5.0001, 10.0001), ("10Y+", 10.0001, 1e9))


def csa_from_counterparty(cp) -> CSA:
    """The CSA as the counterparty record states it: NO_CSA → uncollateralised; VM or VM_IM → daily
    variation margin with the record's threshold and MTA, 10bd MPoR, IM when the type says so."""
    kind = str(getattr(cp, "csa_type", None) or "NO_CSA").upper()
    if kind in ("NO_CSA", "NONE", ""):
        return CSA.uncollateralised()
    thr = float(getattr(cp, "csa_threshold_m", None) or 0.0) * 1e6
    mta = float(getattr(cp, "csa_mta_k", None) or 0.0) * 1e3
    im = "IM" in kind
    return CSA(preset=kind, collateralised=True, threshold_cp=thr, threshold_own=thr, mta=mta, im_exchanged=im)


def exposures(V: np.ndarray, t: np.ndarray, csa: CSA, im0_usd: float = 0.0, seed: int = 11, flows: Optional[np.ndarray] = None) -> dict[str, Any]:
    """flows[i]: net trade flow paid in (t_{i−1}, t_i], as the jump it makes in V. The lagged value
    is the bridge between grid points, which smears that jump; the margin call either saw the
    payment (before the window) or settles with it (inside the window), so the lagged value is
    restored by the part of the jump the bridge left out: frac · J_i, frac the MPoR as a fraction
    of the step (MPoR shorter than a step, as on a monthly grid)."""
    n_paths, T1 = V.shape
    dt = float(t[1] - t[0]) if T1 > 1 else 1 / 12
    rng = np.random.default_rng(seed)
    v0 = float(V[:, 0].mean())
    future = V[:, 1:]
    M0 = float(t[-1]) if T1 > 1 else dt
    im = np.array([im0_usd * max(M0 - tt, 0.0) / M0 if M0 > 0 else 0.0 for tt in t[1:]]) if csa.im_exchanged and im0_usd else np.zeros(T1 - 1)
    if csa.collateralised:
        v_lag = lagged_values(future, v0, dt, csa.mpor_years, rng)
        if flows is not None:
            frac = min(csa.mpor_years / dt, 1.0)
            v_lag = v_lag + frac * np.asarray(flows)[1:][None, :]
        coll = collateral_held(v_lag, csa)
    else:
        coll = np.zeros_like(future)
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


def cva(V_rn: np.ndarray, t: np.ndarray, p0: list[float], csa: CSA, notional_usd: float, cp_cds_bp: float = 85.0, lgd: float = 0.40, im0_usd: float = 0.0) -> dict[str, Any]:
    n_paths, T1 = V_rn.shape
    dt = float(t[1] - t[0]) if T1 > 1 else 1 / 12
    v0 = float(V_rn[:, 0].mean())
    theta = -math.log(max(p0[-1], 1e-9)) / max(float(t[-1]), 1e-6)
    params = WaterfallParams(notional=max(notional_usd, 1.0), maturity_y=float(t[-1]), dt=dt, theta=max(theta, 1e-6), cp_cds_bp=cp_cds_bp, lgd=lgd,
                             simm_im_m=(im0_usd / 1e6) if im0_usd else None)
    wf = run_waterfall(V_rn[:, 1:], v0, p0, params, csa)
    return {"cva_usd": wf.cva, "dva_usd": wf.dva, "fva_usd": wf.fva, "kva_usd": wf.kva, "mva_usd": wf.mva, "cp_cds_bp": cp_cds_bp, "lgd": lgd,
            "ee_rn": wf.ee, "pfe95_rn": wf.pfe}
