"""SA-CCR against the Basel Committee's worked examples (bcbs279, March 2014, Annex 4a, examples 1–5).

The examples carry intermediates unrounded and print them rounded; the assertions compare at the printed
precision (thousands) with a tolerance of one unit, and the unrounded chain where the text gives it."""
import math

import pytest

from pricing.csa import CSA
from pricing.sa_ccr import (SaccrTrade, adjusted_notional, aggregate_addon, ead, maturity_factor, multiplier,
                            supervisory_delta, supervisory_duration, addon_profile, shifted)

UN = CSA.uncollateralised()


def _ex1_trades():
    d3 = supervisory_delta("PUT", bought=True, P=0.06, K=0.05, T=1.0, sigma=0.50)
    return [SaccrTrade("IR", "USD", 10_000, 0, 10, 10, +1, trade_ref="1"),
            SaccrTrade("IR", "USD", 10_000, 0, 4, 4, -1, trade_ref="2"),
            SaccrTrade("IR", "EUR", 5_000, 1, 11, 11, d3, trade_ref="3")]


def test_supervisory_duration_and_adjusted_notional_as_printed():
    assert supervisory_duration(0, 10) == pytest.approx(7.87, abs=0.005)
    assert supervisory_duration(0, 4) == pytest.approx(3.63, abs=0.005)
    assert supervisory_duration(1, 11) == pytest.approx(7.49, abs=0.005)
    t1, t2, t3 = _ex1_trades()
    assert adjusted_notional(t1) == pytest.approx(78_694, abs=1)
    assert adjusted_notional(t2) == pytest.approx(36_254, abs=1)
    assert adjusted_notional(t3) == pytest.approx(37_428, abs=1)


def test_swaption_delta_is_the_bought_put_formula():
    d = supervisory_delta("PUT", True, 0.06, 0.05, 1.0, 0.50)
    assert d == pytest.approx(-0.27, abs=0.005)
    assert supervisory_delta("PUT", False, 0.06, 0.05, 1.0, 0.50) == pytest.approx(-d)
    c = supervisory_delta("CALL", True, 0.06, 0.05, 1.0, 0.50)
    assert c == pytest.approx(1.0 + d)                     # put–call: Φ(d) − 1 = −Φ(−d)
    assert supervisory_delta("CALL", True, 0.0, 0.01, 1.0, 0.5, shift=0.02) > 0   # the λ shift admits a zero rate


def test_example_1_interest_rate_netting_set():
    trades = _ex1_trades()
    addon, detail = aggregate_addon(trades, UN)
    usd, eur = detail["IR"]["hedging_sets"]["USD"], detail["IR"]["hedging_sets"]["EUR"]
    assert usd["buckets"][1] == pytest.approx(-36_254, abs=1) and usd["buckets"][2] == pytest.approx(78_694, abs=1)
    assert eur["buckets"][2] == pytest.approx(-10_083, abs=1)
    assert usd["effective_notional"] == pytest.approx(59_270, abs=1)
    assert eur["effective_notional"] == pytest.approx(10_083, abs=1)
    assert addon == pytest.approx(347, abs=0.5)
    r = ead(trades, UN, V=30 - 20 + 50)
    assert r.rc == 60 and r.multiplier == 1.0
    assert r.ead == pytest.approx(569, abs=0.6)


def _ex2_trades():
    return [SaccrTrade("CREDIT", "FIRM_A", 10_000, 0, 3, 3, +1, "AA", "1"),
            SaccrTrade("CREDIT", "FIRM_B", 10_000, 0, 6, 6, -1, "BBB", "2"),
            SaccrTrade("CREDIT", "CDX.IG", 10_000, 0, 5, 5, +1, "INDEX_IG", "3")]


def test_example_2_credit_netting_set_with_the_multiplier():
    trades = _ex2_trades()
    addon, detail = aggregate_addon(trades, UN)
    ents = detail["CREDIT"]["hedging_sets"]
    assert ents["FIRM_A"]["addon"] == pytest.approx(106, abs=0.6)
    assert ents["FIRM_B"]["addon"] == pytest.approx(-280, abs=0.6)
    assert ents["CDX.IG"]["addon"] == pytest.approx(168, abs=0.6)
    assert addon == pytest.approx(282, abs=0.6)
    r = ead(trades, UN, V=20 - 40 + 0)
    assert r.rc == 0.0
    assert r.multiplier == pytest.approx(0.965, abs=0.001)
    assert r.ead == pytest.approx(381, abs=0.6)


def _ex3_trades():
    return [SaccrTrade("COMMODITY", "ENERGY", 10_000, 0, 0.75, 0.75, +1, "OIL_GAS", "1"),
            SaccrTrade("COMMODITY", "ENERGY", 20_000, 0, 2, 2, -1, "OIL_GAS", "2"),
            SaccrTrade("COMMODITY", "METALS", 10_000, 0, 5, 5, +1, "METALS", "3")]


def test_example_3_commodity_netting_set_with_a_nine_month_maturity_factor():
    assert maturity_factor(UN, 0.75) == pytest.approx(math.sqrt(0.75))
    trades = _ex3_trades()
    addon, detail = aggregate_addon(trades, UN)
    energy = detail["COMMODITY"]["hedging_sets"]["ENERGY"]
    assert energy["types"]["OIL_GAS"]["effective_notional"] == pytest.approx(-11_340, abs=1)
    assert energy["addon"] == pytest.approx(2_041, abs=1)
    assert detail["COMMODITY"]["hedging_sets"]["METALS"]["addon"] == pytest.approx(1_800, abs=0.5)
    assert addon == pytest.approx(3_841, abs=1)
    r = ead(trades, UN, V=-50 - 30 + 100)
    assert r.rc == 20 and r.multiplier == 1.0
    assert r.ead == pytest.approx(5_406, abs=1.5)


def test_example_4_asset_classes_add_without_diversification():
    r = ead(_ex1_trades() + _ex2_trades(), UN, V=60 - 20)
    assert r.rc == 40 and r.addon == pytest.approx(629, abs=1) and r.ead == pytest.approx(936, abs=1.5)


def test_example_5_margined_weekly_with_an_independent_amount():
    csa = CSA.bilateral(threshold_cp=0.0, mta=5.0, mpor_days=14.0, im_exchanged=True)
    assert maturity_factor(csa, 10.0) == pytest.approx(1.5 * math.sqrt(14 / 250))
    trades = _ex1_trades() + _ex3_trades()
    addon, detail = aggregate_addon(trades, csa)
    usd = detail["IR"]["hedging_sets"]["USD"]
    assert usd["buckets"][1] == pytest.approx(-12_869, abs=1) and usd["buckets"][2] == pytest.approx(27_934, abs=1)
    assert usd["effective_notional"] == pytest.approx(21_039, abs=1)
    assert detail["IR"]["addon"] == pytest.approx(123, abs=0.6)
    assert detail["COMMODITY"]["addon"] == pytest.approx(1_278, abs=1)
    assert addon == pytest.approx(1_401, abs=1)
    V = 30 - 20 + 50 - 50 - 30 + 100
    r = ead(trades, csa, V=V, C=200, nica=150)
    assert V == 80 and r.rc == 0.0
    assert r.multiplier == pytest.approx(0.958, abs=0.001)
    assert r.ead == pytest.approx(1_879, abs=1.5)
    assert not r.capped and r.ead_unmargined > r.ead


def test_the_margined_cap_binds_when_the_margined_ead_would_exceed_the_unmargined_one():
    """A one-week trade: unmargined MF = sqrt(10bd) while margined MF = 1.5 sqrt(10/250) is larger, so CRE52.2 caps it."""
    t = [SaccrTrade("FX", "EURUSD", 1_000, 0, 0.02, 0.02, 1)]
    csa = CSA.bilateral(mpor_days=10)
    r = ead(t, csa, V=0.0)
    assert r.capped and r.ead == pytest.approx(r.ead_unmargined)


def test_multiplier_floor_and_cap():
    assert multiplier(100, 0, 50) == 1.0
    assert multiplier(-1e9, 0, 50) == pytest.approx(0.05)
    assert multiplier(0, 0, 0) == 1.0


def test_the_engine_s_single_factor_add_on_is_the_ir_class_with_one_trade():
    """Today's waterfall uses SF · N · SD · MF for one swap; the module gives the same number for one IR trade."""
    from pricing.xva_engine import SF_IR
    N, M = 1e7, 5.0
    t = [SaccrTrade("IR", "USD", N, 0, M, M, +1)]
    for csa in (UN, CSA.bilateral(), CSA.on_chain()):
        addon, _ = aggregate_addon(t, csa)
        sd = (1 - math.exp(-0.05 * M)) / 0.05
        assert addon == pytest.approx(SF_IR * N * sd * maturity_factor(csa, M))


def test_profile_shifts_the_dates_and_drops_matured_trades():
    t = _ex1_trades()
    later = shifted(t, 5.0)
    assert len(later) == 2 and {x.trade_ref for x in later} == {"1", "3"}
    assert later[0].end_y == 5 and later[1].start_y == 0 and later[1].end_y == 6
    prof = addon_profile(t, UN, [0.0, 2.0, 5.0, 12.0])
    assert prof[0] == pytest.approx(347, abs=0.5) and prof[1] < prof[0] and prof[-1] == 0.0
