"""
Currencies — FX and digital assets on one model (pricing/currency_forward.py).

    GET  /api/currency/pairs             supported pairs with spot, as-of, and which curve prices each side
    POST /api/currency/spot/snap         FX reference rates (ECB via frankfurter.dev) + crypto spot (Coinbase), saved as snapshots
    POST /api/currency/spot/tick         same for the demo template account (X-Rijeka-Cron)
    POST /api/currency/forward/price     spot / forward / NDF on any pair, from parameters

Snapshots: {PAIR}_SPOT with quotes [{"tenor": "SPOT", "rate": quote per base}], source IMPORT.
Discounting: each currency's OIS curve (USD_SOFR, EUR_ESTR, GBP_SONIA, …) through the
pricer's own loader; a digital asset discounts at its funding rate ({ASSET}_FUNDING, MANUAL).

Booked FX_SPOT / FX_FORWARD / NDF / CRYPTO_FORWARD trades are priced from trade.terms by
price_booked() when POST /price meets one. The crypto routes under /api/crypto remain.
"""
from __future__ import annotations

import json
import logging
import math
import os
import uuid
from datetime import date, timedelta
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.models import Trade
from db.session import get_db
from middleware.auth import verify_token
from pricing.currency_forward import price_currency_forward
from api.routes.crypto import (ASSETS as CRYPTO_ASSETS, fetch_spot as fetch_crypto_spot, save_spot,
                               latest_snapshot, _quote, _require_trader)

log = logging.getLogger("rijeka.currency")
router = APIRouter(prefix="/api/currency", tags=["currency"])

# pairs as the market quotes them: quote currency per one unit of base
FX_PAIRS = ("EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "USDCHF", "USDCAD")
CRYPTO_PAIRS = tuple(f"{a}USD" for a in CRYPTO_ASSETS)
PAIRS = FX_PAIRS + CRYPTO_PAIRS
CURVE_FOR = {"USD": "USD_SOFR", "EUR": "EUR_ESTR", "GBP": "GBP_SONIA", "JPY": "JPY_TONAR",
             "CHF": "CHF_SARON", "AUD": "AUD_AONIA", "CAD": "CAD_CORRA"}
PIP = {"USDJPY": 0.01}
FX_FEED_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,CAD"
FX_FEED_NAME = "ECB reference rates (frankfurter.dev, public)"
# When an account has no OIS curve for a currency (the hosted demo copies only
# public-source snapshots), discount it flat at a rate the desk can set
# ({CCY}_FLAT, MANUAL) or, failing that, at the central bank's policy rate.
# Every response says which one it used; a flat curve is illustrative.
POLICY_RATE_PCT = {"EUR": 2.50, "GBP": 3.75, "JPY": 1.25, "CHF": 0.00, "AUD": 4.60, "CAD": 2.25, "USD": 4.00}
POLICY_RATE_NOTE = "central-bank policy rate, late October 2026, illustrative"
FWD_TENORS = ("1W", "2W", "1M", "2M", "3M", "6M", "9M", "1Y", "2Y")
TENOR_DAYS = {"ON": 1, "1W": 7, "2W": 14, "1M": 30, "2M": 61, "3M": 91, "6M": 182, "9M": 273, "1Y": 365, "2Y": 730}
MODES = ("MARKET", "IMPLIED")     # MARKET: outright = spot + quoted points; IMPLIED: parity on the two OIS curves
FIXING_DEFAULT = {"USDJPY": "WM/Reuters 4pm London", "BTCUSD": "CME CF BRR", "ETHUSD": "CME CF ETHUSD_RR", "SOLUSD": "Coinbase SOL-USD"}


def split_pair(pair: str) -> tuple[str, str]:
    p = pair.upper()
    if p not in PAIRS:
        raise HTTPException(status_code=422, detail=f"pair must be one of {', '.join(PAIRS)}")
    base = p[:-3] if p.endswith("USD") and p[:-3] != "USD" else p[:3]
    return base, p[len(base):]


def is_crypto(base: str) -> bool:
    return base.upper() in CRYPTO_ASSETS


# ── market data ────────────────────────────────────────────────────────────

def fetch_fx_spot(timeout: float = 8.0) -> dict[str, float]:
    """quote-per-base for every FX pair, from USD-based reference rates."""
    with httpx.Client(timeout=timeout, follow_redirects=True,
                      headers={"User-Agent": "rijeka/0.4 (+https://rijeka.app)"}) as c:
        r = c.get(FX_FEED_URL)
        r.raise_for_status()
        usd = r.json()["rates"]          # units of CCY per 1 USD
    out = {}
    for pair in FX_PAIRS:
        base, quote = pair[:3], pair[3:]
        try:
            out[pair] = float(usd[quote]) if base == "USD" else 1.0 / float(usd[base])
        except (KeyError, ZeroDivisionError, TypeError):
            log.warning("fx pair %s missing from feed", pair)
    if not out:
        raise RuntimeError("no FX rates could be read")
    return out


def fetch_all_spot() -> dict[str, float]:
    prices: dict[str, float] = {}
    try:
        prices.update(fetch_fx_spot())
    except Exception as e:
        log.warning("fx feed failed: %s", e)
    try:
        prices.update({f"{a}USD": px for a, px in fetch_crypto_spot().items()})
    except Exception as e:
        log.warning("crypto feed failed: %s", e)
    if not prices:
        raise RuntimeError("no spot could be fetched from either feed")
    return prices


def _save_pairs(db: Session, user_id, prices: dict[str, float]) -> int:
    from sqlalchemy import text
    today = date.today()
    n = 0
    for pair, px in prices.items():
        cid = f"{pair}_SPOT"
        quotes = [{"tenor": "SPOT", "quote_type": "SPOT", "rate": px, "enabled": True}]
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
                   {"u": user_id, "c": cid, "d": today})
        db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                        "VALUES (:c, :d, CAST(:q AS jsonb), 'IMPORT', :u, :u)"),
                   {"c": cid, "d": today, "q": json.dumps(quotes), "u": user_id})
        n += 1
    db.commit()
    return n


def forward_curve(db: Session, user_id, pair: str) -> Optional[dict]:
    """Latest {PAIR}_FWD snapshot: {valuation_date, source, points: {tenor: pips}}."""
    row = latest_snapshot(db, user_id, f"{pair}_FWD")
    if not row or not row.quotes:
        return None
    pts = {q["tenor"]: float(q["rate"]) for q in row.quotes
           if q.get("enabled", True) and q.get("rate") is not None and q.get("tenor") in TENOR_DAYS}
    if len(pts) < 2:
        return None
    return {"valuation_date": row.valuation_date.isoformat(), "source": row.source, "points": pts}


def interp_points(points: dict[str, float], days: int) -> float:
    """Forward points at `days`, linear in time between quoted tenors; 0 at spot, flat beyond the last."""
    xs = sorted((TENOR_DAYS[t], v) for t, v in points.items())
    xs = [(0, 0.0)] + xs
    if days <= 0:
        return 0.0
    for (d0, p0), (d1, p1) in zip(xs, xs[1:]):
        if d0 <= days <= d1:
            return p0 + (p1 - p0) * (days - d0) / (d1 - d0) if d1 > d0 else p1
    return xs[-1][1]


def forward_mode(db: Session, user_id) -> str:
    row = latest_snapshot(db, user_id, "FX_FORWARD_MODE")
    v = _quote(row, "MODE")
    return "IMPLIED" if v is not None and int(v) == 0 else "MARKET"


def pair_state(db: Session, user_id, pair: str) -> dict[str, Any]:
    base, quote = split_pair(pair)
    s = latest_snapshot(db, user_id, f"{pair}_SPOT")
    out = {"pair": pair, "base": base, "quote": quote, "crypto": is_crypto(base),
           "spot": _quote(s, "SPOT"), "spot_as_of": s.valuation_date.isoformat() if s else None,
           "quote_curve": CURVE_FOR.get(quote), "pip": PIP.get(pair, 1.0 if is_crypto(base) else 1e-4),
           "fixing_default": FIXING_DEFAULT.get(pair, "WM/Reuters 4pm London")}
    fc = forward_curve(db, user_id, pair)
    out.update(forward_curve=fc and {"valuation_date": fc["valuation_date"], "source": fc["source"], "tenors": sorted(fc["points"], key=TENOR_DAYS.get)},
               forward_points=fc["points"] if fc else None)
    if is_crypto(base):
        f = latest_snapshot(db, user_id, f"{base}_FUNDING")
        out.update(base_curve=None, funding_pct=_quote(f, "FLAT"), funding_as_of=f.valuation_date.isoformat() if f else None)
    else:
        bc = CURVE_FOR.get(base)
        row = latest_snapshot(db, user_id, bc) if bc else None
        has = bool(row) and sum(1 for q in (row.quotes or []) if q.get("enabled", True) and q.get("rate") is not None) >= 2
        flat = latest_snapshot(db, user_id, f"{base}_FLAT")
        out.update(base_curve=bc, base_curve_available=has,
                   base_flat_pct=_quote(flat, "FLAT") if flat else None,
                   base_fallback=None if has else (f"flat {_quote(flat, 'FLAT')}% ({base}_FLAT)" if flat else f"flat {POLICY_RATE_PCT.get(base)}% ({POLICY_RATE_NOTE})"))
    return out


@router.get("/pairs")
def pairs(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return {"pairs": [pair_state(db, user["sub"], p) for p in PAIRS], "forward_mode": forward_mode(db, user["sub"]),
            "forward_tenors": list(FWD_TENORS),
            "feeds": {"fx": FX_FEED_NAME, "crypto": "Coinbase spot (public)"}}


class ForwardCurveIn(BaseModel):
    pair: str
    valuation_date: Optional[date] = None
    points: dict[str, float] = Field(..., description="tenor -> forward points in pips (Bloomberg convention)")
    spot: Optional[float] = Field(None, description="outright spot to save alongside, if the snap carried one")
    source: str = "MANUAL"


@router.post("/forward-curve")
def save_forward_curve(req: ForwardCurveIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Save a pair's forward points by tenor as a {PAIR}_FWD snapshot (and the spot, if given)."""
    _require_trader(user)
    pair = req.pair.upper(); split_pair(pair)
    if req.source.upper() not in ("MANUAL", "BLOOMBERG", "IMPORT"):
        raise HTTPException(status_code=422, detail="source must be MANUAL, BLOOMBERG or IMPORT")
    pts = {t.upper(): float(v) for t, v in req.points.items() if t.upper() in TENOR_DAYS and v is not None}
    if len(pts) < 2:
        raise HTTPException(status_code=422, detail="give at least two tenors")
    from sqlalchemy import text
    uid, today = uuid.UUID(user["sub"]), req.valuation_date or date.today()
    quotes = [{"tenor": t, "quote_type": "FWD_POINTS", "rate": v, "enabled": True} for t, v in sorted(pts.items(), key=lambda kv: TENOR_DAYS[kv[0]])]
    for cid, q in ((f"{pair}_FWD", quotes), (f"{pair}_SPOT", [{"tenor": "SPOT", "quote_type": "SPOT", "rate": float(req.spot), "enabled": True}] if req.spot else None)):
        if q is None:
            continue
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"), {"u": uid, "c": cid, "d": today})
        db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                        "VALUES (:c, :d, CAST(:q AS jsonb), :s, :u, :u)"), {"c": cid, "d": today, "q": json.dumps(q), "s": req.source.upper(), "u": uid})
    db.commit()
    return pair_state(db, uid, pair)


class ForwardModeIn(BaseModel):
    mode: str = Field(..., description="MARKET (spot + quoted points) or IMPLIED (parity on the two OIS curves)")


@router.post("/forward-mode")
def set_forward_mode(req: ForwardModeIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _require_trader(user)
    mode = req.mode.upper()
    if mode not in MODES:
        raise HTTPException(status_code=422, detail="mode must be MARKET or IMPLIED")
    from sqlalchemy import text
    uid, today = uuid.UUID(user["sub"]), date.today()
    quotes = [{"tenor": "MODE", "quote_type": "SETTING", "rate": 1 if mode == "MARKET" else 0, "enabled": True}]
    db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = 'FX_FORWARD_MODE' AND valuation_date = :d"), {"u": uid, "d": today})
    db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                    "VALUES ('FX_FORWARD_MODE', :d, CAST(:q AS jsonb), 'MANUAL', :u, :u)"), {"d": today, "q": json.dumps(quotes), "u": uid})
    db.commit()
    return {"forward_mode": mode}


@router.post("/spot/snap")
def snap(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _require_trader(user)
    try:
        prices = fetch_all_spot()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"spot feeds unavailable: {e}")
    n = _save_pairs(db, uuid.UUID(user["sub"]), prices)
    return {"saved": n, "prices": prices, "as_of": date.today().isoformat()}


@router.post("/spot/tick")
def tick(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None, alias="X-Rijeka-Cron")):
    secret = os.getenv("RIJEKA_CRON_SECRET", "")
    if not secret or x_rijeka_cron != secret:
        raise HTTPException(status_code=401, detail="bad cron secret")
    from api.routes.demo import _template_user_id
    uid = _template_user_id(db)
    if uid is None:
        raise HTTPException(status_code=422, detail="RIJEKA_DEMO_TEMPLATE_EMAIL is not set or has no account")
    try:
        prices = fetch_all_spot()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"spot feeds unavailable: {e}")
    return {"saved": _save_pairs(db, uid, prices), "prices": prices}


# ── pricing ────────────────────────────────────────────────────────────────

class CurrencyPriceRequest(BaseModel):
    pair: str = Field(..., examples=["EURUSD"])
    shape: str = Field("FORWARD", description="SPOT | FORWARD | NDF")
    base_notional: float = Field(..., gt=0)
    settlement_date: Optional[date] = Field(None, description="omitted for SPOT: T+2 (T+0 for a digital asset)")
    valuation_date: Optional[date] = None
    forward_rate: Optional[float] = Field(None, description="contract rate K; omitted = at the fair forward")
    direction: str = "BUY"
    spot: Optional[float] = Field(None, gt=0)
    base_rate_pct: Optional[float] = Field(None, description="digital asset only: funding override, % p.a.")


def _curve(db: Session, user_id: str, curve_id: str, val_date: date):
    from api.routes.pricer import _build_curve, CurveInput
    try:
        return _build_curve(CurveInput(curve_id=curve_id), val_date, db, user_id)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"{curve_id}: {e}")


def spot_date(val_date: date, crypto: bool) -> date:
    if crypto:
        return val_date + timedelta(days=1)
    d, n = val_date, 0
    while n < 2:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return d


def _price(db: Session, user_id: str, pair: str, *, shape: str, base_notional: float, settlement: Optional[date],
           val_date: date, K: Optional[float], direction: str, spot_override: Optional[float],
           base_rate_pct: Optional[float]) -> dict:
    st = pair_state(db, user_id, pair)
    base, quote, crypto = st["base"], st["quote"], st["crypto"]
    shape = (shape or "FORWARD").upper()
    if shape not in ("SPOT", "FORWARD", "NDF"):
        raise HTTPException(status_code=422, detail="shape must be SPOT, FORWARD or NDF")
    settle = settlement or spot_date(val_date, crypto)
    if shape == "SPOT":
        settle = spot_date(val_date, crypto)
    if spot_override is not None:
        S, s_src = float(spot_override), "request"
    elif st["spot"] is not None:
        S, s_src = st["spot"], f"snapshot {st['spot_as_of']}"
    else:
        raise HTTPException(status_code=422, detail=f"No {pair} spot saved. Click SNAP SPOT or pass spot.")
    q_curve = _curve(db, user_id, st["quote_curve"], val_date)
    kw: dict[str, Any] = {}
    if crypto:
        if base_rate_pct is not None:
            kw["base_rate"], b_src = float(base_rate_pct) / 100, "request"
        elif st.get("funding_pct") is not None:
            kw["base_rate"], b_src = st["funding_pct"] / 100, f"snapshot {st['funding_as_of']}"
        else:
            kw["base_rate"], b_src = 0.0, "default 0%"
    elif st.get("base_curve_available"):
        try:
            kw["base_curve"], b_src = _curve(db, user_id, st["base_curve"], val_date), st["base_curve"]
        except HTTPException as e:          # a row exists but does not bootstrap: fall back, and say so
            log.warning("%s did not build (%s); flat fallback", st["base_curve"], e.detail)
            st["base_curve_available"] = False
    if not crypto and not st.get("base_curve_available"):
        flat = st.get("base_flat_pct")
        rate = flat if flat is not None else POLICY_RATE_PCT.get(base)
        if rate is None:
            raise HTTPException(status_code=422, detail=f"No {st['base_curve']} snapshot and no flat rate for {base}.")
        kw["base_rate"], b_src = float(rate) / 100, (st.get("base_fallback") or
                                                     (f"flat {flat}% ({base}_FLAT)" if flat is not None else f"flat {rate}% ({POLICY_RATE_NOTE})"))
    try:
        implied = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=base_notional,
                                         forward_rate=K, spot=S, valuation_date=val_date, settlement_date=settle,
                                         quote_curve=q_curve, direction=direction, pip=st["pip"], **kw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    mode = forward_mode(db, user_id) if not crypto else "IMPLIED"
    fc = st.get("forward_points")
    r, f_src, basis_pts = implied, "implied from the two OIS curves (interest-rate parity)", None
    mkt_pts = None
    if fc:
        days = (settle - val_date).days
        mkt_pts = interp_points(fc, days)
        f_mkt = S + mkt_pts * st["pip"]
        basis_pts = mkt_pts - implied.forward_points
        if mode == "MARKET" and shape != "SPOT" and f_mkt > 0:
            # the market forward implies the base-currency discount factor: DF_b = F·DF_q/S
            df_b = f_mkt * implied.df_quote / S
            t = implied.t
            r = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=base_notional,
                                       forward_rate=K, spot=S, valuation_date=val_date, settlement_date=settle,
                                       quote_curve=q_curve, direction=direction, pip=st["pip"],
                                       base_rate=-math.log(df_b) / t if t > 0 else 0.0)
            f_src = f"market points ({pair}_FWD {st['forward_curve']['valuation_date']}, {st['forward_curve']['source']}), basis {basis_pts:+.1f} pts vs parity"
    out = r.__dict__.copy()
    out.update(pair=pair, shape=shape, valuation_date=val_date.isoformat(), settlement_date=settle.isoformat(),
               spot_source=s_src, base_discounting=b_src, quote_curve=st["quote_curve"],
               quote_curve_snapshot=str(getattr(q_curve, "snapshot_date", "") or ""),
               forward_mode=mode, forward_source=f_src, implied_forward=implied.forward, implied_points=implied.forward_points,
               market_points=mkt_pts, basis_points=basis_pts,
               model="F = S·DF_base/DF_quote (parity) or S + quoted points (market); NPV_quote = ±N_base·(F−K)·DF_quote; ACT/365")
    return out


@router.post("/forward/price")
def price_forward(req: CurrencyPriceRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    pair = req.pair.upper()
    split_pair(pair)
    val_date = req.valuation_date or date.today()
    return _price(db, user["sub"], pair, shape=req.shape, base_notional=req.base_notional, settlement=req.settlement_date,
                  val_date=val_date, K=req.forward_rate, direction=req.direction, spot_override=req.spot,
                  base_rate_pct=req.base_rate_pct)


class FlatRateRequest(BaseModel):
    currency: str
    rate_pct: float = Field(..., description="flat continuous zero used when the currency has no OIS curve, % p.a.")


@router.post("/flat")
def set_flat(req: FlatRateRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _require_trader(user)
    ccy = req.currency.upper()
    if ccy not in CURVE_FOR:
        raise HTTPException(status_code=422, detail=f"currency must be one of {', '.join(CURVE_FOR)}")
    from sqlalchemy import text
    uid, cid, today = uuid.UUID(user["sub"]), f"{ccy}_FLAT", date.today()
    quotes = [{"tenor": "FLAT", "quote_type": "FLAT", "rate": float(req.rate_pct), "enabled": True}]
    db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
               {"u": uid, "c": cid, "d": today})
    db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                    "VALUES (:c, :d, CAST(:q AS jsonb), 'MANUAL', :u, :u)"), {"c": cid, "d": today, "q": json.dumps(quotes), "u": uid})
    db.commit()
    return {"currency": ccy, "flat_pct": float(req.rate_pct)}


CURRENCY_INSTRUMENTS = ("FX_SPOT", "FX_FORWARD", "NDF", "CRYPTO_FORWARD")


def price_booked(trade: Trade, db: Session, user: dict, val_date: date) -> dict:
    """A booked currency trade, from trade.terms (the canonical record's fields)."""
    t = dict(trade.terms or {})
    itype = str(trade.instrument_type or "").upper()
    try:
        if itype == "CRYPTO_FORWARD":
            pair = f"{str(t['digital_asset']).upper()}USD"
            notional = float(t.get("notional_amount") or trade.notional)
            K = float(t["forward_price"]) if t.get("forward_price") not in (None, "") else None
            settle = date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date))
            shape = "NDF"
        else:
            pair = str(t.get("currency_pair") or f"{t.get('base_currency','')}{t.get('quote_currency','')}").upper()
            notional = float(t.get("base_notional") or trade.notional)
            K = float(t["forward_rate"]) if t.get("forward_rate") not in (None, "") else None
            settle = date.fromisoformat(str(t.get("value_date") or trade.maturity_date))
            shape = "SPOT" if itype == "FX_SPOT" else "NDF" if itype == "NDF" else "FORWARD"
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"trade.terms is missing or malformed: {e}")
    split_pair(pair)
    out = _price(db, user["sub"], pair, shape="FORWARD" if shape == "SPOT" else shape, base_notional=notional,
                 settlement=settle, val_date=val_date, K=K, direction=str(t.get("direction") or "BUY"),
                 spot_override=None, base_rate_pct=None)
    out.update(trade_id=str(trade.id), trade_ref=trade.trade_ref, instrument_type=itype, npv_ccy=out["quote_currency"],
               legs=[], shape=shape)
    return out
