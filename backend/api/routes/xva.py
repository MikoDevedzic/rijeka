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
import uuid
import math
import numpy as np
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from api.routes._limits import heavy
from api.routes._errors import internal
from pricing.calibration import calibrate_hw1f, tenor_to_years, hw1f_swaption_vol_normal
from pricing.hw1f_mc import simulate_swap_paths
# Same curve builder the pricer uses, so the simulation and the valuation can
# never end up on different curves. (pricer does not import xva — no cycle.)
from api.routes.pricer import CurveInput, _build_curve
from pricing.curve import discount_fn_from_curve
from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, run_waterfall

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


CALIB_STALE_WARN_DAYS  = 5
CALIB_STALE_ALERT_DAYS = 14


def _staleness_block(calib_date, mkt_curve, val_date) -> dict:
    """
    Age of the two inputs an XVA number rests on: the vol calibration and the
    market snapshot. Both are loaded 'most recent available' with no date
    filter, so either can be arbitrarily old without the number looking any
    different. Report the age rather than let it pass unremarked.
    """
    def _days(d):
        try:
            return (val_date - d).days if d is not None else None
        except Exception:
            return None

    calib_days = _days(calib_date)
    snap_date  = getattr(mkt_curve, "snapshot_date", None) if mkt_curve is not None else None
    snap_days  = _days(snap_date)

    status, msgs = "ok", []
    if calib_days is not None:
        if calib_days >= CALIB_STALE_ALERT_DAYS:
            status = "alert"
            msgs.append(f"HW1F calibration is {calib_days} days old.")
        elif calib_days >= CALIB_STALE_WARN_DAYS:
            status = "warn" if status == "ok" else status
            msgs.append(f"HW1F calibration is {calib_days} days old.")
    if snap_days is not None:
        if snap_days >= 7:
            status = "alert"
            msgs.append(f"Market data is {snap_days} days behind the valuation date.")
        elif snap_days >= 3:
            status = "warn" if status == "ok" else status
            msgs.append(f"Market data is {snap_days} days behind the valuation date.")

    return {
        "status":            status,
        "message":           " ".join(msgs) or None,
        "valuation_date":    str(val_date),
        "calibration_date":  str(calib_date) if calib_date is not None else None,
        "calibration_days":  calib_days,
        "snapshot_date":     str(snap_date) if snap_date is not None else None,
        "snapshot_days":     snap_days,
    }


class CalibrateRequest(BaseModel):
    valuation_date: Optional[date] = None
    theta: Optional[float] = None        # long-run rate; if None, uses 5Y SOFR from DB
    a_init: Optional[float] = 0.03
    sigma_bp_init: Optional[float] = 95.0
    curve_id: str = "USD_SOFR"           # discount curve the model is fitted on
    curves: Optional[List[CurveInput]] = None   # explicit quotes; else latest DB snapshot


class SimulateRequest(BaseModel):
    notional: float = Field(default=10_000_000.0, gt=0)
    maturity_y: float = Field(default=5.0, gt=0, le=60)
    fixed_rate: float = 0.03643
    paths: int = Field(default=2000, ge=100, le=10_000)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)   # 42 repeats exactly; the ticket's RE-ROLL sends a fresh one
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
    # Collateral terms. None → uncollateralised, no IM (MVA = 0).
    #   {"preset": "BILATERAL", "threshold_cp": 5e5, "mta": 1e5, "mpor_days": 10}
    #   {"preset": "ON_CHAIN"}                       # 5bd MPoR, continuous VM
    #   {"preset": "UNCOLLATERALISED", "im_exchanged": true}
    csa: Optional[dict] = None
    # What the margin is held in (collateral/apply.py): {posted: {instrument: w}, received: {...}, im_posted?: {...}, rail?}.
    # Blank = cash in the CSA currency (zero carry): every number before instruments existed.
    collateral: Optional[dict] = None


def _with_collateral(db: Session, uid: str, csa: CSA, body_collateral: Optional[dict]) -> CSA:
    """The ticket's collateral choice onto the CSA: VM carries and the IM pickup from the instruments' carry over OIS,
    resolved on the account's latest market; 422 on an unknown instrument."""
    if not body_collateral:
        return csa
    from collateral.apply import apply_collateral
    from pnl.market import Market
    dates = Market.dates(db, uid, upto=date.today())
    mkt = Market(db, uid, dates[-1]) if dates else None
    try:
        return apply_collateral(db, uid, csa, body_collateral, mkt, dates[-1] if dates else None)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"collateral: {e}")


# ── Calibrate ─────────────────────────────────────────────────────────────────

@router.post("/calibrate")
def calibrate(
    body: CalibrateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")
    heavy(user, "calibration", 4)

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

    # ── Term structure ───────────────────────────────────────────────────────
    # Fit the model on the same bootstrapped curve /simulate reconstitutes
    # bonds from. A flat exp(-theta t) here and a market curve there means the
    # (a, sigma) that reproduce the swaption vols on one curve are handed to a
    # simulation on another. Fall back to flat theta only when no curve can
    # be built, and say so in the response.
    disc_fn    = None
    curve_note = None
    try:
        ci = (body.curves[0] if body.curves
              else CurveInput(curve_id=body.curve_id, quotes=[]))
        mkt_curve = _build_curve(ci, val_date, db, user_id)
        disc_fn   = discount_fn_from_curve(mkt_curve)
    except Exception as _curve_err:
        curve_note = str(_curve_err)

    # Run calibration
    try:
        result = calibrate_hw1f(
            basket=basket,
            theta=theta,
            a_init=body.a_init or 0.03,
            sigma_bp_init=body.sigma_bp_init or 35.0,
            discount_fn=disc_fn,
        )
    except Exception as e:
        raise internal(500, "Calibration failed", e)
    result["curve_id"]   = body.curve_id
    result["curve_note"] = curve_note

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
                discount_fn=disc_fn,
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
                "curve_source":   result["curve_source"],
                "curve_id":       body.curve_id,
                "curve_note":     curve_note,
            }),
            "created_by":  user_id,
            "user_id":     user_id,
        }
    )
    db.commit()

    return result


# ── Stored calibration → response shape ──────────────────────────────────────

def stored_calibration_fields(fit_details) -> dict:
    """The calibrate response carries the per-instrument fit as a list under `fit_details` with converged /
    iterations / surface_errors alongside; the xva_calibration row stores all of that in one JSON object. This
    returns the response-shaped fields for a stored row, tolerating the legacy shape (a bare list)."""
    if isinstance(fit_details, str):
        try:
            fit_details = json.loads(fit_details)
        except ValueError:
            fit_details = None
    if isinstance(fit_details, dict):
        basket = fit_details.get("basket")
        return {
            "fit_details":    basket if isinstance(basket, list) else [],
            "surface_errors": fit_details.get("surface_errors") or [],
            "converged":      fit_details.get("converged"),
            "iterations":     fit_details.get("iterations"),
            "snap_date":      fit_details.get("snap_date"),
            "curve_source":   fit_details.get("curve_source"),
            "curve_id":       fit_details.get("curve_id"),
            "curve_note":     fit_details.get("curve_note"),
        }
    return {
        "fit_details":    fit_details if isinstance(fit_details, list) else [],
        "surface_errors": [], "converged": None, "iterations": None,
        "snap_date": None, "curve_source": None, "curve_id": None, "curve_note": None,
    }


# ── Get latest calibration ────────────────────────────────────────────────────

@router.get("/calibration/latest")
def get_latest_calibration(
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
        "created_at":    row.created_at.isoformat(),
        **stored_calibration_fields(row.fit_details),
    }


# ── Simulate ──────────────────────────────────────────────────────────────────

@router.post("/simulate")
def simulate(
    body: SimulateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    heavy(user, "XVA simulation", 6)
    # Load HW1F params — from request override or latest calibration
    a        = body.a
    sigma_bp = body.sigma_bp
    theta    = body.theta

    calib_date = None
    if a is None or sigma_bp is None:
        row = db.execute(
            text("""
                SELECT a, sigma_bp, theta, valuation_date FROM xva_calibration
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
        calib_date = getattr(row, "valuation_date", None)

    sigma   = sigma_bp / 10000.0
    T       = int(body.maturity_y * 12)   # monthly steps
    DT      = 1.0 / 12.0
    N       = body.notional
    K       = body.fixed_rate
    n_paths = min(body.paths, 10000)
    import time as _time
    _t0 = _time.perf_counter()
    rng     = np.random.default_rng(seed=int(body.seed))


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

    # ── Monte Carlo (pricing/hw1f_mc.py: the exact-fit Hull-White step and the bond reconstitution) ──
    sim = simulate_swap_paths(a, sigma, p0_grid, f0_grid, T, DT, N, K, n_paths, direction="RECEIVE", rng=rng)
    paths, ann_mean = sim.paths, sim.ann_mean
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

    # ── Collateral + XVA waterfall (pricing/xva_engine.py) ───────────────────
    try:
        csa = CSA.from_request(body.csa)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"csa: {e}")
    csa = _with_collateral(db, user["sub"], csa, body.collateral)

    v0 = body.npv if body.npv is not None else anchor_v0
    wf = run_waterfall(
        paths, v0, p0_grid,
        WaterfallParams(
            notional=N, maturity_y=body.maturity_y, dt=DT, theta=theta,
            lgd=body.lgd, own_lgd=body.own_lgd,
            cp_cds_bp=body.cp_cds_bp, own_cds_bp=body.own_cds_bp,
            cp_cds_curve=body.cp_cds_curve, own_cds_curve=body.own_cds_curve,
            ftp_bp=body.ftp_bp, ftp_curve=body.ftp_curve, fba_ratio=body.fba_ratio,
            hurdle_rate=body.hurdle_rate, capital_model=body.capital_model,
            counterparty_rw=body.counterparty_rw, wwr_multiplier=body.wwr_multiplier,
            ir01=body.ir01, simm_im_m=body.simm_im_m,
        ),
        csa,
    )
    ee, ene, pfe = wf.ee, wf.ene, wf.pfe
    cva, dva, fva, fba_v, kva, mva, colva = wf.cva, wf.dva, wf.fva, wf.fba, wf.kva, wf.mva, wf.colva
    ead_0, cap_0, im_0, rw_cp = wf.ead_0, wf.capital_0, wf.im_0, body.counterparty_rw
    annuity = float(sum(p0_grid[i + 1] for i in range(T)) * DT)          # Σ DF·Δt on the grid: a running-bp equivalent of an upfront amount

    # Trade TV comes from the pricer. If the caller did not supply it we
    # return null rather than 0.0 — an all-in that silently ignores the
    # trade's MtM is worse than no number at all.
    npv       = body.npv
    xva_total = cva + dva + fva + fba_v + kva + mva + colva
    all_in    = (npv + xva_total) if npv is not None else None

    # Sample 80 paths for visualisation (evenly spaced)
    n_sample = min(80, n_paths)
    step = max(1, n_paths // n_sample)
    sample_paths = (wf.exposure_paths if csa.collateralised else paths)[::step, :].tolist()

    return {
        "ee":           [round(v, 2) for v in ee],
        "ene":          [round(v, 2) for v in ene],
        "pfe":          [round(v, 2) for v in pfe],
        # Gross (pre-collateral) profiles and what the CSA removed, so the
        # effect of margining is visible rather than baked in.
        "ee_gross":     [round(v, 2) for v in wf.ee_gross],
        "ene_gross":    [round(v, 2) for v in wf.ene_gross],
        "collateral":   [round(v, 2) for v in wf.collateral_mean],
        "im_profile":   [round(v, 2) for v in wf.im_profile],
        "csa":          csa.to_dict(),
        "sample_paths": [[round(v, 0) for v in p] for p in sample_paths],
        "seed":         int(body.seed), "engine_ms": round((_time.perf_counter() - _t0) * 1000.0, 1), "path_steps": int(n_paths) * int(T),
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
            "colva": round(colva, 2),
            "xva_total": round(xva_total, 2),
            "all_in": round(all_in, 2) if all_in is not None else None,
            "annuity": round(annuity, 6),
            "notional": N,
        },
        # Vol calibration and market data both age silently. A four-week-old
        # calibration priced against today is a model-validation finding, not a
        # detail — so it is reported alongside the numbers it produced.
        "staleness": _staleness_block(calib_date, mkt_curve, val_date),
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
            "simm_rw":     round(wf.simm_rw, 2),      # MPoR-scaled weight used
            "simm_rw_10d": round(wf.simm_rw_10d, 2),  # published 10bd weight
            "mpor_days":   csa.mpor_days,
            "sa_ccr_mf_0": round(wf.mf_0, 4),
            "margined":    csa.sa_ccr_margined,
        },
    }


# ── FX / crypto forwards: same waterfall, lognormal forward exposure ─────────────

class CurrencyXvaRequest(BaseModel):
    pair: str
    base_notional: float = 1_000_000.0
    settlement_date: Optional[date] = None
    forward_rate: Optional[float] = None       # contract K; None = struck at the fair forward
    direction: str = "BUY"                     # of the base currency
    valuation_date: Optional[date] = None
    vol_pct: Optional[float] = None            # flat annualised; None = demo default for the pair
    paths: int = 2000
    cp_cds_bp: float = 85.0
    own_cds_bp: float = 42.0
    ftp_bp: float = 55.0
    fba_ratio: float = 0.55
    lgd: float = 0.40
    own_lgd: float = 0.40
    hurdle_rate: float = 0.12
    capital_model: str = "sa_ccr"
    counterparty_rw: float = 1.0
    wwr_multiplier: float = 1.0
    cp_cds_curve: Optional[list] = None
    own_cds_curve: Optional[list] = None
    ftp_curve: Optional[list] = None
    csa: Optional[dict] = None
    # What the margin is held in (collateral/apply.py): {posted: {instrument: w}, received: {...}, im_posted?: {...}, rail?}.
    # Blank = cash in the CSA currency (zero carry): every number before instruments existed.
    collateral: Optional[dict] = None
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    vol_mode: str = "SURFACE"        # SURFACE: the term structure (and smile) along the paths; FLAT: one vol held
    simm_im_m: Optional[float] = None    # IM in $M for MVA; None = SIMM-style weight on the spot delta
    # wrong-way risk (pricing/xva_engine.path_survival): the multiple a party's default intensity takes when the asset
    # halves against its forward. 1 = default independent of the asset (the numbers before this existed)
    cp_hazard_if_halves: float = Field(default=1.0, ge=0.1, le=20.0)
    own_hazard_if_halves: float = Field(default=1.0, ge=0.1, le=20.0)


def surface_vol_pct(db, user_id: str, pair: str, t_years: float, forward: float, snapshot=None, lookup=None):
    """The pair's own surface at the forward's tenor and strike (ATM), in PERCENT as ForwardXvaInput takes it
    (lookup_vol returns a decimal); (None, None) when the pair has no surface, so the engine's default applies."""
    from api.routes.currencies import latest_snapshot
    from pricing.fx_vol import lookup_vol
    snapshot = snapshot or latest_snapshot
    lookup = lookup or lookup_vol
    vs = snapshot(db, user_id, f"{pair}_VOL")
    if not vs or not getattr(vs, "quotes", None):
        return None, None
    v, tier, note = lookup(vs.quotes, pair, t_years, forward, forward, None)
    return float(v) * 100.0, f"{pair}_VOL surface, ATM at {t_years:.2f}y ({tier}; {getattr(vs, 'valuation_date', '')})"


def one_wrong_way(body) -> None:
    """A modelled link and the multiplier are one or the other: the multiplier on top of a link would count the
    effect twice, and both figures of the answer would carry it."""
    linked = float(body.cp_hazard_if_halves) != 1.0 or float(body.own_hazard_if_halves) != 1.0
    if linked and float(getattr(body, "wwr_multiplier", 1.0) or 1.0) != 1.0:
        raise HTTPException(status_code=422, detail="wwr_multiplier and a credit link (cp_hazard_if_halves, own_hazard_if_halves) are one or the other: "
                                                    "leave the multiplier at 1 when a link is given")


def wwr_block(m: Optional[dict]) -> Optional[dict]:
    """The wrong-way block of a currency XVA answer: the two inputs, CVA and DVA as they would be with default
    independent of the asset, the model in a sentence. None when the run had no link."""
    if not m:
        return None
    return {"cp_hazard_if_halves": m["cp_hazard_if_halves"], "own_hazard_if_halves": m["own_hazard_if_halves"],
            "cva_independent": round(float(m["cva_independent"]), 2), "dva_independent": round(float(m["dva_independent"]), 2), "model": m["model"]}


def _surface_pillars(db, uid: str, pair: str):
    from api.routes.currencies import latest_snapshot
    from pricing.fx_vol import parse_surface
    vs = latest_snapshot(db, uid, f"{pair}_VOL")
    return (parse_surface(vs.quotes) if vs and vs.quotes else None) or None


def forward_xva_input(db, uid: str, pair: str, *, base_notional: float, settlement, forward_rate, direction: str, val_date: date,
                      vol_pct: Optional[float], vol_mode: str):
    """The forward priced today and its engine input: (ForwardXvaInput, quote). One reading for POST /currency and
    for a forward leg of POST /currency-package."""
    from api.routes.currencies import _price, split_pair
    from pricing import fx_xva
    split_pair(pair)
    q = _price(db, uid, pair, shape="FORWARD", base_notional=base_notional, settlement=settlement,
               val_date=val_date, K=forward_rate, direction=direction, spot_override=None, base_rate_pct=None)
    vol_source = "desk input" if vol_pct is not None else None
    pillars = None
    if vol_pct is None:
        vol_pct, vol_source = surface_vol_pct(db, uid, pair, float(q["t"]), float(q["forward"]))
        if str(vol_mode).upper() != "FLAT":
            pillars = _surface_pillars(db, uid, pair)
    inp = fx_xva.ForwardXvaInput(pair=pair, base_notional=base_notional, forward=float(q["forward"]),
                                 strike=float(q["forward_rate"]), t_years=float(q["t"]), df_quote_t=float(q["df_quote"]),
                                 quote_zero=float(q["quote_rate"]), direction=direction, vol_pct=vol_pct, vol_source=vol_source,
                                 spot01=float(q.get("spot01", q.get("delta_quote_per_pct", 0.0))), pillars=pillars or None)
    return inp, q


def _csa_of(db, uid: str, csa_body, collateral_body) -> CSA:
    try:
        csa = CSA.from_request(csa_body)
    except Exception as e:      # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"csa: {e}")
    return _with_collateral(db, uid, csa, collateral_body)


@router.post("/currency")
def currency_xva(body: CurrencyXvaRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """XVA for an FX or crypto forward through the rates waterfall (pricing/fx_xva.py)."""
    one_wrong_way(body)                 # before the limiter: a refused request does not use the allowance
    heavy(user, "XVA simulation", 6)
    from pricing import fx_xva
    pair = body.pair.upper()
    val_date = body.valuation_date or date.today()
    inp, q = forward_xva_input(db, user["sub"], pair, base_notional=body.base_notional, settlement=body.settlement_date,
                               forward_rate=body.forward_rate, direction=body.direction, val_date=val_date,
                               vol_pct=body.vol_pct, vol_mode=body.vol_mode)
    csa = _csa_of(db, user["sub"], body.csa, body.collateral)
    import time as _time
    _t0 = _time.perf_counter()
    wf, meta = fx_xva.forward_xva(inp, csa, n_paths=min(body.paths, 10000), cp_cds_bp=body.cp_cds_bp, own_cds_bp=body.own_cds_bp,
                                  ftp_bp=body.ftp_bp, fba_ratio=body.fba_ratio, lgd=body.lgd, own_lgd=body.own_lgd,
                                  hurdle_rate=body.hurdle_rate, capital_model=body.capital_model,
                                  counterparty_rw=body.counterparty_rw, wwr_multiplier=body.wwr_multiplier,
                                  cp_cds_curve=body.cp_cds_curve, own_cds_curve=body.own_cds_curve, ftp_curve=body.ftp_curve, seed=int(body.seed), simm_im_m=body.simm_im_m,
                                  cp_hazard_if_halves=body.cp_hazard_if_halves, own_hazard_if_halves=body.own_hazard_if_halves)
    _ms = (_time.perf_counter() - _t0) * 1000.0
    npv = float(q["npv"])
    # a fan of simulated MtM paths behind the profiles, as the rates tab draws: residual paths under a CSA, gross without
    raw = wf.exposure_paths if csa.collateralised else meta["_paths"]
    step = max(1, raw.shape[0] // min(80, raw.shape[0]))
    sample_paths = [[round(float(v), 0) for v in row] for row in raw[::step, :]]
    return {
        "sample_paths": sample_paths,
        "seed": int(body.seed), "engine_ms": round(_ms, 1), "path_steps": int(meta["n_paths"]) * int(meta["steps"]),
        "ee": [round(v, 2) for v in wf.ee], "ene": [round(v, 2) for v in wf.ene], "pfe": [round(v, 2) for v in wf.pfe],
        "ee_gross": [round(v, 2) for v in wf.ee_gross], "ene_gross": [round(v, 2) for v in wf.ene_gross],
        "collateral": [round(v, 2) for v in wf.collateral_mean], "im_profile": [round(v, 2) for v in wf.im_profile],
        "csa": csa.to_dict(), "steps": meta["steps"], "dt": meta["dt"], "n_paths": meta["n_paths"],
        "quote_currency": q["quote_currency"], "pair": pair,
        "xva": {"npv": round(npv, 2), "cva": round(wf.cva, 2), "dva": round(wf.dva, 2), "fva": round(wf.fva, 2),
                "fba": round(wf.fba, 2), "kva": round(wf.kva, 2), "mva": round(wf.mva, 2), "colva": round(wf.colva, 2),
                "xva_total": round(wf.xva_total, 2), "all_in": round(npv + wf.xva_total, 2),
                "annuity": round(float(sum(meta["p0_grid"][1:1 + meta["steps"]]) * meta["dt"]), 6) if meta.get("p0_grid") else None,
                "im_0": round(wf.im_0, 2), "ead_0": round(wf.ead_0, 2)},
        "capital": {"im_0": round(wf.im_0, 2), "ead_0": round(wf.ead_0, 2), "im_basis": meta["im_basis"], "im_rw_per_pct": meta["im_rw_per_pct"]},
        "wwr": wwr_block(meta.get("wwr")),
        "params": {k: meta[k] for k in ("vol_pct", "vol_source", "im_rw_per_pct", "im_basis", "model", "vol_mode", "step_vols_pct")},
    }


# ── Stand-alone XVA for an FX or digital-asset option, any style ──────────────────────────────

class CurrencyOptionXvaRequest(BaseModel):
    trade: dict                           # the ticket's booking body (instrument_type, notional, notional_ccy, maturity_date, terms)
    vol_pct: Optional[float] = None       # override; else the pair's surface at the option's expiry and strike
    paths: int = Field(default=2000, ge=200, le=10000)
    valuation_date: Optional[date] = None
    cp_cds_bp: float = 85.0
    own_cds_bp: float = 42.0
    ftp_bp: float = 55.0
    fba_ratio: float = 0.55
    lgd: float = 0.40
    own_lgd: float = 0.40
    hurdle_rate: float = 0.12
    capital_model: str = "sa_ccr"
    counterparty_rw: float = 1.0
    wwr_multiplier: float = 1.0
    cp_cds_curve: Optional[list] = None
    own_cds_curve: Optional[list] = None
    ftp_curve: Optional[list] = None
    csa: Optional[dict] = None
    # What the margin is held in (collateral/apply.py): {posted: {instrument: w}, received: {...}, im_posted?: {...}, rail?}.
    # Blank = cash in the CSA currency (zero carry): every number before instruments existed.
    collateral: Optional[dict] = None
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    vol_mode: str = "SURFACE"        # SURFACE: the term structure (and smile) along the paths; FLAT: one vol held
    simm_im_m: Optional[float] = None    # IM in $M for MVA; None = SIMM-style weight on the spot delta
    # wrong-way risk (pricing/xva_engine.path_survival): the multiple a party's default intensity takes when the asset
    # halves against its forward. 1 = default independent of the asset (the numbers before this existed)
    cp_hazard_if_halves: float = Field(default=1.0, ge=0.1, le=20.0)
    own_hazard_if_halves: float = Field(default=1.0, ge=0.1, le=20.0)


def currency_terms_of(d: dict) -> tuple[str, dict]:
    """The pair and the terms of a currency booking body (the ticket's), as the valuation reads a stored trade's."""
    from types import SimpleNamespace
    from pnl.valuation import _currency_terms
    itype = str(d.get("instrument_type") or "").upper()
    try:
        t = SimpleNamespace(terms=d.get("terms") or {}, instrument_type=itype, notional=d.get("notional"),
                            maturity_date=date.fromisoformat(str(d.get("maturity_date"))[:10]) if d.get("maturity_date") else None)
        return _currency_terms(t)
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"trade.terms is missing or malformed: {e}")


def option_xva_input(db, uid: str, pair: str, terms: dict, *, val_date: date, vol_pct: Optional[float], vol_mode: str):
    """The option priced today and its engine input: (OptionXvaInput, quote). One reading for POST /currency-option
    and for an option leg of POST /currency-package."""
    from api.routes.currencies import _price_option, spec_from
    from pricing import fx_xva
    q = _price_option(db, uid, pair, option_type=terms["option_type"], base_notional=float(terms["notional"]), expiry=terms["expiry"],
                      settlement=terms["settle"], strike=terms["K"], direction=terms["direction"], val_date=val_date, vol_pct=vol_pct,
                      spot_override=None, settlement_type=terms.get("settlement_type", "DELIVERABLE"), style_fields=terms.get("style_fields") or {})
    spec = spec_from(terms.get("style_fields") or {}, terms["option_type"], float(q["strike"]) if q.get("strike") is not None else None)
    if spec.strike is None and spec.style != "TOUCH":
        spec.strike = float(q["forward"])
    t_s = float(q.get("t_settle") or ((terms["settle"] - val_date).days / 365.0))
    df_q = float(q["df_quote"])
    pillars = _surface_pillars(db, uid, pair) if vol_pct is None and str(vol_mode).upper() != "FLAT" else None
    inp = fx_xva.OptionXvaInput(pair=pair, base_notional=float(terms["notional"]), spot=float(q["spot"]), forward=float(q["forward"]),
                                t_expiry=float(q.get("t_expiry") or ((terms["expiry"] - val_date).days / 365.0)), t_settle=t_s, df_quote_t=df_q,
                                quote_zero=-math.log(max(df_q, 1e-12)) / max(t_s, 1e-9), vol=float(q["vol"]), spec=spec,
                                direction=terms["direction"], spot01=float(q.get("spot01") or 0.0),
                                vol_source=("desk input" if vol_pct is not None else f"{pair}_VOL surface at the option's expiry and strike"),
                                pillars=pillars or None)
    return inp, q


@router.post("/currency-option")
def currency_option_xva(body: CurrencyOptionXvaRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """XVA for an FX or digital-asset option, any style, through the rates waterfall: the option valued along
    simulated spot paths with the credit engine's model (pricing/fx_xva.option_xva)."""
    one_wrong_way(body)                 # before the limiter: a refused request does not use the allowance
    heavy(user, "XVA simulation", 6)
    from pricing import fx_xva
    d = dict(body.trade or {})
    itype = str(d.get("instrument_type") or "").upper()
    if itype not in ("FX_OPTION", "CRYPTO_OPTION"):
        raise HTTPException(status_code=422, detail="trade.instrument_type must be FX_OPTION or CRYPTO_OPTION")
    val_date = body.valuation_date or date.today()
    pair, terms = currency_terms_of(d)
    inp, q = option_xva_input(db, user["sub"], pair, terms, val_date=val_date, vol_pct=body.vol_pct, vol_mode=body.vol_mode)
    spec = inp.spec
    csa = _csa_of(db, user["sub"], body.csa, body.collateral)
    import time as _time
    _t0 = _time.perf_counter()
    wf, meta = fx_xva.option_xva(inp, csa, n_paths=min(body.paths, 10000), cp_cds_bp=body.cp_cds_bp, own_cds_bp=body.own_cds_bp,
                                 ftp_bp=body.ftp_bp, fba_ratio=body.fba_ratio, lgd=body.lgd, own_lgd=body.own_lgd, hurdle_rate=body.hurdle_rate,
                                 capital_model=body.capital_model, counterparty_rw=body.counterparty_rw, wwr_multiplier=body.wwr_multiplier,
                                 cp_cds_curve=body.cp_cds_curve, own_cds_curve=body.own_cds_curve, ftp_curve=body.ftp_curve, seed=int(body.seed), simm_im_m=body.simm_im_m,
                                  cp_hazard_if_halves=body.cp_hazard_if_halves, own_hazard_if_halves=body.own_hazard_if_halves)
    _ms = (_time.perf_counter() - _t0) * 1000.0
    npv = float(q["npv"])
    raw = wf.exposure_paths if csa.collateralised else meta["_paths"]
    step = max(1, raw.shape[0] // min(80, raw.shape[0]))
    return {
        "sample_paths": [[round(float(v), 0) for v in row] for row in raw[::step, :]],
        "seed": int(body.seed), "engine_ms": round(_ms, 1), "path_steps": int(meta["n_paths"]) * int(meta["steps"]),
        "ee": [round(v, 2) for v in wf.ee], "ene": [round(v, 2) for v in wf.ene], "pfe": [round(v, 2) for v in wf.pfe],
        "ee_gross": [round(v, 2) for v in wf.ee_gross], "ene_gross": [round(v, 2) for v in wf.ene_gross],
        "collateral": [round(v, 2) for v in wf.collateral_mean], "im_profile": [round(v, 2) for v in wf.im_profile],
        "csa": csa.to_dict(), "steps": meta["steps"], "dt": meta["dt"], "n_paths": meta["n_paths"],
        "quote_currency": q["quote_currency"], "pair": pair, "style": spec.style, "expiry_step": None,
        "xva": {"npv": round(npv, 2), "cva": round(wf.cva, 2), "dva": round(wf.dva, 2), "fva": round(wf.fva, 2),
                "fba": round(wf.fba, 2), "kva": round(wf.kva, 2), "mva": round(wf.mva, 2), "colva": round(wf.colva, 2),
                "xva_total": round(wf.xva_total, 2), "all_in": round(npv + wf.xva_total, 2),
                "annuity": round(float(sum(meta["p0_grid"][1:1 + meta["steps"]]) * meta["dt"]), 6) if meta.get("p0_grid") else None,
                "im_0": round(wf.im_0, 2), "ead_0": round(wf.ead_0, 2)},
        "capital": {"im_0": round(wf.im_0, 2), "ead_0": round(wf.ead_0, 2), "im_basis": meta["im_basis"], "im_rw_per_pct": meta["im_rw_per_pct"]},
        "wwr": wwr_block(meta.get("wwr")),
        "params": {k: meta[k] for k in ("vol_pct", "vol_source", "im_rw_per_pct", "im_basis", "model", "style", "vol_mode")},
    }


# ── A package of legs on one pair, as one netting set ────────────────────────────────────────

PACKAGE_MAX_LEGS = 24
PACKAGE_MAX_YEARS = 10.0             # the longest settlement a package run takes
PACKAGE_MAX_WORK = 4_000_000         # legs × paths × monthly steps: what one run may cost
PACKAGE_FORWARDS = ("FX_FORWARD", "NDF", "CRYPTO_FORWARD")
PACKAGE_OPTIONS = ("FX_OPTION", "CRYPTO_OPTION")


class CurrencyPackageXvaRequest(BaseModel):
    trades: list[dict] = Field(min_length=1, max_length=PACKAGE_MAX_LEGS)   # the booking body of each leg, the ticket's first
    vol_pct: Optional[float] = None       # one override for every leg; else each leg reads the pair's surface as on its own
    paths: int = Field(default=2000, ge=200, le=10000)
    valuation_date: Optional[date] = None
    cp_cds_bp: float = 85.0
    own_cds_bp: float = 42.0
    ftp_bp: float = 55.0
    fba_ratio: float = 0.55
    lgd: float = 0.40
    own_lgd: float = 0.40
    hurdle_rate: float = 0.12
    capital_model: str = "sa_ccr"
    counterparty_rw: float = 1.0
    wwr_multiplier: float = 1.0
    cp_cds_curve: Optional[list] = None
    own_cds_curve: Optional[list] = None
    ftp_curve: Optional[list] = None
    csa: Optional[dict] = None
    collateral: Optional[dict] = None
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    vol_mode: str = "SURFACE"
    simm_im_m: Optional[float] = None
    # wrong-way risk (pricing/xva_engine.path_survival): the multiple a party's default intensity takes when the asset
    # halves against its forward. 1 = default independent of the asset (the numbers before this existed)
    cp_hazard_if_halves: float = Field(default=1.0, ge=0.1, le=20.0)
    own_hazard_if_halves: float = Field(default=1.0, ge=0.1, le=20.0)


def package_inputs(db, uid: str, trades: list[dict], *, val_date: date, vol_pct: Optional[float], vol_mode: str) -> tuple[list, list[dict], str]:
    """Each leg's engine input and its quote, read as the leg's own route reads it; the pair they share."""
    inputs, quotes, pairs = [], [], set()
    for n, d in enumerate(trades, start=1):
        d = dict(d or {})
        itype = str(d.get("instrument_type") or "").upper()
        if itype not in PACKAGE_FORWARDS + PACKAGE_OPTIONS:
            raise HTTPException(status_code=422, detail=f"leg {n}: instrument_type must be one of {', '.join(PACKAGE_FORWARDS + PACKAGE_OPTIONS)}")
        pair, terms = currency_terms_of(d)
        pairs.add(pair)
        if len(pairs) > 1:
            raise HTTPException(status_code=422, detail=f"leg {n} is on {pair}: every leg of a package is on the same pair")
        try:
            if itype in PACKAGE_OPTIONS:
                inp, q = option_xva_input(db, uid, pair, terms, val_date=val_date, vol_pct=vol_pct, vol_mode=vol_mode)
            else:
                inp, q = forward_xva_input(db, uid, pair, base_notional=float(terms["notional"]), settlement=terms["settle"], forward_rate=terms["K"],
                                           direction=terms["direction"], val_date=val_date, vol_pct=vol_pct, vol_mode=vol_mode)
        except HTTPException as e:
            raise HTTPException(status_code=e.status_code, detail=f"leg {n}: {e.detail}")
        inputs.append(inp)
        quotes.append(q)
    return inputs, quotes, next(iter(pairs))


@router.post("/currency-package")
def currency_package_xva(body: CurrencyPackageXvaRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """XVA for a package of FX or digital-asset legs on one pair (forwards and options of any style) as ONE
    netting set: every leg on the same simulated paths, so they net before the charge is taken
    (pricing/fx_xva.package_xva). The answer has the shape of POST /currency, plus a row per leg."""
    one_wrong_way(body)                 # before the limiter: a refused request does not use the allowance
    heavy(user, "XVA simulation", 6)
    from pricing import fx_xva
    val_date = body.valuation_date or date.today()
    inputs, quotes, pair = package_inputs(db, user["sub"], body.trades, val_date=val_date, vol_pct=body.vol_pct, vol_mode=body.vol_mode)
    csa = _csa_of(db, user["sub"], body.csa, body.collateral)
    horizon = max(fx_xva._horizon(i) for i in inputs)
    if horizon > PACKAGE_MAX_YEARS:
        raise HTTPException(status_code=422, detail=f"a package run takes settlements up to {PACKAGE_MAX_YEARS:.0f} years out; the longest leg settles in {horizon:.1f}")
    work = len(inputs) * min(body.paths, 10000) * fx_xva.monthly_grid(horizon)[0]
    if work > PACKAGE_MAX_WORK:
        fits = max(200, int(PACKAGE_MAX_WORK / (len(inputs) * fx_xva.monthly_grid(horizon)[0]) // 100 * 100))
        raise HTTPException(status_code=422, detail=f"{len(inputs)} legs to {horizon:.1f} years at {body.paths} paths is more than one run takes; {fits} paths fit")
    import time as _time
    _t0 = _time.perf_counter()
    wf, meta = fx_xva.package_xva(inputs, csa, n_paths=min(body.paths, 10000), cp_cds_bp=body.cp_cds_bp, own_cds_bp=body.own_cds_bp,
                                  ftp_bp=body.ftp_bp, fba_ratio=body.fba_ratio, lgd=body.lgd, own_lgd=body.own_lgd, hurdle_rate=body.hurdle_rate,
                                  capital_model=body.capital_model, counterparty_rw=body.counterparty_rw, wwr_multiplier=body.wwr_multiplier,
                                  cp_cds_curve=body.cp_cds_curve, own_cds_curve=body.own_cds_curve, ftp_curve=body.ftp_curve, seed=int(body.seed), simm_im_m=body.simm_im_m,
                                  cp_hazard_if_halves=body.cp_hazard_if_halves, own_hazard_if_halves=body.own_hazard_if_halves)
    _ms = (_time.perf_counter() - _t0) * 1000.0
    npv = float(sum(float(q["npv"]) for q in quotes))
    raw = wf.exposure_paths if csa.collateralised else meta["_paths"]
    step = max(1, raw.shape[0] // min(80, raw.shape[0]))
    legs = [{"leg": n, "instrument_type": str(d.get("instrument_type") or "").upper(), "npv": round(float(q["npv"]), 2),
             "settles": round(float(row["horizon"]), 4), "ee_gross_peak": round(float(row["ee_gross_peak"]), 2)}
            for n, (d, q, row) in enumerate(zip(body.trades, quotes, meta["_legs"]), start=1)]
    return {
        "sample_paths": [[round(float(v), 0) for v in r] for r in raw[::step, :]],
        "seed": int(body.seed), "engine_ms": round(_ms, 1), "path_steps": int(meta["n_paths"]) * int(meta["steps"]),
        "ee": [round(v, 2) for v in wf.ee], "ene": [round(v, 2) for v in wf.ene], "pfe": [round(v, 2) for v in wf.pfe],
        "ee_gross": [round(v, 2) for v in wf.ee_gross], "ene_gross": [round(v, 2) for v in wf.ene_gross],
        "collateral": [round(v, 2) for v in wf.collateral_mean], "im_profile": [round(v, 2) for v in wf.im_profile],
        "csa": csa.to_dict(), "steps": meta["steps"], "dt": meta["dt"], "n_paths": meta["n_paths"],
        "quote_currency": quotes[0]["quote_currency"], "pair": pair, "package": True, "legs": legs,
        "xva": {"npv": round(npv, 2), "cva": round(wf.cva, 2), "dva": round(wf.dva, 2), "fva": round(wf.fva, 2),
                "fba": round(wf.fba, 2), "kva": round(wf.kva, 2), "mva": round(wf.mva, 2), "colva": round(wf.colva, 2),
                "xva_total": round(wf.xva_total, 2), "all_in": round(npv + wf.xva_total, 2),
                "annuity": round(float(sum(meta["p0_grid"][1:1 + meta["steps"]]) * meta["dt"]), 6) if meta.get("p0_grid") else None,
                "im_0": round(wf.im_0, 2), "ead_0": round(wf.ead_0, 2)},
        "capital": {"im_0": round(wf.im_0, 2), "ead_0": round(wf.ead_0, 2), "im_basis": meta["im_basis"], "im_rw_per_pct": meta["im_rw_per_pct"]},
        "wwr": wwr_block(meta.get("wwr")),
        "params": {k: meta[k] for k in ("vol_pct", "vol_source", "im_rw_per_pct", "im_basis", "model", "vol_mode")},
    }


# ── Incremental XVA: the netting set with the trade and without it ───────────────────────────

class IncrementalXvaRequest(BaseModel):
    counterparty_id: Optional[str] = None
    trade: Optional[dict] = None          # the booking body the ticket would send (instrument_type, terms, legs, ...)
    trades: Optional[list[dict]] = Field(default=None, max_length=24)   # or a package: the booking body of each leg
    trade_id: Optional[str] = None        # or a stored trade: the marginal effect of removing it
    n_paths: Optional[int] = Field(default=None, ge=200, le=5000)


XVA_KEYS = ("cva", "dva", "fva", "fba", "kva", "mva", "colva")


def hypothetical_trade(d: dict, counterparty_id, user_id: str):
    """A Trade-shaped object the credit engine can value without a row: the ticket's booking body, its legs
    completed per currency convention as POST /api/book/trade would store them."""
    from types import SimpleNamespace
    from api.routes._instrument_alias import normalize_instrument_type
    from api.routes._leg_defaults import complete_leg
    d = dict(d or {})
    itype = normalize_instrument_type(d.get("instrument_type"))
    if not itype:
        raise HTTPException(status_code=422, detail="trade.instrument_type is required")
    def _d(k):
        v = d.get(k)
        try:
            return date.fromisoformat(str(v)[:10]) if v else None
        except ValueError:
            raise HTTPException(status_code=422, detail=f"trade.{k} must be an ISO date")
    eff, mat = _d("effective_date"), _d("maturity_date")
    if not mat:
        raise HTTPException(status_code=422, detail="trade.maturity_date is required")
    ccy = str(d.get("notional_ccy") or "USD").upper()
    legs = [complete_leg(dict(l), effective_date=eff, maturity_date=mat, currency=ccy,
                         discount_curve_id=d.get("discount_curve_id"), forecast_curve_id=d.get("forecast_curve_id"))
            for l in (d.get("legs") or [])]
    for lg in legs:
        for k in ("effective_date", "maturity_date"):
            if lg.get(k) is not None and not isinstance(lg[k], str):
                lg[k] = str(lg[k])
    return SimpleNamespace(id=uuid.uuid4(), trade_ref="THIS TRADE", instrument_type=itype, structure=d.get("structure"),
                           notional=float(d.get("notional") or 0.0), notional_ccy=ccy, trade_date=_d("trade_date") or date.today(),
                           effective_date=eff or date.today(), maturity_date=mat, terms=dict(d.get("terms") or {}),
                           counterparty_id=counterparty_id, user_id=user_id, status="PENDING",
                           discount_curve_id=d.get("discount_curve_id") or (legs[0].get("discount_curve_id") if legs else None),
                           forecast_curve_id=d.get("forecast_curve_id"), asset_class=d.get("asset_class"), _legs=legs)


def xva_levels(rep: Optional[dict]) -> dict:
    """The six components and their total from a counterparty report; zeros for an empty set."""
    x = (rep or {}).get("xva") or {}
    out = {k: float(x.get(f"{k}_usd") or 0.0) for k in XVA_KEYS}
    out["total"] = sum(out.values())
    return out


def align_ee(r0: Optional[dict], r1: Optional[dict]) -> dict:
    """EE profiles on one date grid: the two runs can end on different dates when the new trade is the longest."""
    g0 = list(zip((r0 or {}).get("grid") or [], (r0 or {}).get("ee_rn") or []))
    g1 = list(zip((r1 or {}).get("grid") or [], (r1 or {}).get("ee_rn") or []))
    grid = sorted({d for d, _ in g0} | {d for d, _ in g1})
    d0, d1 = dict(g0), dict(g1)
    return {"grid": grid, "without": [round(d0.get(d, 0.0), 2) for d in grid], "with": [round(d1.get(d, 0.0), 2) for d in grid]}


@router.post("/incremental")
def incremental_xva(body: IncrementalXvaRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """The counterparty's netting set valued on the credit engine's risk-neutral paths with the trade and
    without it, same paths (common random numbers): the charge the desk quotes, not the trade on its own."""
    if not body.trade and not body.trade_id and not body.trades:
        raise HTTPException(status_code=422, detail="trade, trades or trade_id is required")
    heavy(user, "counterparty run", 4)
    import time as _time
    from ccr.report import LIVE, counterparty_report, settings
    from db.models import Counterparty, Trade
    from pnl.market import Market
    from risk.report import firm_of, template_uid
    t0 = _time.time()
    uid = user["sub"]
    dates = Market.dates(db, uid, upto=date.today())
    if not dates:
        raise HTTPException(status_code=422, detail="No market dates: save or snap a curve first.")
    asof = dates[-1]
    mkt = Market(db, uid, asof)
    st = dict(settings(db, firm_of(db, uid)))
    if body.n_paths:
        st["n_paths"] = int(body.n_paths)
    tpl = template_uid(db)
    cp = None
    if body.counterparty_id:
        try:
            cpid = uuid.UUID(body.counterparty_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="counterparty_id must be a UUID")
        cp = db.query(Counterparty).filter(Counterparty.id == cpid, Counterparty.user_id == uuid.UUID(uid)).first()
        if cp is None:
            raise HTTPException(status_code=404, detail="Counterparty not found")
    cp_id = cp.id if cp else None
    existing = [t for t in db.query(Trade).filter(Trade.user_id == uuid.UUID(uid), Trade.counterparty_id == cp_id).all() if t.status in LIVE]
    if body.trade_id:
        try:
            tid = uuid.UUID(body.trade_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="trade_id must be a UUID")
        if not any(t.id == tid for t in existing):
            raise HTTPException(status_code=404, detail="Trade not found in this counterparty's live set")
        with_trades, without, mode = existing, [t for t in existing if t.id != tid], "MARGINAL"
    else:
        # one trade, or a package: every leg joins the set, so the charge is the package's, its legs netted
        hyps = [hypothetical_trade(d, cp_id, uid) for d in (body.trades or [body.trade])]
        if len(hyps) > 1:
            for n, h in enumerate(hyps, start=1):
                h.trade_ref = f"LEG {n}"
        with_trades, without, mode = existing + hyps, existing, "INCREMENTAL"

    def run(trades):
        if not trades:
            return None
        try:
            return counterparty_report(db, user, cp, trades, asof, mkt, st, tpl, exposure=False)
        except HTTPException:
            raise
        except Exception as e:          # noqa: BLE001
            db.rollback()
            raise internal(422, "The credit engine could not value this set", e)

    r0, r1 = run(without), run(with_trades)
    if r1 is None or r1.get("empty"):
        reasons = "; ".join(f"{x.get('trade_ref')}: {x.get('reason')}" for x in (r1 or {}).get("skipped") or [])
        raise HTTPException(status_code=422, detail=f"The trade cannot be valued on the exposure paths yet. {reasons}".strip())
    w0, w1 = xva_levels(r0), xva_levels(r1)
    inc = {k: round(w1[k] - w0[k], 2) for k in list(XVA_KEYS) + ["total"]}
    notes = ["common random numbers: both runs draw the same paths (seed 7), so the difference is the trade, not the noise",
             "risk-neutral measure: the Hull-White parameters calibrated to the swaption surface, the spots' implied vols, the drift from the curves",
             "the CSA, threshold and MTA are the counterparty record's; IM when the record exchanges it"]
    if r1.get("skipped"):
        notes.append("not on the paths: " + "; ".join(f"{x.get('trade_ref')} ({x.get('reason')})" for x in r1["skipped"]))
    return {"mode": mode, "counterparty": r1.get("counterparty"), "counterparty_id": r1.get("counterparty_id"), "asof": asof.isoformat(),
            "csa": r1.get("csa_model"), "measure": "RISK_NEUTRAL", "n_paths": r1.get("n_paths"), "months": r1.get("months"),
            "other_trades": len(without), "legs": len(with_trades) - len(without) if mode == "INCREMENTAL" else 1, "without": {k: round(v, 2) for k, v in w0.items()}, "with": {k: round(v, 2) for k, v in w1.items()},
            "incremental": inc, "ee": align_ee(r0, r1), "cp_cds_bp": float(st.get("cp_cds_bp") or 85.0), "lgd": float(st.get("lgd") or 0.4),
            "notes": notes, "seconds": round(_time.time() - t0, 1)}
