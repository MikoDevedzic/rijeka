# bloomberg.py — FastAPI routes for Bloomberg terminal integration
# Mounts at /api/bloomberg/...

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import date
import json

from db.session import get_db
from middleware.auth import verify_token
from pricing.bloomberg_client import (
    check_connection,
    snap_live,
    snap_historical,
    get_default_tickers,
    BLOOMBERG_AVAILABLE,
)

router = APIRouter()


class SnapRequest(BaseModel):
    curve_id: str
    snap_date: str
    tickers: list[dict]
    mode: str


class TickerOverrideRequest(BaseModel):
    curve_id: str
    overrides: list[dict]


@router.get("/bloomberg/status")
async def bloomberg_status():
    return check_connection()


@router.get("/bloomberg/tickers/{curve_id}")
async def get_tickers(
    curve_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    defaults = get_default_tickers(curve_id)

    try:
        rows = db.execute(
            text("SELECT tenor, ticker FROM bloomberg_ticker_overrides WHERE curve_id = :cid AND created_by = :uid"),
            {"cid": curve_id, "uid": user["sub"]},
        ).fetchall()
    except Exception:
        rows = []

    merged = dict(defaults)
    has_overrides = False
    for row in rows:
        merged[row.tenor] = row.ticker
        has_overrides = True

    return {
        "curve_id": curve_id,
        "tickers": merged,
        "has_overrides": has_overrides,
        "total_tenors": len(merged),
    }


@router.post("/bloomberg/snap")
async def bloomberg_snap(
    req: SnapRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    role = user.get("user_metadata", {}).get("role", "viewer")
    if role not in ("trader", "admin"):
        raise HTTPException(403, "TRADER or ADMIN role required to snap market data")

    if not BLOOMBERG_AVAILABLE:
        raise HTTPException(503, "blpapi not installed. Run: pip install blpapi --break-system-packages")

    if not req.tickers:
        raise HTTPException(422, "No tickers provided. Select BLOOMBERG source and wait for tickers to load.")

    ticker_list = [t["ticker"] for t in req.tickers]
    snap_date = date.fromisoformat(req.snap_date)

    try:
        if req.mode == "live":
            prices = snap_live(ticker_list, field="MID")
        else:
            prices = snap_historical(ticker_list, snap_date)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    ticker_to_tenor = {t["ticker"]: t["tenor"] for t in req.tickers}
    quotes = []
    failed_tenors = []

    for ticker, price in prices.items():
        tenor = ticker_to_tenor.get(ticker)
        if tenor is None:
            continue
        if price is not None:
            quotes.append({
                "tenor": tenor,
                "quote_type": "SWAP",
                "rate": price,
                "ticker": ticker,
                "enabled": True,
            })
        else:
            failed_tenors.append(tenor)

    if not quotes:
        raise HTTPException(
            422,
            f"Bloomberg returned no prices. Check tickers are valid. Failed tenors: {failed_tenors}",
        )

    quotes_json = json.dumps(quotes)

    existing = db.execute(
        text("SELECT id FROM market_data_snapshots WHERE curve_id = :cid AND valuation_date = :dt AND user_id = :uid"),
        {"cid": req.curve_id, "dt": snap_date, "uid": user["sub"]},
    ).fetchone()

    if existing:
        db.execute(
            text("UPDATE market_data_snapshots SET quotes = :q, source = 'BLOOMBERG', created_by = :uid, user_id = :uid WHERE id = :id"),
            {"q": quotes_json, "uid": user["sub"], "id": str(existing.id)},
        )
    else:
        db.execute(
            text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id) VALUES (:cid, :dt, :q, 'BLOOMBERG', :uid, :uid)"),
            {"cid": req.curve_id, "dt": snap_date, "q": quotes_json, "uid": user["sub"]},
        )

    db.commit()

    return {
        "saved": True,
        "curve_id": req.curve_id,
        "snap_date": req.snap_date,
        "source": "BLOOMBERG",
        "quotes_saved": len(quotes),
        "failed_tenors": failed_tenors,
        "quotes": quotes,
    }


@router.post("/bloomberg/tickers/override")
async def save_ticker_overrides(
    req: TickerOverrideRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    for override in req.overrides:
        db.execute(
            text("INSERT INTO bloomberg_ticker_overrides (curve_id, tenor, ticker, created_by) VALUES (:cid, :tenor, :ticker, :uid) ON CONFLICT (curve_id, tenor, created_by) DO UPDATE SET ticker = :ticker"),
            {
                "cid": req.curve_id,
                "tenor": override["tenor"],
                "ticker": override["ticker"],
                "uid": user["sub"],
            },
        )
    db.commit()
    return {"saved": True, "count": len(req.overrides)}


class SwvolSnapRequest(BaseModel):
    snap_date: str
    tickers: list[dict]   # [{expiry, tenor, ticker}]


@router.post("/bloomberg/snap-swvol")
async def bloomberg_snap_swvol(
    req: SwvolSnapRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Snap ATM normal swaption vols from Bloomberg.
    Tickers: USSNA[expiry][tenor] Curncy
    Field: MID (bp normal vol, leave source blank)
    Returns quotes ready for useXVAStore + auto-saves to market_data_snapshots.
    """
    role = user.get("user_metadata", {}).get("role", "viewer")
    if role not in ("trader", "admin"):
        raise HTTPException(403, "TRADER or ADMIN role required")

    if not BLOOMBERG_AVAILABLE:
        raise HTTPException(503, "blpapi not installed")

    if not req.tickers:
        raise HTTPException(422, "No tickers provided")

    ticker_list = [t["ticker"] for t in req.tickers]
    snap_date   = date.fromisoformat(req.snap_date)

    try:
        prices = snap_live(ticker_list)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    ticker_map = {t["ticker"]: t for t in req.tickers}
    quotes     = []
    failed     = []

    for ticker, price in prices.items():
        inst = ticker_map.get(ticker)
        if inst is None:
            continue
        if price is not None:
            quotes.append({
                "expiry":  inst["expiry"],
                "tenor":   inst["tenor"],
                "ticker":  ticker,
                "vol_bp":  price,
                "enabled": True,
                "quote_type": "SWVOL",
                "rate":        price,
                "swp_tenor":   inst["tenor"],
            })
        else:
            failed.append(inst["expiry"] + "x" + inst["tenor"])

    if not quotes:
        raise HTTPException(422, f"Bloomberg returned no vol prices. Failed: {failed}")

    db_quotes = [
        {
            "tenor":      q["expiry"] + "x" + q["tenor"],
            "quote_type": "SWVOL",
            "rate":       q["vol_bp"],
            "enabled":    True,
            "expiry":     q["expiry"],
            "swp_tenor":  q["tenor"],
            "ticker":     q["ticker"],
        }
        for q in quotes
    ]
    db_quotes_json = json.dumps(db_quotes)

    existing = db.execute(
        text("SELECT id FROM market_data_snapshots WHERE curve_id = 'USD_SWVOL_ATM' AND valuation_date = :dt AND user_id = :uid"),
        {"dt": snap_date, "uid": user["sub"]},
    ).fetchone()

    if existing:
        db.execute(
            text("UPDATE market_data_snapshots SET quotes = cast(:q as jsonb), source = 'BLOOMBERG', created_by = :uid, user_id = :uid WHERE id = :id"),
            {"q": db_quotes_json, "uid": user["sub"], "id": str(existing.id)},
        )
    else:
        db.execute(
            text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id) VALUES ('USD_SWVOL_ATM', :dt, cast(:q as jsonb), 'BLOOMBERG', :uid, :uid)"),
            {"dt": snap_date, "q": db_quotes_json, "uid": user["sub"]},
        )

    db.commit()

    return {
        "saved":        True,
        "snap_date":    req.snap_date,
        "source":       "BLOOMBERG",
        "quotes_saved": len(quotes),
        "quotes":       quotes,
        "failed":       failed,
    }


# ── OTM Vol Snap ──────────────────────────────────────────────────────────────

class OtmSnapRequest(BaseModel):
    snap_date: str
    tickers: list[dict]   # [{expiry, tenor, offset_bp, ticker}]


@router.post("/bloomberg/snap-otm-vol")
async def bloomberg_snap_otm_vol(
    req: OtmSnapRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Snap absolute OTM normal vol from Bloomberg SMKO tickers.
    Tickers: USW[G/E/C/B/L/M/O/R]A[expiry][tenor] SMKO Curncy
    Field: MID — absolute normal vol in bp (NOT spread vs ATM)

    Prefix to strike mapping (confirmed from Bloomberg DES):
      USWG=-200bp  USWE=-100bp  USWC=-50bp  USWB=-25bp
      USWL=+25bp   USWM=+50bp   USWO=+100bp  USWR=+200bp

    Frontend converts abs vol to spreads on save: spread = abs_vol - atm_vol
    """
    role = user.get("user_metadata", {}).get("role", "viewer")
    if role not in ("trader", "admin"):
        raise HTTPException(403, "TRADER or ADMIN role required")

    if not BLOOMBERG_AVAILABLE:
        raise HTTPException(503, "blpapi not installed")

    if not req.tickers:
        raise HTTPException(422, "No tickers provided")

    ticker_list = [t["ticker"] for t in req.tickers]

    try:
        prices = snap_live(ticker_list)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    ticker_map = {t["ticker"]: t for t in req.tickers}
    quotes = []
    failed = []

    for ticker, price in prices.items():
        inst = ticker_map.get(ticker)
        if inst is None:
            continue
        if price is not None:
            quotes.append({
                "expiry":     inst["expiry"],
                "tenor":      inst["tenor"],
                "offset_bp":  inst["offset_bp"],
                "ticker":     ticker,
                "abs_vol_bp": round(price, 4),
            })
        else:
            failed.append(f"{inst['expiry']}x{inst['tenor']}@{inst['offset_bp']}bp")

    return {
        "quotes":    quotes,
        "failed":    failed,
        "snap_date": req.snap_date,
        "source":    "BLOOMBERG",
    }
# ============================================================


# ============================================================


# ============================================================
# CAP / FLOOR VOL SNAP  (absolute-strike convention, v2)
# ============================================================
#
# USCNQ* tickers are quoted at ABSOLUTE strikes, not ATM spreads
# (confirmed via Bloomberg DES — e.g. USCNQB5 = "USD ABSOLUTE OTM CAP
# NVOL (SOFR) +.25% 5Year", Strike: Absolute +.25 %).
#
# At snap time we fetch the SOFR discount curve, compute the ATM forward
# per tenor (= weighted-average caplet forward = par cap rate), then
# derive strike_spread_bp = (absolute_strike - atm_forward) * 10000.
#
# Ticker conventions (verified 2026-04-17):
#   ATM   : USCNSQ{N} ICPL Curncy         → PX_MID field
#   Skew  : USCNQ{letter}{N} ICPL Curncy  → MID field
#
# Letter → absolute strike (%):
#   B=0.25  C=0.50  D=0.75  E=1.00  G=1.50  H=2.00
#   I=2.50  J=3.00  L=4.00  O=5.00
# ============================================================

from typing import Optional

# (strike_pct, is_atm, prefix, letter)
# strike_pct is None for ATM — resolved at snap time from the curve.
CAP_STRIKES_ABS = [
    (None, True,  "USCNSQ", ""),
    (0.25, False, "USCNQ",  "B"),
    (0.50, False, "USCNQ",  "C"),
    (0.75, False, "USCNQ",  "D"),
    (1.00, False, "USCNQ",  "E"),
    (1.50, False, "USCNQ",  "G"),
    (2.00, False, "USCNQ",  "H"),
    (2.50, False, "USCNQ",  "I"),
    (3.00, False, "USCNQ",  "J"),
    (4.00, False, "USCNQ",  "L"),
    (5.00, False, "USCNQ",  "O"),
]

CAP_TENORS = [1, 2, 3, 5, 7, 10]


def _build_cap_ticker(prefix: str, letter: str, tenor_y: int) -> str:
    if prefix == "USCNSQ":
        return f"USCNSQ{tenor_y} ICPL Curncy"
    return f"{prefix}{letter}{tenor_y} ICPL Curncy"


class CapVolSnapRequest(BaseModel):
    valuation_date: Optional[str] = None
    tenors:         Optional[list] = None
    atm_only:       bool = False
    curve_id:       str = "USD_SOFR"


@router.post("/bloomberg/cap-vol/snap")
async def snap_cap_vol_surface(
    req: CapVolSnapRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Snap cap vol surface from Bloomberg using absolute-strike tickers.
    Computes ATM forward per tenor from the discount curve and stores
    both strike_pct (%) and strike_spread_bp (derived).
    """
    val_date_s = req.valuation_date or date.today().isoformat()
    val_date   = date.fromisoformat(val_date_s)
    tenors     = req.tenors or CAP_TENORS
    strikes    = [s for s in CAP_STRIKES_ABS if s[1]] if req.atm_only else CAP_STRIKES_ABS

    # 1. Build discount curve (loads from latest DB snapshot via curve_id)
    from api.routes.pricer import _build_curve, CurveInput
    from pricing.cap_floor import compute_atm_forward

    try:
        curve = _build_curve(
            CurveInput(curve_id=req.curve_id, quotes=[]),
            val_date, db, user["sub"]
        )
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot build {req.curve_id} curve for {val_date_s}: {e}"
        )

    # 2. Compute ATM forward per tenor
    atm_fwd = {t: compute_atm_forward(curve, val_date, t) for t in tenors}

    # 3. Build ticker list with resolved strikes and derived spreads
    ticker_meta = []
    for tenor in tenors:
        for strike_pct, is_atm, prefix, letter in strikes:
            ticker = _build_cap_ticker(prefix, letter, tenor)
            if is_atm:
                resolved_pct = atm_fwd[tenor] * 100.0
                spread_bp    = 0
            else:
                resolved_pct = strike_pct
                spread_bp    = int(round((strike_pct / 100.0 - atm_fwd[tenor]) * 10000))
            ticker_meta.append((ticker, tenor, resolved_pct, spread_bp, is_atm))

    # 4. Fetch from Bloomberg (ATM uses PX_MID, skew uses MID)
    try:
        from pricing.bloomberg_client import snap_live
        atm_tickers  = [t[0] for t in ticker_meta if t[4]]
        skew_tickers = [t[0] for t in ticker_meta if not t[4]]
        blp_data = {}
        if atm_tickers:
            blp_data.update(snap_live(atm_tickers, "PX_MID"))
        if skew_tickers:
            blp_data.update(snap_live(skew_tickers, "MID"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bloomberg fetch failed: {e}")

    # 5. Wipe existing rows for this val_date (idempotent snap)
    db.execute(
        text("DELETE FROM cap_vol_surface WHERE valuation_date = :vd AND user_id = :uid"),
        {"vd": val_date_s, "uid": user["sub"]}
    )

    # 6. Insert fresh
    rows_upserted = 0
    result_rows   = []

    for ticker, tenor_y, strike_pct, spread_bp, is_atm in ticker_meta:
        vol = blp_data.get(ticker)
        if vol is None:
            continue
        db.execute(
            text("""
                INSERT INTO cap_vol_surface
                    (valuation_date, cap_tenor_y, strike_spread_bp, is_atm,
                     flat_vol_bp, strike_pct, ticker, source, user_id)
                VALUES
                    (:valuation_date, :cap_tenor_y, :strike_spread_bp, :is_atm,
                     :flat_vol_bp, :strike_pct, :ticker, :source, :user_id)
            """),
            {
                "valuation_date":   val_date_s,
                "cap_tenor_y":      tenor_y,
                "strike_spread_bp": spread_bp,
                "is_atm":           is_atm,
                "flat_vol_bp":      round(float(vol), 6),
                "strike_pct":       round(float(strike_pct), 6),
                "ticker":           ticker.replace(" Curncy", "").strip(),
                "source":           "BLOOMBERG",
                "user_id":          user["sub"],
            }
        )
        rows_upserted += 1
        result_rows.append({
            "ticker":     ticker.strip(),
            "tenor_y":    tenor_y,
            "strike_pct": round(strike_pct, 4),
            "spread_bp":  spread_bp,
            "vol_bp":     round(float(vol), 4),
        })

    db.commit()

    return {
        "valuation_date": val_date_s,
        "rows_upserted":  rows_upserted,
        "atm_forwards_pct": {str(k): round(v * 100, 6) for k, v in atm_fwd.items()},
        "data":           result_rows,
    }


@router.get("/bloomberg/cap-vol/tickers")
async def get_cap_vol_ticker_map():
    """Return full ticker map for debugging / Bloomberg connectivity check."""
    out = []
    for tenor in CAP_TENORS:
        for strike_pct, is_atm, prefix, letter in CAP_STRIKES_ABS:
            ticker = _build_cap_ticker(prefix, letter, tenor)
            out.append({
                "ticker":     ticker,
                "tenor_y":    tenor,
                "strike_pct": strike_pct,
                "is_atm":     is_atm,
            })
    return {"tickers": out, "count": len(out)}
