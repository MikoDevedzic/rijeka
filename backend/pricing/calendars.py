"""
Rijeka — Business Day Calendars
Uses the holidays package for accurate holiday data per currency.
Falls back to weekend-only if holidays package unavailable.
"""

from datetime import date, timedelta
from typing import Set

try:
    import holidays as _holidays
    _HAS_HOLIDAYS = True
except ImportError:
    _HAS_HOLIDAYS = False

_CACHE: dict = {}

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
        elif cal == 'LONDON':
            hols = set(_holidays.UK(years=year).keys())
        elif cal == 'TARGET':
            # ECB TARGET: New Year, Good Friday, Easter Monday, May 1, Dec 25-26
            de = _holidays.Germany(years=year)
            for d, n in de.items():
                if 'Good Friday' in n or 'Easter Monday' in n:
                    hols.add(d)
            hols |= {date(year,1,1), date(year,5,1), date(year,12,25), date(year,12,26)}
        elif cal == 'TOKYO':
            hols = set(_holidays.Japan(years=year).keys())
        elif cal == 'ZURICH':
            hols = set(_holidays.Switzerland(years=year).keys())
        elif cal == 'SYDNEY':
            hols = set(_holidays.Australia(years=year).keys())
        elif cal == 'TORONTO':
            hols = set(_holidays.Canada(years=year).keys())
        elif '+' in cal:
            for part in cal.split('+'):
                hols |= _load(part.strip(), year)
    except Exception:
        pass
    _CACHE[key] = hols
    return hols

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
