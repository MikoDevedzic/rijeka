"""
xva.py — Sprint 6A
XVA routes: calibrate and simulate.

POST /api/xva/calibrate
  Reads latest USD_SWVOL_ATM snapshot from market_data_snapshots.
  Runs HW1F calibration against the basket.
  Writes result to xva_calibration table (UPSERT on curve_id, valuation_date, model).
  Returns calibration result including per-instrument fit details.

POST /api/xva/simulate
  Reads latest HW1F calibration from xva_calibration.
  Runs Monte Carlo simulation for a given trade.
  Returns EE, ENE, PFE profiles + XVA waterfall.

GET /api/xva/calibration/latest
  Returns the most recent HW1F calibration result.
  Used by XVA tab in trade booking window on mount.
"""

import json
import math
import numpy as np
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from pricing.calibration import calibrate_hw1f, tenor_to_years, hw1f_swaption_vol_normal

router = APIRouter(prefix="/api/xva", tags=["xva"])

# Calibration basket definition — mirrors swaptionVols.js HW1F_CALIBRATION_BASKET
# Calibration basket: 5Y-tenor column across expiries.
# HW1F constant (a,sigma) fits ONE tenor column well.
# 5Y tenor is standard for XVA — captures mid-curve dynamics.
# Expected results: sigma ~30-40bp, a ~0.02-0.08, RMSE < 3bp.
CALIBRATION_BASKET_DEF = [
    {"expiry": "1Y",  "tenor": "5Y", "ticker": "USSNA15 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "2Y",  "tenor": "5Y", "ticker": "USSNA25 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "3Y",  "tenor": "5Y", "ticker": "USSNA35 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "5Y",  "tenor": "5Y", "ticker": "USSNA55 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "7Y",  "tenor": "5Y", "ticker": "USSNA75 ICPL Curncy",  "role": "5Y_diagonal", "weight": 0.8},
    {"expiry": "10Y", "tenor": "5Y", "ticker": "USSNA105 ICPL Curncy", "role": "5Y_diagonal", "weight": 0.6},
]


# ── Models ────────────────────────────────────────────────────────────────────

class CalibrateRequest(BaseModel):
    valuation_date: Optional[date] = None
    theta: Optional[float] = None        # long-run rate; if None, uses 5Y SOFR from DB
    a_init: Optional[float] = 0.03
    sigma_bp_init: Optional[float] = 95.0


class SimulateRequest(BaseModel):
    trade_id: Optional[str] = None       # if provided, loads trade from DB
    notional: float = 10_000_000.0
    maturity_y: float = 5.0
    fixed_rate: float = 0.03643
    paths: int = 2000
    # HW1F overrides — if None, loads latest calibration from DB
    a: Optional[float] = None
    sigma_bp: Optional[float] = None
    theta: Optional[float] = None
    # XVA inputs
    cp_cds_bp: float = 85.0
    own_cds_bp: float = 42.0
    # Full term structure (overrides flat if provided)
    cp_cds_curve: Optional[list] = None   # [{t: float, spread_bp: float}]
    own_cds_curve: Optional[list] = None
    ftp_curve: Optional[list] = None
    lgd: float = 0.40
    ftp_bp: float = 55.0
    fba_ratio: float = 0.55
    hurdle_rate: float = 0.12
    capital_model: str = "sa_ccr"        # sa_ccr | cem | imm
    wwr_multiplier: float = 1.0
    simm_im_m: float = 0.85              # IM in $M for MVA proxy
    direction: str = "PAY"                # PAY or RECEIVE — flips EE/ENE


# ── Calibrate ─────────────────────────────────────────────────────────────────

@router.post("/calibrate")
async def calibrate(
    body: CalibrateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")

    val_date = body.valuation_date or date.today()
    user_id  = user.get("sub")

    # Load latest vol snapshot
    snap = db.execute(
        text("""
            SELECT quotes, valuation_date
            FROM market_data_snapshots
            WHERE curve_id = 'USD_SWVOL_ATM' AND user_id = :user_id
            ORDER BY valuation_date DESC
            LIMIT 1
        """),
        {"user_id": user_id}
    ).fetchone()

    if not snap:
        raise HTTPException(
            status_code=404,
            detail="No USD_SWVOL_ATM snapshot found. Save swaption vols in Configurations first."
        )

    quotes = snap.quotes if isinstance(snap.quotes, list) else []
    if not quotes:
        raise HTTPException(status_code=422, detail="Vol snapshot is empty")

    # Build vol lookup: (expiry, tenor) -> vol_bp
    vol_lookup = {}
    for q in quotes:
        # Handle two schemas:
        # 1. {expiry, swp_tenor, rate} — from useXVAStore saveSnapshot
        # 2. {expiry, tenor, vol_bp}   — legacy
        exp = q.get("expiry")
        ten = q.get("swp_tenor") or q.get("tenor")
        vol = q.get("rate") if q.get("quote_type") == "SWVOL" else q.get("vol_bp")
        
        # Also parse from combined tenor key like "1Yx5Y"
        if not exp and ten and "x" in str(ten):
            parts = str(ten).split("x")
            if len(parts) == 2:
                exp, ten = parts[0], parts[1]
        
        if exp and ten and vol is not None:
            vol_lookup[(exp, ten)] = float(vol)

    # Build calibration basket — skip instruments with no market data
    basket = []
    for inst in CALIBRATION_BASKET_DEF:
        key = (inst["expiry"], inst["tenor"])
        if key in vol_lookup:
            basket.append({
                "expiry_y": tenor_to_years(inst["expiry"]),
                "tenor_y":  tenor_to_years(inst["tenor"]),
                "vol_bp":   vol_lookup[key],
                "ticker":   inst["ticker"],
                "role":     inst["role"],
                "weight":   inst["weight"],
            })

    # Some co-terminal basket instruments (4Y expiry) may not be in the 6x6 grid
    # Also try to pull 4Y×1Y from quotes directly
    for inst in CALIBRATION_BASKET_DEF:
        key = (inst["expiry"], inst["tenor"])
        if key not in vol_lookup and inst["expiry"] == "4Y":
            # Interpolate from 3Y and 5Y expiry
            k3 = ("3Y", inst["tenor"])
            k5 = ("5Y", inst["tenor"])
            if k3 in vol_lookup and k5 in vol_lookup:
                interp = (vol_lookup[k3] + vol_lookup[k5]) / 2.0
                basket.append({
                    "expiry_y": tenor_to_years(inst["expiry"]),
                    "tenor_y":  tenor_to_years(inst["tenor"]),
                    "vol_bp":   interp,
                    "ticker":   inst["ticker"] + " [interp]",
                    "role":     inst["role"],
                    "weight":   inst["weight"] * 0.5,
                })

    if len(basket) < 3:
        raise HTTPException(
            status_code=422,
            detail=f"Only {len(basket)} basket instruments have market data. Need at least 3."
        )

    # Get theta from request or estimate from flat rate
    theta = body.theta
    if theta is None:
        # Use 5Y SOFR swap rate from DB as proxy for long-run level
        sofr_snap = db.execute(
            text("""
                SELECT quotes FROM market_data_snapshots
                WHERE curve_id = 'USD_SOFR' AND user_id = :user_id
                ORDER BY valuation_date DESC LIMIT 1
            """),
            {"user_id": user_id}
        ).fetchone()
        if sofr_snap and sofr_snap.quotes:
            q5 = next((q for q in sofr_snap.quotes if q.get("tenor") == "5Y"), None)
            theta = float(q5["rate"]) / 100.0 if q5 else 0.0365
        else:
            theta = 0.0365  # fallback

    # Run calibration
    try:
        result = calibrate_hw1f(
            basket=basket,
            theta=theta,
            a_init=body.a_init or 0.03,
            sigma_bp_init=body.sigma_bp_init or 35.0,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calibration failed: {str(e)}")

    # Also compute full 6x6 model vol surface for display
    expiries = ["1Y","2Y","3Y","5Y","7Y","10Y"]
    tenors   = ["1Y","2Y","3Y","5Y","7Y","10Y"]
    sigma_dec = result["sigma_bp"] / 10000.0
    surface_errors = []
    for exp in expiries:
        for ten in tenors:
            mkt = vol_lookup.get((exp, ten))
            mdl = hw1f_swaption_vol_normal(
                result["a"], sigma_dec, theta,
                tenor_to_years(exp), tenor_to_years(ten),
            )
            surface_errors.append({
                "expiry": exp, "tenor": ten,
                "mkt_vol_bp": round(mkt, 2) if mkt else None,
                "mdl_vol_bp": round(mdl, 2),
                "error_bp":   round(mdl - mkt, 3) if mkt else None,
            })

    result["surface_errors"] = surface_errors
    result["snap_date"] = snap.valuation_date.isoformat()

    # UPSERT into xva_calibration
    db.execute(
        text("""
            INSERT INTO xva_calibration
              (curve_id, valuation_date, model, a, sigma_bp, theta,
               basket_size, fit_rmse_bp, fit_details, created_by, user_id)
            VALUES
              ('USD_SWVOL_ATM', :val_date, 'HW1F', :a, :sigma_bp, :theta,
               :basket_size, :fit_rmse_bp, cast(:fit_details as jsonb), :created_by, :user_id)
            ON CONFLICT (curve_id, valuation_date, model)
            DO UPDATE SET
              a            = EXCLUDED.a,
              sigma_bp     = EXCLUDED.sigma_bp,
              theta        = EXCLUDED.theta,
              basket_size  = EXCLUDED.basket_size,
              fit_rmse_bp  = EXCLUDED.fit_rmse_bp,
              fit_details  = EXCLUDED.fit_details,
              created_at   = NOW(),
              created_by   = EXCLUDED.created_by
        """),
        {
            "val_date":    val_date,
            "a":           result["a"],
            "sigma_bp":    result["sigma_bp"],
            "theta":       result["theta"],
            "basket_size": result["basket_size"],
            "fit_rmse_bp": result["fit_rmse_bp"],
            "fit_details": json.dumps({
                "basket":         result["fit_details"],
                "surface_errors": surface_errors,
                "converged":      result["converged"],
                "iterations":     result["iterations"],
                "snap_date":      result["snap_date"],
            }),
            "created_by":  user_id,
            "user_id":     user_id,
        }
    )
    db.commit()

    return result


# ── Get latest calibration ────────────────────────────────────────────────────

@router.get("/calibration/latest")
async def get_latest_calibration(
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    row = db.execute(
        text("""
            SELECT id, curve_id, valuation_date, model,
                   a, sigma_bp, theta, basket_size, fit_rmse_bp,
                   fit_details, created_at
            FROM xva_calibration
            WHERE curve_id = 'USD_SWVOL_ATM' AND model = 'HW1F' AND user_id = :user_id
            ORDER BY valuation_date DESC, created_at DESC
            LIMIT 1
        """),
        {"user_id": user["sub"]}
    ).fetchone()

    if not row:
        return {"exists": False}

    return {
        "exists":        True,
        "id":            str(row.id),
        "valuation_date":row.valuation_date.isoformat(),
        "model":         row.model,
        "a":             row.a,
        "sigma_bp":      row.sigma_bp,
        "theta":         row.theta,
        "basket_size":   row.basket_size,
        "fit_rmse_bp":   row.fit_rmse_bp,
        "fit_details":   row.fit_details,
        "created_at":    row.created_at.isoformat(),
    }


# ── Simulate ──────────────────────────────────────────────────────────────────

@router.post("/simulate")
async def simulate(
    body: SimulateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    # Load HW1F params — from request override or latest calibration
    a        = body.a
    sigma_bp = body.sigma_bp
    theta    = body.theta

    if a is None or sigma_bp is None:
        row = db.execute(
            text("""
                SELECT a, sigma_bp, theta FROM xva_calibration
                WHERE curve_id = 'USD_SWVOL_ATM' AND model = 'HW1F' AND user_id = :user_id
                ORDER BY valuation_date DESC, created_at DESC
                LIMIT 1
            """),
            {"user_id": user["sub"]}
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail="No HW1F calibration found. Run CALIBRATE first."
            )
        a        = row.a
        sigma_bp = row.sigma_bp
        theta    = theta or row.theta or 0.0365

    sigma   = sigma_bp / 10000.0
    T       = int(body.maturity_y * 12)   # monthly steps
    DT      = 1.0 / 12.0
    N       = body.notional
    K       = body.fixed_rate
    n_paths = min(body.paths, 10000)
    rng     = np.random.default_rng(seed=42)

    std_dt = sigma * math.sqrt((1 - math.exp(-2 * a * DT)) / (2 * a))

    # ── Monte Carlo ──────────────────────────────────────────────────────────
    # Shape: (n_paths, T)
    r0 = theta
    paths = np.zeros((n_paths, T))
    r = np.full(n_paths, r0)

    for i in range(T):
        z = rng.standard_normal(n_paths)
        r = (r * math.exp(-a * DT)
             + theta * (1 - math.exp(-a * DT))
             + std_dt * z)
        r = np.maximum(r, -0.005)

        # Analytical swaption-style NPV per path at time step i
        t_now = (i + 1) * DT
        rem = T - (i + 1)
        if rem <= 0:
            paths[:, i] = 0.0
            continue

        # Annuity approximation
        ann = np.zeros(n_paths)
        for j in range(i + 1, T):
            tau = (j + 1) * DT - t_now
            B   = (1 - np.exp(-a * tau)) / a
            log_A = ((B - tau) * (theta - sigma * sigma / (2 * a * a))
                     - sigma * sigma * B * B / (4 * a))
            df = np.exp(log_A - B * r)
            ann += DT * df

        # Discount factor to maturity
        tau_m = T * DT - t_now
        B_m   = (1 - np.exp(-a * tau_m)) / a
        log_Am = ((B_m - tau_m) * (theta - sigma * sigma / (2 * a * a))
                  - sigma * sigma * B_m * B_m / (4 * a))
        df_m = np.exp(log_Am - B_m * r)

        paths[:, i] = (K * ann - (1 - df_m)) * N

    # ── Exposure profiles ────────────────────────────────────────────────────
    # Flip sign for RECEIVE FIXED — receiver has mirror exposure profile
    if body.direction.upper() == "RECEIVE":
        paths = -paths
    ee  = np.mean(np.maximum(paths, 0), axis=0).tolist()
    ene = np.mean(np.minimum(paths, 0), axis=0).tolist()
    pfe = np.percentile(paths, 95, axis=0).tolist()

    # ── XVA waterfall ────────────────────────────────────────────────────────
    lgd   = body.lgd

    # ── Spread interpolation helper ──────────────────────────────────────
    def interp_spread(curve, flat_bp, t):
        """Linear interpolation of spread at time t from term structure."""
        if not curve:
            return flat_bp / 10000.0
        pts = sorted(curve, key=lambda x: x['t'])
        if t <= pts[0]['t']:
            return pts[0]['spread_bp'] / 10000.0
        if t >= pts[-1]['t']:
            return pts[-1]['spread_bp'] / 10000.0
        for i in range(len(pts)-1):
            t0, t1 = pts[i]['t'], pts[i+1]['t']
            if t0 <= t <= t1:
                w = (t - t0) / (t1 - t0)
                return (pts[i]['spread_bp'] * (1-w) + pts[i+1]['spread_bp'] * w) / 10000.0
        return flat_bp / 10000.0

    ftp_flat = body.ftp_bp / 10000.0
    hurdle= body.hurdle_rate
    wwr   = body.wwr_multiplier
    rwa   = {"sa_ccr": 0.015, "cem": 0.018, "imm": 0.010}.get(body.capital_model, 0.015)

    cva=dva=fva=fba_v=kva=0.0
    qcp=qow=1.0
    disc_rate = theta

    for i in range(T):
        t    = (i + 1) * DT
        disc = math.exp(-disc_rate * t)
        cp_h_t = interp_spread(body.cp_cds_curve, body.cp_cds_bp, t)
        ow_h_t = interp_spread(body.own_cds_curve, body.own_cds_bp, t)
        ftp_t  = interp_spread(body.ftp_curve, body.ftp_bp, t) if body.ftp_curve else ftp_flat
        fba_s_t= ftp_t * body.fba_ratio
        nqcp = math.exp(-cp_h_t * t)
        nqow = math.exp(-ow_h_t * t)
        cva  += lgd * ee[i]          * (qcp - nqcp) * disc * wwr
        dva  -= lgd * abs(ene[i])    * (qow - nqow) * disc
        fva  += ftp_t  * ee[i]       * DT           * disc
        fba_v-= fba_s_t* abs(ene[i]) * DT           * disc
        kva  += hurdle * N * rwa     * math.exp(-disc_rate * t) * DT * disc
        qcp   = nqcp
        qow   = nqow

    cva   = -abs(cva)
    dva   =  abs(dva)
    fva   = -abs(fva)
    fba_v =  abs(fba_v)
    kva   = -abs(kva)
    mva   = -(body.simm_im_m * 1e6 * ftp_flat * body.maturity_y / 2.0)

    # Stub NPV — in production this comes from the pricer
    npv   = 0.0

    # Sample 80 paths for visualisation (evenly spaced)
    n_sample = min(80, n_paths)
    step = max(1, n_paths // n_sample)
    sample_paths = paths[::step, :].tolist()

    return {
        "ee":           [round(v, 2) for v in ee],
        "ene":          [round(v, 2) for v in ene],
        "pfe":          [round(v, 2) for v in pfe],
        "sample_paths": [[round(v, 0) for v in p] for p in sample_paths],
        "steps":        T,
        "dt":           DT,
        "n_paths":      n_paths,
        "xva": {
            "npv": round(npv, 2),
            "cva": round(cva, 2),
            "dva": round(dva, 2),
            "fva": round(fva, 2),
            "fba": round(fba_v, 2),
            "kva": round(kva, 2),
            "mva": round(mva, 2),
            "all_in": round(npv + cva + dva + fva + fba_v + kva + mva, 2),
        },
        "params": {
            "a":        a,
            "sigma_bp": sigma_bp,
            "theta":    theta,
        },
    }
