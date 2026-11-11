"""A pair's forward points by tenor, and what a forward is worth where no point is quoted.

A forward curve is a handful of quoted tenors: forward points over spot, in pips (an FX pair) or in the quote
currency per unit (a digital asset). Three questions are answered here, with no database and no curve of its own:

1. Inside the quoted tenors: the points at a date between two of them are linear in time, 0 at spot. This is as it
   always was (`interp_points`).

2. Beyond the last quoted tenor. Until 0.22.0 the last points were held flat, which says a ten-year forward is
   the two-year forward: the carry between the two dates is thrown away. A forward is spot carried at the
   difference of two rates, and what the market quotes on top of that (the cross-currency basis on a currency
   pair, the futures basis on a digital asset) is a rate too. So the rule is: parity from the two curves, plus the
   basis the last quoted tenor shows, held flat *as a rate*:

       b      = ln(F_quoted(T_L) / F_parity(T_L)) / t_L          t in years from the spot date, ACT/365
       F(T)   = F_parity(T) · exp(b · t)                         for T beyond T_L

   On a digital asset parity is spot carried at the dollar curve less the asset's saved rate, so holding b flat is
   holding the asset's implied rate flat from the last listed expiry on. Nothing is quoted out there: the figure
   is a model's, and every answer built on it says so (`kind` IMPLIED, with the method in words).

3. What kind of point a date got: QUOTED (the date is a quoted tenor), INTERPOLATED (between two), IMPLIED (beyond
   the last, by the rule above; or parity alone when the pair has no quoted points at all). A tenor the desk has
   switched off is not a quote: its date is interpolated or implied like any other.

The public standards behind it: covered interest parity, and the cross-currency basis as a spread to it (Borio,
McCauley, McGuire and Sushko, "Covered interest parity lost: understanding the cross-currency basis", BIS Quarterly
Review, September 2016); a futures basis read as an annualised rate is the same quantity on a digital asset.
Nothing here is fitted: one number, read off the last quote.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Optional

# Days from the spot date to each tenor the forwards page and the feeds use. A year is 365 days and a month the
# count the page has always shown; the ticket's own dates come from the calendar (pricing/tenor_dates.py).
TENOR_DAYS = {"ON": 1, "1W": 7, "2W": 14, "1M": 30, "2M": 61, "3M": 91, "6M": 182, "9M": 273, "1Y": 365, "18M": 547,
              "2Y": 730, "3Y": 1095, "4Y": 1460, "5Y": 1825, "7Y": 2555, "10Y": 3650}
FWD_TENORS = ("1W", "2W", "1M", "2M", "3M", "6M", "9M", "1Y", "18M", "2Y", "3Y", "4Y", "5Y", "7Y", "10Y")

QUOTED, INTERPOLATED, IMPLIED = "QUOTED", "INTERPOLATED", "IMPLIED"
# A tenor's pillar is a round count of days (2Y is 730) and a ticket's 2Y date is two calendar years from the spot
# date, rolled to a business day: 731 to 734 days. A date this close to a quoted tenor IS that tenor: it is named
# QUOTED (the figure is still read off the curve at its own day count, a few days of carry from the quote).
TENOR_SLACK_DAYS = 7


def interp_points(points: dict[str, float], days: int) -> float:
    """Forward points at `days`, linear in time between quoted tenors; 0 at spot, flat beyond the last.

    The flat tail is kept for the callers that shock or compare points (a scenario's bump, a venue's sanity
    check). A price beyond the last tenor goes through `points_at`, which does not hold points flat."""
    xs = sorted((TENOR_DAYS[t], v) for t, v in points.items())
    xs = [(0, 0.0)] + xs
    if days <= 0:
        return 0.0
    for (d0, p0), (d1, p1) in zip(xs, xs[1:]):
        if d0 <= days <= d1:
            return p0 + (p1 - p0) * (days - d0) / (d1 - d0) if d1 > d0 else p1
    return xs[-1][1]


@dataclass(frozen=True)
class PointsAt:
    points: float                 # forward points at the date, in the pair's own unit
    kind: str                     # QUOTED | INTERPOLATED | IMPLIED
    method: str                   # how, in words a ticket can print
    last_tenor: Optional[str]     # the last quoted tenor the answer leans on (IMPLIED beyond it), else None
    basis_rate: Optional[float]   # b above, a year, continuously compounded; None unless IMPLIED beyond a quote
    beyond: bool = False          # the date lies beyond every tenor of the curve: the figure is carried, not read off points


def last_quoted(points: dict[str, float]) -> Optional[tuple[str, int]]:
    """(tenor, days) of the longest quoted tenor, or None."""
    if not points:
        return None
    t = max(points, key=lambda k: TENOR_DAYS[k])
    return t, TENOR_DAYS[t]


def basis_rate(spot: float, pip: float, points_last: float, parity_forward_last: float, days_last: int) -> Optional[float]:
    """b: what the last quoted forward shows over parity, as a rate a year. None when it cannot be read (a forward
    or a parity forward that is not positive, a tenor of no length)."""
    f_quoted = spot + points_last * pip
    if days_last <= 0 or f_quoted <= 0 or parity_forward_last <= 0:
        return None
    return math.log(f_quoted / parity_forward_last) / (days_last / 365.0)


def points_at(points: Optional[dict[str, float]], days: int, *, spot: float, pip: float,
              parity_forward: Callable[[int], float], extrapolated: frozenset = frozenset()) -> PointsAt:
    """The forward points a price uses at `days` from the spot date.

    `points` are the pair's tenors (switched-off tenors left out); `parity_forward(d)` is the forward the two
    curves imply `d` days from spot. It is called at most twice (the date, and the last tenor), and only beyond the
    last tenor or when there are no points.

    `extrapolated` names tenors a feed filled beyond its venue's last listed expiry by holding that expiry's basis
    flat as a rate (market_data/deribit.py): the same rule as here, applied by the feed. They price as they always
    did, and a date beyond the last tenor that IS a quote is reported IMPLIED, because nothing is listed there."""
    if not points:
        f = parity_forward(days)
        return PointsAt((f - spot) / pip, IMPLIED, "parity on the two curves (no points quoted)", None, None)
    tenor_l, days_l = last_quoted(points)
    true = {t: v for t, v in points.items() if t not in extrapolated}
    # the quoted tenor this date is, if it is one: the nearest true quote within the slack
    near = min((t for t in true if abs(TENOR_DAYS[t] - days) <= TENOR_SLACK_DAYS), key=lambda t: abs(TENOR_DAYS[t] - days), default=None)
    if days <= days_l:
        days_t = last_quoted(true)[1] if true else 0
        if days > days_t and not near:
            tenor_t = last_quoted(true)[0] if true else None
            where = f"nothing is listed beyond {tenor_t}" if tenor_t else "no tenor of this curve is a listed expiry"
            return PointsAt(interp_points(points, days), IMPLIED, f"the feed's last listed basis held flat as a rate ({where})", tenor_t, None)
        if near:
            off = days - TENOR_DAYS[near]
            how = f"quoted at {near}" + ("" if off == 0 else f" (the date is {abs(off)} day{'s' if abs(off) != 1 else ''} {'past' if off > 0 else 'short of'} the tenor's {TENOR_DAYS[near]} days)")
            return PointsAt(interp_points(points, days), QUOTED, how, None, None)
        before = [t for t in points if TENOR_DAYS[t] < days]
        after = [t for t in points if TENOR_DAYS[t] > days]
        lo = max(before, key=lambda k: TENOR_DAYS[k]) if before else "spot"
        hi = min(after, key=lambda k: TENOR_DAYS[k])
        return PointsAt(interp_points(points, days), INTERPOLATED, f"linear in time between {lo} and {hi}", None, None)
    f_par_l, f_par = parity_forward(days_l), parity_forward(days)
    b = basis_rate(spot, pip, points[tenor_l], f_par_l, days_l)
    if b is None:
        # the last quote cannot be read as a rate over parity: carry its basis in points, and say so
        pts = (f_par - spot) / pip + (points[tenor_l] - (f_par_l - spot) / pip)
        return PointsAt(pts, IMPLIED, f"parity plus the {tenor_l} basis in points (its rate could not be read)", tenor_l, None, True)
    f = f_par * math.exp(b * days / 365.0)
    if near == tenor_l:
        # a few days past the last quoted tenor's round day count: the tenor itself, carried those days
        off = days - days_l
        return PointsAt((f - spot) / pip, QUOTED, f"quoted at {near} (the date is {off} day{'s' if off != 1 else ''} past the tenor's {days_l} days)", None, None)
    return PointsAt((f - spot) / pip, IMPLIED,
                    f"parity plus the {tenor_l} basis held flat as a rate ({b * 1e4:+.1f} bp a year)", tenor_l, b, True)
