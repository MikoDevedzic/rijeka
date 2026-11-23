"""0.64.0. The last step of an option's XVA run.

An option expires a few days before it settles, and the run's grid ends on the settlement date: the expiry lies
inside the last step. Until 0.64.0 the payoff was fixed on the level at the grid date, which has diffused for those
days too, so the expected value at that date stood above the option's price by about sqrt(T_s/T_e) − 1: 2 % at three
months with four days between (the model validator's measurement, 23 November 2026), 13 to 25 % on a one-week option.
The level at the expiry is now drawn inside its step (pricing/fx_xva.interior_levels), once for the run so that every leg of a package reads one path, the payoff and the barrier
watch read it, and the value a margin period earlier in that step runs to the expiry."""
from __future__ import annotations

import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.fx_exotic import ExoticSpec

Phi = lambda x: 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))        # noqa: E731
S0, F0, RQ, VOL, N = 1.10, 1.105, 0.041, 0.09, 10_000_000.0


def _opt(t_e, t_s, spec=None, pair="EURUSD", vol=VOL, **kw):
    spec = spec or ExoticSpec("EUROPEAN", "CALL", strike=F0)
    return fx_xva.OptionXvaInput(pair=pair, base_notional=N, spot=S0, forward=F0, t_expiry=t_e, t_settle=t_s, df_quote_t=math.exp(-RQ * t_s), quote_zero=RQ,
                                 vol=vol, spec=spec, direction="BUY", **kw)


def _black(f, k, s_rt):
    d1 = (math.log(f / k) + 0.5 * s_rt * s_rt) / s_rt
    return f * Phi(d1) - k * Phi(d1 - s_rt)


@pytest.mark.parametrize("label,t_e,t_s,was", [("one week, two days to settlement", 7 / 365, 9 / 365, 0.13), ("one week, four days", 7 / 365, 11 / 365, 0.25),
                                              ("three months, four days", 0.25 - 4 / 365, 0.25, 0.023)])
def test_the_last_dates_expected_value_is_the_options_price(label, t_e, t_s, was):
    """The discounted value is a martingale to the last date. It stood sqrt(T_s/T_e) − 1 above the price there."""
    assert math.sqrt(t_s / t_e) - 1 == pytest.approx(was, abs=0.006)
    V, p0, v0 = fx_xva.simulate_option_paths(_opt(t_e, t_s), n_paths=200_000, seed=5)
    last = V.shape[1] - 1
    se = float(V[:, last].std()) / math.sqrt(V.shape[0]) * p0[last + 1] / v0
    assert se < 0.004
    assert float(V[:, last].mean()) * p0[last + 1] / v0 - 1.0 == pytest.approx(0.0, abs=3.5 * se), label
    # and against the formula, not the run: the expected payoff on the forward at the EXPIRY is Black at σ√T_e
    assert v0 == pytest.approx(N * math.exp(-RQ * t_s) * _black(F0, F0, VOL * math.sqrt(t_e)), rel=1e-12)


def test_the_level_at_the_expiry_is_a_bridge_inside_its_step():
    """Its law, checked on the draws: variance σ²T_e, mean one (a martingale), and with the grid level after it the
    correlation a Brownian path has (the root of the share of the step before the expiry). Rebuilt here from the
    two grid levels and the normal drawn for it."""
    t_e, t_s = 0.25 - 4 / 365, 0.25
    inp = _opt(t_e, t_s)
    nz: dict = {}
    V, _, _ = fx_xva.simulate_option_paths(inp, n_paths=200_000, seed=8, noise_out=nz)
    steps, dt, i_exp = nz["steps"], nz["dt"], nz["i_exp"]
    assert i_exp == steps - 1 and nz["xi_exp"] is not None
    m = nz["f_t"] / F0
    m_e = nz["f_exp"] / F0
    w = (t_e - i_exp * dt) / dt
    assert 0 < w < 1 and np.allclose(nz["om_exp"], w)
    rebuilt = np.exp(np.log(m[:, i_exp - 1]) + w * (np.log(m[:, i_exp]) - np.log(m[:, i_exp - 1])) + nz["xi_exp"] * VOL * math.sqrt(dt * w * (1 - w)))
    assert np.allclose(m_e, rebuilt, rtol=1e-12)
    assert float(np.var(np.log(m_e))) == pytest.approx(VOL * VOL * t_e, rel=0.01) and float(m_e.mean()) == pytest.approx(1.0, abs=5e-4)
    a, b = np.log(m_e) - np.log(m[:, i_exp - 1]), np.log(m[:, i_exp]) - np.log(m[:, i_exp - 1])
    assert float(np.corrcoef(a, b)[0, 1]) == pytest.approx(math.sqrt(w), abs=0.01)
    # the payoff is on the forward to settlement at the expiry, paid at settlement
    assert np.allclose(V[:, -1], N * np.maximum(nz["f_exp"] - F0, 0.0), rtol=1e-12, atol=1e-9)


def test_an_expiry_on_the_grid_date_draws_nothing_and_is_as_it_was():
    inp = _opt(0.5, 0.5, grid_per_year=12)
    nz: dict = {}
    V, _, _ = fx_xva.simulate_option_paths(inp, n_paths=500, noise_out=nz)
    assert nz["xi_exp"] is None and np.array_equal(nz["f_exp"], nz["f_t"][:, nz["i_exp"]])
    assert np.allclose(V[:, -1], N * np.maximum(nz["f_t"][:, -1] - F0, 0.0), rtol=1e-12, atol=1e-9)


def test_a_barrier_is_watched_to_the_expiry_and_no_further():
    """On the dates alone, an up-and-out that is inside at the expiry and beyond its level on the grid date after it
    has not knocked: before 0.64.0 it had."""
    spec = ExoticSpec("BARRIER", "CALL", strike=F0, barrier=1.16, barrier_type="UP_OUT")
    inp = _opt(7 / 365, 11 / 365, spec=spec, vol=0.60, watch_between=False)
    nz: dict = {}
    fx_xva.simulate_option_paths(inp, n_paths=20_000, seed=2, noise_out=nz)
    _, _, x = fx_xva._option_values(inp, nz["steps"], nz["dt"], nz["f_t"] / F0, nz["step_vols"], nz["clock"], 2)
    r_b = RQ - math.log(F0 / S0) / inp.t_settle
    s_exp = x["f_exp"] * math.exp(-(RQ - r_b) * (inp.t_settle - inp.t_expiry))
    before = x["knocked"][:, x["i_exp"]]
    assert np.array_equal(x["knocked"][:, -1], before | (s_exp >= 1.16))
    crossed_after = ~before & (s_exp < 1.16) & (x["s_t"][:, x["i_exp"]] >= 1.16)
    assert crossed_after.sum() > 100 and not x["knocked"][crossed_after, -1].any()


def test_the_value_a_margin_period_earlier_in_the_expirys_step_runs_to_the_expiry():
    """Eighteen months on monthly steps: the date a margin period before the last grid date lies inside the last step,
    before the expiry. The level there is drawn given the level at the expiry (the payoff's), and the option is the
    closed form with the time left to the EXPIRY, discounted from settlement. Rebuilt here, formula and level both."""
    t_e, t_s = 1.495, 1.506
    inp = _opt(t_e, t_s)
    nz: dict = {}
    V, _, _ = fx_xva.simulate_option_paths(inp, n_paths=4000, seed=9, noise_out=nz)
    steps, dt, i_exp = nz["steps"], nz["dt"], nz["i_exp"]
    lag_y = 10.0 / 250.0
    assert lag_y < dt and t_s - lag_y < t_e, "the lagged date of the last step is before the expiry"
    zs = np.zeros((4000, steps))
    lagged = nz["lag"](lag_y, np.random.default_rng(43), zs)
    m = nz["f_t"] / F0
    w_l, w_e = 1.0 - lag_y / dt, (t_e - i_exp * dt) / dt
    lo = np.log(m[:, i_exp - 1])
    m_l = np.exp(lo + (w_l / w_e) * (np.log(nz["f_exp"] / F0) - lo) + zs[:, i_exp] * VOL * math.sqrt(dt * w_l * (1 - w_l / w_e)))
    tl = t_s - lag_y
    tau, df = t_e - tl, math.exp(-RQ * (t_s - tl))
    mine = np.array([N * df * _black(F0 * float(x), F0, VOL * math.sqrt(tau)) for x in m_l[:50]])
    assert np.allclose(lagged[:50, i_exp], mine, rtol=1e-10, atol=1e-6)
    # its law: the level a margin period earlier has the variance of its own date, and moves with the level at the expiry
    assert float(np.var(np.log(m_l))) == pytest.approx(VOL * VOL * tl, rel=0.06)
    assert float(np.corrcoef(np.log(m_l) - lo, np.log(nz["f_exp"] / F0) - lo)[0, 1]) == pytest.approx(math.sqrt(w_l / w_e), abs=0.03)
    assert V.shape == lagged.shape


def test_a_digital_asset_reads_the_share_of_the_steps_variance_on_its_clock():
    """With vol regimes the share of the last step's variance before the expiry is the path's own. On one vol the
    last date's expected value is the price, as for a currency pair. With the regimes it is below it for an option at
    the money, the stated bias of marking an option at one vol on paths whose variance is uncertain (methodology,
    volatility regimes: 3.6 % at one month): about 5.5 % at one week. Until 0.64.0 the last step's error, some 7 % the
    other way at one week, hid it."""
    def last_against_price(regimes):
        nz: dict = {}
        V, p0, v0 = fx_xva.simulate_option_paths(_opt(7 / 365, 8 / 365, pair="BTCUSD", vol=0.60, regimes=regimes), n_paths=100_000, seed=6, noise_out=nz)
        last = V.shape[1] - 1
        se = float(V[:, last].std()) / math.sqrt(V.shape[0]) * p0[last + 1] / v0
        return float(V[:, last].mean()) * p0[last + 1] / v0 - 1.0, se, nz
    gap, se, nz = last_against_price(False)
    assert nz["clock"] is None and gap == pytest.approx(0.0, abs=3.5 * se)
    gap, se, nz = last_against_price(True)
    assert nz["clock"] is not None and np.ptp(nz["om_exp"]) > 0.01 and (nz["om_exp"] > 0).all() and (nz["om_exp"] < 1).all()
    assert -0.09 < gap < -0.025, "the regimes' stated bias at one week, no longer hidden by the last step"


def test_every_leg_of_a_package_reads_one_path_a_margin_period_earlier():
    """A call deep in the money against a forward sold to the same settlement is a hedge: a margin period before the
    last date the two legs' values move together, whatever the level. The option's level there is the run's own
    (drawn given the level at its expiry), not one of its own beside the forward's: with a level of its own the
    hedge's value a margin period earlier scattered by a fifth of a leg's (the reviewer's run, 23 November 2026)."""
    from pricing.csa import CSA
    t_e, t_s = 0.25 - 4 / 365, 0.25
    call = _opt(t_e, t_s, spec=ExoticSpec("EUROPEAN", "CALL", strike=0.80))
    fwd = fx_xva.ForwardXvaInput(pair="EURUSD", base_notional=N, forward=F0, strike=F0, t_years=t_s, df_quote_t=math.exp(-RQ * t_s), quote_zero=RQ,
                                 direction="SELL", vol_pct=VOL * 100, spot=S0)
    nz: dict = {}
    V, _, _, rows = fx_xva.simulate_package_paths([call, fwd], n_paths=5000, noise_out=nz, keep_leg_paths=True)
    steps, dt = nz["steps"], nz["dt"]
    one_leg = float(rows[1]["paths"][:, -2].std())
    for lag_y in (0.012, 0.016):                                 # shorter than a step, longer than the four days from expiry to settlement
        assert lag_y < dt and t_s - lag_y < t_e
        lagged = nz["lag"](lag_y, np.random.default_rng(43))
        assert float(lagged[:, -1].std()) < 2e-3 * one_leg, lag_y
        assert float(lagged[:, steps // 2].std()) < 2e-3 * one_leg
    # a margin period shorter than the days from expiry to settlement lands after the expiry: the option's amount is
    # fixed there and the forward still moves, by the level's move since the expiry and no more
    after = nz["lag"](0.008, np.random.default_rng(43))
    assert t_s - 0.008 > t_e and float(after[:, -1].std()) == pytest.approx(N * F0 * VOL * math.sqrt(t_s - 0.008 - t_e), rel=0.1)
    wf, _ = fx_xva.package_xva([call, fwd], CSA.from_request({"preset": "BILATERAL"}), n_paths=2000)
    alone, _ = fx_xva.option_xva(call, CSA.from_request({"preset": "BILATERAL"}), n_paths=2000)
    assert abs(wf.mva) < 0.05 * abs(alone.mva), "a hedge calls almost no margin; the option alone calls its own"


def test_two_expiries_are_two_points_of_one_path():
    """Two options of a package that expire in the same step read two points of one path, the later one drawn given
    the earlier; in different steps their draws are independent. Checked on the levels themselves."""
    n, steps, dt = 200_000, 4, 0.25
    rng = np.random.default_rng(1)
    m = np.exp(np.cumsum(-0.5 * VOL * VOL * dt + VOL * math.sqrt(dt) * rng.standard_normal((n, steps)), axis=1))
    lv = fx_xva.interior_levels([0.85, 0.95, 0.40], steps, dt, m, np.full(steps, VOL), VOL, None, 42)
    a, b, c = (np.log(lv["at"][t]["m"]) for t in (0.85, 0.95, 0.40))
    assert sorted(lv["steps"]) == [1, 3] and [p[0] for p in lv["steps"][3]] == [0.85, 0.95]
    for x, t in ((a, 0.85), (b, 0.95), (c, 0.40)):
        assert float(np.var(x)) == pytest.approx(VOL * VOL * t, rel=0.02) and float(np.exp(x).mean()) == pytest.approx(1.0, abs=5e-4)
    lo = np.log(m[:, 2])
    assert float(np.cov(a - lo, b - lo)[0, 1]) == pytest.approx(VOL * VOL * (0.85 - 0.75), rel=0.03), "Cov of two points of one Brownian path: the variance to the earlier"
    assert float(np.cov(b - lo, np.log(m[:, 3]) - lo)[0, 1]) == pytest.approx(VOL * VOL * (0.95 - 0.75), rel=0.03)
    assert abs(float(np.corrcoef(lv["at"][0.85]["xi"], lv["at"][0.40]["xi"])[0, 1])) < 0.01, "another step, another draw"
    # a date on a grid date, or within the hour before one, is that date's level: nothing is drawn for it
    assert fx_xva.interior_levels([0.5, 1.0, 0.25 - 1e-7], steps, dt, m, np.full(steps, VOL), VOL, None, 42)["at"] == {}


def test_a_package_carries_the_expirys_level_for_its_option_leg():
    opt = _opt(0.40, 0.411)
    fwd = fx_xva.ForwardXvaInput(pair="EURUSD", base_notional=N, forward=1.13, strike=1.13, t_years=2.0, df_quote_t=math.exp(-RQ * 2.0), quote_zero=RQ,
                                 direction="SELL", vol_pct=9.0, spot=S0)
    from pricing.csa import CSA
    for csa in (CSA.uncollateralised(), CSA.from_request({"preset": "BILATERAL"})):
        wf, _ = fx_xva.package_xva([fwd, opt], csa, n_paths=400)
        assert all(math.isfinite(v) for v in (wf.cva, wf.dva, wf.fca, wf.kva, wf.mva, wf.xva_total))
