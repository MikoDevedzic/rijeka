"""Forward points where none is quoted (pricing/forward_points.py): inside the quoted tenors nothing changes; beyond
the last one the forward is parity plus the last quoted basis held flat as a rate, and the answer says it is implied."""
import math

import pytest

from pricing.forward_points import FWD_TENORS, IMPLIED, INTERPOLATED, QUOTED, TENOR_DAYS, basis_rate, interp_points, last_quoted, points_at

S, PIP = 1.0850, 1e-4
R_USD, R_EUR = 0.040, 0.025


def parity(days: int, r_q: float = R_USD, r_b: float = R_EUR, spot: float = S) -> float:
    """Spot carried at the difference of two flat continuous rates: the two curves' forward, in closed form."""
    return spot * math.exp((r_q - r_b) * days / 365.0)


def test_the_tenor_grid_reaches_ten_years_in_order():
    assert FWD_TENORS[-1] == "10Y" and TENOR_DAYS["10Y"] == 3650
    days = [TENOR_DAYS[t] for t in FWD_TENORS]
    assert days == sorted(days) and len(set(days)) == len(days)
    for t in ("18M", "3Y", "4Y", "5Y", "7Y"):
        assert t in FWD_TENORS


def test_inside_the_quoted_tenors_nothing_has_changed():
    pts = {"1M": 12.5, "3M": 41.3, "1Y": 123.1, "2Y": 186.5}
    never = lambda d: (_ for _ in ()).throw(AssertionError("parity is not asked for inside the quotes"))
    for days in (0, 7, 30, 45, 91, 200, 365, 600, 730):
        r = points_at(pts, days, spot=S, pip=PIP, parity_forward=never)
        assert r.points == pytest.approx(interp_points(pts, days))
    assert points_at(pts, 91, spot=S, pip=PIP, parity_forward=never).kind == QUOTED
    r = points_at(pts, 200, spot=S, pip=PIP, parity_forward=never)
    assert r.kind == INTERPOLATED and r.method == "linear in time between 3M and 1Y"
    assert points_at(pts, 10, spot=S, pip=PIP, parity_forward=never).method == "linear in time between spot and 1M"


def test_beyond_the_last_quote_the_basis_is_held_as_a_rate():
    # the market quotes the two-year forward 20 bp a year rich to parity
    b = 0.0020
    f2 = parity(730) * math.exp(b * 2.0)
    pts = {"1Y": (parity(365) * math.exp(b) - S) / PIP, "2Y": (f2 - S) / PIP}
    r = points_at(pts, 3650, spot=S, pip=PIP, parity_forward=parity)
    assert r.kind == IMPLIED and r.last_tenor == "2Y"
    assert r.basis_rate == pytest.approx(b, abs=1e-12)
    assert S + r.points * PIP == pytest.approx(parity(3650) * math.exp(b * 10.0), rel=1e-12)
    assert r.method == "parity plus the 2Y basis held flat as a rate (+20.0 bp a year)"
    # and it is not the old rule: the last points held flat would say the ten-year forward is the two-year one
    assert S + interp_points(pts, 3650) * PIP == pytest.approx(f2)
    assert abs((S + r.points * PIP) - f2) > 0.1


def test_the_curve_is_continuous_at_the_last_quote():
    pts = {"6M": 74.5, "2Y": 186.5}
    at = points_at(pts, 730, spot=S, pip=PIP, parity_forward=parity)
    just_after = points_at(pts, 731, spot=S, pip=PIP, parity_forward=parity)
    assert at.kind == QUOTED and just_after.kind == IMPLIED
    assert just_after.points == pytest.approx(at.points, abs=0.6)      # one day's carry, not a jump


def test_with_no_basis_the_extension_is_parity_itself():
    pts = {t: (parity(TENOR_DAYS[t]) - S) / PIP for t in ("3M", "1Y", "2Y")}
    for days in (1095, 1825, 3650):
        r = points_at(pts, days, spot=S, pip=PIP, parity_forward=parity)
        assert r.basis_rate == pytest.approx(0.0, abs=1e-12)
        assert S + r.points * PIP == pytest.approx(parity(days), rel=1e-12)


def test_a_digital_asset_holds_its_implied_rate():
    """Parity carries spot at the dollar rate less the asset's saved rate q0. A futures basis b at the last listed
    expiry is the asset's implied rate q0 - b; holding b flat holds that rate flat."""
    spot, q0, b = 108_250.0, 0.03, -0.012
    par = lambda d: spot * math.exp((R_USD - q0) * d / 365.0)
    pts = {"3M": par(91) * math.exp(b * 91 / 365) - spot, "1Y": par(365) * math.exp(b) - spot}
    r = points_at(pts, 1825, spot=spot, pip=1.0, parity_forward=par)
    assert spot + r.points == pytest.approx(spot * math.exp((R_USD - (q0 - b)) * 5.0), rel=1e-12)
    assert r.kind == IMPLIED and r.last_tenor == "1Y"


def test_no_points_at_all_is_parity_and_says_so():
    r = points_at(None, 1825, spot=S, pip=PIP, parity_forward=parity)
    assert r.kind == IMPLIED and r.basis_rate is None and r.last_tenor is None
    assert S + r.points * PIP == pytest.approx(parity(1825))
    assert r.method == "parity on the two curves (no points quoted)"
    assert points_at({}, 30, spot=S, pip=PIP, parity_forward=parity).kind == IMPLIED


def test_a_tenor_switched_off_is_not_a_quote():
    on = {"3M": 41.3, "1Y": 123.1, "2Y": 186.5}
    off = {k: v for k, v in on.items() if k != "2Y"}           # the desk switches the two-year off
    r = points_at(off, 730, spot=S, pip=PIP, parity_forward=parity)
    assert r.kind == IMPLIED and r.last_tenor == "1Y"
    assert points_at(on, 730, spot=S, pip=PIP, parity_forward=parity).kind == QUOTED
    mid = {k: v for k, v in on.items() if k != "1Y"}           # a tenor in the middle off: its date is interpolated
    assert points_at(mid, 365, spot=S, pip=PIP, parity_forward=parity).kind == INTERPOLATED


def test_a_last_quote_that_cannot_be_read_as_a_rate_carries_its_basis_in_points():
    pts = {"1Y": -11_000.0, "2Y": -12_000.0}                   # a forward below zero: no logarithm
    r = points_at(pts, 1095, spot=S, pip=PIP, parity_forward=parity)
    assert r.kind == IMPLIED and r.basis_rate is None and "in points" in r.method
    assert r.points == pytest.approx((parity(1095) - S) / PIP + (-12_000.0 - (parity(730) - S) / PIP))
    assert basis_rate(S, PIP, -12_000.0, parity(730), 730) is None
    assert basis_rate(S, PIP, 100.0, 0.0, 730) is None and basis_rate(S, PIP, 100.0, 1.1, 0) is None


def test_last_quoted():
    assert last_quoted({"3M": 1.0, "2Y": 2.0, "1Y": 3.0}) == ("2Y", 730)
    assert last_quoted({}) is None


def test_a_tenor_the_feed_filled_beyond_its_last_listed_expiry_prices_as_before_and_is_called_implied():
    """A venue lists futures to about a year; the feed fills 18M and 2Y by holding the last listed basis flat as a
    rate. Those tenors stay pillars (no figure moves), and a date beyond the last listed tenor is IMPLIED."""
    pts = {"6M": 1500.0, "1Y": 3100.0, "18M": 4800.0, "2Y": 6500.0}
    tagged = frozenset({"18M", "2Y"})
    never = lambda d: (_ for _ in ()).throw(AssertionError("inside the feed's grid parity is not asked for"))
    for days in (365, 400, 547, 600, 730):
        r = points_at(pts, days, spot=100_000.0, pip=1.0, parity_forward=never, extrapolated=tagged)
        assert r.points == pytest.approx(interp_points(pts, days))            # the number is what it always was
        assert r.kind == (QUOTED if days == 365 else IMPLIED)
    r = points_at(pts, 600, spot=100_000.0, pip=1.0, parity_forward=never, extrapolated=tagged)
    assert r.last_tenor == "1Y" and "nothing is listed beyond 1Y" in r.method
    assert points_at(pts, 200, spot=100_000.0, pip=1.0, parity_forward=never, extrapolated=tagged).kind == INTERPOLATED
    # beyond the feed's grid: parity plus the basis the last tenor shows, as everywhere
    par = lambda d: 100_000.0 * math.exp(0.02 * d / 365.0)
    far = points_at(pts, 1825, spot=100_000.0, pip=1.0, parity_forward=par, extrapolated=tagged)
    assert far.kind == IMPLIED and far.last_tenor == "2Y" and far.basis_rate == pytest.approx(math.log(106_500.0 / par(730)) / 2.0)
