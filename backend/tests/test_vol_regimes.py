"""A digital asset's vol regimes (pricing/vol_regimes: a fast chain and a slow one) and what they do to a ticket's
paths (pricing/fx_xva).

Three things are held here. Each chain is the chain it says it is (its long-run share, its memory, the same chain
at any step length). The regimes change the spread of outcomes and nothing else: the level is still a martingale,
the variance expected over any period is the ticket's, today's value is untouched, a currency pair is untouched
draw for draw. And the value a margin period earlier agrees with a simulation that shares no code with the engine:
the regime drawn day by day, the level stepped day by day, both dates read off the same path."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.vol_regimes import REGIMES, Chain, clock, regimes_of, share_before, step_variance
from pricing.xva_engine import IM_CONFIDENCE, model_im

Q = 0.038
BTC = REGIMES["BTC"]


def _fwd(vol_pct, t=0.5, pair="BTCUSD", regimes=True, direction="BUY"):
    f = 108465.61
    return fx_xva.ForwardXvaInput(pair=pair, base_notional=10.0, forward=f, strike=f, t_years=t, df_quote_t=math.exp(-Q * t),
                                  quote_zero=Q, direction=direction, vol_pct=vol_pct, regimes=regimes)


# ── the chains ──────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("asset", sorted(REGIMES))
def test_each_chains_two_levels_average_to_one_so_the_tickets_variance_stands(asset):
    reg = REGIMES[asset]
    for chain in (reg.fast, reg.slow):
        low, high = chain.scales
        p = chain.high_share
        assert (1 - p) * low ** 2 + p * high ** 2 == pytest.approx(1.0, abs=1e-12)
        assert high / low == pytest.approx(chain.ratio) and low < 1.0 < high
    assert reg.fast.spells[1] < 5 < 30 < reg.slow.spells[1], "the fast stress lasts days, the slow level weeks"
    d = reg.describe(60.0)
    assert d["lowest_vol_pct"] < 60.0 < d["highest_vol_pct"] and d["as_of"] == reg.as_of and d["days"] == reg.days
    assert d["fast"]["stressed_spell_days"] == pytest.approx(reg.fast.spells[1], abs=0.05) and d["slow"]["high_spell_days"] == round(reg.slow.spells[1])


@pytest.mark.parametrize("chain", [BTC.fast, BTC.slow])
def test_a_chain_over_any_length_is_the_daily_chain(chain):
    P = np.array([[chain.stay_low, 1 - chain.stay_low], [1 - chain.stay_high, chain.stay_high]])
    for days in (1, 2, 7, 30):
        Pn = np.linalg.matrix_power(P, days)
        assert chain.stay(days) == pytest.approx((Pn[0, 0], Pn[1, 1]), abs=1e-12)
    # half a day twice is a day; a very long time forgets where it started
    a, b = chain.stay(0.5)
    half = np.array([[a, 1 - a], [1 - b, b]])
    assert half @ half == pytest.approx(P, abs=1e-12)
    assert chain.stay(100_000) == pytest.approx((1 - chain.high_share, chain.high_share), abs=1e-9)


@pytest.mark.parametrize("bad", [dict(ratio=0.9, stay_low=0.8, stay_high=0.6), dict(ratio=2.0, stay_low=1.0, stay_high=0.6),
                                 dict(ratio=2.0, stay_low=0.4, stay_high=0.5), dict(ratio=2.0, stay_low=0.8, stay_high=0.0)])
def test_parameters_that_are_not_a_persistent_chain_are_refused(bad):
    with pytest.raises(ValueError):
        Chain(**bad)


def test_who_has_regimes():
    assert regimes_of("BTCUSD") is BTC and regimes_of("ethusd") is REGIMES["ETH"] and regimes_of("SOLUSD") is REGIMES["SOL"]
    assert regimes_of("EURUSD") is None and regimes_of("USDJPY") is None and regimes_of("DOGEUSD") is None


def test_the_clock_is_the_two_chains_that_were_fitted():
    n, steps, dt = 20_000, 12, 1 / 12
    ck = clock(BTC, n, steps, dt, seed=42)
    (calm, stressed), (low, high) = BTC.fast.scales, BTC.slow.scales
    assert ck.shape == (n, steps, 30) and ck.dtype == np.float32
    four = sorted((f * s) ** 2 for f in (calm, stressed) for s in (low, high))
    assert sorted(float(x) for x in np.unique(ck)) == pytest.approx(four, rel=1e-5)
    flat = ck.reshape(n, -1).astype(np.float64)
    is_ = lambda f, s: np.isclose(flat, (f * s) ** 2, rtol=1e-4)                     # noqa: E731
    for chain, state in ((BTC.fast, is_(stressed, low) | is_(stressed, high)), (BTC.slow, is_(calm, high) | is_(stressed, high))):
        assert state.mean() == pytest.approx(chain.high_share, abs=0.012), "the long-run share, from the first day"
        assert state[:, 0].mean() == pytest.approx(chain.high_share, abs=0.012)
        # a sub-step is 365/360 of a day here: the chance a state is followed by itself is the chain's over that length
        stay_low, stay_high = chain.stay(dt * 365 / 30)
        assert (state[:, 1:] & state[:, :-1]).sum() / state[:, :-1].sum() == pytest.approx(stay_high, abs=0.004)
        assert (~state[:, 1:] & ~state[:, :-1]).sum() / (~state[:, :-1]).sum() == pytest.approx(stay_low, abs=0.004)
    assert step_variance(ck).mean() == pytest.approx(1.0, abs=0.012), "the variance expected is the ticket's"
    assert np.array_equal(ck, clock(BTC, n, steps, dt, seed=42)) and not np.array_equal(ck, clock(BTC, n, steps, dt, seed=43))


def test_the_share_of_a_steps_variance_before_a_date():
    ck = np.array([[[1.0, 3.0, 1.0, 3.0]], [[2.0, 2.0, 2.0, 2.0]]], dtype=np.float32)       # two paths, one step, four sub-steps
    assert share_before(ck, 0, 0.0) == pytest.approx([0.0, 0.0])
    assert share_before(ck, 0, 1.0) == pytest.approx([1.0, 1.0])
    assert share_before(ck, 0, 0.5) == pytest.approx([0.5, 0.5])
    assert share_before(ck, 0, 0.25) == pytest.approx([1 / 8, 0.25])
    assert share_before(ck, 0, 0.375) == pytest.approx([(1 + 1.5) / 8, 0.375]), "part of a sub-step counts in proportion"


# ── what the regimes change, and what they do not ───────────────────────────────────────────────────────────

def test_the_level_is_a_martingale_with_the_tickets_variance_and_fatter_tails():
    n, steps, dt, sigma = 300_000, 6, 1 / 12, 0.51
    z, t, sv, m, ck = fx_xva._driver(n, steps, dt, 42, sigma, None, BTC)
    z0, _, _, m0, ck0 = fx_xva._driver(n, steps, dt, 42, sigma, None)
    assert ck0 is None and np.array_equal(z, z0), "the same standard normals: only the clock differs"
    for k in range(steps):
        assert float(m[:, k].mean()) == pytest.approx(1.0, abs=5e-3)
    var = (sv ** 2 * dt)[None, :] * step_variance(ck)
    assert float(var.sum(axis=1).mean()) == pytest.approx(sigma ** 2 * t[-1], rel=0.01), "the variance expected to the horizon is sigma^2 T"
    step = np.log(m[:, 1] / m[:, 0])                      # one month's log move
    step0 = np.log(m0[:, 1] / m0[:, 0])
    kurt = lambda x: float(((x - x.mean()) ** 4).mean() / x.var() ** 2 - 3.0)       # noqa: E731
    # the fast stress is over in days and a month averages it out; the slow level is not, and a month still has fat tails
    assert abs(kurt(step0)) < 0.05 and kurt(step) > 0.6, "one vol has no excess kurtosis; a month of the regimes has"
    assert np.percentile(step, 1) / np.percentile(step0, 1) > 1.08, "and a lower tail further out"


@pytest.mark.parametrize("days, tail, beyond, gaussian", [(5, -0.162, -0.199, -0.140), (10, -0.226, -0.274, -0.198), (14, -0.267, -0.319, -0.234)])
def test_the_fitted_chains_have_the_tails_the_calibration_reports(days, tail, beyond, gaussian):
    """The figures backend/scripts/calibrate_vol_regimes.py printed for BTC on 11 November 2026, which the
    methodology quotes, at the fit's own vol (51.4 %): the 1st percentile of a log move over 5, 10 and 14 days and
    the mean move beyond it, against a Gaussian's. Drawn here through the engine's clock, not the script's simulation."""
    n, sigma = 400_000, 0.514
    ck = clock(BTC, n, 1, days / 365.0, seed=7)
    var = sigma ** 2 * (days / 365.0) * step_variance(ck)[:, 0]
    x = -0.5 * var + np.sqrt(var) * np.random.default_rng(8).standard_normal(n)
    assert -2.326 * sigma * math.sqrt(days / 365.0) == pytest.approx(gaussian, abs=0.0015)
    assert float(np.percentile(x, 1)) == pytest.approx(tail, abs=0.005)
    assert float(x[x <= np.percentile(x, 1)].mean()) == pytest.approx(beyond, abs=0.007)


def test_todays_value_and_a_currency_pair_are_untouched():
    on, off = {}, {}
    p_on, _, v_on = fx_xva.simulate_paths(_fwd(55), n_paths=4000, seed=42, noise_out=on)
    p_off, _, v_off = fx_xva.simulate_paths(_fwd(55, regimes=False), n_paths=4000, seed=42, noise_out=off)
    assert v_on == v_off and on["clock"] is not None and off["clock"] is None
    assert np.array_equal(on["z"], off["z"]) and not np.allclose(p_on, p_off)
    eur_on, eur_off = {}, {}
    a, _, _ = fx_xva.simulate_paths(_fwd(8, pair="EURUSD"), n_paths=4000, seed=42, noise_out=eur_on)
    b, _, _ = fx_xva.simulate_paths(_fwd(8, pair="EURUSD", regimes=False), n_paths=4000, seed=42, noise_out=eur_off)
    assert np.array_equal(a, b) and eur_on["clock"] is None, "a currency pair has one vol, with or without the switch"
    rng = np.random.default_rng(43)
    assert np.array_equal(eur_on["lag"](10 / 250, rng), eur_off["lag"](10 / 250, np.random.default_rng(43)))


def test_a_run_says_what_its_regimes_are():
    from pricing.csa import CSA
    wf, meta = fx_xva.forward_xva(_fwd(55), CSA.from_request({"preset": "BILATERAL"}), n_paths=500)
    r = meta["vol_regimes"]
    assert r["lowest_vol_pct"] < 55 < r["highest_vol_pct"] and r["as_of"] == BTC.as_of and "regimes" in meta["model"]
    _, off = fx_xva.forward_xva(_fwd(55, regimes=False), CSA.from_request({"preset": "BILATERAL"}), n_paths=500)
    assert off["vol_regimes"] is None and "regimes" not in off["model"]
    _, eur = fx_xva.forward_xva(_fwd(8, pair="EURUSD"), CSA.from_request({"preset": "BILATERAL"}), n_paths=500)
    assert eur["vol_regimes"] is None


# ── the value a margin period earlier, against a simulation day by day ──────────────────────────────────────

def _day_by_day(reg, sigma, days_to, days_lag, n, seed):
    """The level at day (days_to − days_lag) and at day days_to, with both regimes redrawn every day: written here
    from the model's definition, sharing nothing with pricing/vol_regimes' clock or the engine's grid and bridge."""
    rng = np.random.default_rng(seed)
    ln, at_lag = np.zeros(n), None
    chains = []
    for c in (reg.fast, reg.slow):
        p = (1 - c.stay_low) / (2 - c.stay_low - c.stay_high)
        low = 1 / math.sqrt(1 - p + p * c.ratio ** 2)
        chains.append([c, np.array([low, low * c.ratio]), rng.random(n) < p])
    for day in range(1, days_to + 1):
        sd = np.full(n, sigma / math.sqrt(365.0))                      # a day's vol: the ticket's, times each chain's level
        for item in chains:
            c, levels, state = item
            u = rng.random(n)
            item[2] = state = np.where(state, u < c.stay_high, u >= c.stay_low)
            sd = sd * levels[state.astype(int)]
        ln += -0.5 * sd * sd + sd * rng.standard_normal(n)
        if day == days_to - days_lag:
            at_lag = ln.copy()
    return np.exp(at_lag if at_lag is not None else np.zeros(n)), np.exp(ln)


def _pct(move):
    move = move - move.mean()
    return max(np.percentile(move, IM_CONFIDENCE), 0.0), max(np.percentile(-move, IM_CONFIDENCE), 0.0)


@pytest.mark.parametrize("asset, vol_pct, lag_days", [("BTC", 55, 14), ("BTC", 80, 14), ("ETH", 70, 7), ("SOL", 95, 14)])
def test_the_margin_estimate_with_regimes_agrees_with_a_simulation_day_by_day(asset, vol_pct, lag_days):
    """A year of 360 days in twelve steps of 30, so that every grid date and every date a margin period before it
    is a whole day on both sides (the engine's sub-step is 365/360 of a day: the chain is stepped that much
    longer, which is inside the tolerance)."""
    t_years, n, lag = 360 / 365.0 / 2, 200_000, lag_days / 365.0
    inp = _fwd(vol_pct, t=t_years, pair=f"{asset}USD")
    noise = {}
    paths, _, v0 = fx_xva.simulate_paths(inp, n_paths=n, seed=42, noise_out=noise)
    assert noise["steps"] == 6 and noise["dt"] * 365 == pytest.approx(30.0)
    call, post = model_im(paths, noise["lag"](lag, np.random.default_rng(43)))
    one_vol = {}
    p1, _, _ = fx_xva.simulate_paths(_fwd(vol_pct, t=t_years, pair=f"{asset}USD", regimes=False), n_paths=n, seed=42, noise_out=one_vol)
    call1, _ = model_im(p1, one_vol["lag"](lag, np.random.default_rng(43)))
    v = lambda m, day: inp.base_notional * (inp.forward * m - inp.strike) * math.exp(-Q * (t_years - day / 365.0))      # noqa: E731
    raised = []
    for i in range(noise["steps"]):
        day = 30 * (i + 1)
        m_lag, m_t = _day_by_day(REGIMES[asset], vol_pct / 100.0, day, lag_days, n, seed=3000 + i)
        ref_call, ref_post = _pct(v(m_t, day) - v(m_lag, day - lag_days))
        # a 99th percentile of a fat-tailed move on 200,000 paths each side: known to about 1.5 %; 5 % is three of those
        assert call[i] == pytest.approx(ref_call, rel=0.05), f"the margin we call at step {i + 1}"
        assert post[i] == pytest.approx(ref_post, rel=0.05), f"the margin we post at step {i + 1}"
        raised.append(call[i] / call1[i])
    # what the regimes add to the margin we call, over one vol: most at the first dates, less at each later one,
    # where the spread of the level itself has already widened the move in the quote currency
    # (on 12 November 2026: BTC at 55 % and 14 days +14 % at the first date and +6 % at the last; SOL at 95 % +9 % and
    # nothing at the last, to sampling)
    shown = [round(float(x), 3) for x in raised]
    assert raised[0] > 1.08 and min(raised) > 0.98 and np.mean(raised) > 1.03, f"the regimes raise the margin we call ({shown})"


def test_an_options_margin_estimate_with_regimes_agrees_with_a_simulation_day_by_day():
    """A bought European call, marked on each path at the surface's vol as the engine marks it (the formula written
    out here, Garman and Kohlhagen), on levels drawn day by day with both regimes. The last date is the payoff."""
    from pricing.fx_exotic import ExoticSpec

    def cdf(x):
        return 0.5 * (1.0 + np.vectorize(math.erf)(np.asarray(x) / math.sqrt(2.0)))

    def call(s, k, r_q, r_b, sigma, tau):
        d1 = (np.log(s / k) + (r_q - r_b + 0.5 * sigma ** 2) * tau) / (sigma * math.sqrt(tau))
        return s * math.exp(-r_b * tau) * cdf(d1) - k * math.exp(-r_q * tau) * cdf(d1 - sigma * math.sqrt(tau))

    t_years, n, lag_days, sigma = 360 / 365.0 / 2, 200_000, 14, 0.8
    inp = fx_xva.OptionXvaInput(pair="BTCUSD", base_notional=10.0, spot=108250.0, forward=108465.61, t_expiry=t_years, t_settle=t_years,
                                df_quote_t=math.exp(-Q * t_years), quote_zero=Q, vol=sigma, spec=ExoticSpec("EUROPEAN", "CALL", strike=110000.0), direction="BUY")
    noise = {}
    paths, _, _ = fx_xva.simulate_option_paths(inp, n_paths=n, seed=42, noise_out=noise)
    assert noise["clock"] is not None and noise["steps"] == 6
    call_im, post_im = model_im(paths, noise["lag"](lag_days / 365.0, np.random.default_rng(43)))
    r_b = noise["r_b"]

    def v(m, day):
        at = day / 365.0
        s = inp.forward * m * math.exp(-(Q - r_b) * (inp.t_settle - at))
        return inp.base_notional * call(s, inp.spec.strike, Q, r_b, sigma, inp.t_expiry - at)
    for i in range(noise["steps"] - 1):
        day = 30 * (i + 1)
        m_lag, m_t = _day_by_day(BTC, sigma, day, lag_days, n, seed=5000 + i)
        ref_call, ref_post = _pct(v(m_t, day) - v(m_lag, day - lag_days))
        assert call_im[i] == pytest.approx(ref_call, rel=0.06), f"the margin we call at step {i + 1}"
        assert post_im[i] == pytest.approx(ref_post, rel=0.06), f"the margin we post at step {i + 1}"


def test_the_lagged_level_on_the_clock_is_a_martingale_and_the_rest_of_the_step_is_its_own():
    n, steps, dt, sigma, lag = 300_000, 4, 30 / 365.0, 0.8, 14 / 365.0
    z, t, sv, m, ck = fx_xva._driver(n, steps, dt, 42, sigma, None, BTC)
    rec = np.zeros((n, steps))
    m_lag, t_lag, j_of = fx_xva._lagged_driver(m, sv, dt, lag, np.random.default_rng(43), rec, ck)
    w = 1.0 - lag / dt
    for i in range(steps):
        assert float(m_lag[:, i].mean()) == pytest.approx(1.0, abs=6e-3)
        rest = np.log(m[:, i] / m_lag[:, i])
        om = share_before(ck, i, w)
        var_rest = sigma ** 2 * dt * step_variance(ck)[:, i] * (1 - om)                # the variance the path had left in the step
        assert float(np.mean(rest / np.sqrt(var_rest) + 0.5 * np.sqrt(var_rest))) == pytest.approx(0.0, abs=0.01)
        assert float(np.var(rest / np.sqrt(var_rest))) == pytest.approx(1.0, rel=0.02), "given the clock, the rest of the step is Gaussian with the variance left"
    # the recorded normals rebuild the level: what the Excel replication does
    lnm = np.concatenate([np.zeros((n, 1)), np.log(m)], axis=1)
    om_all = np.stack([share_before(ck, i, w) for i in range(steps)], axis=1)
    rebuilt = np.exp(lnm[:, :-1] + om_all * (lnm[:, 1:] - lnm[:, :-1]) + rec * np.sqrt(sigma ** 2 * dt * step_variance(ck) * om_all * (1 - om_all)))
    assert np.allclose(m_lag, rebuilt, rtol=1e-10)
