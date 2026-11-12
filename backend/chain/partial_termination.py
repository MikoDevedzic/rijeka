"""A partial termination: the trade stays, on a smaller notional.

What changes is worked out here from the booking as it stands, never taken from the request: the trade's notional,
each leg's in the same proportion, and for a currency or digital-asset trade the notional its signed record carries
in `terms` (`base_notional` and `quote_notional`, or `notional_amount`). The fee for the unwind joins the trade's
fees (`terms.fees`, type UNWIND), so the runs that read fees read it.

Nothing here touches a database or a chain. api/routes/chain.py applies the result: through the registry with both
signatures when the trade's record is anchored (the old record is superseded by the new one, as an amendment is),
and straight onto the booking when it is not.

Not handled, and refused in words: a leg of a package (the registry holds the package's hash), an option whose
size is a payout and not a notional (a digital, a touch), and a leg with a notional schedule of its own.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from pricing import fees as F

OPEN_STATUSES = ("PENDING", "CONFIRMED")           # a trade that is cancelled, terminated or matured has nothing left to reduce
PAYOUT_STRUCTURES = ("DIGITAL", "TOUCH")
_SCALED_WITH_THE_NOTIONAL = ("quote_notional",)      # stated in the record as notional × rate: moves in proportion
_THE_NOTIONAL_ITSELF = ("notional_amount", "base_notional")


def _dec(x) -> Decimal:
    try:
        d = Decimal(str(x))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("the notional is a number") from None
    if not d.is_finite():
        raise ValueError("the notional is a number")
    return d


def plain(d: Decimal) -> str:
    """A decimal as the record writes it: no exponent, no trailing zeros."""
    s = format(d.normalize(), "f")
    return s if s not in ("-0", "") else "0"


def _like(original, d: Decimal):
    """The new figure in the type the record held the old one in (a string stays a string)."""
    return plain(d) if isinstance(original, str) else float(d)


def fee_currency(trade) -> str:
    """The currency the trade's fees are in: the one its fees already carry, else the quote or price currency of a
    currency or digital-asset trade, else the notional's."""
    t = trade.terms or {}
    for f in (t.get("fees") or []):
        if isinstance(f, dict) and f.get("currency"):
            return str(f["currency"]).upper()
    return str(t.get("quote_currency") or t.get("price_currency") or t.get("settlement_currency") or trade.notional_ccy or "USD").upper()


def changes_for(trade, legs: list, new_notional, fee: Optional[dict], today: date) -> tuple[dict, dict]:
    """(changes, summary) for reducing `trade` to `new_notional`, or ValueError saying why not.

    `changes` has the shape an amendment's has ({"trade": {...}, "legs": [{"id", "notional"}]}), so the event that
    carries it replays like one. `summary` is what was done, in figures: from, to, the part terminated, the date,
    the fee."""
    if str(trade.status or "").upper() not in OPEN_STATUSES:
        raise ValueError(f"{trade.trade_ref} is {trade.status}: only a pending or confirmed trade can be partially terminated")
    if trade.notional is None:
        raise ValueError(f"{trade.trade_ref} has no notional to reduce")
    terms = deepcopy(dict(trade.terms or {}))
    if str(trade.structure or "").upper() in PAYOUT_STRUCTURES or terms.get("payout") not in (None, ""):
        raise ValueError("this option's size is a payout, not a notional: a partial termination of it is not built yet")
    old, new = _dec(trade.notional), _dec(new_notional)
    if not (Decimal(0) < new < old):
        raise ValueError(f"the new notional is above zero and below the trade's {plain(old)} (to close the whole trade, terminate it)")
    for k in _THE_NOTIONAL_ITSELF:
        if terms.get(k) not in (None, ""):
            if _dec(terms[k]) != old:
                raise ValueError(f"the record's {k} ({terms[k]}) is not the trade's notional ({plain(old)}): the booking is out of step with itself")
            terms[k] = _like(terms[k], new)
    for k in _SCALED_WITH_THE_NOTIONAL:
        if terms.get(k) not in (None, ""):
            terms[k] = _like(terms[k], (_dec(terms[k]) * new / old).quantize(Decimal("0.01")))
    unwind = None
    if fee is not None:
        ccy = fee_currency(trade)
        raw = {"type": "UNWIND", "direction": fee.get("direction"), "amount": fee.get("amount"), "currency": fee.get("currency") or ccy,
               "date": fee.get("date"), "note": fee.get("note") or f"partial termination {plain(old)} to {plain(new)}"}
        every = F.normalise(list(terms.get("fees") or []) + [raw], ccy)       # ValueError in the fee's own words
        unwind = every[-1]
        if date.fromisoformat(unwind["date"]) < today:
            raise ValueError("the unwind fee is paid today or later")
        terms["fees"] = every
    leg_changes = []
    for leg in legs:
        if getattr(leg, "notional_schedule", None):
            raise ValueError("a leg of this trade has a notional schedule of its own: a partial termination of it is not built yet")
        if leg.notional is None:
            continue
        leg_changes.append({"id": str(leg.id), "notional": plain((_dec(leg.notional) * new / old).quantize(Decimal("0.000001")))})
    trade_changes = {"notional": plain(new)}
    if terms != dict(trade.terms or {}):
        trade_changes["terms"] = terms
    summary = {"from_notional": plain(old), "to_notional": plain(new), "terminated_notional": plain(old - new),
               "notional_ccy": trade.notional_ccy, "effective_date": today.isoformat(), "fee": unwind}
    return {"trade": trade_changes, "legs": leg_changes}, summary


def apply(trade, legs: list, changes: dict) -> None:
    """Put `changes` (from changes_for) on the rows. The caller owns the transaction."""
    tc = changes.get("trade") or {}
    trade.notional = Decimal(tc["notional"])
    if "terms" in tc:
        trade.terms = tc["terms"]
    by_id = {str(leg.id): leg for leg in legs}
    for c in changes.get("legs") or []:
        by_id[c["id"]].notional = Decimal(c["notional"])
