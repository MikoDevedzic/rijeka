"""Shared market and QuantLib plumbing for the reference checks.

The reference suite compares Rijeka's numbers with QuantLib's on one frozen USD SOFR
snapshot (VAL, USD_SOFR below; the shape of the daily demo build, market_data/demo_feed.py
OIS_TENORS, with levels close to late October 2026). Two QuantLib curves are used:

  replica_handle(curve)   a QuantLib DiscountCurve on Rijeka's own bootstrapped discount
                          factors, log-linear in time on ACT/365F, which is Rijeka's
                          interpolation (log-linear on calendar-day fractions). Pricing on it
                          isolates Rijeka's cashflow arithmetic from its bootstrap.
  market_curve()          QuantLib's own bootstrap of the same quotes with market SOFR
                          conventions (OISRateHelper: T+2, annual, modified following, payment
                          lag 2, SOFR fixing calendar). Differences against it are conventions.

null_index(handle) is an overnight index on a calendar with no holidays: every day is a
fixing day, so a compounded coupon over [s, e] is exactly DF(s)/DF(e) − 1 on any dates,
which is how Rijeka projects SOFR. ql.Sofr(handle) is the market index.

Every check returns rows (see Row) so the same numbers drive the assertions and the table
in docs/methodology (tests/reference/report.py prints it)."""
from __future__ import annotations

import functools
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

import QuantLib as ql

from pricing.bootstrap import DEPOSIT, OIS_SWAP, PillarQuote, bootstrap_curve
from pricing.curve import Curve

VAL = date(2026, 10, 30)                 # a Friday; spot (T+2 New York) is Tuesday 3 November

# Percent. Tenors exactly as the demo build emits them.
USD_SOFR: list[tuple[str, float]] = [
    ("ON", 3.87), ("1W", 3.869), ("2W", 3.866), ("3W", 3.862), ("1M", 3.858), ("2M", 3.842), ("3M", 3.826),
    ("4M", 3.808), ("5M", 3.79), ("6M", 3.771), ("7M", 3.752), ("8M", 3.734), ("9M", 3.716), ("10M", 3.699),
    ("11M", 3.683), ("1Y", 3.668), ("18M", 3.585), ("2Y", 3.528), ("3Y", 3.47), ("4Y", 3.462), ("5Y", 3.481),
    ("6Y", 3.515), ("7Y", 3.556), ("8Y", 3.598), ("9Y", 3.638), ("10Y", 3.675), ("12Y", 3.742), ("15Y", 3.818),
    ("20Y", 3.881), ("25Y", 3.884), ("30Y", 3.862), ("40Y", 3.77), ("50Y", 3.672),
]

FED = ql.UnitedStates(ql.UnitedStates.FederalReserve)   # Rijeka's NEW_YORK calendar is the US federal list
SOFR_CAL = ql.UnitedStates(ql.UnitedStates.SOFR)        # the market fixing calendar (adds Good Friday)


# ── dates ────────────────────────────────────────────────────────────────────
def qd(d: date) -> ql.Date:
    return ql.Date(d.day, d.month, d.year)


def pd_(q: ql.Date) -> date:
    return date(q.year(), q.month(), q.dayOfMonth())


def set_eval(d: date = VAL) -> None:
    ql.Settings.instance().evaluationDate = qd(d)


# ── Rijeka side ──────────────────────────────────────────────────────────────
def rijeka_quotes(quotes=USD_SOFR, bump: Optional[dict[str, float]] = None) -> list[PillarQuote]:
    bump = bump or {}
    return [PillarQuote(t, DEPOSIT if t == "ON" else OIS_SWAP, (r + bump.get(t, 0.0)) / 100.0) for t, r in quotes]


@functools.cache
def rijeka_curve() -> Curve:
    return bootstrap_curve(VAL, rijeka_quotes())


# ── QuantLib side ────────────────────────────────────────────────────────────
def replica_handle(curve: Curve) -> ql.YieldTermStructureHandle:
    set_eval(curve.valuation_date)
    dates = [qd(d) for d, _ in curve._df_pillars]
    dfs = [float(v) for _, v in curve._df_pillars]
    c = ql.DiscountCurve(dates, dfs, ql.Actual365Fixed())
    c.enableExtrapolation()
    return ql.YieldTermStructureHandle(c)


def null_index(handle: ql.YieldTermStructureHandle) -> ql.OvernightIndex:
    return ql.OvernightIndex("SOFR-everyday", 0, ql.USDCurrency(), ql.NullCalendar(), ql.Actual360(), handle)


def _tenor(t: str) -> ql.Period:
    n, u = int(t[:-1]), t[-1]
    return ql.Period(n, {"D": ql.Days, "W": ql.Weeks, "M": ql.Months, "Y": ql.Years}[u])


def market_curve(quotes=USD_SOFR, payment_lag: int = 2) -> ql.YieldTermStructureHandle:
    """QuantLib's bootstrap of the same quotes, market SOFR conventions."""
    set_eval(VAL)
    sofr = ql.Sofr()
    helpers = []
    for t, r in quotes:
        q = ql.QuoteHandle(ql.SimpleQuote(r / 100.0))
        if t == "ON":
            helpers.append(ql.DepositRateHelper(q, ql.Period(1, ql.Days), 0, SOFR_CAL, ql.Following, False, ql.Actual360()))
        else:
            helpers.append(ql.OISRateHelper(2, _tenor(t), q, sofr, paymentLag=payment_lag, paymentConvention=ql.ModifiedFollowing,
                                            paymentFrequency=ql.Annual, paymentCalendar=SOFR_CAL))
    c = ql.PiecewiseLogLinearDiscount(qd(VAL), helpers, ql.Actual365Fixed())
    c.enableExtrapolation()
    return ql.YieldTermStructureHandle(c)


# ── rows ─────────────────────────────────────────────────────────────────────
@dataclass
class Row:
    """One comparison. diff = rijeka − quantlib in `unit`; ok when |diff| <= tol."""
    product: str
    case: str
    metric: str
    rijeka: float
    quantlib: float
    unit: str                 # 'bp of notional', 'bp', '% of premium', 'abs', ...
    tol: float
    cause: str = ""           # the convention or finding that explains a non-zero diff
    scale: float = 1.0        # diff in `unit` = (rijeka − quantlib) * scale
    kind: str = "replica"     # 'replica' (same conventions: must match) | 'convention' (reported, bounded)
    extra: dict = field(default_factory=dict)

    @property
    def diff(self) -> float:
        return (self.rijeka - self.quantlib) * self.scale

    @property
    def ok(self) -> bool:
        return abs(self.diff) <= self.tol

    def __str__(self) -> str:
        return f"{self.product} | {self.case} | {self.metric}: rijeka {self.rijeka:.8g} ql {self.quantlib:.8g} diff {self.diff:.4g} {self.unit} (tol {self.tol})"


def assert_rows(rows: list[Row]) -> None:
    bad = [str(r) for r in rows if not r.ok]
    assert not bad, "outside tolerance:\n" + "\n".join(bad)
