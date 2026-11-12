"""The desk's record that a barrier was touched (or, once the option has expired, that it never was).

A barrier or touch option's payoff depends on whether its level traded before expiry, which no fixing can say
after the fact. The settlement rule (settlement/rule.py) has always read `terms.knocked`; nothing wrote it, so
such an option settled on a provisional amount. This is the writer: what may be recorded, and the terms with the
record on them. Built for a digital asset's options, which are the ones the settlement rule settles.

The record is `knocked` (true or false), `knock_date` (the day the level traded), `knock_level` (the price seen,
optional) and `knock_recorded` (who and when). It is not a term both parties signed, so the signed record of the
confirmation does not cover it and does not change with it.

Nothing here touches a database. api/routes/currencies.py applies it."""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Optional

KNOCK_STYLES = ("BARRIER", "DOUBLE_BARRIER", "TOUCH")
OPEN_STATUSES = ("PENDING", "CONFIRMED")
_KEYS = ("knocked", "knock_date", "knock_level", "knock_recorded")


def record(terms: dict, *, instrument_type: str, status: str, knocked: Optional[bool], when: Optional[date], level, trade_date: date,
           today: date, by: str, now: datetime) -> dict:
    """The terms with the record on them, or ValueError saying why not. `knocked` None takes the record off."""
    if str(instrument_type or "").upper() != "CRYPTO_OPTION":
        raise ValueError("recording a barrier is built for a digital asset's options")
    if str(status or "").upper() not in OPEN_STATUSES:
        raise ValueError(f"the trade is {status}: only a pending or confirmed trade takes a record")
    t = dict(terms or {})
    style = str(t.get("style") or "EUROPEAN").upper()
    if style not in KNOCK_STYLES:
        raise ValueError(f"a {style.lower()} option has no barrier to record")
    try:
        expiry = date.fromisoformat(str(t.get("expiration_date")))
    except (TypeError, ValueError):
        raise ValueError("the trade's terms carry no expiration date") from None
    for k in _KEYS:
        t.pop(k, None)
    if knocked is None:
        return t
    stamp = {"at": now.isoformat(timespec="seconds"), "by": str(by)}
    if knocked is False:
        if today < expiry:
            raise ValueError(f"'never touched' is said once the option has expired ({expiry}); until then it can still be touched")
        return {**t, "knocked": False, "knock_date": expiry.isoformat(), "knock_recorded": stamp}
    if when is None:
        raise ValueError("a touch needs the date the level traded")
    if not (trade_date <= when <= min(today, expiry)):
        raise ValueError(f"the level traded between the trade date ({trade_date}) and {min(today, expiry)}, the earlier of today and the expiry")
    out = {**t, "knocked": True, "knock_date": when.isoformat(), "knock_recorded": stamp}
    if level is not None:
        try:
            x = float(level)
        except (TypeError, ValueError):
            raise ValueError("the level is a price") from None
        if not (math.isfinite(x) and 0 < x < 1e12):
            raise ValueError("the level is a price")
        out["knock_level"] = x
    return out


def after_touch(fields: dict, spec, direction: str):
    """What a barrier or touch option is once its barrier is recorded as touched and it has not yet expired, or None
    when nothing is recorded (or the style has no barrier):

      ("vanilla", None, words)   knocked in: from here it is the plain option
      ("fixed", amount, words)   everything else: an amount that is known. Nothing where the touch was paid when it
                                 happened (a knock-out's rebate, a one-touch paid at the hit) or pays nothing (a
                                 no-touch); the payout of a one-touch that pays at expiry, from our side.

    The same reading as settlement/rule.with_option_amount makes at expiry."""
    if spec.style not in KNOCK_STYLES or (fields or {}).get("knocked") is not True:
        return None
    on = f" on {fields.get('knock_date')}" if fields.get("knock_date") else ""
    sign = 1.0 if str(direction or "BUY").upper() == "BUY" else -1.0
    if spec.style == "TOUCH":
        if spec.touch_type in ("ONE_TOUCH", "DOUBLE_ONE_TOUCH"):
            if spec.pay_at_hit:
                return "fixed", 0.0, f"touched{on}: the payout was paid at the hit, nothing is outstanding"
            return "fixed", sign * float(spec.payout or 0.0), f"touched{on}: the payout is fixed and paid at settlement"
        return "fixed", 0.0, f"touched{on}: a no-touch pays nothing"
    if str(spec.barrier_type or "").endswith("OUT"):
        return "fixed", 0.0, f"knocked out{on}: the rebate was paid at the hit, nothing is outstanding"
    return "vanilla", None, f"knocked in{on}: from here the plain option"
