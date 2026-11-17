"""The synthetic rates market (0.55.0): one stated generator behind every rates curve of the hosted demo."""
import math
import statistics
from datetime import date, timedelta

import pytest

from market_data import synthetic_rates as R

D = date(2026, 11, 17)
GRID = [1 / 365, 0.25, 1.0, 2.0, 5.0, 10.0, 30.0]


def test_a_curve_is_a_pure_function_of_the_curve_and_the_date():
    for c in R.PARAMS:
        a, b = R.curve_rates(c, D, GRID), R.curve_rates(c, D, GRID)
        assert a == b and all(math.isfinite(x) for x in a)
        assert R.overnight(c, D) == pytest.approx(R.par_rate(c, D, 1 / 365), abs=1e-12)
    # pinned: a change to the seed, the parameters or the recipe moves every curve, and this says so first
    assert R.par_rate("USD_SOFR", D, 10.0) == pytest.approx(3.932, abs=0.0006)
    assert R.overnight("EUR_ESTR", D) == pytest.approx(1.952, abs=0.0006)


def test_without_its_factors_a_curve_is_its_hand_set_parameters():
    for c, (b0, b1, b2, tau) in R.PARAMS.items():
        flat = {f: 0.0 for f in R.FACTORS}
        assert R.par_rate(c, D, 1e-9, flat) == pytest.approx(b0 + b1, abs=1e-6)        # the overnight rate
        assert R.par_rate(c, D, 1e4, flat) == pytest.approx(b0, abs=1e-3)              # the long end
        x = 2.0 / tau
        f1 = (1 - math.exp(-x)) / x
        assert R.par_rate(c, D, 2.0, flat) == pytest.approx(b0 + b1 * f1 + b2 * (f1 - math.exp(-x)), abs=1e-12)


def test_a_weekend_carries_the_last_business_day():
    sat, fri = date(2026, 11, 14), date(2026, 11, 13)
    assert not R.is_business_day(sat) and R.is_business_day(fri)
    for c in R.PARAMS:
        assert R.curve_rates(c, sat, GRID) == R.curve_rates(c, fri, GRID)
        assert R.curve_rates(c, sat + timedelta(days=1), GRID) == R.curve_rates(c, fri, GRID)


def test_a_history_is_the_same_numbers_day_by_day():
    h = R.history("GBP_SONIA", GRID, date(2026, 9, 1), D)
    assert [d for d, _ in h] == [x for x in (date(2026, 9, 1) + timedelta(days=i) for i in range(78)) if R.is_business_day(x)]
    for d, row in (h[0], h[17], h[-1]):
        assert row == pytest.approx(R.curve_rates("GBP_SONIA", d, GRID), abs=1e-11)
    assert R.history("GBP_SONIA", GRID, date(2026, 11, 14), date(2026, 11, 15)) == []     # a weekend alone


def test_the_moves_are_of_the_size_and_kinship_the_recipe_states():
    start = date(2022, 11, 16)
    usd = R.history("USD_SOFR", [10.0], start, D)
    eur = R.history("EUR_ESTR", [10.0], start, D)
    du = [(b[1][0] - a[1][0]) * 100 for a, b in zip(usd, usd[1:])]
    de = [(b[1][0] - a[1][0]) * 100 for a, b in zip(eur, eur[1:])]
    assert len(du) > 1000
    assert 3.0 < statistics.pstdev(du) < 4.5                       # the level shock is 3.5 bp a day; slope and hump add a little at ten years
    mu, me = statistics.fmean(du), statistics.fmean(de)
    corr = sum((a - mu) * (b - me) for a, b in zip(du, de)) / (len(du) * statistics.pstdev(du) * statistics.pstdev(de))
    assert 0.35 < corr < 0.65                                       # half of each shock's variance is shared
    levels = [r[0] for _, r in usd]
    b0 = R.PARAMS["USD_SOFR"][0]
    assert max(abs(x - R.par_rate("USD_SOFR", D, 10.0, {f: 0.0 for f in R.FACTORS})) for x in levels) < 1.5, "it drifts around the parameters and does not run away"
    assert abs(statistics.fmean(levels) - b0) < 1.0


def test_a_shock_is_a_standard_normal_and_two_keys_do_not_share_one():
    xs = [R._normal("test", i) for i in range(20_000)]
    assert abs(statistics.fmean(xs)) < 0.03 and 0.97 < statistics.pstdev(xs) < 1.03
    assert R._normal("a", 1) != R._normal("a", 2) and R._normal("a", 1) == R._normal("a", 1)
