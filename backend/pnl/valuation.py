"""One trade, one market, one date, through the production pricers: the swap and option
pricers behind POST /price for rates trades, the currency forward pricer for FX and digital
assets. The market is handed over explicitly (as-of quotes), never read as 'latest' here."""
from __future__ import annotations

import logging
import math
from datetime import date, timedelta
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
        if itype in ("FX_OPTION", "CRYPTO_OPTION"):
            out.append(f"{pair}_VOL")              # the option's vol surface: a curve of its own in the explain and the ladder
        return out
    ids = [c for c in dict.fromkeys([trade.discount_curve_id, trade.forecast_curve_id]) if c]
    ids = ids or ["USD_SOFR"]
    if itype in SWAPTIONS:                        # the option's ATM surface: a vol factor in the explain, the ladder and VaR
        ids.append(f"{str(trade.notional_ccy or 'USD').upper()}_SWVOL_ATM")
    return ids


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
    elif itype == "CRYPTO_OPTION":
        pair = f"{str(t['digital_asset']).upper()}USD"
        terms = {"notional": float(t.get("notional_amount") or trade.notional), "K": float(t["strike_price"]) if t.get("strike_price") not in (None, "") else None,
                 "shape": "OPTION", "option_type": str(t.get("option_type") or "CALL").upper(), "expiry": date.fromisoformat(str(t["expiration_date"])),
                 "settle": date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date)),
                 "settlement_type": "NON_DELIVERABLE", "style_fields": dict(t)}
    elif itype == "FX_OPTION":
        pair = str(t.get("currency_pair") or f"{t.get('base_currency', '')}{t.get('quote_currency', '')}").upper()
        terms = {"notional": float(t.get("base_notional") or trade.notional), "K": float(t["strike"]) if t.get("strike") not in (None, "") else None,
                 "shape": "OPTION", "option_type": str(t.get("option_type") or "CALL").upper(), "expiry": date.fromisoformat(str(t["expiry_date"])),
                 "settle": date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date)),
                 "settlement_type": str(t.get("settlement_type") or "DELIVERABLE").upper(), "style_fields": dict(t)}
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
    if itype in SWAPTIONS:
        v = _value_swaption(db, user, trade, val_date, mkt)
        if v is not None:
            return v
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


SWAPTIONS = ("IR_SWAPTION",)


def _trade_legs(db: Session, user: dict, trade) -> list[dict]:
    if getattr(trade, "_legs", None) is not None:
        return legs_for_pricer(trade)
    from api.routes.pricer import _leg_to_dict
    from db.models import TradeLeg
    rows = (db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id, TradeLeg.user_id == trade.user_id)
            .order_by(TradeLeg.leg_seq).all())
    return [_leg_to_dict(r) for r in rows]


def _value_swaption(db: Session, user: dict, trade, val_date: date, mkt: Market) -> Optional[dict[str, Any]]:
    """A booked European swaption, valued as the option (pricing/swaption.py, Bachelier on the OIS annuity).

    The booking carries the underlying swap's legs; expiry, strike and payer/receiver are read the way
    the exposure engine reads them (ccr/options.swaption_terms: trade.terms first, else the forward start
    of the fixed leg, its rate and its direction; terms.side BUY/SELL, long when absent), and the vol is
    the nearest point of the day's {CCY}_SWVOL_ATM grid. Until 2026-11 P&L, VaR, stress and the ladder
    valued a booked swaption as its underlying swap: no option value, a full swap delta, no vega. Past
    expiry it is the underlying swap (physical settlement): None hands it back to the swap pricer."""
    from ccr.options import swaption_terms, swaption_vol_bp
    from api.routes.pricer import _build_curve
    from pricing.swaption import price_swaption
    legs = _trade_legs(db, user, trade)
    fixed = next((l for l in legs if str(l.get("leg_type", "")).upper() == "FIXED"), None)
    if fixed is None or not fixed.get("effective_date") or not fixed.get("maturity_date"):
        return None
    terms = swaption_terms(trade, legs, val_date)
    expiry = terms["expiry"]
    if expiry is None or expiry <= val_date:
        return None
    start = date.fromisoformat(str(fixed["effective_date"])[:10])
    mat = date.fromisoformat(str(fixed["maturity_date"])[:10])
    ccy = str(fixed.get("currency") or trade.notional_ccy or "USD").upper()
    cid = fixed.get("discount_curve_id") or trade.discount_curve_id or "USD_SOFR"
    fallback = [] if mkt.quotes(cid) else [cid]
    curve = _build_curve(_curve_input(cid, mkt.quotes(cid)), val_date, db, user["sub"])
    expiry_y = (expiry - val_date).days / 365.0
    tenor_y = max((mat - start).days / 365.25, 0.25)
    vol_bp, vol_src = swaption_vol_bp(mkt, ccy, expiry_y, tenor_y)
    freq = str(fixed.get("payment_frequency") or "ANNUAL").upper()
    period_y = {"ANNUAL": 1.0, "SEMI_ANNUAL": 0.5, "SEMIANNUAL": 0.5, "QUARTERLY": 0.25, "MONTHLY": 1 / 12}.get(freq, 1.0)
    notional = float(fixed.get("notional") or trade.notional or 0.0)

    def npv(c):
        r = price_swaption(notional, expiry_y, tenor_y, terms["K"], vol_bp, terms["is_payer"], c, period_y, val_date,
                           swap_effective_date=start, swap_maturity_date=mat)
        if r.error:
            raise ValueError(f"swaption: {r.error}")
        return r
    base = npv(curve)
    sign = terms["sign"]                                     # −1 when we sold the option
    ir01 = sign * (npv(curve.shifted(1.0)).npv - base.npv)   # +1bp zero, the swaps' IR01 definition
    return {"npv": sign * float(base.npv), "ccy": ccy, "ir01": ir01, "ir01_disc": None, "spot01": None, "theta": sign * float(base.theta),
            "vega": sign * float(base.vega), "asof": {cid: mkt.snapshot_date(cid)} if hasattr(mkt, "snapshot_date") else {},
            "fallback": fallback,
            "model": f"Bachelier {vol_bp:.1f}bp ({vol_src}), {'bought' if sign > 0 else 'sold'}, expiry {expiry}"}


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
    settle = t["settle"] if t["shape"] != "SPOT" else spot_date(val_date, crypto, base, quote)
    # A digital-asset trade from its fixing date on: the stored fixing of the source its terms name, or the stored
    # spot flagged provisional (settlement/rule.py, the one rule; None before the fixing date, and nothing changes).
    fix = None
    if crypto:
        from settlement.rule import settlement
        fix = settlement(db, user["sub"], trade, val_date, spot=S, cache=getattr(mkt, "_cache", None))
    if settle <= val_date or (t["shape"] == "OPTION" and t["expiry"] <= val_date and settle <= val_date):
        out = {"npv": 0.0, "ccy": quote, "ir01": 0.0, "ir01_disc": 0.0, "spot01": 0.0, "theta": 0.0, "asof": {}, "fallback": fallback, "settled": True}
        if fix is not None:
            # the mark is zero once the settlement date is reached (the cash has left it, which is what P&L means by
            # the mark); the amount that settled is reported beside it, undiscounted
            out.update(_settlement_fields(fix, _settled_amount(t, fix)))
        return out
    pip = PIP.get(pair, 1.0 if crypto else 1e-4)
    if fix is not None and fix["fixing"] and t["shape"] != "OPTION" and fix["settlement_amount"] is not None:
        # fixed, not yet paid: a known amount in the quote currency on the settlement date. No spot or funding
        # sensitivity is left; the discounting curve's is that of one cash flow
        amount, df = float(fix["settlement_amount"]), float(q_curve.df(settle))
        npv = amount * df
        d1 = val_date + timedelta(days=1)
        theta = amount * df / max(float(q_curve.df(d1)), 1e-12) - npv if settle > d1 else -npv
        ir01 = npv * (math.exp(-1e-4 * (settle - val_date).days / 365.0) - 1.0)
        return _taxonomy({"npv": npv, "ccy": quote, "ir01": ir01, "ir01_disc": ir01, "ir01_base": 0.0, "spot01": 0.0, "theta": theta,
                          "asof": {qid: mkt.snapshot_date(qid)}, "fallback": fallback, "settled": False,
                          "model": f"fixed {fix['fixing_date']} at {fix['fixing']['value']:g} ({fix['source']}): the settlement amount, paid {settle}",
                          **_settlement_fields(fix, amount)}, crypto)
    fx_spot = None if crypto else spot_date(val_date, False, base, quote)   # an FX spot quote settles T+2; the forward carries from there
    r = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=t["notional"], forward_rate=t["K"], spot=S,
                               valuation_date=val_date, settlement_date=settle, quote_curve=q_curve, direction=t["direction"], pip=pip,
                               spot_date=fx_spot, **kw)
    # The desk's forward mode: on MARKET, quoted forward points ({PAIR}_FWD, as of the market date)
    # replace parity, exactly as the ticket prices (currencies._price). Points are a curve in
    # their own right and get their own attribution step.
    pts = forward_points(mkt, pair)
    if pts and t["shape"] != "SPOT" and market_mode(mkt):
        days = (settle - (fx_spot or val_date)).days           # points are quoted from the spot date
        f_mkt = S + interp_points(pts, days) * pip
        if f_mkt > 0 and r.t > 0:
            from pricing.currency_forward import implied_base_rate, year_fraction
            sd = fx_spot or val_date
            rate_b = implied_base_rate(f_mkt, S, r.df_quote, float(q_curve.df(sd)), r.t, year_fraction(val_date, sd))
            r = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=t["notional"], forward_rate=t["K"], spot=S,
                                       valuation_date=val_date, settlement_date=settle, quote_curve=q_curve, direction=t["direction"], pip=pip,
                                       spot_date=fx_spot, base_rate=rate_b)
    if t["shape"] == "OPTION":
        return _taxonomy(_value_fx_option(t, pair, base, quote, S, r, val_date, mkt, qid, fallback, q_curve, kw, fix), crypto)
    out = {"npv": float(r.npv), "ccy": quote, "ir01": getattr(r, "ir01", None), "ir01_disc": getattr(r, "ir01_disc", None),
           "ir01_base": getattr(r, "ir01_base", None), "spot01": getattr(r, "spot01", None), "theta": getattr(r, "theta", None),
           "asof": {qid: mkt.snapshot_date(qid), f"{pair}_SPOT": mkt.snapshot_date(f"{pair}_SPOT")}, "fallback": fallback}
    if fix is not None:               # the fixing date is reached and no fixing is stored: the value above, flagged
        out.update(settled=False, **_settlement_fields(fix, fix["settlement_amount"]))
    return _taxonomy(out, crypto)


def _settlement_fields(fix: dict, amount: Optional[float]) -> dict[str, Any]:
    """What a valuation reports once the fixing date is reached: the fixing (None when none is stored, and then
    `provisional`), and the amount that settles, undiscounted (on the stored spot while provisional)."""
    return {"fixing": fix["fixing"], "provisional": fix["provisional"], "settlement_amount": amount,
            "fixing_date": fix["fixing_date"].isoformat(), "fixing_source": fix["source"] or None}


def _settled_amount(t: dict, fix: dict) -> Optional[float]:
    """The undiscounted amount of a trade whose fixing date is reached: the rule's for a forward, the expired payoff
    on the rule's price for an option (None when the terms carry no strike to measure it against)."""
    if t["shape"] != "OPTION":
        return fix["settlement_amount"]
    from api.routes.currencies import spec_from
    try:
        spec = spec_from(t.get("style_fields") or {}, t["option_type"], t["K"])
        if fix["price"] is None or (spec.strike is None and spec.style != "TOUCH"):
            return None
        return _expired_amount(t, spec, spec.strike, float(fix["price"]))
    except (TypeError, ValueError, AttributeError):
        return None


def _expired_amount(t: dict, spec, K: Optional[float], s_exp: float) -> float:
    """An expired option's fixed payoff on the price `s_exp`, undiscounted, in the quote currency, from our side. A
    barrier or touch option's knock status is the desk's record (terms.knocked); without one it is read from the
    price alone, which the valuation says."""
    from pricing.fx_exotic import ExoticSpec, _expired
    sign = 1.0 if str(t["direction"]).upper() == "BUY" else -1.0
    sf = t.get("style_fields") or {}
    if spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH") and sf.get("knocked") is not None:
        knocked = bool(sf["knocked"])
        if spec.style == "TOUCH":
            hit_pays = spec.touch_type in ("ONE_TOUCH", "DOUBLE_ONE_TOUCH")
            unit = spec.payout if (knocked == hit_pays) else 0.0
        else:
            alive_pays = spec.barrier_type.endswith("OUT")
            unit = (_expired(ExoticSpec("EUROPEAN", spec.option_type, strike=K), s_exp, 1.0) if (knocked != alive_pays) else spec.rebate)
        scale = t["notional"] if spec.style != "TOUCH" else 1.0
    else:
        unit = _expired(spec, s_exp, 1.0)
        scale = t["notional"] if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else 1.0
    return sign * scale * unit


def _taxonomy(v: dict[str, Any], crypto: bool) -> dict[str, Any]:
    """The desk's names: on a digital asset IR01 is the discounting curve's sensitivity alone and the funding
    rate's sensitivity is FUND01; on a currency pair both legs are rate curves and IR01 is their sum."""
    if crypto and v.get("ir01_disc") is not None:
        v["fund01"] = v.get("ir01_base") if v.get("ir01_base") is not None else (v["ir01"] - v["ir01_disc"] if v.get("ir01") is not None else None)
        v["ir01"] = v["ir01_disc"]
    return v


def _value_fx_option(t: dict, pair: str, base: str, quote: str, S: float, fwd, val_date: date, mkt: Market, qid: str, fallback: list,
                     q_curve=None, base_kw: Optional[dict] = None, fix: Optional[dict] = None) -> dict[str, Any]:
    """A booked FX option on the day's market: the forward engine's forward and discount factor to settlement
    (quoted points or parity, as the account prices), the vol from the day's {PAIR}_VOL snapshot (a desk default
    when there is none, and the result says so), Garman–Kohlhagen on top (pricing/fx_option.py). After expiry and
    before settlement the payoff is fixed: the spot on the expiry date against the strike, discounted. A digital
    asset's is fixed on the stored fixing of the source its terms name (`fix`, settlement/rule.py), and on the
    stored spot, flagged provisional, while none is stored."""
    from api.routes.currencies import spec_from, spot_date
    from pricing.fx_exotic import price_exotic
    from pricing.fx_option import price_fx_option
    from pricing.fx_vol import lookup_vol
    expiry, settle = t["expiry"], t["settle"]
    spec = spec_from(t.get("style_fields") or {}, t["option_type"], t["K"])
    if spec.strike is None and spec.style != "TOUCH":
        spec.strike = float(fwd.forward)
    K = spec.strike if spec.strike is not None else float(fwd.forward)
    vol_cid = f"{pair}_VOL"
    asof = {qid: mkt.snapshot_date(qid), f"{pair}_SPOT": mkt.snapshot_date(f"{pair}_SPOT"), vol_cid: mkt.snapshot_date(vol_cid)}
    if expiry <= val_date:
        # expired, not yet settled: the fixing is the spot of the expiry date (the market as of expiry), or for a
        # digital asset the rule's price (the stored fixing, else that same spot). A barrier or touch option's knock
        # status is the desk's record (terms.knocked); without one it is read from that price alone, which the
        # valuation says
        if fix is not None and fix["price"] is not None:
            s_exp = float(fix["price"])
        else:
            s_exp = Market(mkt.db, mkt.user_id, expiry).spot(pair) if hasattr(mkt, "db") else S
            s_exp = s_exp or S
        amount = _expired_amount(t, spec, K, s_exp)
        npv = amount * float(fwd.df_quote)
        fixed_on = f" on the {fix['source']} fixing" if fix is not None and fix["fixing"] else ""
        out = {"npv": npv, "ccy": quote, "ir01": 0.0, "ir01_disc": 0.0, "spot01": 0.0, "theta": 0.0, "vega": 0.0, "asof": asof,
               "fallback": fallback, "model": f"expired {expiry}: fixed payoff{fixed_on}, paid {settle}" + ("" if spec.style in ("EUROPEAN", "AMERICAN", "DIGITAL") or (t.get("style_fields") or {}).get("knocked") is not None else "; knock status not recorded, read from the " + ("fixing" if fixed_on else "expiry spot"))}
        if fix is not None:
            out.update(settled=False, **_settlement_fields(fix, amount))
        return out
    T_e = (expiry - val_date).days / 365.0
    vol, tier, note = lookup_vol(mkt.quotes(vol_cid), pair, T_e, float(fwd.forward), K, None)
    if tier == "DEFAULT":
        fallback = fallback + [vol_cid]
    if spec.style == "EUROPEAN":
        from api.routes.currencies import is_crypto
        r = price_fx_option(base_currency=base, quote_currency=quote, base_notional=t["notional"], option_type=spec.option_type, strike=K, spot=S,
                            forward=float(fwd.forward), df_quote=float(fwd.df_quote), valuation_date=val_date, expiry_date=expiry, settlement_date=settle,
                            vol=vol, direction=t["direction"], spot_date=spot_date(val_date, is_crypto(base), base, quote))
        return {"npv": float(r.npv), "ccy": quote, "ir01": r.ir01, "ir01_disc": r.ir01_disc, "ir01_base": r.ir01_base, "spot01": r.spot01, "theta": r.theta,
                "vega": r.vega, "asof": asof, "fallback": fallback,
                "model": f"{'Black-76' if is_crypto(base) else 'Garman–Kohlhagen'} {vol * 100:.2f}% ({note})"}
    x = price_exotic(spec, base_notional=t["notional"], spot=S, forward=float(fwd.forward), df_quote=float(fwd.df_quote), t_expiry=T_e, vol=vol,
                     direction=t["direction"])
    return {"npv": float(x.npv), "ccy": quote, "ir01": x.ir01, "ir01_disc": x.ir01_disc, "ir01_base": x.ir01_base, "spot01": x.spot01, "theta": x.theta,
            "vega": x.vega, "asof": asof, "fallback": fallback, "model": f"{x.method}, {vol * 100:.2f}% ({note})"}


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
