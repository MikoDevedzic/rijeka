"""A barrier watched between the exposure grid's dates (pricing/fx_xva.knocked_by, 0.30.0), against closed forms that
watch it continuously: none of the engine's path code, no fitted number.

The chance a lognormal level reaches B before T (the reflection principle), with drift mu = r − r_b − σ²/2 in logs:
    P = N((−b + mu T) / (σ√T)) + exp(2 mu b / σ²) N((−b − mu T) / (σ√T)),   b = ln(B / S0) for a level above
and the pricer's own continuous closed form for a knock-out's value today. Until 0.30.0 a barrier was watched on the
grid's dates alone: on weekly steps 16 % of the touches were missed and a knock-out's payoff on the paths was 63 %
above its price; on monthly steps 29 % and 126 %."""
import math

import pytest

from pricing import fx_xva
from pricing.fx_exotic import ExoticSpec

S0, F, T, VOL, R = 98_000.0, 100_000.0, 0.5, 0.55, 0.04
RB = R - math.log(F / S0) / T
N = lambda x: 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _touch_probability(level: float) -> float:
    mu, b, s = R - RB - 0.5 * VOL * VOL, math.log(level / S0), VOL * math.sqrt(T)
    if b > 0:
        return N((-b + mu * T) / s) + math.exp(2 * mu * b / VOL ** 2) * N((-b - mu * T) / s)
    return N((b - mu * T) / s) + math.exp(2 * mu * b / VOL ** 2) * N((b + mu * T) / s)


def _opt(spec, **kw):
    return fx_xva.OptionXvaInput(pair="BTCUSD", base_notional=10.0, spot=S0, forward=F, t_expiry=T, t_settle=T, df_quote_t=math.exp(-R * T), quote_zero=R,
                                 vol=VOL, spec=spec, direction="BUY", spot01=5000.0, regimes=False, **kw)


def _run(spec, **kw):
    nz = {}
    V, _, v0 = fx_xva.simulate_option_paths(_opt(spec, **kw), n_paths=40000, seed=42, noise_out=nz)
    _, _, x = fx_xva._option_values(_opt(spec, **kw), nz["steps"], nz["dt"], nz["f_t"] / F, nz["step_vols"], nz["clock"], 42)
    return float(x["knocked"][:, -1].mean()), float(V[:, -1].mean()) * math.exp(-R * T), v0


@pytest.mark.parametrize("level, kind", [(130_000.0, "UP_OUT"), (80_000.0, "DOWN_OUT")])
@pytest.mark.parametrize("per_year", [None, 12])
def test_the_share_of_paths_that_touch_is_the_continuous_probability(level, kind, per_year):
    spec = ExoticSpec("BARRIER", "CALL", strike=100_000.0, barrier=level, barrier_type=kind)
    exact = _touch_probability(level)
    touched, _, _ = _run(spec, grid_per_year=per_year)
    assert touched == pytest.approx(exact, rel=0.02), (touched, exact)                 # 40,000 paths: about 0.6 % of sampling error
    dates_only, _, _ = _run(spec, grid_per_year=per_year, watch_between=False)
    assert dates_only < 0.90 * exact, "the grid's dates alone miss more than a tenth of the touches"


def test_a_knock_outs_payoff_on_the_paths_is_its_price():
    spec = ExoticSpec("BARRIER", "CALL", strike=100_000.0, barrier=130_000.0, barrier_type="UP_OUT")
    _, pv, v0 = _run(spec)
    assert pv == pytest.approx(v0, rel=0.04), (pv, v0)
    _, pv_dates, _ = _run(spec, watch_between=False)
    assert pv_dates > 1.4 * v0, "watched on weekly dates alone it paid over 40 % more than its price"


def test_a_one_touch_paid_at_expiry_is_worth_its_payout_times_the_chance_of_the_touch():
    spec = ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="ONE_TOUCH", barrier=130_000.0, pay_at_hit=False)
    touched, pv, v0 = _run(spec)
    exact = 250_000.0 * _touch_probability(130_000.0) * math.exp(-R * T)
    assert v0 == pytest.approx(exact, rel=1e-3), "the pricer's own closed form is this"
    assert pv == pytest.approx(exact, rel=0.02) and touched == pytest.approx(_touch_probability(130_000.0), rel=0.02)
