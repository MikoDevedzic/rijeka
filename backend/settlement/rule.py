"""The settlement rule for digital-asset trades, in one place. The booked valuation (pnl/valuation.py) and the
ticket's pricing of a booked trade (api/routes/currencies.price_booked) both call settlement() from the fixing
date on; before that date it returns None and neither path changes.

The fixing of a trade is the stored row for its pair, its fixing date (terms.valuation_date for a forward,
terms.expiration_date for an option) and exactly the source its terms name (terms.settlement_price_source): the
account's own row first, then the shared one. Never another source's price: a trade that names one benchmark
does not settle on a venue's delivery price.

    forward   amount = sign × N × (fixing − K) in the quote currency, sign +1 for BUY and −1 for SELL
    option    the expired payoff of pnl/valuation.py, on the fixing instead of the stored spot

No fixing stored: `provisional`, and the price is the stored spot of the fixing date, as before the store existed.
Nothing here writes, and nothing here changes a trade."""
from __future__ import annotations

import logging
import math
from datetime import date
from typing import Any, Optional

from settlement import store

log = logging.getLogger("rijeka.settlement")

INSTRUMENTS = ("CRYPTO_FORWARD", "CRYPTO_OPTION")


def _date(v) -> Optional[date]:
    try:
        return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def _float(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def terms_of(trade) -> Optional[dict]:
    """{pair, shape, fixing_date, source, direction, notional, strike} of a digital-asset forward or option, from
    its terms; None for any other trade and for terms without a readable asset or fixing date."""
    itype = str(getattr(trade, "instrument_type", "") or "").upper()
    if itype not in INSTRUMENTS:
        return None
    t = dict(getattr(trade, "terms", None) or {})
    asset = str(t.get("digital_asset") or "").upper()
    if itype == "CRYPTO_FORWARD":
        shape, strike = "FORWARD", t.get("forward_price")
        fixing_date = _date(t.get("valuation_date")) or _date(t.get("settlement_date")) or _date(getattr(trade, "maturity_date", None))
    else:
        shape, strike = "OPTION", t.get("strike_price")
        fixing_date = _date(t.get("expiration_date"))
    if not asset or fixing_date is None:
        return None
    return {"pair": f"{asset}USD", "shape": shape, "fixing_date": fixing_date, "source": str(t.get("settlement_price_source") or "").strip(),
            "direction": str(t.get("direction") or "BUY").upper(), "notional": _float(t.get("notional_amount") or getattr(trade, "notional", None)),
            "strike": _float(strike) if strike not in (None, "") else None}


def forward_amount(direction: str, notional: float, strike: float, price: float) -> float:
    """sign × N × (price − K), in the quote currency, from our side."""
    return (1.0 if str(direction).upper() == "BUY" else -1.0) * float(notional) * (float(price) - float(strike))


def _stored_spot(db, user_id, pair: str, on: date, cache: Optional[dict]) -> Optional[float]:
    if db is None:
        return None
    from pnl.market import Market
    try:
        return Market(db, user_id, on, cache=cache).spot(pair)
    except Exception as e:          # noqa: BLE001 — no spot is an answer; the caller's own stands
        log.debug("stored spot %s %s: %s", pair, on, type(e).__name__)
        try:
            db.rollback()
        except Exception:          # noqa: BLE001
            pass
        return None


def settlement(db, user_id, trade, val_date: date, *, spot: Optional[float] = None, cache: Optional[dict] = None) -> Optional[dict[str, Any]]:
    """What a digital-asset trade settles on, once its fixing date is reached; None before it and for other trades.

        fixing             {source, date, time, value, origin} of the named source's stored fixing, or None
        provisional        True when no fixing is stored
        price              the fixing; without one the stored spot of the fixing date, else `spot` (the caller's)
        settlement_amount  a forward's sign × N × (price − K), undiscounted; None for an option (its payoff is the
                           valuation's) and when the terms carry no contract price

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
    fixing = {f: row[f] for f in ("source", "date", "time", "value", "origin")} if row else None
    price = fixing["value"] if fixing else (_stored_spot(db, user_id, k["pair"], k["fixing_date"], cache) or spot)
    amount = None
    if k["shape"] == "FORWARD" and price is not None and k["strike"] is not None and k["notional"] is not None:
        amount = forward_amount(k["direction"], k["notional"], k["strike"], price)
    return {**k, "fixing": fixing, "provisional": fixing is None, "price": price, "settlement_amount": amount}
