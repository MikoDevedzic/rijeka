"""A scenario's shifts: a curve's quotes moved before the bootstrap, a cap's vol moved in parallel.

They are inputs, not formulas: with none set every price is the price it always was, and with one set the price is
the production pricer's on the moved market. These tests hold both halves.
"""
from datetime import date

import pytest

from api.routes.pricer import CURVE_SHIFT_BOUND_BP, CurveInput, CurveQuote, _build_curve, _curve_shift
from pricing.cap_floor import VOL_FLOOR_BP, price_cap, price_collar, price_floor, shifted_vol_bp
from pricing.curve import Curve

VAL = date(2026, 11, 2)
SURFACE = [{"cap_tenor_y": t, "strike_spread_bp": s, "flat_vol_bp": 85.0 + 2 * t + abs(s) / 25.0, "is_atm": s == 0, "source": "TEST"}
           for t in (1, 2, 3, 5, 7, 10) for s in (-100, -50, 0, 50, 100)]


@pytest.fixture
def curve():
    return Curve(valuation_date=VAL, flat_rate=0.035)


class TestAVolShift:
    def test_no_shift_is_the_vol_untouched(self):
        assert shifted_vol_bp(86.1234567, 0.0) == 86.1234567
        assert shifted_vol_bp(86.1234567, None) == 86.1234567

    def test_a_shift_is_added_and_never_reaches_zero(self):
        assert shifted_vol_bp(85.0, 15.0) == 100.0
        assert shifted_vol_bp(85.0, -15.0) == 70.0
        assert shifted_vol_bp(85.0, -85.0) == VOL_FLOOR_BP
        assert shifted_vol_bp(85.0, -500.0) == VOL_FLOOR_BP

    @pytest.mark.parametrize("price,strike", [(price_cap, 0.04), (price_floor, 0.03)])
    def test_a_price_without_a_shift_is_the_price_it_was(self, curve, price, strike):
        was = price(10_000_000, strike, 5.0, curve, VAL, SURFACE)
        now = price(10_000_000, strike, 5.0, curve, VAL, SURFACE, vol_shift_bp=0.0)
        assert (now.npv, now.vega, now.ir01, now.vol_bp, now.vol_tier) == (was.npv, was.vega, was.ir01, was.vol_bp, was.vol_tier)

    @pytest.mark.parametrize("price,strike", [(price_cap, 0.04), (price_floor, 0.03)])
    @pytest.mark.parametrize("shift", [-30.0, -5.0, 1.0, 15.0, 50.0])
    def test_a_shift_prices_as_the_same_leg_at_the_shifted_vol(self, curve, price, strike, shift):
        base = price(10_000_000, strike, 5.0, curve, VAL, SURFACE)
        shifted = price(10_000_000, strike, 5.0, curve, VAL, SURFACE, vol_shift_bp=shift)
        at = price(10_000_000, strike, 5.0, curve, VAL, SURFACE, vol_override_bp=base.vol_bp + shift)
        # the answer's vol is written to four decimals of a bp; the override is that written figure, so the two prices
        # may differ by the vega on half of the last decimal
        assert shifted.npv == pytest.approx(at.npv, abs=0.02 + abs(base.vega) * 1e-4)
        assert shifted.vol_bp == pytest.approx(base.vol_bp + shift, abs=1e-3)
        # more vol is worth more to the holder of an option, by about its vega a bp
        assert (shifted.npv - base.npv) * shift > 0
        if abs(shift) <= 1.0:
            assert shifted.npv - base.npv == pytest.approx(base.vega * shift, rel=0.02)

    def test_a_shift_on_an_overridden_vol_moves_the_override(self, curve):
        a = price_cap(10_000_000, 0.04, 5.0, curve, VAL, SURFACE, vol_override_bp=90.0, vol_shift_bp=10.0)
        b = price_cap(10_000_000, 0.04, 5.0, curve, VAL, SURFACE, vol_override_bp=100.0)
        assert a.npv == b.npv

    def test_a_moved_curve_does_not_move_the_trade_along_the_smile(self, curve):
        from pricing.cap_floor import compute_atm_forward
        moved = Curve(valuation_date=VAL, flat_rate=0.036)
        held = compute_atm_forward(curve, VAL, 5.0, 4)
        base = price_cap(10_000_000, 0.04, 5.0, curve, VAL, SURFACE)
        free = price_cap(10_000_000, 0.04, 5.0, moved, VAL, SURFACE)
        kept = price_cap(10_000_000, 0.04, 5.0, moved, VAL, SURFACE, vol_atm_forward=held)
        assert kept.vol_bp == base.vol_bp                    # the vol it priced at, on the moved curve
        assert free.vol_bp != base.vol_bp                    # left alone, the pricer reads the smile ten bp nearer the money
        at = price_cap(10_000_000, 0.04, 5.0, moved, VAL, SURFACE, vol_override_bp=base.vol_bp)
        assert kept.npv == pytest.approx(at.npv, abs=0.02 + abs(base.vega) * 1e-4)
        # holding the forward the curve itself gives is no change
        same = price_cap(10_000_000, 0.04, 5.0, curve, VAL, SURFACE, vol_atm_forward=held)
        assert (same.npv, same.vol_bp) == (base.npv, base.vol_bp)

    def test_a_collar_moves_both_legs(self, curve):
        was = price_collar(10_000_000, 0.045, 0.025, 5.0, curve, VAL, SURFACE)
        same = price_collar(10_000_000, 0.045, 0.025, 5.0, curve, VAL, SURFACE, vol_shift_bp=0.0)
        assert same["net_npv"] == was["net_npv"] and same["cap"].vol_bp == was["cap"].vol_bp
        up = price_collar(10_000_000, 0.045, 0.025, 5.0, curve, VAL, SURFACE, vol_shift_bp=10.0)
        assert up["cap"].vol_bp == pytest.approx(was["cap"].vol_bp + 10.0, abs=1e-3)
        assert up["floor"].vol_bp == pytest.approx(was["floor"].vol_bp + 10.0, abs=1e-3)
        cap = price_cap(10_000_000, 0.045, 5.0, curve, VAL, SURFACE, vol_shift_bp=10.0)
        floor = price_floor(10_000_000, 0.025, 5.0, curve, VAL, SURFACE, vol_shift_bp=10.0)
        assert up["net_npv"] == pytest.approx(cap.npv - floor.npv, abs=0.01)


QUOTES = [("ON", "DEPOSIT", 0.0365), ("1Y", "OIS_SWAP", 0.0372), ("2Y", "OIS_SWAP", 0.0362), ("5Y", "OIS_SWAP", 0.0368), ("10Y", "OIS_SWAP", 0.0385)]


def _ci(shift_flat_bp=None, shift_bp=None, bump=None):
    return CurveInput(curve_id="USD_SOFR", shift_flat_bp=shift_flat_bp, shift_bp=shift_bp,
                      quotes=[CurveQuote(tenor=t, quote_type=q, rate=r + (bump or {}).get(t, 0.0)) for t, q, r in QUOTES])


class TestACurveShift:
    def test_none_is_none(self):
        assert _curve_shift(_ci()) is None
        assert _curve_shift(_ci(shift_flat_bp=0.0, shift_bp={"5Y": 0})) is None

    def test_it_is_the_flat_shift_and_the_tenors_own_in_decimal(self):
        f = _curve_shift(_ci(shift_flat_bp=10.0, shift_bp={"5y": 5.0, " 10Y ": -20.0}))
        assert f("1Y") == pytest.approx(0.0010)
        assert f("5Y") == pytest.approx(0.0015)
        assert f("10Y") == pytest.approx(-0.0010)
        assert f(None) == pytest.approx(0.0010)

    @pytest.mark.parametrize("flat,by", [(CURVE_SHIFT_BOUND_BP + 1, None), (0.0, {"5Y": -CURVE_SHIFT_BOUND_BP - 1}), (float("nan"), None),
                                          (600.0, {"5Y": 600.0}), (0.0, {f"{i}Y": 1.0 for i in range(1, 90)})])
    def test_a_shift_out_of_bounds_is_refused(self, flat, by):
        with pytest.raises(ValueError):
            _curve_shift(_ci(shift_flat_bp=flat, shift_bp=by))

    def test_a_curve_without_a_shift_is_the_curve_it_was(self):
        a, b = _build_curve(_ci(), VAL, None, "u"), _build_curve(_ci(shift_flat_bp=0.0, shift_bp={}), VAL, None, "u")
        for d in (date(2027, 11, 2), date(2031, 11, 3), date(2036, 11, 3)):
            assert a.df(d) == b.df(d)

    def test_a_shifted_curve_is_the_curve_of_the_shifted_quotes(self):
        shifted = _build_curve(_ci(shift_flat_bp=10.0, shift_bp={"5Y": 5.0}), VAL, None, "u")
        typed = _build_curve(_ci(bump={"ON": 0.0010, "1Y": 0.0010, "2Y": 0.0010, "5Y": 0.0015, "10Y": 0.0010}), VAL, None, "u")
        base = _build_curve(_ci(), VAL, None, "u")
        for d in (date(2027, 11, 2), date(2031, 11, 3), date(2036, 11, 3)):
            assert shifted.df(d) == pytest.approx(typed.df(d), abs=1e-14)
            assert shifted.df(d) < base.df(d)                # rates up, discount factors down
