"""
Rijeka — Day Count Conventions
Supported: ACT/360, ACT/365F, 30/360, ACT/ACT ISDA
"""

from datetime import date
from decimal import Decimal


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def act360(d1: date, d2: date) -> Decimal:
    return Decimal((d2 - d1).days) / Decimal(360)


def act365f(d1: date, d2: date) -> Decimal:
    return Decimal((d2 - d1).days) / Decimal(365)


def thirty360(d1: date, d2: date) -> Decimal:
    """30/360 Bond Basis (ISDA 2006 section 4.16(f))."""
    y1, m1, d1_ = d1.year, d1.month, d1.day
    y2, m2, d2_ = d2.year, d2.month, d2.day
    if d1_ == 31:
        d1_ = 30
    if d2_ == 31 and d1_ == 30:
        d2_ = 30
    return Decimal(360 * (y2 - y1) + 30 * (m2 - m1) + (d2_ - d1_)) / Decimal(360)


def actact_isda(d1: date, d2: date) -> Decimal:
    """ACT/ACT ISDA — splits at 1 Jan boundaries."""
    if d1 == d2:
        return Decimal(0)
    if d1.year == d2.year:
        days_in_year = 366 if _is_leap(d1.year) else 365
        return Decimal((d2 - d1).days) / Decimal(days_in_year)

    frac = Decimal(0)
    # d1 → 1 Jan of next year
    end_y1 = date(d1.year + 1, 1, 1)
    days_y1 = 366 if _is_leap(d1.year) else 365
    frac += Decimal((end_y1 - d1).days) / Decimal(days_y1)
    # full years between
    for y in range(d1.year + 1, d2.year):
        frac += Decimal(1)
    # 1 Jan of d2's year → d2
    start_y2 = date(d2.year, 1, 1)
    days_y2 = 366 if _is_leap(d2.year) else 365
    frac += Decimal((d2 - start_y2).days) / Decimal(days_y2)
    return frac


_REGISTRY = {
    "ACT/360":       act360,
    "ACT/365F":      act365f,
    "ACT/365":       act365f,
    "30/360":        thirty360,
    "30/360 BOND":   thirty360,
    "ACT/ACT":       actact_isda,
    "ACT/ACT ISDA":  actact_isda,
    "ACTACT":        actact_isda,
}


def dcf(convention: str, d1: date, d2: date) -> Decimal:
    """
    Day count fraction for [d1, d2) under the given convention.
    Defaults to ACT/360 if convention is unrecognised.
    """
    fn = _REGISTRY.get((convention or "ACT/360").upper().strip(), act360)
    return fn(d1, d2)
