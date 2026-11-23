"""The netting-set engine and an option's expiry (0.65.0).

The engine's grid is monthly from the valuation date. An option booked today expires a day or more before the grid
date its tenor lands on about one time in five (a weekend or a holiday between), and settles after it. On that
grid date the payoff used to be fixed on the grid date's own spot: the level had diffused for the days since the
expiry, and the carry to settlement was left out. These tests hold the level at the expiry to the path's own law,
the value on that grid date to the option's price, and the barrier to the expiry."""
import math
from datetime import date, timedelta

import numpy as np
import pytest

from ccr import calibration as C
from ccr.options import value_fx_option
from ccr.simulate import simulate, spot_between, step_vol
from pricing.curve import Curve
from pricing.fx_exotic import ExoticSpec

VAL = date(2026, 11, 23)
KEY, SKEY = "RATES:USD_SOFR", "SPOT:EURUSD"
S0, SIG, RQ, RB = 1.165, 0.075, 0.04, 0.02
FX, FLAT = {"USD": 1.0}, {"EURUSD": RB}


def paths(n=40000, months=3, sigma=SIG, seed=11, rq=RQ, rb=RB, pillars=None, rates_sigma=1e-6, skey=SKEY, spot=S0):
    f = {KEY: C.Factor(KEY, "RATES", a=0.03, sigma=rates_sigma), skey: C.Factor(skey, "SPOT", sigma=sigma, pillars=pillars)}
    cal = C.Calibration("RISK_NEUTRAL", f, np.eye(2), [KEY, skey], drift_mode="forward")
    return simulate(cal, {KEY: Curve(VAL, flat_rate=rq)}, {skey: spot}, {skey: (rq, rb)}, VAL, months, n_paths=n, seed=seed)


def years(d):
    return (d - VAL).days / 365.25


def call(p, i, before, after, K=1.167, **kw):
    g = p.grid[i]
    return {"pair": "EURUSD", "base": "EUR", "quote": "USD", "K": K, "option_type": "CALL", "expiry": g - timedelta(days=before),
            "settle": g + timedelta(days=after), "N": 1e7, "vol": SIG, "sign": 1.0, **kw}


def test_a_time_on_a_grid_date_is_the_grid_level_and_draws_nothing():
    p = paths(n=500)
    for j in range(len(p.grid)):
        assert np.shares_memory(spot_between(p, SKEY, float(p.t[j])), p.s[SKEY][:, j])       # the grid's own column
    assert p.inside == {}


def test_the_level_inside_a_step_has_the_paths_own_law():
    p = paths()
    T = years(p.grid[2] - timedelta(days=9))
    s = spot_between(p, SKEY, T)
    ln = np.log(s / S0)
    n = p.n_paths
    assert ln.var() == pytest.approx(SIG ** 2 * T, rel=4 * math.sqrt(2 / n))                    # the variance to that date
    assert s.mean() == pytest.approx(S0 * math.exp((RQ - RB) * T), rel=4 * SIG * math.sqrt(T / n))   # the forward to it
    after = np.log(p.s[SKEY][:, 2] / s)                                                         # what is left of the step
    assert after.var() == pytest.approx(SIG ** 2 * 9 / 365.25, rel=4 * math.sqrt(2 / n))
    assert abs(np.corrcoef(ln, after)[0, 1]) < 4 / math.sqrt(n)                                 # increments independent
    before = np.log(s / p.s[SKEY][:, 1])
    assert abs(np.corrcoef(before, after)[0, 1]) < 4 / math.sqrt(n)


def test_two_dates_in_one_step_are_two_points_of_one_path_in_any_order():
    p, q = paths(), paths()
    T1, T2 = years(p.grid[2] - timedelta(days=12)), years(p.grid[2] - timedelta(days=3))
    a1, a2 = spot_between(p, SKEY, T1), spot_between(p, SKEY, T2)
    b2, b1 = spot_between(q, SKEY, T2), spot_between(q, SKEY, T1)                               # asked the other way round
    assert np.array_equal(a1, b1) and np.array_equal(a2, b2)
    move = np.log(a2 / a1)
    assert move.var() == pytest.approx(SIG ** 2 * 9 / 365.25, rel=4 * math.sqrt(2 / p.n_paths))
    assert sorted(k[1:] for k in p.inside) == [(2, (p.grid[2] - p.grid[1]).days - 12), (2, (p.grid[2] - p.grid[1]).days - 3)]   # the two levels, no more


def test_a_factor_with_a_surface_diffuses_inside_a_step_at_that_steps_vol():
    from pricing.fx_vol import Pillar, step_vols
    pillars = [Pillar(1 / 12, 0.06, 0.0, 0.0, False), Pillar(0.25, 0.10, 0.0, 0.0, False)]
    p = paths(pillars=pillars)
    assert step_vol(p, SKEY, 2) == pytest.approx(float(step_vols(pillars, p.t[1:])[1]))
    assert step_vol(p, SKEY, 2) != pytest.approx(SIG)
    D = (p.grid[2] - p.grid[1]).days
    T = years(p.grid[1] + timedelta(days=D // 2))
    inside = np.log(spot_between(p, SKEY, T) / p.s[SKEY][:, 1])
    assert inside.var() == pytest.approx(step_vol(p, SKEY, 2) ** 2 * (D // 2) / 365.25, rel=4 * math.sqrt(2 / p.n_paths))


@pytest.mark.parametrize("pair,months,before,after,sigma,spot,K", [
    ("EURUSD", 1, 1, 1, 0.075, 1.165, 1.167),
    ("EURUSD", 3, 2, 2, 0.075, 1.165, 1.171),
    ("EURUSD", 12, 2, 2, 0.075, 1.165, 1.188),
    ("BTCUSD", 1, 1, 1, 0.55, 90000.0, 90300.0),             # a digital asset: no curve for the base, the flat funding rate
    ("BTCUSD", 3, 2, 1, 0.55, 90000.0, 91000.0),
])
def test_the_value_on_that_grid_date_averages_to_the_price_at_each_tenor(pair, months, before, after, sigma, spot, K):
    skey = f"SPOT:{pair}"
    p = paths(n=200000, months=months + 1, sigma=sigma, skey=skey, spot=spot)
    g = p.grid[months]
    item = {"pair": pair, "base": pair[:3], "quote": "USD", "K": K, "option_type": "CALL", "expiry": g - timedelta(days=before),
            "settle": g + timedelta(days=after), "N": 1e3, "vol": sigma, "sign": 1.0}
    flat = {pair: RB}
    v0 = float(value_fx_option(dict(item), p, 0, FX, flat)[0])
    at = value_fx_option(dict(item), p, months, FX, flat) * math.exp(-RQ * float(p.t[months]))
    se = float(at.std() / math.sqrt(p.n_paths))
    assert abs(float(at.mean()) - v0) < 3.5 * se
    put = value_fx_option({**item, "option_type": "PUT"}, p, months, FX, flat) * math.exp(-RQ * float(p.t[months]))
    p0 = float(value_fx_option({**item, "option_type": "PUT"}, p, 0, FX, flat)[0])
    assert abs(float(put.mean()) - p0) < 3.5 * float(put.std() / math.sqrt(p.n_paths))         # the put, where the carry turns
    sold = value_fx_option({**item, "sign": -1.0}, p, months, FX, flat) * math.exp(-RQ * float(p.t[months]))
    assert np.array_equal(sold, -at)


def test_the_value_on_the_grid_date_after_the_expiry_averages_to_the_price():
    p = paths(n=200000, months=2)
    item = call(p, 1, before=3, after=1)
    v0 = float(value_fx_option(dict(item), p, 0, FX, FLAT)[0])
    at = value_fx_option(dict(item), p, 1, FX, FLAT) * math.exp(-RQ * float(p.t[1]))
    se = float(at.std() / math.sqrt(p.n_paths))
    assert abs(float(at.mean()) - v0) < 3.5 * se                                                # a martingale to that date
    # the validator's own figure for this option (his closed form 94,507.6; his daily paths 94,396 +/- 221)
    assert v0 == pytest.approx(94507.6, rel=5e-4)
    # what the engine did until 0.65.0: the payoff on the grid date's own spot, three days of diffusion too many
    T_s = years(item["settle"])
    old = 1e7 * np.maximum(p.s[SKEY][:, 1] - item["K"], 0.0) * math.exp(-RQ * T_s)
    assert float(old.mean()) > v0 * 1.03 and float(old.mean()) - v0 > 8 * se


def test_an_expiry_on_a_grid_date_pays_on_the_rate_for_delivery_at_settlement():
    rq, rb = 0.06, 0.0                                                                          # a carry large enough to see
    p = paths(n=200000, months=2, rq=rq, rb=rb)
    item = call(p, 1, before=0, after=4, K=1.171)
    flat = {"EURUSD": rb}
    T_e, T_s = years(item["expiry"]), years(item["settle"])
    at = value_fx_option(dict(item), p, 1, FX, flat)
    fwd = p.s[SKEY][:, 1] * math.exp((rq - rb) * (T_s - T_e))
    want = 1e7 * np.maximum(fwd - item["K"], 0.0) * math.exp(-rq * (T_s - T_e))
    assert float(np.abs(at - want).max()) < 25.0                                                # of 10m: the curve is read by the day
    assert float(((at > 0) != (fwd > item["K"])).mean()) < 1e-4                                 # in the money on the forward, not the spot
    assert float(((at > 0) != (p.s[SKEY][:, 1] > item["K"])).mean()) > 1e-3
    assert p.inside == {}                                                                       # nothing drawn: the grid's own level
    v0 = float(value_fx_option(dict(item), p, 0, FX, flat)[0])
    disc = at * math.exp(-rq * T_e)
    se = float(disc.std() / math.sqrt(p.n_paths))
    assert abs(float(disc.mean()) - v0) < 3.5 * se
    on_spot = 1e7 * np.maximum(p.s[SKEY][:, 1] - item["K"], 0.0) * math.exp(-rq * T_s)          # until 0.65.0
    assert v0 - float(on_spot.mean()) > 5 * se


def test_a_barrier_is_watched_to_the_expiry_and_no_further():
    p = paths(n=40000, months=2, sigma=0.12)
    B = 1.19
    spec = ExoticSpec("BARRIER", "CALL", strike=1.15, barrier_type="UP_OUT", barrier=B)
    item = call(p, 1, before=3, after=1, K=1.15, spec=spec, vol=0.12)
    at = value_fx_option(dict(item), p, 1, FX, FLAT)
    s_e = spot_between(p, SKEY, years(item["expiry"]))
    grid = p.s[SKEY][:, 1]
    late = (grid >= B) & (s_e < B) & (s_e > 1.16)               # crossed only after the expiry: the option had paid
    assert late.sum() > 20
    assert np.all(at[late] > 0.0)
    assert np.all(at[s_e >= B] == 0.0)                           # at the barrier on the expiry: out
    early = (s_e > 1.16) & (s_e < B)
    assert np.all(at[early] > 0.0)


def test_two_trades_with_one_expiry_read_one_level():
    p = paths(n=5000, months=2)
    bought = call(p, 1, before=2, after=2)
    sold = {**bought, "sign": -1.0}
    a, b = value_fx_option(dict(bought), p, 1, FX, FLAT), value_fx_option(dict(sold), p, 1, FX, FLAT)
    assert np.array_equal(a, -b) and float(a.max()) > 0.0
    put = {**bought, "option_type": "PUT"}
    c = value_fx_option(dict(put), p, 1, FX, FLAT)
    # one level for both: the call less the put is the forward on it, path by path
    T_e, T_s = years(bought["expiry"]), years(bought["settle"])
    fwd = spot_between(p, SKEY, T_e) * math.exp((RQ - RB) * (T_s - T_e))
    df = math.exp(-RQ * (T_s - float(p.t[1])))
    assert float(np.abs((a - c) - 1e7 * (fwd - bought["K"]) * df).max()) < 25.0


def test_two_pairs_move_together_inside_a_step_as_they_do_across_it():
    k2 = "SPOT:GBPUSD"
    f = {KEY: C.Factor(KEY, "RATES", a=0.03, sigma=1e-6), SKEY: C.Factor(SKEY, "SPOT", sigma=0.075), k2: C.Factor(k2, "SPOT", sigma=0.09)}
    corr = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.6], [0.0, 0.6, 1.0]])
    cal = C.Calibration("REAL_WORLD", f, corr, [KEY, SKEY, k2], drift_mode="zero")
    p = simulate(cal, {KEY: Curve(VAL, flat_rate=RQ)}, {SKEY: S0, k2: 1.31}, {SKEY: (RQ, RB), k2: (RQ, RB)}, VAL, 2, n_paths=40000, seed=4)
    D = (p.grid[1] - p.grid[0]).days
    T = years(p.grid[0] + timedelta(days=D // 2))
    rho = (D // 2) / D
    resid = []
    for key in (SKEY, k2):
        lo, hi = np.log(p.s[key][:, 0]), np.log(p.s[key][:, 1])
        resid.append(np.log(spot_between(p, key, T)) - (lo + rho * (hi - lo)))
    assert np.corrcoef(resid[0], resid[1])[0, 1] == pytest.approx(0.6, abs=4 / math.sqrt(p.n_paths))
    whole = [np.log(p.s[key][:, 1] / p.s[key][:, 0]) for key in (SKEY, k2)]
    assert np.corrcoef(whole[0], whole[1])[0, 1] == pytest.approx(0.6, abs=0.02)
    assert abs(np.corrcoef(resid[0], whole[1])[0, 1]) < 4 / math.sqrt(p.n_paths)               # and apart from the step's ends


def test_an_option_expired_and_not_yet_settled_reads_todays_level():
    p = paths(n=1000, months=1)
    item = {"pair": "EURUSD", "base": "EUR", "quote": "USD", "K": 1.10, "option_type": "CALL", "expiry": VAL - timedelta(days=1),
            "settle": VAL + timedelta(days=1), "N": 1e7, "vol": SIG, "sign": 1.0}
    v = value_fx_option(dict(item), p, 0, FX, FLAT)
    assert np.allclose(v, 1e7 * (S0 - 1.10), rtol=2e-3) and p.inside == {}


def test_before_the_expiry_and_after_settlement_nothing_changes():
    p = paths(n=2000, months=3)
    item = call(p, 2, before=3, after=1)
    v1 = value_fx_option(dict(item), p, 1, FX, FLAT)             # a month before: the closed form on the grid's spot
    assert p.inside == {} and np.all(np.isfinite(v1)) and float(v1.mean()) > 0
    assert np.all(value_fx_option(dict(item), p, 3, FX, FLAT) == 0.0)


def test_historical_sampling_draws_the_level_at_the_factors_vol():
    rng = np.random.default_rng(3)
    panel = np.column_stack([rng.normal(0, 0.0005, 500), rng.normal(0, SIG / math.sqrt(252), 500)])
    f = {KEY: C.Factor(KEY, "RATES", a=0.03, sigma=0.008), SKEY: C.Factor(SKEY, "SPOT", sigma=SIG)}
    cal = C.Calibration("REAL_WORLD", f, np.eye(2), [KEY, SKEY], drift_mode="zero", sampling="HISTORICAL", panel=panel)
    p = simulate(cal, {KEY: Curve(VAL, flat_rate=RQ)}, {SKEY: S0}, {SKEY: (RQ, RB)}, VAL, 2, n_paths=20000, seed=5)
    assert step_vol(p, SKEY, 1) == pytest.approx(SIG)
    T = years(p.grid[1] - timedelta(days=10))
    s = spot_between(p, SKEY, T)
    assert np.all(np.isfinite(s)) and np.all(s > 0)
    D = (p.grid[1] - p.grid[0]).days
    rho = (D - 10) / D
    month = np.log(p.s[SKEY][:, 1] / S0).var()                 # the observed block's own spread over the step
    want = rho ** 2 * month + SIG ** 2 * (D / 365.25) * rho * (1 - rho)
    assert np.log(s / S0).var() == pytest.approx(want, rel=0.05)   # the straight line to the block's end, and the bridge
