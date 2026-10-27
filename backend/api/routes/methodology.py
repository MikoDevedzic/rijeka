"""
methodology.py — the product list and the Excel replications behind it.

GET /api/methodology/products                  what is documented, how, and where
GET /api/methodology/{product}/replication.xlsx the workbook (see methodology/replicate.py),
                                                built from the caller's latest market data
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from pricing.bootstrap import bootstrap_from_dicts
from api.routes.pricer import _map_qt, CURVE_DC, CURVE_CAL, CURVE_SPOT_LAG, CURVE_CCY
from methodology import replicate as rep

router = APIRouter(prefix="/api/methodology", tags=["methodology"])


@router.get("/products")
def products(user: dict = Depends(verify_token)):
    return rep.PRODUCTS


def _latest(db: Session, user_id: str, curve_id: str):
    return db.execute(text("""
        SELECT valuation_date, quotes, source FROM market_data_snapshots
         WHERE curve_id = :c AND user_id = :u ORDER BY valuation_date DESC LIMIT 1"""),
        {"c": curve_id, "u": user_id}).first()


def market_for(db: Session, user_id: str) -> rep.Market:
    snap = _latest(db, user_id, "USD_SOFR")
    if snap is None:
        raise HTTPException(status_code=422, detail="No USD_SOFR snapshot loaded for this account. Load a curve under Configurations → Market data first.")
    # Same translation the pricer applies to a stored snapshot (api/routes/pricer._build_curve):
    # UI quote types → bootstrap types, rates in percent → decimals, curve conventions.
    cid = "USD_SOFR"
    quotes = []
    for q in (snap.quotes or []):
        if not q.get("enabled", True) or q.get("rate") is None:
            continue
        qt = _map_qt(q.get("quote_type", "OIS"))
        quotes.append({"tenor": q.get("tenor"), "quote_type": qt, "rate": float(q["rate"]) / 100,
                       "day_count": "ACT/360" if qt == "DEPOSIT" else CURVE_DC.get(cid, "ACT/360"),
                       "calendar": CURVE_CAL.get(cid, "NEW_YORK"), "currency": CURVE_CCY.get(cid, "USD"),
                       "spot_lag": CURVE_SPOT_LAG.get(cid, 2)})
    val = snap.valuation_date
    curve = bootstrap_from_dicts(val, quotes)
    vol = _latest(db, user_id, "USD_SWVOL_ATM")
    return rep.Market(valuation_date=val, curve_id="USD_SOFR", snapshot_date=snap.valuation_date, source=snap.source,
                      quotes=snap.quotes or [], curve=curve, vol_quotes=(vol.quotes if vol else []) or [],
                      vol_date=vol.valuation_date if vol else None)


@router.get("/{product}/replication.xlsx")
def replication(product: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if product not in rep.BUILDERS:
        raise HTTPException(status_code=404, detail=f"No Excel replication for '{product}'.")
    mkt = market_for(db, user["sub"])
    data, _ = rep.build(product, mkt)
    name = f"rijeka_{product}_replication_{mkt.valuation_date.isoformat()}.xlsx"
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
