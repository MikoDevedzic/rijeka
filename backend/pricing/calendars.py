"""
Rijeka — Business Day Calendars
Uses the holidays package for accurate holiday data per currency.
Falls back to weekend-only if holidays package unavailable.
"""

from datetime import date, timedelta
from typing import Optional, Set

try:
    import holidays as _holidays
    _HAS_HOLIDAYS = True
except ImportError:
    _HAS_HOLIDAYS = False

_CACHE: dict = {}
# the holidays-package class and subdivision of each financial centre (None: the national list)
SUBDIV = {'LONDON': ('UK', 'ENG'), 'TOKYO': ('Japan', None), 'ZURICH': ('Switzerland', 'ZH'), 'SYDNEY': ('Australia', 'NSW')}

def _load(calendar: str, year: int) -> Set[date]:
    key = (calendar.upper(), year)
    if key in _CACHE:
        return _CACHE[key]
    hols: Set[date] = set()
    if not _HAS_HOLIDAYS:
        _CACHE[key] = hols
        return hols
    try:
        cal = calendar.upper().replace(' ','_')
        if cal == 'NEW_YORK':
            hols = set(_holidays.US(years=year).keys())
        elif cal == 'TARGET':
            hols = set(target_holidays(year))
        elif cal == 'TORONTO':
            hols = set(toronto_holidays(year))
        elif cal in SUBDIV:
            # the package without a subdivision gives national days only (London lacked Easter Monday and the August bank
            # holiday; Zurich Good Friday, Whit Monday, 26 Dec): the financial centre's region (Emmy vs QuantLib, 9 Nov 2026)
            cls, sub = SUBDIV[cal]
            named = getattr(_holidays, cls)(years=year, subdiv=sub, language='en_US')
            hols = {d for d, n in named.items() if not (cal == 'SYDNEY' and 'ANZAC Day (observed)' in str(n))}   # NSW does not substitute ANZAC Day
            if cal == 'TOKYO':
                hols |= {date(year, 1, 2), date(year, 1, 3), date(year, 12, 31)}       # the bank closures around New Year
            if cal == 'ZURICH':
                hols.add(date(year, 1, 2))                                              # Berchtoldstag
            if cal == 'SYDNEY':
                hols.add(_nth_weekday(year, 8, 0, 1))                                   # the NSW Bank Holiday, first Monday of August
        elif '+' in cal:
            for part in cal.split('+'):
                hols |= _load(part.strip(), year)
    except Exception:
        pass
    _CACHE[key] = hols
    return hols

def easter_sunday(year: int) -> date:
    """Western Easter by the anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7       # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def target_holidays(year: int) -> dict:
    """TARGET2's closing days from its published rule (ECB): New Year's Day, Good Friday, Easter Monday, Labour Day,
    Christmas Day and 26 December. {date: name}; no holiday source and no name matching."""
    easter = easter_sunday(year)
    return {date(year, 1, 1): "New Year's Day", easter - timedelta(days=2): "Good Friday", easter + timedelta(days=1): "Easter Monday",
            date(year, 5, 1): "Labour Day", date(year, 12, 25): "Christmas Day", date(year, 12, 26): "Christmas Holiday"}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The n-th `weekday` (Monday 0) of the month."""
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _observed(d: date) -> date:
    """A fixed-date holiday on a weekend is taken on the Monday after."""
    return d + timedelta(days=7 - d.weekday()) if d.weekday() >= 5 else d


def toronto_holidays(year: int) -> dict:
    """The Canadian bank holidays, from their published rule (the list QuantLib's Canada calendar follows): the
    holidays package knows the Ontario statutory days only (no Civic Holiday, Remembrance Day, Truth and
    Reconciliation Day, and no Monday for a Canada Day on a weekend; Emmy vs QuantLib, 9 Nov 2026)."""
    easter = easter_sunday(year)
    out = {_observed(date(year, 1, 1)): "New Year's Day", _nth_weekday(year, 2, 0, 3): "Family Day", easter - timedelta(days=2): "Good Friday",
           date(year, 5, 24) - timedelta(days=date(year, 5, 24).weekday()): "Victoria Day",          # the Monday on or before 24 May
           _observed(date(year, 7, 1)): "Canada Day", _nth_weekday(year, 8, 0, 1): "Civic Holiday", _nth_weekday(year, 9, 0, 1): "Labour Day",
           _nth_weekday(year, 10, 0, 2): "Thanksgiving Day", _observed(date(year, 11, 11)): "Remembrance Day"}
    if year >= 2021:
        out[_observed(date(year, 9, 30))] = "National Day for Truth and Reconciliation"
    xmas, boxing = date(year, 12, 25), date(year, 12, 26)
    out[_observed(xmas)] = "Christmas Day"
    bx = _observed(boxing)
    out[bx + timedelta(days=1) if bx in out else bx] = "Boxing Day"
    return out


def is_business_day(d: date, calendar: str = 'NEW_YORK') -> bool:
    if d.weekday() >= 5:
        return False
    return d not in _load(calendar, d.year)

def next_business_day(d: date, calendar: str = 'NEW_YORK') -> date:
    while not is_business_day(d, calendar):
        d += timedelta(days=1)
    return d

def prev_business_day(d: date, calendar: str = 'NEW_YORK') -> date:
    while not is_business_day(d, calendar):
        d -= timedelta(days=1)
    return d

def add_business_days(d: date, n: int, calendar: str = 'NEW_YORK') -> date:
    step = 1 if n >= 0 else -1
    remaining = abs(n)
    while remaining > 0:
        d += timedelta(days=step)
        if is_business_day(d, calendar):
            remaining -= 1
    return d

def apply_bdc(d: date, bdc: str, calendar: str = 'NEW_YORK') -> date:
    bdc = (bdc or 'MOD_FOLLOWING').upper().replace(' ','_')
    if bdc == 'UNADJUSTED':
        return d
    if bdc == 'FOLLOWING':
        return next_business_day(d, calendar)
    if bdc == 'MOD_FOLLOWING':
        adj = next_business_day(d, calendar)
        return prev_business_day(d, calendar) if adj.month != d.month else adj
    if bdc == 'PRECEDING':
        return prev_business_day(d, calendar)
    if bdc == 'MOD_PRECEDING':
        adj = prev_business_day(d, calendar)
        return next_business_day(d, calendar) if adj.month != d.month else adj
    return next_business_day(d, calendar)

CCY_CALENDAR = {
    'USD': 'NEW_YORK', 'EUR': 'TARGET', 'GBP': 'LONDON',
    'JPY': 'TOKYO',   'CHF': 'ZURICH', 'AUD': 'SYDNEY', 'CAD': 'TORONTO',
}

def ccy_to_calendar(ccy: str) -> str:
    return CCY_CALENDAR.get((ccy or 'USD').upper(), 'NEW_YORK')


KNOWN = {"NEW_YORK", "LONDON", "TARGET", "TOKYO", "ZURICH", "SYDNEY", "TORONTO"}


def leg_calendar(leg: dict) -> str:
    """The calendar a leg's dates roll on: its payment_calendar when it names known calendars
    (NEW_YORK, TARGET+LONDON, ...), otherwise its currency's."""
    c = str(leg.get("payment_calendar") or "").upper().replace(" ", "_")
    if c and all(part in KNOWN for part in c.split("+")):
        return c
    return ccy_to_calendar(leg.get("currency") or "USD")


# ── joint calendars and the names of their days (pricing/tenor_dates.py) ──────────────────────────

LABEL = {"NEW_YORK": "New York", "LONDON": "London", "TARGET": "TARGET", "TOKYO": "Tokyo",
         "ZURICH": "Zurich", "SYDNEY": "Sydney", "TORONTO": "Toronto"}
_NAMED_CACHE: dict = {}


def joint(*calendars: str) -> str:
    """One calendar name for the days that are business days in every calendar given: a holiday or weekend
    of either closes it. 'TARGET+NEW_YORK' for ('NEW_YORK', 'TARGET'): sorted, without repeats, so the same
    pair of currencies always names the same calendar (and `_load` reads it part by part)."""
    parts: list[str] = []
    for c in calendars:
        for p in str(c or "").upper().replace(" ", "_").split("+"):
            if p and p not in parts:
                parts.append(p)
    return "+".join(sorted(parts)) or "NEW_YORK"


def parts(calendar: str) -> list[str]:
    return [p for p in str(calendar or "").upper().replace(" ", "_").split("+") if p]


def label(calendar: str) -> str:
    """'TARGET and New York' for 'TARGET+NEW_YORK'."""
    return " and ".join(LABEL.get(p, p.replace("_", " ").title()) for p in parts(calendar))


def _named(calendar: str, year: int) -> dict:
    """{date: name} of one (not joint) calendar's holidays, in English, for the days `_load` holds."""
    key = (calendar.upper(), year)
    if key in _NAMED_CACHE:
        return _NAMED_CACHE[key]
    out: dict = {}
    cal = calendar.upper().replace(" ", "_")
    try:
        if cal == "TARGET":
            out = dict(target_holidays(year))
        elif cal == "TORONTO":
            out = dict(toronto_holidays(year))
        elif _HAS_HOLIDAYS:
            cls, sub = SUBDIV.get(cal, ("US" if cal == "NEW_YORK" else None, None))
            if cls:
                out = {d: str(n) for d, n in getattr(_holidays, cls)(years=year, subdiv=sub, language="en_US").items()}
            if cal == "TOKYO":
                out.update({date(year, 1, 2): "New Year Holiday", date(year, 1, 3): "New Year Holiday", date(year, 12, 31): "New Year's Eve"})
            if cal == "ZURICH":
                out.setdefault(date(year, 1, 2), "Berchtoldstag")
    except Exception:
        out = {}
    held = _load(cal, year)
    out = {d: n for d, n in out.items() if d in held}
    _NAMED_CACHE[key] = out
    return out


def holiday_name(d: date, calendar: str) -> Optional[str]:
    """The name of the holiday `d` is in `calendar` (joint calendars included), None when it is a weekday the
    calendar does not hold or a weekend. A joint calendar names the first part that holds it."""
    for p in parts(calendar):
        if d in _load(p, d.year):
            return _named(p, d.year).get(d) or "holiday"
    return None


def why_closed(d: date, calendar: str) -> Optional[str]:
    """Plain words for a day that is not a business day: 'Saturday', 'Sunday', 'New York holiday (Thanksgiving Day)',
    'TARGET and New York holiday (Christmas Day)'; 'not a business day' when nothing names it; None on a business day."""
    if d.weekday() >= 5:
        return d.strftime("%A")
    closed = [p for p in parts(calendar) if d in _load(p, d.year)]
    if not closed:
        return None if is_business_day(d, calendar) else "not a business day"
    names = [n for n in (_named(p, d.year).get(d) for p in closed) if n]
    where = " and ".join(LABEL.get(p, p.replace("_", " ").title()) for p in closed)
    return f"{where} holiday ({names[0]})" if names else f"{where} holiday"


def holidays_between(calendar: str, start: date, end: date) -> list[date]:
    """The weekday holidays of `calendar` (joint included) from `start` to `end`, both inclusive, ascending."""
    out: set = set()
    for y in range(start.year, end.year + 1):
        for p in parts(calendar):
            out |= {d for d in _load(p, y) if start <= d <= end and d.weekday() < 5}
    return sorted(out)
