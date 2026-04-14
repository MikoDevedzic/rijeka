"""
Rijeka — market_data routes (Sprint 4F)

POST /api/market-data/snapshots
  Save or update a curve's pillar quotes for a given valuation date.
  UPSERT on (curve_id, valuation_date).

GET /api/market-data/snapshots/{curve_id}/latest
  Return the most recent snapshot for a curve_id.
  Used by pricer to auto-load curves.

GET /api/market-data/snapshots/{curve_id}
  Return all snapshots for a curve_id (newest first, limit 30).

GET /api/market-data/snapshots/date/{valuation_date}
  Return all curve snapshots for a given date.
  Used by the PRICER tile to load a full market data set.
"""

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token

router = APIRouter(prefix="/api/market-data", tags=["market-data"])


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────

class PillarQuoteIn(BaseModel):
    tenor: str
    quote_type: str      # OISDeposit | OIS | BASIS | FRA | FUTURES
    rate: float          # stored as % (5.310 = 5.310%)
    enabled: bool = True


class SnapshotIn(BaseModel):
    curve_id: str
    valuation_date: date
    quotes: List[PillarQuoteIn]
    source: str = "MANUAL"


class SnapshotOut(BaseModel):
    id: str
    curve_id: str
    valuation_date: date
    quotes: list
    source: str
    created_at: datetime
    created_by: Optional[str]


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/snapshots", response_model=SnapshotOut)
async def save_snapshot(
    body: SnapshotIn,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Save or update a curve snapshot. UPSERT on (curve_id, valuation_date).
    Requires TRADER or ADMIN role.
    """
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")

    user_id = user.get("sub")
    quotes_json = [q.dict() for q in body.quotes]

    import json as _json
    result = db.execute(
        text("""
            INSERT INTO market_data_snapshots
              (curve_id, valuation_date, quotes, source, created_by)
            VALUES
              (:curve_id, :valuation_date, cast(:quotes as jsonb), :source, :created_by)
            ON CONFLICT (curve_id, valuation_date)
            DO UPDATE SET
              quotes     = EXCLUDED.quotes,
              source     = EXCLUDED.source,
              created_at = NOW(),
              created_by = EXCLUDED.created_by
            RETURNING id, curve_id, valuation_date, quotes, source, created_at, created_by
        """),
        {
            "curve_id":       body.curve_id,
            "valuation_date": body.valuation_date,
            "quotes":         _json.dumps(quotes_json),
            "source":         body.source,
            "created_by":     user_id,
        }
    )
    db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="Snapshot save failed")

    return SnapshotOut(
        id=str(row.id),
        curve_id=row.curve_id,
        valuation_date=row.valuation_date,
        quotes=row.quotes if isinstance(row.quotes, list) else [],
        source=row.source,
        created_at=row.created_at,
        created_by=str(row.created_by) if row.created_by else None,
    )


@router.get("/snapshots/{curve_id}/latest")
async def get_latest_snapshot(
    curve_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Return the most recent snapshot for a curve_id.
    Returns null if no snapshot exists.
    """
    result = db.execute(
        text("""
            SELECT id, curve_id, valuation_date, quotes, source, created_at, created_by
            FROM market_data_snapshots
            WHERE curve_id = :curve_id
            ORDER BY valuation_date DESC
            LIMIT 1
        """),
        {"curve_id": curve_id}
    )
    row = result.fetchone()
    if not row:
        return {"exists": False, "curve_id": curve_id}

    return {
        "exists":         True,
        "id":             str(row.id),
        "curve_id":       row.curve_id,
        "valuation_date": row.valuation_date.isoformat(),
        "quotes":         row.quotes if isinstance(row.quotes, list) else [],
        "source":         row.source,
        "created_at":     row.created_at.isoformat(),
    }


@router.get("/snapshots/{curve_id}")
async def get_curve_snapshots(
    curve_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """Return all snapshots for a curve_id, newest first (limit 30)."""
    result = db.execute(
        text("""
            SELECT id, curve_id, valuation_date, quotes, source, created_at
            FROM market_data_snapshots
            WHERE curve_id = :curve_id
            ORDER BY valuation_date DESC
            LIMIT 30
        """),
        {"curve_id": curve_id}
    )
    rows = result.fetchall()
    return [
        {
            "id":             str(r.id),
            "curve_id":       r.curve_id,
            "valuation_date": r.valuation_date.isoformat(),
            "quotes":         r.quotes if isinstance(r.quotes, list) else [],
            "source":         r.source,
            "created_at":     r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/snapshots/date/{valuation_date}")
async def get_snapshots_by_date(
    valuation_date: date,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Return all curve snapshots for a given valuation date.
    Used by PRICER tile to load a full market data set for a date.
    """
    result = db.execute(
        text("""
            SELECT id, curve_id, valuation_date, quotes, source, created_at
            FROM market_data_snapshots
            WHERE valuation_date = :valuation_date
            ORDER BY curve_id
        """),
        {"valuation_date": valuation_date}
    )
    rows = result.fetchall()
    return [
        {
            "id":             str(r.id),
            "curve_id":       r.curve_id,
            "valuation_date": r.valuation_date.isoformat(),
            "quotes":         r.quotes if isinstance(r.quotes, list) else [],
            "source":         r.source,
            "created_at":     r.created_at.isoformat(),
        }
        for r in rows
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Vol Skew (OTM Spreads) — Sprint 8
# ─────────────────────────────────────────────────────────────────────────────

class SkewCellIn(BaseModel):
    expiry_label: str
    tenor_label:  str
    expiry_y:     float
    tenor_y:      float
    atm_vol_bp:   float
    spread_m200:  Optional[float] = None
    spread_m100:  Optional[float] = None
    spread_m50:   Optional[float] = None
    spread_m25:   Optional[float] = None
    spread_p25:   Optional[float] = None
    spread_p50:   Optional[float] = None
    spread_p100:  Optional[float] = None
    spread_p200:  Optional[float] = None
    source:       str = "MANUAL"


class VolSkewIn(BaseModel):
    valuation_date: date
    cells: List[SkewCellIn]


@router.post("/vol-skew")
async def save_vol_skew(
    body: VolSkewIn,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Save OTM vol skew spreads (relative to ATM) for all (expiry, tenor) buckets.
    UPSERT on (valuation_date, expiry_label, tenor_label).
    After saving, triggers SABR calibration for each bucket.
    """
    import json as _json
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")

    user_id = user.get("sub")
    saved = 0

    for cell in body.cells:
        db.execute(
            text("""
                INSERT INTO swaption_vol_skew
                  (valuation_date, expiry_label, tenor_label, expiry_y, tenor_y,
                   atm_vol_bp,
                   spread_m200, spread_m100, spread_m50, spread_m25,
                   spread_p25,  spread_p50,  spread_p100, spread_p200,
                   source, created_by)
                VALUES
                  (:val_date, :exp_lbl, :ten_lbl, :exp_y, :ten_y,
                   :atm_vol,
                   :sm200, :sm100, :sm50, :sm25,
                   :sp25,  :sp50,  :sp100, :sp200,
                   :source, :created_by)
                ON CONFLICT (valuation_date, expiry_label, tenor_label)
                DO UPDATE SET
                  expiry_y    = EXCLUDED.expiry_y,
                  tenor_y     = EXCLUDED.tenor_y,
                  atm_vol_bp  = EXCLUDED.atm_vol_bp,
                  spread_m200 = EXCLUDED.spread_m200,
                  spread_m100 = EXCLUDED.spread_m100,
                  spread_m50  = EXCLUDED.spread_m50,
                  spread_m25  = EXCLUDED.spread_m25,
                  spread_p25  = EXCLUDED.spread_p25,
                  spread_p50  = EXCLUDED.spread_p50,
                  spread_p100 = EXCLUDED.spread_p100,
                  spread_p200 = EXCLUDED.spread_p200,
                  source      = EXCLUDED.source,
                  created_at  = NOW(),
                  created_by  = EXCLUDED.created_by
            """),
            {
                "val_date":   body.valuation_date,
                "exp_lbl":    cell.expiry_label,
                "ten_lbl":    cell.tenor_label,
                "exp_y":      cell.expiry_y,
                "ten_y":      cell.tenor_y,
                "atm_vol":    cell.atm_vol_bp,
                "sm200":      cell.spread_m200,
                "sm100":      cell.spread_m100,
                "sm50":       cell.spread_m50,
                "sm25":       cell.spread_m25,
                "sp25":       cell.spread_p25,
                "sp50":       cell.spread_p50,
                "sp100":      cell.spread_p100,
                "sp200":      cell.spread_p200,
                "source":     cell.source,
                "created_by": user_id,
            }
        )
        saved += 1

    db.commit()

    # Auto-calibrate SABR for each saved bucket
    calibrated = 0
    errors = []
    for cell in body.cells:
        if cell.atm_vol_bp is None:
            continue
        try:
            from pricing.sabr import calibrate_sabr
            # Build strike→vol dict from spreads (relative to ATM)
            # Forward rate proxy — use a reasonable USD SOFR level
            # The exact F doesn't affect β=0 Normal SABR calibration much
            # since the smile shape (ρ, ν) is determined by relative strike
            # distances, not absolute rate level. 3.5% is a reasonable proxy.
            F_approx = 0.035
            T = cell.expiry_y
            atm_vol = cell.atm_vol_bp / 10000.0

            # Build strike_vols from spreads: offset_bp → atm + spread
            strike_vols = {}
            for offset_bp, spread in [
                (-200, cell.spread_m200), (-100, cell.spread_m100),
                (-50,  cell.spread_m50),  (-25,  cell.spread_m25),
                (25,   cell.spread_p25),  (50,   cell.spread_p50),
                (100,  cell.spread_p100), (200,  cell.spread_p200),
            ]:
                if spread is not None:
                    strike_vols[offset_bp] = cell.atm_vol_bp + spread

            alpha, rho, nu, rmse_bp = calibrate_sabr(
                F=F_approx, T=T, atm_vol=atm_vol,
                strike_vols=strike_vols,
            )
            # scipy returns numpy.float64 — convert to Python float
            # psycopg2 cannot serialize numpy types and misparses them as schema names
            alpha   = float(alpha)
            rho     = float(rho)
            nu      = float(nu)
            rmse_bp = float(rmse_bp)

            # Convert numpy floats → Python floats (psycopg2 requirement)
            alpha   = float(alpha)
            rho     = float(rho)
            nu      = float(nu)
            rmse_bp = float(rmse_bp)

            db.execute(
                text("""
                    INSERT INTO sabr_params
                      (valuation_date, expiry_label, tenor_label,
                       expiry_y, tenor_y, alpha, rho, nu, beta,
                       atm_vol_bp, fit_rmse_bp, source, created_by)
                    VALUES
                      (:val_date, :exp_lbl, :ten_lbl,
                       :exp_y, :ten_y, :alpha, :rho, :nu, 0.0,
                       :atm_vol_bp, :rmse_bp, 'AUTO', :created_by)
                    ON CONFLICT (valuation_date, expiry_y, tenor_y)
                    DO UPDATE SET
                      alpha       = EXCLUDED.alpha,
                      rho         = EXCLUDED.rho,
                      nu          = EXCLUDED.nu,
                      atm_vol_bp  = EXCLUDED.atm_vol_bp,
                      fit_rmse_bp = EXCLUDED.fit_rmse_bp,
                      source      = 'AUTO',
                      created_at  = NOW(),
                      created_by  = EXCLUDED.created_by
                """),
                {
                    "val_date":   body.valuation_date,
                    "exp_lbl":    cell.expiry_label,
                    "ten_lbl":    cell.tenor_label,
                    "exp_y":      cell.expiry_y,
                    "ten_y":      cell.tenor_y,
                    "alpha":      alpha,
                    "rho":        rho,
                    "nu":         nu,
                    "atm_vol_bp": cell.atm_vol_bp,
                    "rmse_bp":    rmse_bp,
                    "created_by": user_id,
                }
            )
            calibrated += 1
        except Exception as e:
            import traceback
            errors.append(f"{cell.expiry_label}x{cell.tenor_label}: {str(e)[:120]} | {traceback.format_exc()[-200:]}")

    db.commit()

    # ── Interpolation pass — fill every (expiry, tenor) bucket ───────────────
    # After calibrating the liquid buckets, bilinear-interpolate SABR params
    # for all remaining (expiry, tenor) combinations on the surface.
    # This is the whole point of SABR — sparse market data → dense surface.
    interpolated = 0
    interp_errors = []
    try:
        from pricing.sabr import interpolate_sabr_params

        # Load all freshly calibrated params
        cal_rows = db.execute(
            text("""
                SELECT expiry_y, tenor_y, alpha, rho, nu, atm_vol_bp, expiry_label, tenor_label
                FROM sabr_params
                WHERE valuation_date = :val_date
                ORDER BY expiry_y, tenor_y
            """),
            {"val_date": body.valuation_date}
        ).fetchall()

        if len(cal_rows) >= 2:
            buckets = [
                {
                    "expiry_y": r.expiry_y, "tenor_y": r.tenor_y,
                    "alpha": r.alpha, "rho": r.rho, "nu": r.nu,
                }
                for r in cal_rows
            ]
            calibrated_keys = {(r.expiry_y, r.tenor_y) for r in cal_rows}

            # All (expiry, tenor) combinations on the surface
            EXPIRY_MAP = {"1Y":1.0,"2Y":2.0,"3Y":3.0,"5Y":5.0,"7Y":7.0,"10Y":10.0}
            TENOR_MAP  = {"1Y":1.0,"2Y":2.0,"3Y":3.0,"5Y":5.0,"7Y":7.0,"9Y":9.0}

            for exp_lbl, exp_y in EXPIRY_MAP.items():
                for ten_lbl, ten_y in TENOR_MAP.items():
                    if (exp_y, ten_y) in calibrated_keys:
                        continue  # already have direct calibration

                    # Get ATM vol for this bucket from snapshots
                    atm_row = db.execute(
                        text("""
                            SELECT quotes FROM market_data_snapshots
                            WHERE curve_id = 'USD_SWVOL_ATM'
                            ORDER BY valuation_date DESC LIMIT 1
                        """)
                    ).fetchone()
                    atm_vol = None
                    if atm_row and atm_row.quotes:
                        for q in atm_row.quotes:
                            lbl = q.get("tenor","")
                            if lbl == f"{exp_lbl}x{ten_lbl}" or \
                               (q.get("expiry") == exp_lbl and q.get("swp_tenor") == ten_lbl):
                                atm_vol = q.get("rate") or q.get("vol_bp")
                                break

                    params = interpolate_sabr_params(exp_y, ten_y, buckets)
                    if params is None:
                        continue

                    alpha, rho, nu = params
                    # Ensure Python floats — interpolation may return numpy types
                    alpha = float(alpha)
                    rho   = float(rho)
                    nu    = float(nu)
                    alpha = float(alpha)
                    rho   = float(rho)
                    nu    = float(nu)
                    db.execute(
                        text("""
                            INSERT INTO sabr_params
                              (valuation_date, expiry_label, tenor_label,
                               expiry_y, tenor_y, alpha, rho, nu, beta,
                               atm_vol_bp, fit_rmse_bp, source, created_by)
                            VALUES
                              (:val_date, :exp_lbl, :ten_lbl,
                               :exp_y, :ten_y, :alpha, :rho, :nu, 0.0,
                               :atm_vol_bp, NULL, 'INTERPOLATED', :created_by)
                            ON CONFLICT (valuation_date, expiry_y, tenor_y)
                            DO UPDATE SET
                              alpha       = EXCLUDED.alpha,
                              rho         = EXCLUDED.rho,
                              nu          = EXCLUDED.nu,
                              atm_vol_bp  = EXCLUDED.atm_vol_bp,
                              fit_rmse_bp = NULL,
                              source      = 'INTERPOLATED',
                              created_at  = NOW(),
                              created_by  = EXCLUDED.created_by
                        """),
                        {
                            "val_date":   body.valuation_date,
                            "exp_lbl":    exp_lbl,
                            "ten_lbl":    ten_lbl,
                            "exp_y":      exp_y,
                            "ten_y":      ten_y,
                            "alpha":      alpha,
                            "rho":        rho,
                            "nu":         nu,
                            "atm_vol_bp": atm_vol,
                            "created_by": user_id,
                        }
                    )
                    interpolated += 1

            db.commit()
    except Exception as e:
        interp_errors.append(str(e)[:120])

    return {
        "saved":        saved,
        "calibrated":   calibrated,
        "interpolated": interpolated,
        "errors":       errors + interp_errors,
        "date":         body.valuation_date.isoformat(),
    }


@router.get("/vol-skew/latest")
async def get_latest_vol_skew(
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """Return the most recent full OTM skew surface."""
    result = db.execute(
        text("""
            SELECT expiry_label, tenor_label, expiry_y, tenor_y,
                   atm_vol_bp,
                   spread_m200, spread_m100, spread_m50, spread_m25,
                   spread_p25,  spread_p50,  spread_p100, spread_p200,
                   source, valuation_date
            FROM swaption_vol_skew
            WHERE valuation_date = (
                SELECT MAX(valuation_date) FROM swaption_vol_skew
            )
            ORDER BY expiry_y, tenor_y
        """)
    )
    rows = result.fetchall()
    if not rows:
        return {"exists": False, "cells": []}

    return {
        "exists":         True,
        "valuation_date": rows[0].valuation_date.isoformat(),
        "cells": [
            {
                "expiry_label": r.expiry_label,
                "tenor_label":  r.tenor_label,
                "expiry_y":     r.expiry_y,
                "tenor_y":      r.tenor_y,
                "atm_vol_bp":   r.atm_vol_bp,
                "spread_m200":  r.spread_m200,
                "spread_m100":  r.spread_m100,
                "spread_m50":   r.spread_m50,
                "spread_m25":   r.spread_m25,
                "spread_p25":   r.spread_p25,
                "spread_p50":   r.spread_p50,
                "spread_p100":  r.spread_p100,
                "spread_p200":  r.spread_p200,
                "source":       r.source,
            }
            for r in rows
        ],
    }


@router.get("/sabr-params/latest")
async def get_latest_sabr_params(
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """Return calibrated SABR params for latest available date."""
    result = db.execute(
        text("""
            SELECT expiry_label, tenor_label, expiry_y, tenor_y,
                   alpha, rho, nu, beta, atm_vol_bp, fit_rmse_bp,
                   valuation_date
            FROM sabr_params
            WHERE valuation_date = (
                SELECT MAX(valuation_date) FROM sabr_params
            )
            ORDER BY expiry_y, tenor_y
        """)
    )
    rows = result.fetchall()
    if not rows:
        return {"exists": False, "params": []}

    return {
        "exists":         True,
        "valuation_date": rows[0].valuation_date.isoformat(),
        "params": [
            {
                "expiry_label": r.expiry_label,
                "tenor_label":  r.tenor_label,
                "expiry_y":     r.expiry_y,
                "tenor_y":      r.tenor_y,
                "alpha":        r.alpha,
                "rho":          r.rho,
                "nu":           r.nu,
                "beta":         r.beta,
                "atm_vol_bp":   r.atm_vol_bp,
                "fit_rmse_bp":  r.fit_rmse_bp,
            }
            for r in rows
        ],
    }


@router.post("/sabr-params/manual")
async def save_manual_sabr_params(
    body: dict,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Save manually-specified SABR parameters, bypassing calibration.
    Used when market data is thin or quant team wants to override.
    source = 'MANUAL' marks these as user-set vs AUTO from calibration.
    """
    import json as _json
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")

    user_id    = user.get("sub")
    val_date   = body.get("valuation_date")
    params     = body.get("params", [])
    saved      = 0

    for p in params:
        db.execute(
            text("""
                INSERT INTO sabr_params
                  (valuation_date, expiry_label, tenor_label,
                   expiry_y, tenor_y, alpha, rho, nu, beta,
                   atm_vol_bp, fit_rmse_bp, source, created_by)
                VALUES
                  (:val_date, :exp_lbl, :ten_lbl,
                   :exp_y, :ten_y, :alpha, :rho, :nu, 0.0,
                   :atm_vol_bp, NULL, 'MANUAL', :created_by)
                ON CONFLICT (valuation_date, expiry_y, tenor_y)
                DO UPDATE SET
                  alpha       = EXCLUDED.alpha,
                  rho         = EXCLUDED.rho,
                  nu          = EXCLUDED.nu,
                  atm_vol_bp  = EXCLUDED.atm_vol_bp,
                  fit_rmse_bp = NULL,
                  source      = 'MANUAL',
                  created_at  = NOW(),
                  created_by  = EXCLUDED.created_by
            """),
            {
                "val_date":   val_date,
                "exp_lbl":    p.get("expiry_label"),
                "ten_lbl":    p.get("tenor_label"),
                "exp_y":      p.get("expiry_y"),
                "ten_y":      p.get("tenor_y"),
                "alpha":      p.get("alpha"),
                "rho":        p.get("rho"),
                "nu":         p.get("nu"),
                "atm_vol_bp": p.get("atm_vol_bp"),
                "created_by": user_id,
            }
        )
        saved += 1

    db.commit()
    return {"saved": saved, "date": val_date, "source": "MANUAL"}


# ─────────────────────────────────────────────────────────────────────────────
# OTM Vol Snap (Bloomberg SMKO tickers) — Sprint 8
# ─────────────────────────────────────────────────────────────────────────────

class OtmTickerIn(BaseModel):
    expiry:     str
    tenor:      str
    offset_bp:  int    # e.g. -200, -100, -50, -25
    ticker:     str    # e.g. "USWGA11 SMKO Curncy"


class OtmSnapIn(BaseModel):
    snap_date: date
    tickers:   List[OtmTickerIn]


@router.post("/snap-otm-vol")
async def snap_otm_vol(
    body: OtmSnapIn,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Snap absolute OTM vol from Bloomberg SMKO tickers.
    Returns absolute vol bp per (expiry, tenor, offset_bp).
    Uses same blpapi infrastructure as /bloomberg/snap-swvol.

    Ticker format: USW[G/E/C/B]A[expiry_code][tenor_code] SMKO Curncy
    Field: MID · Normal vol in bp (absolute, not spread vs ATM)
    """
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")

    try:
        import blpapi
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Bloomberg API not available. Install blpapi and connect to terminal."
        )

    quotes  = []
    failed  = []

    try:
        session_opts = blpapi.SessionOptions()
        session_opts.setServerHost("localhost")
        session_opts.setServerPort(8194)
        blp_session = blpapi.Session(session_opts)

        if not blp_session.start():
            raise HTTPException(status_code=503, detail="Could not connect to Bloomberg terminal")

        if not blp_session.openService("//blp/refdata"):
            raise HTTPException(status_code=503, detail="Could not open Bloomberg refdata service")

        ref_service = blp_session.getService("//blp/refdata")
        request     = ref_service.createRequest("ReferenceDataRequest")

        ticker_map = {}
        for t in body.tickers:
            request.append("securities", t.ticker)
            ticker_map[t.ticker] = t
        request.append("fields", "MID")

        blp_session.sendRequest(request)

        while True:
            event = blp_session.nextEvent(5000)
            if event.eventType() in (
                blpapi.Event.RESPONSE,
                blpapi.Event.PARTIAL_RESPONSE
            ):
                for msg in event:
                    sd = msg.getElement("securityData")
                    for i in range(sd.numValues()):
                        sv = sd.getValueAsElement(i)
                        ticker = sv.getElementAsString("security")
                        if sv.hasElement("securityError"):
                            failed.append(ticker)
                            continue
                        fd = sv.getElement("fieldData")
                        try:
                            mid = fd.getElementAsFloat("MID")
                            meta = ticker_map.get(ticker)
                            if meta and mid > 0:
                                quotes.append({
                                    "expiry":     meta.expiry,
                                    "tenor":      meta.tenor,
                                    "offset_bp":  meta.offset_bp,
                                    "ticker":     ticker,
                                    "abs_vol_bp": round(mid, 4),
                                })
                        except Exception:
                            failed.append(ticker)

            if event.eventType() == blpapi.Event.RESPONSE:
                break

        blp_session.stop()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bloomberg snap error: {str(e)}")

    return {
        "quotes":    quotes,
        "failed":    failed,
        "snap_date": body.snap_date.isoformat(),
    }
