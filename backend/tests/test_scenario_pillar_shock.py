"""The scenario tab shocks a discounting curve pillar by pillar in the browser (frontend fx-scenario.js shockAtTime).
Its rule for the shock at a settlement date is the engine's own curve, bumped: the curve is log-linear in the
discount factor between pillars, so +D bp on the zero rate of the pillars a and b moves the zero rate at T by
[(1 - w)*Da*ta + w*Db*tb] / T. These cases pin that rule against pricing.curve.Curve; the browser's test carries
the same numbers (fx-scenario.test.js, "the case the engine's test pins")."""
import math
from datetime import date, timedelta

import pytest

from pricing.curve import Curve

VAL = date(2026, 11, 10)
A, B, T = VAL + timedelta(days=61), VAL + timedelta(days=120), VAL + timedelta(days=92)


def _curve(za: float, zb: float) -> Curve:
    return Curve(VAL, df_pillars=[(A, math.exp(-za * 61 / 365)), (B, math.exp(-zb * 120 / 365))])


def _zero(c: Curve, d: date) -> float:
    return -math.log(c._interp_df(d)) / ((d - VAL).days / 365)


def _rule(da: float, db: float, ta: float = 61 / 365, tb: float = 120 / 365, t: float = 92 / 365) -> float:
    w = (t - ta) / (tb - ta)
    return ((1 - w) * da * ta + w * db * tb) / t


@pytest.mark.parametrize("da, db", [(50.0, 0.0), (0.0, 50.0), (50.0, 50.0), (40.0, -20.0), (-25.0, 10.0)])
def test_a_pillar_shock_reaches_the_settlement_date_as_the_bumped_curve_says(da, db):
    base, bumped = _curve(0.041, 0.040), _curve(0.041 + da / 1e4, 0.040 + db / 1e4)
    moved_bp = (_zero(bumped, T) - _zero(base, T)) * 1e4
    assert moved_bp == pytest.approx(_rule(da, db), abs=1e-9)


def test_the_numbers_the_browser_test_carries():
    assert _rule(50, 0) == pytest.approx(15.7332, abs=1e-4)
    assert _rule(0, 50) == pytest.approx(34.2668, abs=1e-4)
    assert _rule(50, 50) == pytest.approx(50.0, abs=1e-12)          # a parallel shock is itself


def test_before_the_first_pillar_the_shock_is_that_pillars_and_after_the_last_its_own():
    base, bumped = _curve(0.041, 0.040), _curve(0.041 + 0.0030, 0.040 - 0.0010)
    early, late = VAL + timedelta(days=20), VAL + timedelta(days=200)
    assert (_zero(bumped, early) - _zero(base, early)) * 1e4 == pytest.approx(30.0, abs=1e-9)
    # beyond the last pillar the engine holds its zero rate (on a 365.25 clock): the last pillar's shock, to that clock
    assert (_zero(bumped, late) - _zero(base, late)) * 1e4 == pytest.approx(-10.0, abs=0.01)
