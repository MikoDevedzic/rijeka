"""An amendment: the trade stays, on a term the parties have agreed to change.

What the public standards call these (ISDA's Common Domain Model, the CFTC's swap reporting specification):
a change the parties negotiate is an AMENDMENT (CDM: a terms change; CFTC: MODI with the amendment indicator), a
notional that goes up is an INCREASE (CDM: a quantity change), and a booking put right before the other side has
agreed anything is a CORRECTION (the record was wrong, the deal was not). All three keep the trade and its UTI. A
notional that goes down is a partial termination and has its own module (chain/partial_termination.py).

As there, what changes is worked out here from the booking as it stands, never taken from the request: the request
names a term and its new value, and this module finds where the booking and its signed record hold that term, changes
every place together and refuses a booking that is out of step with itself.

Terms a request may set, each only where the trade has exactly one of it:
  notional       upward only; every leg in proportion, and the notional the record carries in `terms`
  fixed_rate     the fixed leg's coupon, in percent (and the copy of it the ticket keeps in the trade's `terms`)
  spread         the floating leg's spread, in basis points (and its copy in `terms`)
  forward_rate   a currency forward's contract rate (the cash it states moves with it)
  forward_price  a digital-asset forward's contract price
  strike         an option's strike (a currency option's stated cash moves with it)

Nothing here touches a database or a chain. api/routes/chain.py applies the result: through the registry with both
signatures when the trade's record is anchored, and straight onto the booking when it is not.

Not handled, and refused in words: dates and schedules, a leg with a schedule of its own, an option whose size is a
payout, any term of a swaption, a cap, a floor or a collar (their options and their premium are sized on the
notional), the notional of a leg that carries an embedded option or cashflows entered by hand, a trade with more
than one fixed leg or more than one floating leg, an option's premium (it is listed, so the form shows that it stays
as booked when the strike or the notional moves), and a leg of a package (the route refuses that one: the registry
holds the package's hash).
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal
from typing import Optional

from chain.partial_termination import OPEN_STATUSES, PAYOUT_STRUCTURES, SIX_DECIMALS, _dec, _like, plain

EIGHT_DECIMALS = Decimal("0.00000001")            # trade_legs.fixed_rate and .spread are Numeric(12, 8)
CENTS = Decimal("0.01")
REASON_MAX = 200
RATE_MAX_PCT = Decimal("100")                     # no coupon is outside +/-100 %
SPREAD_MAX_BP = Decimal("10000")                  # nor a spread outside +/-10,000 bp
PRICE_MAX = Decimal("1e12")                       # nor a rate, price or strike above this
NOTIONAL_MAX = Decimal(10) ** 18                  # trades.notional and trade_legs.notional are Numeric(24, 6): below this
SIZED_ON_THE_NOTIONAL = ("IR_SWAPTION", "IR_CAP", "IR_FLOOR", "IR_COLLAR")

_NOTIONAL_IN_TERMS = ("notional_amount", "base_notional")
LABELS = {"notional": "NOTIONAL", "fixed_rate": "FIXED RATE", "spread": "SPREAD", "forward_rate": "FORWARD RATE",
          "forward_price": "FORWARD PRICE", "strike": "STRIKE", "premium": "PREMIUM"}
PREMIUM_STAYS = "the premium stays as booked"
OPTIONS = ("FX_OPTION", "CRYPTO_OPTION")
UNITS = {"fixed_rate": "%", "spread": "bp"}


def _itype(trade) -> str:
    return str(getattr(trade, "instrument_type", "") or "").upper()


def _has(seq) -> bool:
    """A schedule that holds something (an empty list is a leg without one)."""
    return bool(seq)


def _legs_of(legs: list, kind: str) -> list:
    return [leg for leg in legs if str(getattr(leg, "leg_type", "") or "").upper() == kind]


def _term_key(trade) -> Optional[tuple[str, str]]:
    """(request key, the key in trade.terms) of the one price term a currency or digital-asset trade's record holds."""
    it, terms = _itype(trade), dict(trade.terms or {})
    if it == "CRYPTO_FORWARD":
        return ("forward_price", "forward_price")
    if it == "CRYPTO_OPTION":
        return ("strike", "strike_price") if terms.get("strike_price") not in (None, "") else None
    if it == "FX_OPTION":
        return ("strike", "strike") if terms.get("strike") not in (None, "") else None
    if it in ("FX_FORWARD", "NDF", "FX_SPOT") and terms.get("forward_rate") not in (None, ""):
        return ("forward_rate", "forward_rate")
    return None


def amendable(trade, legs: list) -> list[dict]:
    """The terms of this trade a request may set: [{key, label, now, unit, why_not}], `now` as the form shows it (a
    coupon in percent, a spread in basis points). A term the trade has and this module cannot change is listed with
    `why_not`, so the form says so rather than leaving it out."""
    out: list[dict] = []
    payout = str(getattr(trade, "structure", "") or "").upper() in PAYOUT_STRUCTURES or (trade.terms or {}).get("payout") not in (None, "")
    if trade.notional is not None:
        why = None
        if payout:
            why = "this option's size is a payout, not a notional"
        elif _itype(trade) in SIZED_ON_THE_NOTIONAL:
            why = "this product's options and its premium are sized on the notional"
        elif any(_has(getattr(leg, "notional_schedule", None)) for leg in legs):
            why = "a leg of this trade has a notional schedule of its own"
        elif any(_has(getattr(leg, "embedded_options", None)) for leg in legs):
            why = "a leg of this trade carries an embedded option sized on the notional"
        elif any(_has((getattr(leg, "terms", None) or {}).get("custom_cashflows")) for leg in legs):
            why = "a leg of this trade carries cashflows entered by hand"
        note = "upward only: an increase. To reduce it, partially terminate."
        out.append({"key": "notional", "label": LABELS["notional"], "now": plain(_dec(trade.notional)), "unit": trade.notional_ccy or "", "why_not": why,
                    "note": note + (f" {PREMIUM_STAYS.capitalize()}." if _itype(trade) in OPTIONS else "")})
    if _itype(trade) == "IR_SWAP":
        fixed, floating = _legs_of(legs, "FIXED"), _legs_of(legs, "FLOAT")
        if fixed:
            why = None
            if len(fixed) != 1:
                why = "this trade has more than one fixed leg"
            elif _has(getattr(fixed[0], "fixed_rate_schedule", None)):
                why = "the fixed leg has a rate schedule of its own"
            elif fixed[0].fixed_rate is None:
                why = "the fixed leg has no rate"
            now = plain((_dec(fixed[0].fixed_rate) * 100).normalize()) if len(fixed) == 1 and fixed[0].fixed_rate is not None else ""
            out.append({"key": "fixed_rate", "label": LABELS["fixed_rate"], "now": now, "unit": "%", "why_not": why})
        if floating:
            why = None
            if len(floating) != 1:
                why = "this trade has more than one floating leg"
            elif _has(getattr(floating[0], "spread_schedule", None)):
                why = "the floating leg has a spread schedule of its own"
            now = plain((_dec(floating[0].spread or 0) * 10000).normalize()) if len(floating) == 1 else ""
            out.append({"key": "spread", "label": LABELS["spread"], "now": now, "unit": "bp", "why_not": why})
    tk = _term_key(trade)
    if tk is not None:
        key, where = tk
        terms = dict(trade.terms or {})
        unit = str(terms.get("quote_currency") or terms.get("price_currency") or terms.get("strike_currency") or "")
        out.append({"key": key, "label": LABELS[key], "now": plain(_dec(terms[where])), "unit": unit, "why_not": None,
                    "note": f"{PREMIUM_STAYS}." if _itype(trade) in OPTIONS else None})
    if _itype(trade) in OPTIONS and (trade.terms or {}).get("premium_amount") not in (None, ""):
        # listed so the form shows it beside the strike and the notional: what was paid for the option is not moved by them
        out.append({"key": "premium", "label": LABELS["premium"], "now": plain(_dec(trade.terms["premium_amount"])),
                    "unit": str(trade.terms.get("premium_currency") or ""), "why_not": "the premium is not amended here: it stays as booked"})
    return out


def clean_reason(reason) -> Optional[str]:
    """The reason as it is kept: one line of printable text, or None."""
    if reason is None:
        return None
    s = " ".join("".join(ch if ch.isprintable() else " " for ch in str(reason)).split())
    return s[:REASON_MAX] or None


def _number(v, what: str) -> Decimal:
    try:
        return _dec(v)
    except ValueError:
        raise ValueError(f"the {what} is a number") from None


def _copy_in_terms(terms: dict, key: str, old: Decimal, new: Decimal) -> None:
    """A swap's ticket keeps a copy of its coupon and its spread in the trade's `terms`, and reads the copy first when
    the trade is opened again. The copy moves with the leg; one that does not say what the leg says is refused."""
    if terms.get(key) in (None, ""):
        return
    if _dec(terms[key]).quantize(EIGHT_DECIMALS) != old.quantize(EIGHT_DECIMALS):
        raise ValueError(f"the trade's own {key} ({terms[key]}) is not its leg's ({plain(old)}): the booking is out of step with itself")
    terms[key] = _like(terms[key], new)


def changes_for(trade, legs: list, request: dict, today: date, reason=None) -> tuple[dict, dict]:
    """(changes, summary) for setting the terms in `request` ({key: new value}) on `trade`, or ValueError saying why
    not. `changes` has the shape every amendment's has ({"trade": {...}, "legs": [{"id", ...}]}), so the event that
    carries it replays like one. `summary` is what was done, in the form's own units: each term from and to."""
    if str(trade.status or "").upper() not in OPEN_STATUSES:
        raise ValueError(f"{trade.trade_ref} is {trade.status}: only a pending or confirmed trade can be amended")
    if not isinstance(request, dict) or not request:
        raise ValueError("name at least one term to change")
    offered = {t["key"]: t for t in amendable(trade, legs)}
    for key in request:
        if key not in LABELS:
            raise ValueError(f"`{key}` is not a term an amendment can set: {', '.join(LABELS)}")
        if key not in offered:
            raise ValueError(f"{trade.trade_ref} has no {LABELS[key].lower()} to amend")
        if offered[key]["why_not"]:
            raise ValueError(f"{offered[key]['why_not']}: amending its {LABELS[key].lower()} is not built yet")
    try:
        return _changes(trade, legs, request, today, reason, offered)
    except ArithmeticError:       # a figure no trade has: a division by a notional of zero, a product past what a decimal holds
        raise ValueError("these figures are outside what a trade can carry") from None


def _changes(trade, legs: list, request: dict, today: date, reason, offered: dict) -> tuple[dict, dict]:

    terms = deepcopy(dict(trade.terms or {}))
    trade_changes: dict = {}
    leg_changes: dict[str, dict] = {}
    done: list[dict] = []

    def said(key, old: Decimal, new: Decimal, unit: str):
        done.append({"key": key, "label": LABELS[key], "from": plain(old), "to": plain(new), "unit": unit})

    if "notional" in request:
        old, new = _dec(trade.notional), _number(request["notional"], "notional").quantize(SIX_DECIMALS)
        if old <= 0:
            raise ValueError(f"{trade.trade_ref} has no notional to raise")
        if new >= NOTIONAL_MAX:
            raise ValueError("the notional is below a million million million")
        if new < old:
            raise ValueError(f"an amendment raises the notional from the trade's {plain(old)}: to reduce it, partially terminate")
        if new > old:
            for k in _NOTIONAL_IN_TERMS:
                if terms.get(k) not in (None, ""):
                    if _dec(terms[k]) != old:
                        raise ValueError(f"the record's {k} ({terms[k]}) is not the trade's notional ({plain(old)}): the booking is out of step with itself")
                    terms[k] = _like(terms[k], new)
            if terms.get("quote_notional") not in (None, ""):
                terms["quote_notional"] = _like(terms["quote_notional"], (_dec(terms["quote_notional"]) * new / old).quantize(CENTS))
            for leg in legs:
                if leg.notional is not None:
                    scaled = (_dec(leg.notional) * new / old).quantize(SIX_DECIMALS)
                    if scaled >= NOTIONAL_MAX:
                        raise ValueError("a leg's notional would be past what a trade can carry")
                    leg_changes.setdefault(str(leg.id), {})["notional"] = plain(scaled)
            trade_changes["notional"] = plain(new)
            said("notional", old, new, trade.notional_ccy or "")

    if "fixed_rate" in request:
        leg = _legs_of(legs, "FIXED")[0]
        pct = _number(request["fixed_rate"], "fixed rate")
        if abs(pct) > RATE_MAX_PCT:
            raise ValueError("the fixed rate is a percentage between -100 and 100")
        old, new = _dec(leg.fixed_rate), (pct / 100).quantize(EIGHT_DECIMALS)
        if new != old:
            leg_changes.setdefault(str(leg.id), {})["fixed_rate"] = plain(new)
            _copy_in_terms(terms, "fixed_rate", old, new)
            said("fixed_rate", (old * 100).normalize(), (new * 100).normalize(), "%")

    if "spread" in request:
        leg = _legs_of(legs, "FLOAT")[0]
        bp = _number(request["spread"], "spread")
        if abs(bp) > SPREAD_MAX_BP:
            raise ValueError("the spread is in basis points, between -10,000 and 10,000")
        old, new = _dec(leg.spread or 0), (bp / 10000).quantize(EIGHT_DECIMALS)
        if new != old:
            leg_changes.setdefault(str(leg.id), {})["spread"] = plain(new)
            _copy_in_terms(terms, "spread", old, new)
            said("spread", (old * 10000).normalize(), (new * 10000).normalize(), "bp")

    tk = _term_key(trade)
    if tk is not None and tk[0] in request:
        key, where = tk
        old, new = _dec(terms[where]), _number(request[key], LABELS[key].lower())
        if not (Decimal(0) < new <= PRICE_MAX):
            raise ValueError(f"the {LABELS[key].lower()} is above zero")
        if new != old:
            terms[where] = _like(terms[where], new)
            # the cash a currency trade states is its base notional at the rate (or the strike): it moves with it
            if terms.get("quote_notional") not in (None, "") and terms.get("base_notional") not in (None, ""):
                terms["quote_notional"] = _like(terms["quote_notional"], (_dec(terms["base_notional"]) * new).quantize(CENTS))
            said(key, old, new, offered[key]["unit"])

    if not done:
        raise ValueError("these are the terms the trade already has: nothing to amend")
    if terms != dict(trade.terms or {}):
        trade_changes["terms"] = terms
    pending = str(trade.status or "").upper() == "PENDING"
    summary = {"kind": "CORRECTION" if pending else "AMENDMENT", "increase": any(d["key"] == "notional" for d in done),
               "terms": done, "effective_date": today.isoformat(), "reason": clean_reason(reason)}
    changes: dict = {"legs": [{"id": lid, **c} for lid, c in leg_changes.items()]}
    if trade_changes:
        changes["trade"] = trade_changes
    return changes, summary


def apply(trade, legs: list, changes: dict) -> None:
    """Put `changes` (from changes_for) on the rows. The caller owns the transaction."""
    tc = changes.get("trade") or {}
    if "notional" in tc:
        trade.notional = Decimal(tc["notional"])
    if "terms" in tc:
        trade.terms = tc["terms"]
    by_id = {str(leg.id): leg for leg in legs}
    for c in changes.get("legs") or []:
        leg = by_id[c["id"]]
        for k in ("notional", "fixed_rate", "spread"):
            if k in c:
                setattr(leg, k, Decimal(c[k]))
