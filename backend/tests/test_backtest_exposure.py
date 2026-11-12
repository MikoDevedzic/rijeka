"""The exposure backtest (scripts/backtest_exposure.py): the procedure itself, checked on histories whose law is
known. No network, no database: the script's functions on simulated returns."""
import math

import numpy as np
import pytest
from scipy.stats import norm

from pricing import vol_regimes as vr
from scripts import backtest_exposure as bt

BTC = vr.REGIMES["BTC"]


def test_one_vol_quantiles_are_the_lognormal_ones():
    # one vol: the log move over the horizon is normal with mean -s^2/2 and sd s, so quantile / s = z - s/2
    table = bt.quantile_table(None)
    for k, level in enumerate(bt.LEVELS):
        assert np.allclose(table[k], norm.ppf(level) - 0.5 * bt.S_GRID, atol=1e-9)


def test_the_regimes_quantiles_are_fatter_in_the_tails_and_carry_the_same_variance():
    u = bt.clock_multipliers(BTC, 14)
    assert u.mean() == pytest.approx(1.0, abs=0.02)                     # the clock's variance averages the ticket's
    one, reg = bt.quantile_table(None), bt.quantile_table(u)
    j = int(np.argmin(np.abs(bt.S_GRID - 0.55 * math.sqrt(14 / 365))))
    assert reg[0, j] < one[0, j] and reg[3, j] > one[3, j]              # 1st and 99th percentile further out
    assert abs(reg[1, j]) < abs(one[1, j]) + 0.02                       # the 5th is not: the mass moved to the tails


def test_the_vol_a_forecast_is_given_does_not_see_the_day_it_forecasts():
    rng = np.random.default_rng(1)
    r = 0.03 * rng.standard_normal(400)
    v = bt.trailing_vol(r)
    assert np.isnan(v[: bt.WARM_UP]).all() and np.isfinite(v[bt.WARM_UP:]).all()
    later = r.copy()
    later[200:] *= 5.0                                                   # everything from day 200 on changes
    assert np.array_equal(bt.trailing_vol(later)[bt.WARM_UP:201], v[bt.WARM_UP:201])   # the vol given up to day 200 does not
    assert bt.trailing_vol(later)[201] != v[201]
    assert v[200] == pytest.approx(math.sqrt((r[110:200] ** 2).mean() * 365.0))


def _shares(histories: np.ndarray, table: np.ndarray, h: int) -> np.ndarray:
    return np.array([bt.exceedances(x, h, table)[0] for x in histories])


def _outside(observed: np.ndarray, reference: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(reference, 2.5, axis=0), np.percentile(reference, 97.5, axis=0)
    return (observed < lo) | (observed > hi)


def test_the_band_is_a_95_percent_band_and_one_vol_fails_a_history_the_regimes_made():
    """Forty five-year histories of known law stand in for the observed one, two hundred more draw the band.
    A model given its own histories is outside the band about one cell in twenty. One vol given histories the
    regimes made is exceeded at its 1st and 99th percentile about twice as often as it says, and the test sees it
    in most histories but not all: five years is a short record for a 1st percentile."""
    h, days = 10, 1826
    gauss = bt.simulate_history(None, 0.55, days, 240, seed=8)
    made = bt.simulate_history(BTC, 0.55, days, 240, seed=9)
    one, reg = bt.quantile_table(None), bt.quantile_table(bt.clock_multipliers(BTC, h))
    a, b, c = _shares(gauss, one, h), _shares(made, reg, h), _shares(made, one, h)
    assert _outside(a[:40], a[40:]).mean() < 0.10                       # one vol on lognormal histories: about 0.04
    assert _outside(b[:40], b[40:]).mean() < 0.12                       # the regimes on their own histories: about 0.06
    wrong = _outside(c[:40], a[40:])
    assert (wrong[:, 0] | wrong[:, 3]).mean() > 0.45                    # a tail outside in most histories: about 0.6
    assert c[:40, 0].mean() > 0.017 and c[:40, 3].mean() > 0.017        # about 2 % of days beyond a percentile called 1 %
    assert wrong[:, 1].mean() < 0.25 and wrong[:, 2].mean() < 0.25      # the 5th and 95th hardly tell them apart


def test_the_table_counts_cells_per_model():
    r = bt.simulate_history(BTC, 0.55, 700, 1, seed=2)[0]
    rows = bt.backtest(r, BTC, sims=20, seed=3)
    assert {x["model"] for x in rows} == {"one vol", "regimes"} and len(rows) == 2 * len(bt.HORIZONS)
    tally = bt.outside(rows)
    assert tally["one vol"][1] == tally["regimes"][1] == len(bt.HORIZONS) * len(bt.LEVELS)
    assert all(x["n"] == 700 - bt.WARM_UP - x["days"] + 1 for x in rows)
