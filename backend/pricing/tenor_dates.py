"""Dates by market convention for the currency ticket (GET /api/currency/pairs carries them; the ticket used to
make today + N months in the browser, on no calendar).

Three date kinds, each with one rule, stated here so the frontend, which rolls a typed date itself from the
holiday list the pairs answer carries, cannot disagree with the API:

  FX pair (EURUSD, USDJPY, ...), calendar = the joint calendar of both currencies (a holiday or weekend of either)
    forward value date   spot date + tenor, rolled MODIFIED FOLLOWING on the joint calendar. Weeks are 7 calendar
                         days; months keep the day of the month (a day the month does not have is its last day);
                         end-of-month rule: a spot date on the last business day of its month gives value dates on
                         the last business day of theirs.
    option delivery      the forward value date of the tenor.
    option expiry        the latest joint business day whose spot date is the delivery date (Clark 2011 §5.4; Reiswich
                         and Wystup 2010), searched back up to ten calendar days; when no date has that spot date
                         (a holiday week), the delivery less the spot lag in joint business days, flagged
                         expiry_rule "fallback" (otherwise "spot").
    a typed settlement   MODIFIED FOLLOWING on the joint calendar.
    a typed expiry       MODIFIED FOLLOWING on the joint calendar.

  The spot lag is the pair's (currencies.spot_lag): two business days, USDCAD one; a digital asset's spot settles at
  once (T+0), so its spot date is today and its lag 0.

  Digital asset (BTC, ETH, SOL against USD), calendar = New York (the USD cash moves; the fixing can fall on any day)
    forward settlement   today + tenor by the same arithmetic (no end-of-month rule: there is no spot date to anchor
                         it), rolled FOLLOWING to a New York business day.
    option settlement    the forward settlement of the tenor (so the ticket's 3M option and 3M forward sit on one
                         forward, as FX does).
    option expiry        the New York business day before that settlement (the fixing is published and the cash
                         moves the next business day; a Friday fixing settles Monday).
    a typed settlement   FOLLOWING on New York.
    a typed expiry       not rolled (any calendar day: the cut is the fixing source's time); its default settlement
                         is the first New York business day strictly after it.
"""
from __future__ import annotations

import calendar as _cal
import re
from datetime import date, timedelta
from typing import Optional

from pricing.calendars import (add_business_days, apply_bdc, ccy_to_calendar, holidays_between, is_business_day, joint, why_closed)

TENORS = ("1W", "2W", "1M", "2M", "3M", "6M", "9M", "1Y", "18M", "2Y", "3Y", "4Y", "5Y", "7Y", "10Y")      # the ticket's TENOR select (fx-ticket.js); to ten years since 0.22.0
NEW_YORK = "NEW_YORK"
EXPIRY_SEARCH_DAYS = 10         # calendar days back from the delivery date an FX option's expiry is looked for
HOLIDAY_YEARS = 11              # the pairs answer lists holidays from today to today + this: past the ten-year tenor (0.22.0; three until then)
_TENOR = re.compile(r"^(\d+)([DWMY])$")


def parse_tenor(tenor: str) -> tuple[int, str]:
    m = _TENOR.match(str(tenor or "").upper().strip())
    if not m:
        raise ValueError(f"tenor {tenor!r}: a number and D, W, M or Y")
    return int(m.group(1)), m.group(2)


def add_months(d: date, n: int) -> date:
    """`d` plus `n` calendar months keeping the day; a day the month does not have is its last day."""
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, _cal.monthrange(y, m)[1]))


def add_tenor(d: date, tenor: str) -> date:
    """Unadjusted: weeks and days as calendar days, months and years by calendar month."""
    n, unit = parse_tenor(tenor)
    if unit == "D":
        return d + timedelta(days=n)
    if unit == "W":
        return d + timedelta(days=7 * n)
    return add_months(d, n if unit == "M" else 12 * n)


def is_last_business_day_of_month(d: date, calendar: str) -> bool:
    if not is_business_day(d, calendar):
        return False
    nxt = add_business_days(d, 1, calendar)
    return nxt.month != d.month


def end_of_month(d: date) -> date:
    return date(d.year, d.month, _cal.monthrange(d.year, d.month)[1])


def pair_calendar(pair: str) -> str:
    """The calendar a pair's cash moves on: both currencies' joint calendar, New York for a digital asset."""
    base, quote, crypto = _split(pair)
    return NEW_YORK if crypto else joint(ccy_to_calendar(base), ccy_to_calendar(quote))


def _split(pair: str) -> tuple[str, str, bool]:
    from api.routes.currencies import is_crypto, split_pair
    base, quote = split_pair(pair)
    return base, quote, is_crypto(base)


def spot(pair: str, today: date) -> date:
    from api.routes.currencies import spot_date
    base, quote, crypto = _split(pair)
    return spot_date(today, crypto, base, quote)


def spot_lag(pair: str) -> int:
    from api.routes.currencies import spot_lag as lag
    return lag(pair)


def forward_date(pair: str, today: date, tenor: str) -> date:
    base, quote, crypto = _split(pair)
    cal = pair_calendar(pair)
    if crypto:
        return apply_bdc(add_tenor(today, tenor), "FOLLOWING", cal)
    sd = spot(pair, today)
    raw = add_tenor(sd, tenor)
    unit = parse_tenor(tenor)[1]
    if unit in ("M", "Y") and is_last_business_day_of_month(sd, cal):
        raw = end_of_month(raw)
    return apply_bdc(raw, "MOD_FOLLOWING", cal)


def forward_dates(pair: str, today: date, tenors: tuple[str, ...] = TENORS) -> dict[str, date]:
    """{TENOR: settlement date} of the ticket's tenors."""
    return {t: forward_date(pair, today, t) for t in tenors}


def option_date(pair: str, today: date, tenor: str) -> dict[str, date]:
    base, quote, crypto = _split(pair)
    cal = pair_calendar(pair)
    if crypto:
        settlement = forward_date(pair, today, tenor)
        return {"expiry": add_business_days(settlement, -1, cal), "settlement": settlement, "expiry_rule": "business day before settlement"}
    delivery = forward_date(pair, today, tenor)
    return {**fx_expiry(pair, delivery), "settlement": delivery}


def fx_expiry(pair: str, delivery: date) -> dict:
    """{expiry, expiry_rule}: the latest joint business day whose spot date is `delivery` ("spot"); when none has it
    within EXPIRY_SEARCH_DAYS, the delivery less the pair's spot lag in joint business days ("fallback")."""
    cal = pair_calendar(pair)
    for k in range(1, EXPIRY_SEARCH_DAYS + 1):
        d = delivery - timedelta(days=k)
        if is_business_day(d, cal) and spot(pair, d) == delivery:
            return {"expiry": d, "expiry_rule": "spot"}
    return {"expiry": add_business_days(delivery, -spot_lag(pair), cal), "expiry_rule": "fallback"}


def option_dates(pair: str, today: date, tenors: tuple[str, ...] = TENORS) -> dict[str, dict]:
    """{TENOR: {expiry, settlement, expiry_rule}} of the ticket's tenors."""
    return {t: option_date(pair, today, t) for t in tenors}


def roll(pair: str, d: date, kind: str) -> dict:
    """The date a typed date rolls to: {date, rolled_from, why}. `kind` is 'settlement' or 'expiry'. `rolled_from`
    and `why` are None when the date stands."""
    kind = str(kind or "settlement").lower()
    if kind not in ("settlement", "expiry"):
        raise ValueError("kind must be settlement or expiry")
    base, quote, crypto = _split(pair)
    cal = pair_calendar(pair)
    if crypto and kind == "expiry":
        rolled = d
    elif crypto:
        rolled = apply_bdc(d, "FOLLOWING", cal)
    else:
        rolled = apply_bdc(d, "MOD_FOLLOWING", cal)
    if rolled == d:
        return {"date": d, "rolled_from": None, "why": None}
    return {"date": rolled, "rolled_from": d, "why": why_closed(d, cal)}


def calendar_block(pair: str, today: date) -> dict:
    """What the pairs answer carries so the frontend can roll a typed date itself by the rules above."""
    cal = pair_calendar(pair)
    return {"name": cal, "holidays": [h.isoformat() for h in holidays_between(cal, today, add_months(today, 12 * HOLIDAY_YEARS))],
            "weekend": ["SAT", "SUN"]}


def settlement_note(pair: str, settle: date, kind: str = "settlement") -> tuple[bool, Optional[str]]:
    """(is a business day of the pair's cash calendar, a plain-words note or None) for a settlement or an FX expiry."""
    cal = pair_calendar(pair)
    ok = is_business_day(settle, cal)
    if ok:
        return True, None
    r = roll(pair, settle, kind)
    what = "settlement" if kind == "settlement" else "expiry"
    moved = f"; the market would {'settle' if kind == 'settlement' else 'expire'} on {r['date']:%a %-d %b %Y}" if r["rolled_from"] else ""
    return False, f"{what} {settle:%a %-d %b %Y} is a {r['why'] or why_closed(settle, cal) or 'non-business day'}{moved}"
