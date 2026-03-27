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

from dateutil.relativedelta import relativedelta
from pricing.day_count import dcf as calc_dcf


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


def apply_bdc(d: date, bdc: str) -> date:
    """Apply business day convention to a raw schedule date."""
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
) -> List[CouponPeriod]:
    """
    Generate a list of CouponPeriod objects for a leg.

    Convention:
      - Roll backward from maturity_date.
      - period_end dates are unadjusted; payment_date applies BDC + lag.
      - fixing_date for float legs = 2 business days before period_start.
    """
    freq_upper = (frequency or "QUARTERLY").upper().replace("-", "_").replace(" ", "_")

    # Zero coupon — single period
    if freq_upper in ("ZERO", "ZERO_COUPON", "ZEROCOUPON", "BULLET"):
        start = first_period_start or effective_date
        end   = last_period_end or maturity_date
        pay   = _add_lag(apply_bdc(end, bdc), payment_lag)
        fix   = _fixing_date(start) if is_float else None
        return [CouponPeriod(
            period_start=start,
            period_end=end,
            payment_date=pay,
            fixing_date=fix,
            dcf=calc_dcf(day_count, start, end),
            notional=notional,
        )]

    delta = _FREQ.get(freq_upper)
    if delta is None:
        raise ValueError(f"Unknown payment_frequency: {frequency!r}")

    # Build unadjusted end dates rolling backward from maturity
    end_dates = []
    cursor = maturity_date
    if last_period_end and last_period_end < maturity_date:
        end_dates.append(maturity_date)
        cursor = last_period_end
    end_dates.append(cursor)

    while True:
        prev = cursor - delta
        if prev <= effective_date:
            break
        cursor = prev
        end_dates.append(cursor)

    end_dates.sort()

    # Pair into periods
    starts = [first_period_start or effective_date] + end_dates[:-1]
    ends   = end_dates

    periods = []
    for s, e in zip(starts, ends):
        if s >= e:
            continue
        pay = _add_lag(apply_bdc(e, bdc), payment_lag)
        fix = _fixing_date(s) if is_float else None
        periods.append(CouponPeriod(
            period_start=s,
            period_end=e,
            payment_date=pay,
            fixing_date=fix,
            dcf=calc_dcf(day_count, s, e),
            notional=notional,
        ))

    return periods


def _add_lag(d: date, lag: int) -> date:
    if lag == 0:
        return d
    step = timedelta(days=1) if lag > 0 else timedelta(days=-1)
    count = 0
    while count < abs(lag):
        d += step
        if not _is_weekend(d):
            count += 1
    return d


def _fixing_date(period_start: date) -> date:
    """2 business days before period_start (London/NY convention)."""
    d = period_start
    count = 0
    while count < 2:
        d -= timedelta(days=1)
        if not _is_weekend(d):
            count += 1
    return d
