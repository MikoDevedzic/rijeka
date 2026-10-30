"""One trade, one market, one date, through the production pricers: the swap and option
pricers behind POST /price for rates trades, the currency forward pricer for FX and digital
assets. The market is handed over explicitly (as-of quotes), never read as 'latest' here."""
from __future__ import annotations

import logging
import math
from datetime import date
from types import SimpleNamespace
from typing import Any, Optional

from sqlalchemy.orm import Session

from pnl.market import Market

log = logging.getLogger("rijeka.pnl")

# the curves a trade is valued on, in the order the explain moves them
def trade_curves(trade) -> list[str]:
    from api.routes.currencies import CURRENCY_INSTRUMENTS, CURVE_FOR, is_crypto, split_pair
    itype = str(trade.instrument_type or "").upper()
    if itype in CURRENCY_INSTRUMENTS:
        pair, _ = _currency_terms(trade)
        base, quote = split_pair(pair)
        out = [CURVE_FOR.get(quote) or "USD_SOFR"]
        if is_crypto(base):
            out.append(f"{base}_FUNDING")
        else:
            bc = CURVE_FOR.get(base)
            out += [c for c in (bc, f"{base}_FLAT") if c]
        return out
    ids = [c for c in dict.fromkeys([trade.discount_curve_id, trade.forecast_curve_id]) if c]
    return ids or ["USD_SOFR"]


def points_curve(trade) -> Optional[str]:
    from api.routes.currencies import CURRENCY_INSTRUMENTS
    if str(trade.instrument_type or "").upper() in CURRENCY_INSTRUMENTS:
        pair, t = _currency_terms(trade)
        return None if t["shape"] == "SPOT" else f"{pair}_FWD"
    return None


def spot_curve(trade) -> Optional[str]:
    from api.routes.currencies import CURRENCY_INSTRUMENTS
    if str(trade.instrument_type or "").upper() in CURRENCY_INSTRUMENTS:
        pair, _ = _currency_terms(trade)
        return f"{pair}_SPOT"
    return None


def _currency_terms(trade) -> tuple[str, dict]:
    t = dict(trade.terms or {})
    itype = str(trade.instrument_type or "").upper()
    if itype == "CRYPTO_FORWARD":
        pair = f"{str(t['digital_asset']).upper()}USD"
        terms = {"notional": float(t.get("notional_amount") or trade.notional), "K": float(t["forward_price"]) if t.get("forward_price") not in (None, "") else None,
                 "settle": date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date)), "shape": "NDF"}
    else:
        pair = str(t.get("currency_pair") or f"{t.get('base_currency', '')}{t.get('quote_currency', '')}").upper()
        terms = {"notional": float(t.get("base_notional") or trade.notional), "K": float(t["forward_rate"]) if t.get("forward_rate") not in (None, "") else None,
                 "settle": date.fromisoformat(str(t.get("value_date") or trade.maturity_date)),
                 "shape": "SPOT" if itype == "FX_SPOT" else "NDF" if itype == "NDF" else "FORWARD"}
    terms["direction"] = str(t.get("direction") or "BUY")
    return pair, terms


def _curve_input(curve_id: str, quotes: Optional[list[dict]]):
    from api.routes.pricer import CurveInput, CurveQuote, _map_qt
    if not quotes:
        return CurveInput(curve_id=curve_id)                  # the pricer falls back to its latest snapshot; flagged by the caller
    # snapshots store percent (3.94); the pricer's explicit quotes are decimals (0.0394)
    return CurveInput(curve_id=curve_id, quotes=[CurveQuote(tenor=q["tenor"], quote_type=_map_qt(q.get("quote_type", "OIS")), rate=float(q["rate"]) / 100.0,
                                                            day_count=q.get("day_count")) for q in quotes if q.get("rate") is not None])


_LEG_ATTRS = ("id", "leg_ref", "leg_seq", "leg_type", "direction", "currency", "notional", "notional_type", "notional_schedule", "effective_date",
              "maturity_date", "first_period_start", "last_period_end", "day_count", "payment_frequency", "reset_frequency", "bdc", "stub_type",
              "payment_lag", "fixed_rate", "fixed_rate_schedule", "spread", "spread_schedule", "forecast_curve_id", "discount_curve_id", "cap_rate",
              "floor_rate", "embedded_options", "leverage", "ois_compounding", "terms")


def legs_for_pricer(trade) -> list[dict]:
    """Projection-shaped leg dicts (the event stream's) → the dicts the pricer builds from ORM legs,
    completed from the trade the way booking completes them."""
    from api.routes._leg_defaults import complete_leg
    from api.routes.pricer import _leg_to_dict
    out = []
    for raw in trade._legs:
        ns = SimpleNamespace(**{**{a: None for a in _LEG_ATTRS}, **{k: v for k, v in dict(raw).items() if k in _LEG_ATTRS}})
        d = _leg_to_dict(ns)
        d = complete_leg(d, effective_date=str(trade.effective_date) if trade.effective_date else None,
                         maturity_date=str(trade.maturity_date) if trade.maturity_date else None,
                         discount_curve_id=trade.discount_curve_id, forecast_curve_id=trade.forecast_curve_id, currency=trade.notional_ccy)
        out.append(d)
    return out


def value(db: Session, user: dict, trade, val_date: date, mkt: Market) -> dict[str, Any]:
    """{npv, ccy, ir01, ir01_disc, spot01, theta, asof: {curve_id: snapshot date}, fallback: [curve ids valued on 'latest']}"""
    from api.routes.currencies import CURRENCY_INSTRUMENTS
    itype = str(trade.instrument_type or "").upper()
    if itype in CURRENCY_INSTRUMENTS:
        return _value_currency(db, user, trade, val_date, mkt)
    from api.routes.pricer import PriceRequest, price_trade
    ids = trade_curves(trade)
    fallback = [c for c in ids if mkt.quotes(c) is None]
    if getattr(trade, "_legs", None) is not None:
        # a trade as it stood before an amendment (pnl.explain.shadow_trade): its legs are not in the
        # database under this id, so they are handed to the pricer through its snapshot cache
        from api.routes.pricer import _remember_trade
        _remember_trade(str(trade.id), str(user["sub"]), trade, legs_for_pricer(trade))
    req = PriceRequest(trade_id=str(trade.id), valuation_date=val_date, curves=[_curve_input(c, mkt.quotes(c)) for c in ids])
    p = price_trade(req, db, user)
    return {"npv": float(p.get("npv") or 0.0), "ccy": (p.get("npv_ccy") or p.get("currency") or trade.notional_ccy or "USD").upper(),
            "ir01": p.get("ir01"), "ir01_disc": p.get("ir01_disc"), "spot01": None, "theta": p.get("theta"),
            "asof": {c: mkt.snapshot_date(c) for c in ids}, "fallback": fallback}


def _value_currency(db: Session, user: dict, trade, val_date: date, mkt: Market) -> dict[str, Any]:
    from api.routes.currencies import CURVE_FOR, PIP, POLICY_RATE_PCT, interp_points, is_crypto, spot_date, split_pair
    from api.routes.pricer import _build_curve
    from pricing.currency_forward import price_currency_forward
    pair, t = _currency_terms(trade)
    base, quote = split_pair(pair)
    crypto = is_crypto(base)
    S = mkt.spot(pair)
    if S is None:
        raise ValueError(f"no {pair} spot on or before {mkt.as_of}")
    qid = CURVE_FOR.get(quote) or "USD_SOFR"
    fallback = [] if mkt.quotes(qid) else [qid]
    q_curve = _build_curve(_curve_input(qid, mkt.quotes(qid)), val_date, db, user["sub"])
    kw: dict[str, Any] = {}
    if crypto:
        kw["base_rate"] = (mkt.single(f"{base}_FUNDING", "FLAT") or 0.0) / 100.0
    else:
        bc = CURVE_FOR.get(base)
        bq = mkt.quotes(bc) if bc else None
        if bq and len(bq) >= 2:
            kw["base_curve"] = _build_curve(_curve_input(bc, bq), val_date, db, user["sub"])
        else:
            flat = mkt.single(f"{base}_FLAT", "FLAT")
            kw["base_rate"] = float(flat if flat is not None else POLICY_RATE_PCT.get(base, 0.0)) / 100.0
    settle = t["settle"] if t["shape"] != "SPOT" else spot_date(val_date, crypto)
    if settle <= val_date:
        return {"npv": 0.0, "ccy": quote, "ir01": 0.0, "ir01_disc": 0.0, "spot01": 0.0, "theta": 0.0, "asof": {}, "fallback": fallback, "settled": True}
    pip = PIP.get(pair, 1.0 if crypto else 1e-4)
    r = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=t["notional"], forward_rate=t["K"], spot=S,
                               valuation_date=val_date, settlement_date=settle, quote_curve=q_curve, direction=t["direction"], pip=pip, **kw)
    # The desk's forward mode: on MARKET, quoted forward points ({PAIR}_FWD, as of the market date)
    # replace parity, exactly as the ticket prices (currencies._price). Points are a curve in
    # their own right and get their own attribution step.
    pts = forward_points(mkt, pair)
    if pts and t["shape"] != "SPOT" and market_mode(mkt):
        days = (settle - val_date).days
        f_mkt = S + interp_points(pts, days) * pip
        if f_mkt > 0 and r.t > 0:
            df_b = f_mkt * r.df_quote / S
            r = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=t["notional"], forward_rate=t["K"], spot=S,
                                       valuation_date=val_date, settlement_date=settle, quote_curve=q_curve, direction=t["direction"], pip=pip,
                                       base_rate=-math.log(df_b) / r.t)
    return {"npv": float(r.npv), "ccy": quote, "ir01": getattr(r, "ir01", None), "ir01_disc": getattr(r, "ir01_disc", None),
            "spot01": getattr(r, "spot01", None), "theta": getattr(r, "theta", None),
            "asof": {qid: mkt.snapshot_date(qid), f"{pair}_SPOT": mkt.snapshot_date(f"{pair}_SPOT")}, "fallback": fallback}


def forward_points(mkt: Market, pair: str) -> Optional[dict]:
    from api.routes.currencies import TENOR_DAYS
    q = mkt.quotes(f"{pair}_FWD")
    if not q:
        return None
    pts = {x["tenor"]: float(x["rate"]) for x in q if x.get("tenor") in TENOR_DAYS and x.get("rate") is not None}
    return pts if len(pts) >= 2 else None


def market_mode(mkt: Market) -> bool:
    v = mkt.single("FX_FORWARD_MODE", "MODE")
    return not (v is not None and int(v) == 0)
