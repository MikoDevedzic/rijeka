"""The settlement rule for digital-asset trades, in one place. The booked valuation (pnl/valuation.py) calls it,
and the ticket's pricing of a booked trade (api/routes/currencies.price_booked) answers from that valuation from
the fixing date on; before that date settlement() returns None and neither path changes.

The fixing of a trade is the stored row for its pair, its fixing date (terms.valuation_date for a forward,
terms.expiration_date for an option) and exactly the source its terms name (terms.settlement_price_source): the
account's own row first, then the shared one. Never another source's price: a trade that names one benchmark
does not settle on a venue's delivery price.

    forward   amount = sign × N × (fixing − K) in the quote currency, sign +1 for BUY and −1 for SELL
    option    the expired payoff on the fixing; a barrier's or a touch's only once its knock state is known

A fixed amount not yet paid is one cash flow on the settlement date, whatever product it came from: fixed_cash()
values it and gives its sensitivities, for a forward and an option alike.

`provisional` says the amount is not final, and `provisional_reason` why:
    "no fixing stored"          the price is the stored spot (`provisional_basis` names its date), as before the store
    "knock state not recorded"  a barrier or touch option whose fixing does not itself decide whether the barrier was
                                touched: the amount is the one that holds if it never was
Nothing here writes, and nothing here changes a trade."""
from __future__ import annotations

import logging
import math
from datetime import date, timedelta
from typing import Any, Callable, Optional

from settlement import store
from settlement.sources import INSTRUMENTS

log = logging.getLogger("rijeka.settlement")

KNOCK_STYLES = ("BARRIER", "DOUBLE_BARRIER", "TOUCH")
NO_FIXING, NO_KNOCK = "no fixing stored", "knock state not recorded"
NEVER_TOUCHED = "the barrier taken as never touched"
PAID_AT_HIT = "paid at the hit: nothing is outstanding at expiry"

__all__ = ["INSTRUMENTS", "KNOCK_STYLES", "NO_FIXING", "NO_KNOCK", "parse", "terms_of", "settlement", "forward_amount", "settlement_amount",
           "option_amount", "knock_state", "with_option_amount", "fixed_cash", "report"]


def _z(x):
    """A reported figure without a negative zero (−0.0 reads as a loss of nothing): None stays None."""
    return None if x is None else float(x) + 0.0


def _date(v) -> Optional[date]:
    try:
        return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


# ── the terms ────────────────────────────────────────────────────────────────

def parse(trade) -> dict:
    """A digital-asset forward's or option's terms, from the canonical record's fields: the one reading of them
    (pnl/valuation.py values from it). KeyError, TypeError or ValueError when the terms cannot be read.

        pair, shape (FORWARD | OPTION), notional, strike (the contract price; None when the record has none),
        settle, direction, fixing_date, source, trade_date; an option also option_type, expiry, style_fields"""
    t = dict(trade.terms or {})
    itype = str(trade.instrument_type or "").upper()
    if itype == "CRYPTO_FORWARD":
        out = {"pair": f"{str(t['digital_asset']).upper()}USD", "shape": "FORWARD",
               "notional": float(t.get("notional_amount") or trade.notional),
               "strike": float(t["forward_price"]) if t.get("forward_price") not in (None, "") else None,
               "settle": date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date))}
        out["fixing_date"] = _date(t.get("valuation_date")) or out["settle"]        # an older record without the date fixes on its settlement date
    elif itype == "CRYPTO_OPTION":
        out = {"pair": f"{str(t['digital_asset']).upper()}USD", "shape": "OPTION",
               "notional": float(t.get("notional_amount") or trade.notional),
               "strike": float(t["strike_price"]) if t.get("strike_price") not in (None, "") else None,
               "option_type": str(t.get("option_type") or "CALL").upper(), "expiry": date.fromisoformat(str(t["expiration_date"])),
               "settle": date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date)), "style_fields": dict(t)}
        out["fixing_date"] = out["expiry"]
    else:
        raise ValueError("not a digital-asset forward or option")
    out["direction"] = str(t.get("direction") or "BUY")
    out["source"] = str(t.get("settlement_price_source") or "").strip()
    out["trade_date"] = _date(getattr(trade, "trade_date", None))
    return out


def terms_of(trade) -> Optional[dict]:
    """parse(), or None for any other trade and for terms that cannot be read."""
    if str(getattr(trade, "instrument_type", "") or "").upper() not in INSTRUMENTS:
        return None
    try:
        return parse(trade)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


# ── amounts ──────────────────────────────────────────────────────────────────

def _sign(direction) -> float:
    return 1.0 if str(direction).upper() == "BUY" else -1.0


def forward_amount(direction: str, notional: float, strike: float, price: float) -> float:
    """sign × N × (price − K), in the quote currency, from our side."""
    return _sign(direction) * float(notional) * (float(price) - float(strike))


def settlement_amount(kind: str, direction: str, notional: float, strike: float, price: float) -> float:
    """The undiscounted amount of a FORWARD, or of a vanilla CALL or PUT, on a settlement price: the figures the
    shared test vectors pin (tests/vectors/fx_scenario.json), each from the one implementation of its payoff."""
    kind = str(kind).upper()
    if kind == "FORWARD":
        return forward_amount(direction, notional, strike, price)
    from pricing.fx_exotic import ExoticSpec, _expired
    return _sign(direction) * float(notional) * _expired(ExoticSpec("EUROPEAN", kind, strike=float(strike)), float(price), 1.0)


def option_amount(t: dict, spec, K: Optional[float], price: float, knocked: Optional[bool] = None) -> float:
    """An expired option's fixed payoff on `price`, undiscounted, in the quote currency, from our side.

    `knocked` (whether the barrier was touched) decides a barrier's or a touch's payoff. None leaves it to the
    desk's record (terms.knocked), and without one the payoff is read from the price alone as it was before the
    fixings store existed: what an FX option still does, and nothing a digital asset's settlement relies on."""
    from pricing.fx_exotic import ExoticSpec, _expired
    sf = t.get("style_fields") or {}
    if knocked is None and sf.get("knocked") is not None:
        knocked = bool(sf["knocked"])
    if spec.style in KNOCK_STYLES and knocked is not None:
        if spec.style == "TOUCH":
            hit_pays = spec.touch_type in ("ONE_TOUCH", "DOUBLE_ONE_TOUCH")
            unit = spec.payout if (knocked == hit_pays) else 0.0
        else:
            alive_pays = spec.barrier_type.endswith("OUT")
            unit = (_expired(ExoticSpec("EUROPEAN", spec.option_type, strike=K), price, 1.0) if (knocked != alive_pays) else spec.rebate)
        scale = t["notional"] if spec.style != "TOUCH" else 1.0
    else:
        unit = _expired(spec, price, 1.0)
        scale = t["notional"] if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else 1.0
    return _sign(t["direction"]) * scale * unit


def knock_state(spec, recorded, price: Optional[float], ref_spot: Optional[float] = None) -> tuple[Optional[bool], Optional[str]]:
    """(whether the barrier was touched, how that is known) for a barrier or touch option at expiry.

    "recorded": terms.knocked says so, either way. "price": the price at expiry is itself at or beyond the barrier
    (an out barrier is knocked out, an in barrier knocked in, a one-touch level touched, a double barrier's
    corridor left), which settles it whatever happened before. Otherwise (None, None): the price at expiry does
    not breach, and whether the barrier was touched on the way is not something the fixing can say. A single
    touch level's side is not on the record; it is taken from the stored spot of the trade date (`ref_spot`), and
    without one only a price exactly on the level counts."""
    if recorded is not None:
        return bool(recorded), "recorded"
    if price is None:
        return None, None
    double = spec.style == "DOUBLE_BARRIER" or (spec.style == "TOUCH" and str(spec.touch_type or "").startswith("DOUBLE"))
    if double:
        if spec.lower is not None and spec.upper is not None and (price <= spec.lower or price >= spec.upper):
            return True, "price"
        return None, None
    if spec.barrier is None:
        return None, None
    if spec.style == "BARRIER":
        up = str(spec.barrier_type or "").startswith("UP")
    elif price == spec.barrier:
        return True, "price"
    elif ref_spot:
        up = spec.barrier > ref_spot
    else:
        return None, None
    return (True, "price") if (price >= spec.barrier if up else price <= spec.barrier) else (None, None)


def with_option_amount(fix: dict, t: dict, spec, K: Optional[float]) -> dict:
    """settlement()'s answer for an option, with its amount: the expired payoff on the rule's price. For a barrier
    or a touch the amount is final only when the knock state is known (knock_state); otherwise it is the amount
    that holds if the barrier was never touched, flagged provisional with its reason, and the amount that holds
    if it was touched is given beside it (`settlement_amount_if_touched`). `knock` in the answer is "recorded",
    "price" or "unknown" for those styles and None for the others.

    A recorded touch that was paid when it happened leaves nothing to pay at expiry: a one-touch with pay_at_hit,
    and a knock-out's rebate (the pricer values both at the hit). The outstanding amount is then zero and
    `paid_at_hit` says why. A knock the price at expiry itself decides is paid at expiry, as any other."""
    out = {**fix, "knock": None, "paid_at_hit": False}
    price = fix.get("price")
    if price is None or (K is None and spec.style != "TOUCH"):
        return out
    if spec.style not in KNOCK_STYLES:
        out["settlement_amount"] = option_amount(t, spec, K, float(price))
        return out
    state, how = knock_state(spec, (t.get("style_fields") or {}).get("knocked"), float(price), fix.get("ref_spot"))
    out["settlement_amount"] = option_amount(t, spec, K, float(price), knocked=bool(state))
    out["knock"] = how or "unknown"
    if state is None:
        out["provisional"] = True
        out["provisional_reason"] = fix.get("provisional_reason") or NO_KNOCK
        out["provisional_basis"] = fix.get("provisional_basis") or NEVER_TOUCHED
        out["settlement_amount_if_touched"] = option_amount(t, spec, K, float(price), knocked=True)
    elif how == "recorded" and state:
        one_touch = spec.style == "TOUCH" and spec.touch_type in ("ONE_TOUCH", "DOUBLE_ONE_TOUCH") and bool(spec.pay_at_hit)
        knock_out = spec.style in ("BARRIER", "DOUBLE_BARRIER") and str(spec.barrier_type or "").endswith("OUT")
        if one_touch or knock_out:
            out["settlement_amount"], out["paid_at_hit"] = 0.0, True
    return out


def fixed_cash(amount: float, val_date: date, settle: date, df: Callable[[date], float]) -> dict[str, float]:
    """A known amount in the quote currency on the settlement date, valued today: the one implementation, for a
    forward fixed and not yet paid and for an option whose payoff is fixed alike. `df` is the discounting curve's
    discount factor to a date.

        npv        amount × DF(settlement)
        ir01       +1 bp on the discounting curve, the only curve left: npv × (e^(−1bp × t) − 1), t ACT/365
        theta      one day later on the same curve: amount × DF(settlement) / DF(tomorrow) − npv, and −npv on the
                   eve of settlement (the mark is zero from the settlement date, as the forward pricer has it)
        spot01, ir01_base   zero: no spot and no funding rate is left in it"""
    d = float(df(settle))
    npv = float(amount) * d
    d1 = val_date + timedelta(days=1)
    theta = float(amount) * d / max(float(df(d1)), 1e-12) - npv if settle > d1 else -npv
    ir01 = npv * (math.exp(-1e-4 * (settle - val_date).days / 365.0) - 1.0)
    return {"npv": _z(npv), "ir01": _z(ir01), "ir01_disc": _z(ir01), "ir01_base": 0.0, "spot01": 0.0, "theta": _z(theta)}


# ── the rule ─────────────────────────────────────────────────────────────────

def _stored_spot(db, user_id, pair: str, on: Optional[date], cache: Optional[dict]) -> tuple[Optional[float], Optional[date]]:
    """(the account's stored spot as of a date, the date of the snapshot it came from)."""
    if db is None or on is None:
        return None, None
    from pnl.market import Market
    try:
        m = Market(db, user_id, on, cache=cache)
        px = m.spot(pair)
        return (px, m.snapshot_date(f"{pair}_SPOT")) if px else (None, None)
    except Exception as e:          # noqa: BLE001 — no spot is an answer; the caller's own stands
        log.debug("stored spot %s %s: %s", pair, on, type(e).__name__)
        store._rollback(db)
        return None, None


def settlement(db, user_id, trade, val_date: date, *, spot: Optional[float] = None, cache: Optional[dict] = None) -> Optional[dict[str, Any]]:
    """What a digital-asset trade settles on, once its fixing date is reached; None before it and for other trades.

        fixing              {source, date, time, value, origin, disputed} of the named source's stored fixing, or None
        provisional         True when no fixing is stored (an option's knock state can add to it: with_option_amount)
        provisional_reason  "no fixing stored" then, else None
        provisional_basis   "stored spot of <date>" then: what the price below is
        price               the fixing; without one the stored spot of the fixing date, else `spot` (the caller's)
        settlement_amount   a forward's sign × N × (price − K), undiscounted; None for an option until
                            with_option_amount, and when the terms carry no contract price
        ref_spot            a single touch option only: the stored spot of the trade date, which tells the side of its level

    plus the parsed terms (pair, shape, fixing_date, source, direction, notional, strike, settle, ...).
    `cache` is a per-run memo (a Market's): the same key is read once in a run of many valuations."""
    k = terms_of(trade)
    if k is None or val_date < k["fixing_date"]:
        return None
    key = f"fixing:{k['pair']}:{k['fixing_date']}:{k['source']}"
    if cache is not None and key in cache:
        row = cache[key]
    else:
        try:
            row = store.get(db, k["pair"], k["fixing_date"], k["source"], user_id)
        except Exception as e:          # noqa: BLE001 — a store that cannot be read is no fixing, never a failed valuation
            log.warning("fixing for %s %s not read: %s", k["pair"], k["fixing_date"], type(e).__name__)
            store._rollback(db)
            row = None
        if cache is not None:
            cache[key] = row
    # `disputed`: the venue has since read this date differently and no administrator has ruled; the stored value stands
    fixing = {**{f: row[f] for f in ("source", "date", "time", "value", "origin")}, "disputed": bool(row.get("disputed"))} if row else None
    basis = None
    if fixing:
        price = fixing["value"]
    else:
        price, on = _stored_spot(db, user_id, k["pair"], k["fixing_date"], cache)
        if price is not None:
            basis = f"stored spot of {on.isoformat() if on else k['fixing_date'].isoformat()}"
        elif spot is not None:
            price, basis = spot, f"stored spot of {val_date.isoformat()}"
    amount = None
    if k["shape"] == "FORWARD" and price is not None and k["strike"] is not None:
        amount = forward_amount(k["direction"], k["notional"], k["strike"], price)
    ref = None
    sf = k.get("style_fields") or {}
    if (k["shape"] == "OPTION" and str(sf.get("style") or "").upper() == "TOUCH" and sf.get("knocked") is None
            and not str(sf.get("touch_type") or "").upper().startswith("DOUBLE")):
        ref, _ = _stored_spot(db, user_id, k["pair"], k["trade_date"], cache)
    return {**k, "fixing": fixing, "provisional": fixing is None, "provisional_reason": None if fixing else NO_FIXING,
            "provisional_basis": basis, "price": price, "settlement_amount": amount, "ref_spot": ref}


def report(fix: dict) -> dict[str, Any]:
    """What a valuation says once the fixing date is reached, from settlement()'s answer (with_option_amount applied
    for an option): the one shape, for the booked valuation and the ticket. `settlement_amount_if_touched` is there
    only when the amount is provisional because the knock state is not recorded: the other of the two outcomes."""
    out = {"fixing": fix["fixing"], "provisional": bool(fix["provisional"]), "provisional_reason": fix.get("provisional_reason"),
           "provisional_basis": fix.get("provisional_basis") if fix["provisional"] else None,
           "settlement_amount": _z(fix.get("settlement_amount")), "settlement_price": _z(fix.get("price")),
           "fixing_date": fix["fixing_date"].isoformat(), "fixing_source": fix["source"] or None}
    if fix.get("provisional_reason") == NO_KNOCK and fix.get("settlement_amount_if_touched") is not None:
        out["settlement_amount_if_touched"] = _z(fix["settlement_amount_if_touched"])
    return out
