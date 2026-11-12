"""The record of touches on an option's exposure paths (pricing/fx_xva.knocked_by): what it is on the dates alone,
that a touch is for good, that every leg of a package reads the same touches, and a corridor's two sides."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.fx_exotic import ExoticSpec, knocked_so_far

S0, F, T, VOL, R = 98_000.0, 100_000.0, 0.5, 0.55, 0.04


def _opt(spec, **kw):
    return fx_xva.OptionXvaInput(pair="BTCUSD", base_notional=10.0, spot=S0, forward=F, t_expiry=T - 0.02, t_settle=T, df_quote_t=math.exp(-R * T), quote_zero=R,
                                 vol=VOL, spec=spec, direction="BUY", spot01=5000.0, **kw)


def _paths(spec, n=3000, **kw):
    nz = {}
    fx_xva.simulate_option_paths(_opt(spec, **kw), n_paths=n, seed=42, noise_out=nz)
    _, _, x = fx_xva._option_values(_opt(spec, **kw), nz["steps"], nz["dt"], nz["f_t"] / F, nz["step_vols"], nz["clock"], 42)
    return x, nz


@pytest.mark.parametrize("spec", [
    ExoticSpec("BARRIER", "CALL", strike=100_000.0, barrier=130_000.0, barrier_type="UP_OUT"),
    ExoticSpec("BARRIER", "PUT", strike=95_000.0, barrier=80_000.0, barrier_type="DOWN_IN"),
    ExoticSpec("DOUBLE_BARRIER", "CALL", strike=100_000.0, lower=80_000.0, upper=130_000.0, barrier_type="KNOCK_OUT"),
    ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="ONE_TOUCH", barrier=130_000.0),
    ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="DOUBLE_NO_TOUCH", lower=80_000.0, upper=130_000.0),
])
def test_on_the_dates_alone_it_is_what_it_was_and_between_them_it_only_adds_touches(spec):
    x_dates, _ = _paths(spec, watch_between=False)
    x, _ = _paths(spec)
    s_t, i_exp = x["s_t"], x["i_exp"]
    for j in range(0, i_exp + 2):                                   # column j: by grid point j, as knocked_so_far saw the points up to it
        hist = np.concatenate([np.full((len(s_t), 1), S0), s_t[:, :j]], axis=1)
        assert np.array_equal(x_dates["knocked"][:, j], knocked_so_far(spec, hist)), j
    assert np.all(x["knocked"] >= x_dates["knocked"]), "watching between the dates never takes a touch away"
    assert x["knocked"][:, -1].mean() > x_dates["knocked"][:, -1].mean() + 0.02
    assert np.all(np.diff(x["knocked"].astype(int), axis=1) >= 0), "a touch is for good"
    assert not x["knocked"][:, 0].any(), "the level starts inside"
    assert np.array_equal(x["knocked"][:, i_exp + 1], x["knocked"][:, -1]), "watching stops at the expiry's grid date"


def test_no_barrier_no_record_and_a_level_already_beyond_is_touched_today():
    x, _ = _paths(ExoticSpec("EUROPEAN", "CALL", strike=100_000.0))
    assert not x["knocked"].any()
    x, _ = _paths(ExoticSpec("BARRIER", "CALL", strike=100_000.0, barrier=90_000.0, barrier_type="UP_OUT"))
    assert x["knocked"].all()


def test_a_knock_in_and_a_knock_out_of_the_same_terms_are_still_the_plain_option_on_every_path():
    """Every option leg of a package reads the same touches between dates; were each to draw its own, a path could be
    knocked out on one leg and not knocked in on the other, and the two would no longer add up."""
    ko = _opt(ExoticSpec("BARRIER", "CALL", strike=100_000.0, barrier=130_000.0, barrier_type="UP_OUT"))
    ki = _opt(ExoticSpec("BARRIER", "CALL", strike=100_000.0, barrier=130_000.0, barrier_type="UP_IN"))
    plain = _opt(ExoticSpec("EUROPEAN", "CALL", strike=100_000.0))
    both, _, v0_both, _ = fx_xva.simulate_package_paths([ko, ki], n_paths=2000, seed=42)
    one, _, v0_one, _ = fx_xva.simulate_package_paths([plain], n_paths=2000, seed=42)
    assert v0_both == pytest.approx(v0_one, rel=1e-9)
    assert both == pytest.approx(one, rel=1e-6, abs=0.5)


def test_with_vol_regimes_a_step_of_high_variance_is_likelier_to_have_touched():
    spec = ExoticSpec("BARRIER", "CALL", strike=100_000.0, barrier=130_000.0, barrier_type="UP_OUT")
    x, nz = _paths(spec, n=20000)
    assert nz["clock"] is not None
    x_dates, _ = _paths(spec, n=20000, watch_between=False)
    extra = x["knocked"][:, 1:] & ~x_dates["knocked"][:, 1:]               # touched only between dates
    first = extra & ~np.column_stack([np.zeros(len(extra), dtype=bool), extra[:, :-1]])
    u = nz["clock"].u
    hi = u > np.quantile(u, 0.8)
    assert first[hi[:, :first.shape[1]]].mean() > 1.5 * first[~hi[:, :first.shape[1]]].mean(), "the probability is the step's own variance"
