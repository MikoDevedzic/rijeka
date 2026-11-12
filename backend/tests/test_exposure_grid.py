"""The grid a currency or digital-asset XVA run steps on, and the charge taken on the exposure averaged across each
step (0.28.0). Until then every run stepped monthly and charged the exposure at each step's end: a one-month
digital-asset forward's CVA read 31 % above the same run on daily steps, three months 23 %."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, run_waterfall


def test_weekly_steps_to_a_year_and_monthly_beyond():
    g = fx_xva.exposure_grid
    assert [g(t)[0] for t in (1 / 12, 0.25, 0.5, 1.0)] == [5, 13, 26, 52]
    assert g(183 / 365)[0] == 27 and g(183 / 365)[1] == pytest.approx(183 / 365 / 27)       # dt is the tenor over the steps
    assert g(372 / 365)[0] == 53, "a one-year ticket with a leap day and a roll is still weekly"
    assert g(1.03)[0] == 13 and g(2.0)[0] == 24 and g(10.0)[0] == 120, "beyond a year: monthly, as before"
    assert g(0.01)[0] == 2, "at least two steps"
    assert g(0.5, 12) == (6, 0.5 / 6) and g(5.0, 52)[0] == 260, "an input can ask for its own steps a year"


def _fwd(pair="BTCUSD", t=0.5, **kw):
    f = 105_000.0 if pair == "BTCUSD" else 1.17
    base = dict(pair=pair, base_notional=10.0 if pair == "BTCUSD" else 1e7, forward=f, strike=f, t_years=t, df_quote_t=math.exp(-0.04 * t),
                quote_zero=0.04, direction="BUY", vol_pct=55.0 if pair == "BTCUSD" else 8.0, spot=f)
    return fx_xva.ForwardXvaInput(**{**base, **kw})


def test_a_ticket_runs_on_that_grid_and_an_input_can_override_it():
    for t, steps in ((1 / 12, 5), (0.25, 13), (1.0, 52), (2.0, 24)):
        wf, meta = fx_xva.forward_xva(_fwd(t=t), CSA.uncollateralised(), n_paths=300)
        assert meta["steps"] == steps and len(wf.ee) == steps and meta["dt"] == pytest.approx(t / steps)
    wf, meta = fx_xva.forward_xva(_fwd(t=0.5, grid_per_year=12), CSA.uncollateralised(), n_paths=300)
    assert meta["steps"] == 6


def _hand(paths, v0, p0, P, average):
    """CVA, DVA, FVA, FBA of uncollateralised paths by hand: flat hazard = spread / LGD, the exposure at each step's
    end or the mean of the step's two ends (the first step from today's value)."""
    ee, ene = np.maximum(paths, 0).mean(axis=0), np.minimum(paths, 0).mean(axis=0)
    if average:
        pos = 0.5 * (np.column_stack((np.full(len(paths), max(v0, 0.0)), np.maximum(paths, 0)[:, :-1])) + np.maximum(paths, 0))
        neg = 0.5 * (np.column_stack((np.full(len(paths), min(v0, 0.0)), np.minimum(paths, 0)[:, :-1])) + np.minimum(paths, 0))
        ee, ene = pos.mean(axis=0), neg.mean(axis=0)
    q = lambda bp, lgd, k: math.exp(-(bp / 1e4 / lgd) * k * P.dt)
    cva = dva = fva = fba = 0.0
    for i in range(paths.shape[1]):
        cva -= P.lgd * ee[i] * (q(P.cp_cds_bp, P.lgd, i) - q(P.cp_cds_bp, P.lgd, i + 1)) * p0[i + 1]
        dva += P.own_lgd * abs(ene[i]) * (q(P.own_cds_bp, P.own_lgd, i) - q(P.own_cds_bp, P.own_lgd, i + 1)) * p0[i + 1]
        fva -= P.ftp_bp / 1e4 * ee[i] * P.dt * p0[i + 1]
        fba += P.ftp_bp / 1e4 * P.fba_ratio * abs(ene[i]) * P.dt * p0[i + 1]
    return cva, dva, fva, fba


@pytest.mark.parametrize("v0", [0.0, 40_000.0, -25_000.0])
def test_the_averaged_charge_is_the_mean_of_each_steps_two_ends_by_hand(v0):
    rng = np.random.default_rng(5)
    T, dt = 6, 1.0 / 12
    paths = v0 + np.cumsum(rng.standard_normal((2000, T)) * 30_000.0, axis=1)
    p0 = [math.exp(-0.04 * k * dt) for k in range(T + 1)]
    P = WaterfallParams(notional=1e6, maturity_y=T * dt, dt=dt, theta=0.04)
    end = run_waterfall(paths, v0, p0, P, CSA.uncollateralised())
    avg = run_waterfall(paths, v0, p0, P, CSA.uncollateralised(), average_exposure=True)
    for wf, average in ((end, False), (avg, True)):
        cva, dva, fva, fba = _hand(paths, v0, p0, P, average)
        assert (abs(wf.cva), abs(wf.dva), abs(wf.fva), abs(wf.fba)) == pytest.approx((abs(cva), abs(dva), abs(fva), abs(fba)), rel=1e-9)
        assert wf.cva <= 0 <= wf.dva and wf.fva <= 0 <= wf.fba
    # nothing else moves with the rule: the profiles reported are the values at the grid dates, and capital and margin are as they were
    assert avg.ee == end.ee and avg.ene == end.ene and avg.pfe == end.pfe
    assert (avg.kva, avg.mva, avg.colva, avg.ead_0) == (end.kva, end.mva, end.colva, end.ead_0)
    assert avg.cva != end.cva and avg.fva != end.fva


def test_under_a_margin_agreement_todays_exposure_is_what_the_collateral_leaves():
    """A set worth 40,000 today under daily margin with no threshold: the collateral its value calls covers it, so
    the first step's average starts from nothing, not from 40,000."""
    rng = np.random.default_rng(6)
    T, dt, v0 = 6, 1.0 / 12, 40_000.0
    paths = v0 + np.cumsum(rng.standard_normal((2000, T)) * 30_000.0, axis=1)
    p0 = [math.exp(-0.04 * k * dt) for k in range(T + 1)]
    P = WaterfallParams(notional=1e6, maturity_y=T * dt, dt=dt, theta=0.04)
    csa = CSA.from_request({"preset": "ON_CHAIN"})
    end = run_waterfall(paths, v0, p0, P, csa, rng=np.random.default_rng(43))
    avg = run_waterfall(paths, v0, p0, P, csa, rng=np.random.default_rng(43), average_exposure=True)
    q = lambda k: math.exp(-(P.cp_cds_bp / 1e4 / P.lgd) * k * dt)
    ee = np.array(end.ee)
    mid = 0.5 * (np.concatenate(([0.0], ee[:-1])) + ee)
    assert avg.cva == pytest.approx(-P.lgd * sum(mid[i] * (q(i) - q(i + 1)) * p0[i + 1] for i in range(T)), rel=1e-9)
    assert abs(avg.cva) < abs(end.cva)


def test_a_step_does_not_start_with_what_was_paid_on_its_date():
    """A package leg stands at the amount it settled on its grid date and is gone after (the waterfall's `settled`).
    The step after starts from the set without it: the paid amount is exposure up to its date and not beyond."""
    T, dt, n = 4, 1.0 / 52, 50
    paths = np.tile(np.array([100.0, 100.0, 40.0, 40.0]), (n, 1))        # a leg worth 60 is paid on the second date
    settled = np.tile(np.array([0.0, 0.0, 60.0, 60.0]), (n, 1))
    p0 = [math.exp(-0.04 * k * dt) for k in range(T + 1)]
    P = WaterfallParams(notional=1e6, maturity_y=T * dt, dt=dt, theta=0.04)
    wf = run_waterfall(paths, 100.0, p0, P, CSA.uncollateralised(), average_exposure=True, settled=settled)
    q = lambda k: math.exp(-(P.cp_cds_bp / 1e4 / P.lgd) * k * dt)
    mid = [100.0, 100.0, 0.5 * ((100.0 - 60.0) + 40.0), 40.0]              # the third step starts at 40, not at 100
    assert wf.cva == pytest.approx(-P.lgd * sum(mid[i] * (q(i) - q(i + 1)) * p0[i + 1] for i in range(T)), rel=1e-12)
    assert wf.fva == pytest.approx(-P.ftp_bp / 1e4 * sum(mid[i] * dt * p0[i + 1] for i in range(T)), rel=1e-12)
    assert wf.ee == [100.0, 100.0, 40.0, 40.0]                             # the profile shown is still the value at each date
    naive = run_waterfall(paths, 100.0, p0, P, CSA.uncollateralised(), average_exposure=True)
    assert abs(naive.fva) > abs(wf.fva), "without the settlement the third step would start at 100"


@pytest.mark.parametrize("pair", ["BTCUSD", "EURUSD"])
@pytest.mark.parametrize("t", [1.0 / 12, 0.25, 1.0])
def test_the_grid_the_app_runs_agrees_with_daily_steps(pair, t):
    """Uncollateralised, the app's grid against the same trade on daily steps (the averaged charge on both). Measured
    at 20,000 paths on BTC: −2 % at one month, +1 % at three, 0 % at a year. Before 0.28.0 (monthly steps, the
    exposure at each step's end): +31 %, +23 %, +9 %."""
    app, _ = fx_xva.forward_xva(_fwd(pair, t=t), CSA.uncollateralised(), n_paths=8000)
    daily, _ = fx_xva.forward_xva(_fwd(pair, t=t, grid_per_year=365), CSA.uncollateralised(), n_paths=8000)
    for f in ("cva", "fva", "dva", "fba"):
        assert getattr(app, f) == pytest.approx(getattr(daily, f), rel=0.07), (f, getattr(app, f), getattr(daily, f))
    assert app.kva == pytest.approx(daily.kva, rel=0.10)


def test_a_margin_period_of_two_weekly_steps_is_still_the_exact_lag():
    """Ten business days are two weekly steps. The margin the engine calls and posts at every date agrees with a
    simulation that draws both dates of the margin period (the same check tests/test_fx_xva_lag.py makes on monthly
    steps, where the period lies inside one step)."""
    from tests.test_fx_xva_lag import test_the_margin_estimate_of_a_forward_agrees_with_a_simulation_that_draws_both_dates as check
    assert fx_xva.exposure_grid(0.25)[0] == 13
    check(55, 10, 0.25)
    check(80, 5, 0.25)


# ── what the monthly-pinned modules check at monthly dates, on the grid the app runs ──────────────────────────────

def test_a_fee_between_two_weekly_dates_is_exposure_until_it_is_paid():
    from tests.test_fees import Q, _fwd as fee_fwd
    csa = CSA.uncollateralised()
    base, mb = fx_xva.forward_xva(fee_fwd(), csa, n_paths=4000)
    owed, mo = fx_xva.forward_xva(fee_fwd(), csa, n_paths=4000, fees=[(0.26, 80_000.0)])       # received between week 13 (0.25) and week 14
    assert mb["steps"] == 26
    grid = np.arange(1, 27) * mb["dt"]
    before = grid < 0.26
    assert before.sum() == 13
    assert np.all(np.array(owed.ee)[before] > np.array(base.ee)[before]) and np.array(owed.ee)[~before] == pytest.approx(np.array(base.ee)[~before])
    assert abs(owed.cva) > abs(base.cva)
    assert mo["fees"]["on_grid"][:13] == pytest.approx([80_000 * math.exp(-Q * (0.26 - g)) for g in grid[:13]]) and not any(mo["fees"]["on_grid"][13:])


def test_a_leg_that_settles_between_two_weekly_dates_stands_at_the_later_one_and_is_gone_after():
    from tests.test_package_xva import _fwd as pk_fwd, _opt as pk_opt
    nz = {}
    off = pk_fwd(t=0.2, strike=1.16)                       # settles between week 10 (0.1923) and week 11 (0.2115)
    V, _, _, rows = fx_xva.simulate_package_paths([off, pk_fwd(t=1.0)], n_paths=300, keep_leg_paths=True, noise_out=nz)
    assert nz["steps"] == 52
    k = int(math.ceil(0.2 / nz["dt"] - 1e-9)) - 1
    assert k == 10
    leg = rows[0]["paths"]
    assert leg[:, k] == pytest.approx(1e7 * (1.17 * nz["m"][:, k] - 1.16)), "week 11: the settled amount, nothing left to discount"
    assert leg[:, k - 1].any() and not leg[:, k + 1:].any()
    assert nz["settled"][:, k + 1:] == pytest.approx(np.repeat(leg[:, [k]], 52 - k - 1, axis=1)) and not nz["settled"][:, :k + 1].any()
    assert V == pytest.approx(rows[0]["paths"] + rows[1]["paths"])
    # an option expiring at 0.10 and settling at 0.12, between week 6 and week 7: its payoff stands at week 7, then nothing
    opt = pk_opt("CALL", "BUY", 1.17, t=0.12)
    V, _, _, rows = fx_xva.simulate_package_paths([opt, pk_fwd(t=0.5)], n_paths=300, keep_leg_paths=True, noise_out=nz)
    k = int(math.ceil(0.12 / nz["dt"] - 1e-9)) - 1
    o = rows[0]["paths"]
    assert (o[:, k] >= 0).all() and o[:, k].any() and (o[:, k] == 0).any() and not o[:, k + 1:].any()


def test_the_size_limit_counts_the_steps_the_run_takes():
    """A package of 24 option legs at 10,000 paths took 5.6 s on monthly steps and 23.6 s on a year of weekly ones.
    The limit is on legs × paths × the run's own steps, so that package is told how many paths fit; a ticket and an
    ordinary package are not touched."""
    from fastapi import HTTPException
    from api.routes.xva import CURRENCY_RUN_MAX_WORK, _run_fits
    for legs, paths in ((1, 10000), (2, 10000), (7, 10000), (24, 3200)):
        _run_fits(legs, paths, 1.0)
    with pytest.raises(HTTPException) as e:
        _run_fits(24, 10000, 1.0)
    assert e.value.status_code == 422 and "3200 paths fit" in e.value.detail
    assert 24 * 3200 * 52 <= CURRENCY_RUN_MAX_WORK < 24 * 3300 * 52
    _run_fits(24, 10000, 1.2)          # beyond a year the steps are monthly, as before: 24 × 10,000 × 15

