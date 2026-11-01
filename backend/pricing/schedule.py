"""
Rijeka — ISDA Schedule Generator
Generates coupon periods for fixed and floating legs.

BDC supported: FOLLOWING, MOD_FOLLOWING, PRECEDING, MOD_PRECEDING, UNADJUSTED
Frequency: MONTHLY, QUARTERLY, SEMI_ANNUAL, ANNUAL, ZERO_COUPON
Roll: backward from maturity (standard ISDA convention)
"""

from datetime import date, timedelta
from dataclasses import dataclass
from decimal import Decimal
from typing import List, Optional

import re
from dateutil.relativedelta import relativedelta
from pricing.day_count import dcf as calc_dcf
from pricing.calendars import apply_bdc as _cal_apply_bdc, add_business_days as _cal_add_bd


@dataclass
class CouponPeriod:
    period_start:  date
    period_end:    date
    payment_date:  date
    fixing_date:   Optional[date]    # float legs only (2bd before period_start)
    dcf:           Decimal
    notional:      Decimal


# ── Business day helpers ─────────────────────────────────────

def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5   # Saturday=5, Sunday=6


def _next_bd(d: date) -> date:
    while _is_weekend(d):
        d += timedelta(days=1)
    return d


def _prev_bd(d: date) -> date:
    while _is_weekend(d):
        d -= timedelta(days=1)
    return d


def apply_bdc(d: date, bdc: str, calendar: str = "NEW_YORK") -> date:
    """Apply business day convention with holiday-aware calendar."""
    return _cal_apply_bdc(d, bdc, calendar)

def _apply_bdc_legacy(d: date, bdc: str) -> date:
    """Legacy weekend-only fallback."""
    bdc = (bdc or "MOD_FOLLOWING").upper().replace(" ", "_")
    if bdc == "UNADJUSTED":
        return d
    if bdc == "FOLLOWING":
        return _next_bd(d)
    if bdc == "MOD_FOLLOWING":
        adj = _next_bd(d)
        return _prev_bd(d) if adj.month != d.month else adj
    if bdc == "PRECEDING":
        return _prev_bd(d)
    if bdc == "MOD_PRECEDING":
        adj = _prev_bd(d)
        return _next_bd(d) if adj.month != d.month else adj
    return _next_bd(d)  # default


# ── Frequency → relativedelta ─────────────────────────────────

_FREQ = {
    "MONTHLY":     relativedelta(months=1),
    "QUARTERLY":   relativedelta(months=3),
    "SEMI_ANNUAL": relativedelta(months=6),
    "SEMIANNUAL":  relativedelta(months=6),
    "ANNUAL":      relativedelta(years=1),
    "YEARLY":      relativedelta(years=1),
}


# ── Main schedule generator ───────────────────────────────────

def generate_schedule(
    effective_date:     date,
    maturity_date:      date,
    frequency:          str,
    day_count:          str,
    notional:           Decimal,
    bdc:                str           = "MOD_FOLLOWING",
    payment_lag:        int           = 0,
    stub_type:          str           = "SHORT_FRONT",
    first_period_start: Optional[date] = None,
    last_period_end:    Optional[date] = None,
    is_float:           bool          = False,
    calendar:           Optional[str] = None,
) -> List[CouponPeriod]:
    """
    Generate a list of CouponPeriod objects for a leg.

    Convention:
      - Roll backward from maturity_date.
      - period_end dates are unadjusted; payment_date applies BDC + lag.
      - fixing_date for float legs = 2 business days before period_start.
    """
    freq_upper = (frequency or "QUARTERLY").upper().replace("-", "_").replace(" ", "_")
    # Business days for the payment adjustment, the payment lag and the fixing date. Until 2026-11 the
    # adjustment always used New York and the lag and fixing date counted weekdays only, so a lag across
    # Thanksgiving, or a EUR leg on a TARGET holiday, paid on a holiday. Callers pass the leg's calendar.
    cal = calendar or "NEW_YORK"

    # Zero coupon — single period
    if freq_upper in ("ZERO", "ZERO_COUPON", "ZEROCOUPON", "BULLET"):
        start = first_period_start or effective_date
        end   = last_period_end or maturity_date
        pay   = _add_lag(apply_bdc(end, bdc, cal), payment_lag, cal)
        fix   = _fixing_date(start, cal) if is_float else None
        return [CouponPeriod(
            period_start=start,
            period_end=end,
            payment_date=pay,
            fixing_date=fix,
            dcf=calc_dcf(day_count, start, end),
            notional=notional,
        )]

    delta = _FREQ.get(freq_upper)
    if delta is None:                       # tenor spellings from the ticket: 1M, 3M, 6M, 12M, 1Y
        m = re.fullmatch(r"(\d+)([MY])", freq_upper)
        if m:
            n, unit = int(m.group(1)), m.group(2)
            delta = relativedelta(months=n) if unit == "M" else relativedelta(years=n)
    if delta is None:
        raise ValueError(f"Unknown payment_frequency: {frequency!r}")

    # Unadjusted period dates, each counted from the roll anchor (anchor ± k periods). Stepping
    # from the previous date instead carries a short month into every later period: 31 Aug rolled
    # back quarterly gave 31 May, 28 Feb, 28 Nov, 28 Aug ... where ISDA and QuantLib give 30 Nov
    # and 31 Aug. No end-of-month rule is applied (QuantLib's endOfMonth = false).
    #   SHORT_FRONT  roll backward from maturity; an odd first period is short (default)
    #   LONG_FRONT   as SHORT_FRONT, the odd first period merged into the next one
    #   SHORT_BACK   roll forward from the effective date; an odd last period is short
    #   LONG_BACK    as SHORT_BACK, the odd last period merged into the previous one
    # first_period_start / last_period_end, when given, fix the stub explicitly as before.
    stub = (stub_type or "SHORT_FRONT").upper().replace("-", "_").replace(" ", "_")
    if stub not in ("SHORT_FRONT", "LONG_FRONT", "SHORT_BACK", "LONG_BACK"):
        raise ValueError(f"Unknown stub_type: {stub_type!r}")
    start0 = first_period_start or effective_date
    if stub in ("SHORT_FRONT", "LONG_FRONT") or last_period_end:
        anchor = last_period_end if (last_period_end and last_period_end < maturity_date) else maturity_date
        end_dates = [maturity_date] if anchor != maturity_date else []
        end_dates.append(anchor)
        k = 1
        while True:
            prev = anchor - delta * k
            if prev <= effective_date:
                break
            end_dates.append(prev)
            k += 1
        end_dates.sort()
        odd_first = len(end_dates) >= 2 and end_dates[0] - delta != start0
        if stub == "LONG_FRONT" and odd_first and not first_period_start:
            end_dates = end_dates[1:]
    else:
        end_dates = []
        k = 1
        while True:
            nxt = effective_date + delta * k
            if nxt >= maturity_date:
                break
            end_dates.append(nxt)
            k += 1
        odd_last = bool(end_dates) and end_dates[-1] + delta != maturity_date
        if stub == "LONG_BACK" and odd_last:
            end_dates = end_dates[:-1]
        end_dates.append(maturity_date)

    # Pair into periods
    starts = [first_period_start or effective_date] + end_dates[:-1]
    ends   = end_dates

    periods = []
    for s, e in zip(starts, ends):
        if s >= e:
            continue
        pay = _add_lag(apply_bdc(e, bdc, cal), payment_lag, cal)
        fix = _fixing_date(s, cal) if is_float else None
        periods.append(CouponPeriod(
            period_start=s,
            period_end=e,
            payment_date=pay,
            fixing_date=fix,
            dcf=calc_dcf(day_count, s, e),
            notional=notional,
        ))

    return periods


def _add_lag(d: date, lag: int, calendar: str = "NEW_YORK") -> date:
    """`lag` business days of the calendar after (before, if negative) d."""
    if lag == 0:
        return d
    return _cal_add_bd(d, lag, calendar)


def _fixing_date(period_start: date, calendar: str = "NEW_YORK") -> date:
    """2 business days before period_start on the leg's calendar."""
    return _cal_add_bd(period_start, -2, calendar)
