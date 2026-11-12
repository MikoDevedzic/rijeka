"""The value a margin period earlier on currency and digital-asset tickets (pricing/fx_xva.exact_lag).

Collateral and initial margin read the set's value a margin period before each grid date. The waterfall's own
routine bridges between the grid values as if they were Gaussian; a forward's value is a multiple of a lognormal
level, and at a digital asset's vol the margin we would call then read 9 to 18 % low. fx_xva now draws the level
itself at that time and values every leg on it.

The reference here shares no code with it: for each grid date the level is drawn at t − δ and then again at t
(two independent steps of the same geometric Brownian motion, no grid and no bridge), the trade is valued at
both, and the 99th percentile of the move about its mean is read. The engine's estimate must agree to sampling;
the old bridge must not, at a digital asset's vol, or this change did nothing.

These tests are of the bridge itself, on one vol: the legs here turn the digital asset's vol regimes off
(regimes=False). The same agreement with the regimes on, against a simulation day by day, is tests/test_vol_regimes.py."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.csa import CSA
from pricing.fx_exotic import ExoticSpec
from pricing.xva_engine import IM_CONFIDENCE, lagged_values, model_im

pytestmark = pytest.mark.usefixtures("monthly_steps")     # monthly steps, as these figures were worked (tests/conftest.py)

Q = 0.038          # the quote currency's zero rate


def _cdf(x):
    return 0.5 * (1.0 + np.vectorize(math.erf)(np.asarray(x) / math.sqrt(2.0)))


def _call(s, k, r_q, r_b, sigma, tau):
    """A European call on a currency, written out here (Garman and Kohlhagen): the reference prices with this, not
    with the engine's own closed form."""
    d1 = (np.log(s / k) + (r_q - r_b + 0.5 * sigma ** 2) * tau) / (sigma * math.sqrt(tau))
    return s * math.exp(-r_b * tau) * _cdf(d1) - k * math.exp(-r_q * tau) * _cdf(d1 - sigma * math.sqrt(tau))


def _fwd(vol_pct, t=0.5, direction="BUY", n=10.0, f=108465.61, k=108465.61, pair="BTCUSD"):
    return fx_xva.ForwardXvaInput(pair=pair, base_notional=n, forward=f, strike=k, t_years=t, df_quote_t=math.exp(-Q * t),
                                  quote_zero=Q, direction=direction, vol_pct=vol_pct, regimes=False)


def _opt(vol, t=0.5, style="EUROPEAN", direction="BUY", strike=110000.0, **kw):
    spec = ExoticSpec(style, "CALL", strike=strike, **kw)
    return fx_xva.OptionXvaInput(pair="BTCUSD", base_notional=10.0, spot=108250.0, forward=108465.61, t_expiry=t, t_settle=t,
                                 df_quote_t=math.exp(-Q * t), quote_zero=Q, vol=vol, spec=spec, direction=direction, regimes=False)


def _two_dates(sigma, t, lag, n, seed):
    """The level at t − lag and at t, drawn as two steps: nothing in common with a grid or a bridge."""
    rng = np.random.default_rng(seed)
    a = np.exp(-0.5 * sigma ** 2 * (t - lag) + sigma * math.sqrt(t - lag) * rng.standard_normal(n))
    b = a * np.exp(-0.5 * sigma ** 2 * lag + sigma * math.sqrt(lag) * rng.standard_normal(n))
    return a, b


def _pct(move):
    move = move - move.mean()
    return max(np.percentile(move, IM_CONFIDENCE), 0.0), max(np.percentile(-move, IM_CONFIDENCE), 0.0)


@pytest.mark.parametrize("vol_pct, mpor_bd, t_years", [(8, 10, 0.5), (55, 10, 0.5), (55, 5, 0.5), (80, 10, 0.5), (110, 10, 0.5),
                                                       (80, 25, 0.3)])      # the last: a margin period of 1.33 steps
def test_the_margin_estimate_of_a_forward_agrees_with_a_simulation_that_draws_both_dates(vol_pct, mpor_bd, t_years):
    inp, n, lag = _fwd(vol_pct, t=t_years), 200_000, mpor_bd / 250.0
    noise = {}
    paths, _, v0 = fx_xva.simulate_paths(inp, n_paths=n, seed=42, noise_out=noise)
    call, post = model_im(paths, noise["lag"](lag, np.random.default_rng(43)))
    old_call, _ = model_im(paths, lagged_values(paths, v0, noise["dt"], lag, np.random.default_rng(43)))
    sigma, T = vol_pct / 100.0, inp.t_years
    worst_old = 1.0
    for i in range(noise["steps"]):
        t = (i + 1) * noise["dt"]
        v = lambda m, at: inp.base_notional * (inp.forward * m - inp.strike) * math.exp(-Q * (T - at))
        if t - lag <= 0:                            # the margin period reaches back before today: the value then is today's
            m_t = np.exp(-0.5 * sigma ** 2 * t + sigma * math.sqrt(t) * np.random.default_rng(1000 + i).standard_normal(n))
            ref_call, ref_post = _pct(v(m_t, t) - v(1.0, 0.0))
        else:
            m_lag, m_t = _two_dates(sigma, t, lag, n, seed=1000 + i)
            ref_call, ref_post = _pct(v(m_t, t) - v(m_lag, t - lag))
        # 200,000 paths each side: a 99th percentile is known to about 1 % here (over eight seeds the two agree to
        # 0.1 % on average and differ by 1.3 % at one standard deviation at 110 % vol), so 4 % is three of those
        assert call[i] == pytest.approx(ref_call, rel=0.04), f"the margin we call at step {i + 1}"
        assert post[i] == pytest.approx(ref_post, rel=0.04), f"the margin we post at step {i + 1}"
        worst_old = min(worst_old, old_call[i] / ref_call)
    if vol_pct >= 55 and t_years == 0.5:
        assert worst_old < 0.92, "at a digital asset's vol the bridge between values reads the margin we call low: the reason for this change"
    elif vol_pct < 55:
        assert worst_old > 0.97, "at a currency's vol the two were always close"


def test_the_margin_estimate_of_an_option_agrees_with_a_simulation_that_draws_both_dates():
    inp, n, lag, sigma = _opt(0.8), 200_000, 10 / 250.0, 0.8
    noise = {}
    paths, _, _ = fx_xva.simulate_option_paths(inp, n_paths=n, seed=42, noise_out=noise)
    call, post = model_im(paths, noise["lag"](lag, np.random.default_rng(43)))
    r_b = noise["r_b"]

    def v(m, at):                                   # the formula written out above, on a level drawn another way
        s = inp.forward * m * math.exp(-(Q - r_b) * (inp.t_settle - at))
        return inp.base_notional * _call(s, inp.spec.strike, Q, r_b, sigma, inp.t_expiry - at)
    for i in range(noise["steps"] - 1):             # the last date is the payoff: its own test below
        t = (i + 1) * noise["dt"]
        m_lag, m_t = _two_dates(sigma, t, lag, n, seed=2000 + i)
        ref_call, ref_post = _pct(v(m_t, t) - v(m_lag, t - lag))
        assert call[i] == pytest.approx(ref_call, rel=0.05), f"the margin we call at step {i + 1}"
        assert post[i] == pytest.approx(ref_post, rel=0.05), f"the margin we post at step {i + 1}"


def test_at_expiry_the_move_is_the_payoff_less_the_value_a_margin_period_before_it():
    inp, n, lag = _opt(0.8), 50_000, 10 / 250.0
    noise = {}
    paths, _, _ = fx_xva.simulate_option_paths(inp, n_paths=n, seed=42, noise_out=noise)
    v_lag = noise["lag"](lag, np.random.default_rng(43))
    last = noise["steps"] - 1
    assert np.all(paths[:, last] >= 0) and np.all(v_lag[:, last] > 0), "a bought call: a payoff, and before it a value with time left"
    # with ten days left the value is the discounted expected payoff: on average the move is nothing
    assert abs(float(np.mean(paths[:, last] - v_lag[:, last]))) < 0.03 * float(np.mean(paths[:, last]))


def test_a_margin_period_of_a_whole_step_reads_the_grid_and_draws_nothing():
    inp = _fwd(55)
    noise = {}
    paths, _, v0 = fx_xva.simulate_paths(inp, n_paths=500, noise_out=noise)
    rng = np.random.default_rng(5)
    v_lag = noise["lag"](noise["dt"], rng)
    assert np.array_equal(v_lag[:, 1:], paths[:, :-1]) and np.all(v_lag[:, 0] == v0)
    assert rng.standard_normal() == np.random.default_rng(5).standard_normal(), "nothing was drawn"
    assert np.array_equal(noise["lag"](0.0, rng), paths), "no margin period: the value itself"


def test_before_today_the_value_is_todays():
    inp = _fwd(55, t=0.05)                          # two steps of 0.025 years; ten business days are 0.04
    noise = {}
    paths, _, v0 = fx_xva.simulate_paths(inp, n_paths=300, noise_out=noise)
    v_lag = noise["lag"](10 / 250.0, np.random.default_rng(1))
    assert np.all(v_lag[:, 0] == v0), "0.025 − 0.04 is before today"
    assert np.std(v_lag[:, 1]) > 0, "0.05 − 0.04 is inside the first step"


def test_the_lagged_level_has_the_bridges_mean_and_variance_and_the_draws_are_the_ones_recorded():
    n, steps, dt, sigma, lag = 400_000, 6, 1 / 12, 0.8, 10 / 250.0
    z, t, sv, m, _ = fx_xva._driver(n, steps, dt, 42, sigma, None)
    rec = np.zeros((n, steps))
    m_lag, t_lag, j_of = fx_xva._lagged_driver(m, sv, dt, lag, np.random.default_rng(43), rec)
    assert list(j_of) == [1, 2, 3, 4, 5, 6] and t_lag == pytest.approx(t - lag)
    for i in range(steps):
        # unconditionally ln M(t − δ) is N(−σ²(t−δ)/2, σ²(t−δ)), and M is a martingale
        assert float(np.mean(m_lag[:, i])) == pytest.approx(1.0, abs=4e-3)
        assert float(np.var(np.log(m_lag[:, i]))) == pytest.approx(sigma ** 2 * t_lag[i], rel=0.01)
        # and the step from there to the grid date is the rest of the step, independent of where it started
        step = np.log(m[:, i] / m_lag[:, i])
        assert float(np.var(step)) == pytest.approx(sigma ** 2 * lag, rel=0.01)
        assert abs(float(np.corrcoef(step, np.log(m_lag[:, i]))[0, 1])) < 0.01
    again = fx_xva._lagged_driver(m, sv, dt, lag, np.random.default_rng(43))[0]
    lnm = np.concatenate([np.zeros((n, 1)), np.log(m)], axis=1)
    w = 1.0 - lag / dt
    rebuilt = np.exp(lnm[:, :-1] + w * (lnm[:, 1:] - lnm[:, :-1]) + rec * sigma * math.sqrt(w * (1 - w) * dt))
    assert np.allclose(again, rebuilt, rtol=1e-12), "the recorded normals rebuild the level: what the Excel replication does"


@pytest.mark.parametrize("leg", [_fwd(55), _opt(0.8), _opt(0.8, style="BARRIER", barrier=140000.0, barrier_type="UP_OUT"), _opt(0.8, direction="SELL")])
def test_a_package_of_one_leg_lags_as_the_leg_does_on_its_own(leg):
    a, b = {}, {}
    (fx_xva.simulate_option_paths if fx_xva._is_option(leg) else fx_xva.simulate_paths)(leg, n_paths=400, noise_out=a)
    fx_xva.simulate_package_paths([leg], n_paths=400, noise_out=b)
    assert np.array_equal(a["lag"](10 / 250.0, np.random.default_rng(9)), b["lag"](10 / 250.0, np.random.default_rng(9)))


def test_a_package_lags_as_the_sum_of_its_legs_and_a_settled_leg_stands_at_what_it_paid():
    near, far = _fwd(55, t=0.25), _fwd(55, t=0.75, direction="SELL", k=112000.0)
    lag = 10 / 250.0
    both, one, two = {}, {}, {}
    fx_xva.simulate_package_paths([near, far], n_paths=400, noise_out=both)
    fx_xva.simulate_package_paths([near, _fwd(55, t=0.75, n=0.0)], n_paths=400, noise_out=one)      # the same grid, the far leg at no size
    fx_xva.simulate_package_paths([_fwd(55, t=0.25, n=0.0), far], n_paths=400, noise_out=two)
    v = both["lag"](lag, np.random.default_rng(9))
    assert np.allclose(v, one["lag"](lag, np.random.default_rng(9)) + two["lag"](lag, np.random.default_rng(9)), rtol=1e-12, atol=1e-6)
    v_near, _, _ = fx_xva._forward_values(near, both["steps"], both["dt"], both["m"])
    k_set = fx_xva._settle_step(np.arange(1, both["steps"] + 1) * both["dt"], near.t_years)
    alone = one["lag"](lag, np.random.default_rng(9))
    assert np.allclose(alone[:, k_set + 1:], v_near[:, [k_set]]), "from the step after it settled: the amount it paid, not a move"
    assert not np.allclose(alone[:, k_set], v_near[:, k_set]), "a margin period before its settlement it was still moving"


@pytest.mark.parametrize("preset", ["BILATERAL", "ON_CHAIN"])
def test_the_ticket_runs_on_the_exact_lag_and_the_margin_we_call_rises_at_a_digital_assets_vol(preset):
    inp, csa = _fwd(80), CSA.from_request({"preset": preset})
    noise = {}
    wf, meta = fx_xva.forward_xva(inp, csa, n_paths=20_000, noise_out=noise)
    v_lag = noise["lag"](csa.mpor_years, np.random.default_rng(43))                 # the waterfall's own generator and seed
    _, post = model_im(meta["_paths"], v_lag)
    assert wf.im_profile == pytest.approx([float(x) for x in post], rel=1e-9), "the waterfall's margin is the exact lag's"
    assert np.any(wf.bridge_noise != 0), "the draws are kept for the replication"
