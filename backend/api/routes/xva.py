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
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from pricing.calibration import calibrate_hw1f, tenor_to_years, hw1f_swaption_vol_normal
# Same curve builder the pricer uses, so the simulation and the valuation can
# never end up on different curves. (pricer does not import xva — no cycle.)
from api.routes.pricer import CurveInput, _build_curve

router = APIRouter(prefix="/api/xva", tags=["xva"])

# Calibration basket definition — mirrors swaptionVols.js HW1F_CALIBRATION_BASKET
# Calibration basket: 5Y-tenor column across expiries.
# HW1F constant (a,sigma) fits ONE tenor column well.
# 5Y tenor is standard for XVA — captures mid-curve dynamics.
# SECTION 6.1B: wide basket (diagonal + cross-tenor + co-terminal + long-end).
# Cross-tenor vol decay identifies a; the flat diagonal alone pinned a at its
# lower bound. Post-6.1 expectation: sigma ~70-90bp, a off the bound, RMSE a few bp.
CALIBRATION_BASKET_DEF = [
    {"expiry": "1Y",  "tenor": "5Y", "ticker": "USSNA15 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "2Y",  "tenor": "5Y", "ticker": "USSNA25 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "3Y",  "tenor": "5Y", "ticker": "USSNA35 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "5Y",  "tenor": "5Y", "ticker": "USSNA55 ICPL Curncy",  "role": "5Y_diagonal", "weight": 1.0},
    {"expiry": "7Y",  "tenor": "5Y", "ticker": "USSNA75 ICPL Curncy",  "role": "5Y_diagonal", "weight": 0.8},
    {"expiry": "10Y", "tenor": "5Y", "ticker": "USSNA105 ICPL Curncy", "role": "5Y_diagonal", "weight": 0.6},
    {"expiry": "1Y",  "tenor": "1Y", "ticker": "USSNA11 ICPL Curncy",  "role": "cross_tenor", "weight": 0.8},
    {"expiry": "1Y",  "tenor": "2Y", "ticker": "USSNA12 ICPL Curncy",  "role": "cross_tenor", "weight": 0.8},
    {"expiry": "1Y",  "tenor": "3Y", "ticker": "USSNA13 ICPL Curncy",  "role": "cross_tenor", "weight": 0.8},
    {"expiry": "1Y",  "tenor": "7Y", "ticker": "USSNA17 ICPL Curncy",  "role": "cross_tenor", "weight": 0.8},
    {"expiry": "1Y",  "tenor": "9Y", "ticker": "USSNA19 ICPL Curncy",  "role": "cross_tenor", "weight": 0.8},
    {"expiry": "3Y",  "tenor": "7Y", "ticker": "USSNA37 ICPL Curncy",  "role": "co_terminal_10Y", "weight": 0.8},
    {"expiry": "7Y",  "tenor": "3Y", "ticker": "USSNA73 ICPL Curncy",  "role": "co_terminal_10Y", "weight": 0.8},
    {"expiry": "5Y",  "tenor": "9Y", "ticker": "USSNA59 ICPL Curncy",  "role": "long_end_anchor", "weight": 0.7},
    {"expiry": "7Y",  "tenor": "7Y", "ticker": "USSNA77 ICPL Curncy",  "role": "long_end_anchor", "weight": 0.7},
    {"expiry": "7Y",  "tenor": "9Y", "ticker": "USSNA79 ICPL Curncy",  "role": "long_end_anchor", "weight": 0.7},
]


# ── ISDA SIMM — IR delta risk weights, regular-volatility currencies ─────────
# (USD/EUR/GBP). Units are bp, matching a sensitivity expressed as $ per bp,
# so IM = RW x |IR01| comes out in dollars.
_SIMM_IR_RW = [
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


def _simm_ir_risk_weight(maturity_y: float) -> float:
    """Linearly interpolated SIMM IR delta risk weight for a tenor in years."""
    pts = _SIMM_IR_RW
    if maturity_y <= pts[0][0]:
        return pts[0][1]
    if maturity_y >= pts[-1][0]:
        return pts[-1][1]
    for i in range(len(pts) - 1):
        t0, w0 = pts[i]
        t1, w1 = pts[i + 1]
        if t0 <= maturity_y <= t1:
            f = (maturity_y - t0) / (t1 - t0)
            return w0 * (1 - f) + w1 * f
    return pts[-1][1]


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
    # Trade TV from the pricer. XVA is an ADJUSTMENT to this, not a
    # standalone value — all_in = npv + Σ XVA. If the caller does not
    # supply it we return npv=None rather than silently reporting 0.0,
    # so the UI cannot display an all-in that ignores the trade's MtM.
    npv: Optional[float] = None
    ir01: Optional[float] = None         # $ per bp, from the pricer — drives SIMM IM
    # Term structure the paths are generated from. Same shape the pricer takes,
    # so both can be handed the identical payload. If omitted, the curve is
    # loaded from the DB snapshot exactly as /price does.
    curves: Optional[List[CurveInput]] = None
    curve_id: str = "USD_SOFR"
    valuation_date: Optional[date] = None
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
    lgd: float = 0.40                    # counterparty LGD (1 - recovery)
    own_lgd: float = 0.40                # own LGD for DVA
    ftp_bp: float = 55.0
    fba_ratio: float = 0.55
    hurdle_rate: float = 0.12
    capital_model: str = "sa_ccr"        # sa_ccr | cem | imm
    counterparty_rw: float = 1.0         # Basel counterparty risk weight (1.0 = 100%)
    wwr_multiplier: float = 1.0
    # IM in $M for MVA. If None, derived from ISDA SIMM IR delta on `ir01`
    # (or a notional/tenor proxy) instead of a hardcoded guess.
    simm_im_m: Optional[float] = None
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
            ON CONFLICT (user_id, curve_id, valuation_date, model)
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

    # ── Initial term structure ───────────────────────────────────────────────
    # Generating paths from a single flat rate at theta ignores the shape of the
    # curve: forward rates drift wrongly, which moves the EE hump in both time
    # and height and feeds straight into CVA and KVA. Build the SAME curve the
    # pricer uses and fit the model to it.
    val_date   = body.valuation_date or date.today()
    mkt_curve  = None
    curve_note = None
    try:
        ci = (body.curves[0] if body.curves
              else CurveInput(curve_id=body.curve_id, quotes=[]))
        mkt_curve = _build_curve(ci, val_date, db, user["sub"])
    except Exception as _curve_err:
        curve_note = str(_curve_err)

    def _p0(t: float) -> float:
        """Market discount factor to year-fraction t (ACT/365F, as Curve uses)."""
        if t <= 0:
            return 1.0
        return mkt_curve.df(val_date + timedelta(days=int(round(t * 365.0))))

    # P(0, t) and the instantaneous forward f(0, t) on the simulation grid.
    if mkt_curve is not None:
        p0_grid = [_p0(k * DT) for k in range(T + 2)]
        f0_grid = []
        for k in range(T + 1):
            a_df, b_df = p0_grid[k], p0_grid[k + 1]
            f0_grid.append(-math.log(b_df / a_df) / DT
                           if (a_df > 0 and b_df > 0) else theta)
        curve_source = "bootstrapped" if (body.curves and body.curves[0].quotes) else "db-snapshot"
    else:
        # No curve available — fall back to the previous flat-theta behaviour
        # rather than failing the request, but say so in the response.
        p0_grid = [math.exp(-theta * k * DT) for k in range(T + 2)]
        f0_grid = [theta] * (T + 1)
        curve_source = "flat-theta-fallback"

    # ── Monte Carlo ──────────────────────────────────────────────────────────
    # Shape: (n_paths, T)
    # Hull-White in its exact-fit form: r(t) = x(t) + alpha(t), where x is a
    # zero-mean Ornstein-Uhlenbeck process and alpha(t) is the deterministic
    # shift that makes the model reproduce the initial curve exactly:
    #
    #     alpha(t) = f(0,t) + (sigma^2 / 2a^2)(1 - e^-at)^2
    #
    # Bonds then reconstitute as P(t,T) = A(t,T) e^-B(t,T) r(t) with
    # A(t,T) = P(0,T)/P(0,t) * exp[ B f(0,t) - (sigma^2/4a)(1-e^-2at) B^2 ].
    # At t=0 this returns the market DF by construction, so a par swap prices
    # to ~0 in the simulation — see `anchor` in the response, which should
    # collapse toward zero now that the model and the pricer share a curve.
    paths = np.zeros((n_paths, T))
    ann_mean = np.zeros(T)      # mean annuity per step — used to decay the TV anchor
    x = np.zeros(n_paths)       # OU deviation; x(0) = 0

    for i in range(T):
        z = rng.standard_normal(n_paths)
        x = x * math.exp(-a * DT) + std_dt * z
        # No floor on r: Hull-White is a Gaussian model and negative rates are
        # admissible. Clamping biases discount factors and breaks the exact fit.
        t_step = (i + 1) * DT
        alpha  = f0_grid[i + 1] + (sigma * sigma / (2 * a * a)) * (1 - math.exp(-a * t_step)) ** 2
        r = x + alpha

        # Analytical swaption-style NPV per path at time step i
        t_now = (i + 1) * DT
        rem = T - (i + 1)
        if rem <= 0:
            paths[:, i] = 0.0
            continue

        # Reconstitution coefficients at t_now, off the market curve
        p0_t  = p0_grid[i + 1]
        f0_t  = f0_grid[i + 1]
        e2at  = 1.0 - math.exp(-2.0 * a * t_now)

        # Annuity: sum of market-consistent zero-bond prices over remaining steps
        ann = np.zeros(n_paths)
        for j in range(i + 1, T):
            tau   = (j + 1) * DT - t_now
            B     = (1 - math.exp(-a * tau)) / a
            log_A = (math.log(p0_grid[j + 1] / p0_t)
                     + B * f0_t
                     - (sigma * sigma / (4 * a)) * e2at * B * B)
            ann += DT * np.exp(log_A - B * r)

        # Discount factor to maturity
        tau_m  = T * DT - t_now
        B_m    = (1 - math.exp(-a * tau_m)) / a
        log_Am = (math.log(p0_grid[T] / p0_t)
                  + B_m * f0_t
                  - (sigma * sigma / (4 * a)) * e2at * B_m * B_m)
        df_m = np.exp(log_Am - B_m * r)

        ann_mean[i] = float(np.mean(ann))
        paths[:, i] = (K * ann - (1 - df_m)) * N

    # ── Exposure profiles ────────────────────────────────────────────────────
    # `paths` above is the RECEIVER value: K·A − (1 − DF), i.e. receive fixed.
    # The PAY FIXED trade is its mirror, so the payer is what needs flipping.
    # (This previously flipped on RECEIVE, which gave every pay-fixed swap the
    # receiver's exposure profile and therefore swapped CVA with DVA.)
    if body.direction.upper() == "PAY":
        paths = -paths

    # ── Anchor the profile to the pricer's TV ────────────────────────────────
    # The MC runs off a flat curve at theta, so its t=0 value is the ATM value
    # of a swap struck at `fixed_rate`. The real trade is generally away from
    # that (on 2026-08-12: TV +$212k = 46.6bp of moneyness), and an exposure
    # profile that ignores it under-states EE for an ITM trade. A rate-level
    # offset is worth Δr × annuity × N, so we re-strike the simulated swap by
    # the offset implied by the pricer's TV — the shift decays with the
    # annuity and vanishes at maturity, exactly as the real moneyness does.
    # (Deeper fix: run the MC off the bootstrapped curve rather than flat theta.)
    anchor_v0 = float(np.mean(paths[:, 0])) if T > 0 else 0.0
    anchor_delta = 0.0
    if body.npv is not None and ann_mean[0] > 0:
        anchor_delta = body.npv - anchor_v0
        for i in range(T):
            paths[:, i] += anchor_delta * (ann_mean[i] / ann_mean[0])

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
    hurdle  = body.hurdle_rate
    wwr     = body.wwr_multiplier
    own_lgd = body.own_lgd

    # ── Initial margin for MVA (ISDA SIMM IR delta) ──────────────────────────
    # A single vanilla swap sits in one currency / one tenor bucket, so the
    # SIMM weighted-sensitivity quadratic form collapses to |RW x IR01|.
    if body.simm_im_m is not None:
        im_0 = body.simm_im_m * 1e6
    else:
        rw_simm = _simm_ir_risk_weight(body.maturity_y)
        if body.ir01 is not None:
            im_0 = abs(body.ir01) * rw_simm
        else:
            # Fallback when the caller has no IR01: IR01 ~ N x annuity x 1bp
            ann_0 = ((1.0 - math.exp(-theta * body.maturity_y)) / theta
                     if theta > 0 else body.maturity_y)
            im_0  = abs(N * ann_0 * 1e-4) * rw_simm

    # ── SA-CCR constants ─────────────────────────────────────────────────────
    SF_IR = 0.005     # supervisory factor, interest-rate asset class
    ALPHA = 1.4       # SA-CCR alpha
    CAP_R = 0.08      # capital / RWA
    rw_cp = body.counterparty_rw
    M0    = body.maturity_y

    cva=dva=fva=fba_v=kva=mva=0.0
    qcp=qow=1.0
    mean_v = np.mean(paths, axis=0)
    ead_0 = cap_0 = 0.0

    for i in range(T):
        t    = (i + 1) * DT
        # Discount XVA on the market curve, not a flat exp(-theta*t).
        disc = p0_grid[i + 1]
        cp_s_t = interp_spread(body.cp_cds_curve, body.cp_cds_bp, t)
        ow_s_t = interp_spread(body.own_cds_curve, body.own_cds_bp, t)
        ftp_t  = interp_spread(body.ftp_curve, body.ftp_bp, t) if body.ftp_curve else ftp_flat
        fba_s_t= ftp_t * body.fba_ratio

        # Credit triangle: hazard = spread / (1 - R) = spread / LGD.
        # Using the raw CDS spread as the hazard understates PD by ~1/LGD
        # (at 91bp / LGD 0.40 that is a 5Y PD of 4.4% instead of 10.7%).
        nqcp = math.exp(-(cp_s_t / lgd)     * t) if lgd     > 0 else 0.0
        nqow = math.exp(-(ow_s_t / own_lgd) * t) if own_lgd > 0 else 0.0

        cva  += lgd     * ee[i]       * (qcp - nqcp) * disc * wwr
        dva  -= own_lgd * abs(ene[i]) * (qow - nqow) * disc
        fva  += ftp_t   * ee[i]       * DT * disc
        fba_v-= fba_s_t * abs(ene[i]) * DT * disc

        # ── Capital profile → KVA ────────────────────────────────────────────
        # Capital amortises as the trade rolls down; it is NOT a flat
        # percentage of notional held to maturity.
        m_t = max(M0 - t, 0.0)
        if m_t > 0:
            sd_t  = (1.0 - math.exp(-0.05 * m_t)) / 0.05   # supervisory duration
            mf_t  = math.sqrt(min(m_t, 1.0))               # unmargined maturity factor
            addon = SF_IR * N * sd_t * mf_t
            rc_t  = max(float(mean_v[i]), 0.0)             # replacement cost, uncollateralised
            if addon > 0:
                # PFE multiplier floors at 5% when the netting set is OTM
                mult = min(1.0, 0.05 + 0.95 * math.exp(float(mean_v[i]) / (1.9 * addon)))
            else:
                mult = 1.0
            if body.capital_model == "imm":
                ead_t = ALPHA * ee[i]                      # alpha x effective EPE
            elif body.capital_model == "cem":
                ead_t = rc_t + SF_IR * N * mf_t            # RC + notional add-on
            else:
                ead_t = ALPHA * (rc_t + mult * addon)      # SA-CCR
            k_t   = CAP_R * rw_cp * ead_t
            kva  += hurdle * k_t * DT * disc               # single discount
            if i == 0:
                ead_0, cap_0 = ead_t, k_t

            # IM amortises with residual maturity
            im_t  = im_0 * (m_t / M0) if M0 > 0 else 0.0
            mva  -= im_t * ftp_t * DT * disc

        qcp   = nqcp
        qow   = nqow

    cva   = -abs(cva)
    dva   =  abs(dva)
    fva   = -abs(fva)
    fba_v =  abs(fba_v)
    kva   = -abs(kva)
    mva   = -abs(mva)

    # Trade TV comes from the pricer. If the caller did not supply it we
    # return null rather than 0.0 — an all-in that silently ignores the
    # trade's MtM is worse than no number at all.
    npv       = body.npv
    xva_total = cva + dva + fva + fba_v + kva + mva
    all_in    = (npv + xva_total) if npv is not None else None

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
            "npv": round(npv, 2) if npv is not None else None,
            "cva": round(cva, 2),
            "dva": round(dva, 2),
            "fva": round(fva, 2),
            "fba": round(fba_v, 2),
            "kva": round(kva, 2),
            "mva": round(mva, 2),
            "xva_total": round(xva_total, 2),
            "all_in": round(all_in, 2) if all_in is not None else None,
        },
        "params": {
            "a":        a,
            "sigma_bp": sigma_bp,
            "theta":    theta,
            # Which term structure the paths were generated from. Anything other
            # than a real curve here means the profile is not market-consistent.
            "curve_source":   curve_source,
            "curve_id":       body.curve_id,
            "valuation_date": str(val_date),
            "curve_error":    curve_note,
        },
        # The model is fitted to the initial curve, so a par trade should price
        # to ~0 at t=0 and `delta` should be small. A large delta means the
        # simulation and the pricer disagree about the curve.
        "anchor": {
            "model_v0": round(anchor_v0, 2),
            "npv":      round(body.npv, 2) if body.npv is not None else None,
            "delta":    round(anchor_delta, 2),
        },
        # Capital / margin diagnostics — so a reviewer can tie KVA and MVA
        # back to an EAD and an IM rather than take them on faith.
        "capital": {
            "model":      body.capital_model,
            "ead_0":      round(ead_0, 2),
            "capital_0":  round(cap_0, 2),
            "rw":         rw_cp,
            "im_0":       round(im_0, 2),
            "simm_rw":    _simm_ir_risk_weight(body.maturity_y),
        },
    }
