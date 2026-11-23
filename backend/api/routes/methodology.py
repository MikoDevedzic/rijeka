"""
methodology.py — the product list and the Excel replications behind it.

GET /api/methodology/products                  what is documented, how, and where
GET /api/methodology/{product}/replication.xlsx the workbook (see methodology/replicate.py),
                                                built from the caller's latest market data
"""

from __future__ import annotations


import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from api.routes._limits import heavy
from pricing.bootstrap import bootstrap_from_dicts
from api.routes.pricer import _map_qt, CURVE_DC, CURVE_CAL, CURVE_SPOT_LAG, CURVE_CCY
from methodology import replicate as rep

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/methodology", tags=["methodology"])


@router.get("/products")
def products(user: dict = Depends(verify_token)):
    return rep.PRODUCTS


def _latest(db: Session, user_id: str, curve_id: str):
    return db.execute(text("""
        SELECT valuation_date, quotes, source FROM market_data_snapshots
         WHERE curve_id = :c AND user_id = :u ORDER BY valuation_date DESC LIMIT 1"""),
        {"c": curve_id, "u": user_id}).first()


# the currency XVA books and the pair each one's trade is on: a download prices its own pair's trade and no other
FORWARD_XVA_BOOKS = {"xva_fx": "EURUSD", "xva_crypto": "BTCUSD"}
OPTION_XVA_BOOKS = {"xva_fx_option": "EURUSD", "xva_crypto_option": "BTCUSD"}


def _not_priced(pair: str, what: str, e: Exception) -> None:
    """A book's trade the account's market did not price: the book is built from its own inputs and says so on its
    Model sheet. The pricing routes' own refusal (no spot, no curve) is expected; anything else is logged as a fault."""
    if isinstance(e, HTTPException):
        log.info("methodology: %s on %s is not priced on this account's market (%s): its XVA book uses its own inputs", what, pair, str(e.detail)[:160])
    else:
        log.warning("methodology: pricing %s on %s for its XVA book failed with %s (%s): the book uses its own inputs", what, pair, type(e).__name__, str(e)[:160])


def market_for(db: Session, user_id: str, product: str | None = None) -> rep.Market:
    """The account's market for a workbook. The currency XVA books' trades are priced by the ticket's own routes, which
    costs a curve build each: they are read only for the book that needs them (every one when no product is named)."""
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
    fxv = _latest(db, user_id, "EURUSD_VOL")
    btc = _latest(db, user_id, "BTCUSD_VOL")
    cal = db.execute(text("""SELECT a, sigma_bp, theta, valuation_date, fit_rmse_bp FROM xva_calibration
                             WHERE user_id = :u AND model = 'HW1F' ORDER BY valuation_date DESC, created_at DESC LIMIT 1"""), {"u": user_id}).first()
    hw1f = {"a": cal.a, "sigma_bp": cal.sigma_bp, "theta": cal.theta, "valuation_date": cal.valuation_date.isoformat(), "fit_rmse_bp": cal.fit_rmse_bp} if cal else None
    return rep.Market(valuation_date=val, curve_id="USD_SOFR", snapshot_date=snap.valuation_date, source=snap.source,
                      quotes=snap.quotes or [], curve=curve, vol_quotes=(vol.quotes if vol else []) or [],
                      vol_date=vol.valuation_date if vol else None, fx_vol_quotes=(fxv.quotes if fxv else []) or [],
                      vol_quotes_by_pair={"BTCUSD": (btc.quotes if btc else []) or []}, hw1f=hw1f,
                      fx_tickets=fx_tickets(db, user_id, val, FORWARD_XVA_BOOKS.get(product)) if product is None or product in FORWARD_XVA_BOOKS else {},
                      fx_option_tickets=fx_option_tickets(db, user_id, val, OPTION_XVA_BOOKS.get(product)) if product is None or product in OPTION_XVA_BOOKS else {})


def fx_tickets(db: Session, user_id: str, val, only: str | None = None) -> dict:
    """The forwards of the two currency XVA books as a ticket's XVA run reads them on this account's market: the
    route's own reader (api/routes/xva.forward_xva_input: the pair's stored spot, curves and points, the spot date,
    its surface in SURFACE mode), for the book's trade. A pair the account cannot price (no spot saved, no curve) is
    left out, and its book prices the same trade from its own illustrative inputs and says so."""
    from api.routes.xva import forward_xva_input
    from methodology.fx_xva_workbook import DIRECTION, XVA_CRYPTO_CASE, XVA_FX_CASE, settlement_date
    out = {}
    for case in (XVA_FX_CASE, XVA_CRYPTO_CASE):
        pair = case["pair"]
        if only is not None and pair != only:
            continue
        try:
            settle = settlement_date(val, pair)
            inp, _q = forward_xva_input(db, user_id, pair, base_notional=case["notional"], settlement=settle, forward_rate=None,
                                        direction=DIRECTION, val_date=val, vol_pct=None, vol_mode="SURFACE")
            out[pair] = {"inp": inp, "settle": settle}
        except Exception as e:      # noqa: BLE001 — a book is still built, from its own inputs
            db.rollback()
            _not_priced(pair, "a forward", e)
    return out


def fx_option_tickets(db: Session, user_id: str, val, only: str | None = None) -> dict:
    """The options of the two currency option XVA books as a ticket's XVA run reads them on this account's market in
    its FLAT vol mode: the route's own reader (api/routes/xva.option_xva_input: the option priced by the ticket's
    pricer from the pair's stored spot, curves, points and surface), for the book's trade, struck at the forward. A
    pair the account cannot price is left out, and its book prices the same trade from its own illustrative inputs."""
    from api.routes.xva import option_xva_input
    from methodology.fx_xva_workbook import DIRECTION, OPTION_TYPE, XVA_CRYPTO_OPTION_CASE, XVA_FX_OPTION_CASE, option_dates
    out = {}
    for case in (XVA_FX_OPTION_CASE, XVA_CRYPTO_OPTION_CASE):
        pair = case["pair"]
        if only is not None and pair != only:
            continue
        try:
            d = option_dates(val, pair)
            terms = {"notional": case["notional"], "K": None, "shape": "OPTION", "option_type": OPTION_TYPE, "expiry": d["expiry"], "settle": d["settlement"],
                     "settlement_type": "NON_DELIVERABLE" if case["pair"] != "EURUSD" else "DELIVERABLE", "style_fields": {}, "direction": DIRECTION}
            inp, q = option_xva_input(db, user_id, pair, terms, val_date=val, vol_pct=None, vol_mode="FLAT")
            out[pair] = {"inp": inp, "expiry": d["expiry"], "settle": d["settlement"], "npv": float(q["npv"]), "vol_source": str(q.get("vol_source") or inp.vol_source)}
        except Exception as e:      # noqa: BLE001 — a book is still built, from its own inputs
            db.rollback()
            _not_priced(pair, "an option", e)
    return out


@router.get("/{product}/replication.xlsx")
def replication(product: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if product not in rep.BUILDERS:
        raise HTTPException(status_code=404, detail=f"No Excel replication for '{product}'.")
    heavy(user, "Excel replication", 6)          # the XVA book runs a calibration and a Monte Carlo per download
    mkt = market_for(db, user["sub"], product)
    try:
        data, _ = rep.build(product, mkt)
    except ValueError as e:
        # a book written for one shape of trade (an XVA book's grid, an option's expiry in the last step) says when the
        # account's market does not give it that shape: an answer, not a server error
        log.warning("methodology: %s could not be built on this account's market: %s", product, str(e)[:200])
        raise HTTPException(status_code=422, detail=f"This workbook cannot be built from this account's market today: {str(e)[:200]}")
    name = f"rijeka_{product}_replication_{mkt.valuation_date.isoformat()}.xlsx"
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
