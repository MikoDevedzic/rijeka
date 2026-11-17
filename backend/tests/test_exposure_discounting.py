"""The exposure discounted on its own path (0.53.0): CVA, DVA, FCA, FBA and ColVA read E[D(t) · exposure], not
P(0, t) · E[exposure]. Found by putting one swap through ORE and this engine like for like, 17 November 2026."""
import math

import numpy as np
import pytest

from ccr import calibration as C
from ccr.simulate import account, deflator, simulate
from pricing.csa import CSA
from pricing.curve import Curve
from pricing.xva_engine import WaterfallParams, run_waterfall

from datetime import date

T, DT = 24, 1.0 / 12
P0 = [math.exp(-0.03 * k * DT) for k in range(T + 2)]
FIELDS = ("cva", "dva", "fca", "fba", "kva", "mva", "colva", "cva_unilateral", "dva_unilateral")


def _values(n=4000, seed=3):
    rng = np.random.default_rng(seed)
    return np.cumsum(rng.standard_normal((n, T)) * 40_000.0 * math.sqrt(DT), axis=1)


def _params(**kw):
    return WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.03, lgd=0.6, own_lgd=0.6, cp_cds_bp=150.0, own_cds_bp=80.0, ftp_bp=70.0, **kw)


@pytest.mark.parametrize("average", [False, True])
@pytest.mark.parametrize("margined", [False, True])
def test_a_deflator_of_ones_is_the_run_without_one(average, margined):
    """Where rates are not simulated every path's discounting is today's curve's: nothing may move."""
    paths = _values()
    csa = CSA.bilateral() if margined else CSA.uncollateralised()
    if margined:
        csa.vm_post_carry_bp, csa.vm_recv_carry_bp = 25.0, -10.0
    a = run_waterfall(paths, 0.0, P0, _params(), csa, np.random.default_rng(9), average_exposure=average)
    b = run_waterfall(paths, 0.0, P0, _params(), csa, np.random.default_rng(9), average_exposure=average, deflator=np.ones_like(paths))
    for f in FIELDS:
        assert getattr(b, f) == pytest.approx(getattr(a, f), rel=1e-12, abs=1e-9), f
    assert a.ee == b.ee and a.pfe == b.pfe
    assert b.discounted_on_path and not a.discounted_on_path


def test_the_unilateral_charges_by_hand():
    """CVA = −LGD · Σ E[w_i · V⁺_i] · (default probability in step i) · P(0, t_i), and DVA with what we owe: written
    here from the paths, not through the engine's exposure arrays."""
    paths = _values(seed=5)
    rng = np.random.default_rng(8)
    w = np.exp(0.15 * rng.standard_normal(paths.shape) - 0.5 * 0.15 ** 2 - 2e-6 * paths)     # tied to the value: a weight that matters
    wf = run_waterfall(paths, 0.0, P0, _params(), CSA.uncollateralised(), deflator=w)
    q = lambda bp, k: math.exp(-(bp / 1e4 / 0.6) * k * DT)
    cva = -sum(0.6 * float(np.mean(np.maximum(paths[:, i], 0.0) * w[:, i])) * (q(150.0, i) - q(150.0, i + 1)) * P0[i + 1] for i in range(T))
    dva = sum(0.6 * float(np.mean(np.maximum(-paths[:, i], 0.0) * w[:, i])) * (q(80.0, i) - q(80.0, i + 1)) * P0[i + 1] for i in range(T))
    assert wf.cva_unilateral == pytest.approx(cva, rel=1e-10)
    assert wf.dva_unilateral == pytest.approx(dva, rel=1e-10)
    # the profiles reported are the undiscounted values at the grid dates, with or without a weight
    plain = run_waterfall(paths, 0.0, P0, _params(), CSA.uncollateralised())
    assert wf.ee == plain.ee and wf.ene == plain.ene and wf.pfe == plain.pfe
    # capital and margin read expected amounts on today's curve: untouched
    assert wf.kva == plain.kva and wf.mva == plain.mva


def test_an_averaged_step_weights_each_end_at_its_own_date():
    """The first step starts today, where the weight is one; every later start carries the weight of its date."""
    paths = _values(seed=6)
    w = np.exp(-3e-6 * paths)
    wf = run_waterfall(paths, 0.0, P0, _params(), CSA.uncollateralised(), deflator=w, average_exposure=True)
    q = lambda bp, k: math.exp(-(bp / 1e4 / 0.6) * k * DT)
    pos = np.maximum(paths, 0.0)
    start = np.column_stack((np.zeros(len(paths)), pos[:, :-1] * w[:, :-1]))
    cva = -sum(0.6 * float(np.mean(0.5 * (start[:, i] + pos[:, i] * w[:, i]))) * (q(150.0, i) - q(150.0, i + 1)) * P0[i + 1] for i in range(T))
    assert wf.cva_unilateral == pytest.approx(cva, rel=1e-10)


def test_a_deflator_of_another_shape_is_refused():
    paths = _values(n=50)
    with pytest.raises(ValueError, match="deflator"):
        run_waterfall(paths, 0.0, P0, _params(), CSA.uncollateralised(), deflator=np.ones((50, T + 1)))


def _hw_paths(n=20_000, months=60):
    asof = date(2026, 11, 17)
    key = "RATES:USD_SOFR"
    curve = Curve(valuation_date=asof, df_pillars=[(asof, 1.0)] + [(date(asof.year + y, asof.month, asof.day), math.exp(-0.035 * y)) for y in range(1, 9)])
    cal = C.Calibration("RISK_NEUTRAL", {key: C.Factor(key, "RATES", a=0.03, sigma=0.0085)}, np.eye(1), [key], drift_mode="forward")
    return simulate(cal, {key: curve}, {}, {}, asof, months, n_paths=n, seed=17), key


def test_the_deflator_is_the_accounts_and_averages_to_one():
    p, key = _hw_paths()
    w = deflator(p, key)
    A = account(p, key)
    assert w.shape == (p.n_paths, len(p.t) - 1)
    for i in (1, 12, 36, 60):
        assert w[0, i - 1] == pytest.approx(1.0 / (A[0, i] * p.p0[key](float(p.t[i]))), rel=1e-12)
        se = float(w[:, i - 1].std()) / math.sqrt(p.n_paths)
        assert abs(float(w[:, i - 1].mean()) - 1.0) < 4 * se + 1e-9, (i, float(w[:, i - 1].mean()), se)


def test_a_receiver_is_owed_more_and_owes_less_on_the_path_and_a_payer_the_reverse():
    """The direction, on the engine's own Hull-White paths: a value that rises when rates fall is owed where the
    discounting is lightest."""
    p, key = _hw_paths()
    w = deflator(p, key)
    months = len(p.t) - 1
    left = np.array([max(months - i, 0) / 12.0 for i in range(1, months + 1)])           # years still to run
    x = p.x[key][:, 1:]
    receiver = -1e7 * left[None, :] * x                                                   # worth more when rates are below the curve
    dt = float(p.t[-1]) / months
    p0 = [float(p.p0[key](float(t))) for t in p.t] + [float(p.p0[key](float(p.t[-1]) + dt))]
    P = WaterfallParams(notional=1e7, maturity_y=months * dt, dt=dt, theta=0.035, lgd=0.6, own_lgd=0.6, cp_cds_bp=150.0, own_cds_bp=80.0, ftp_bp=120.0)   # a funding basis of 40 bp, so there is a benefit to read
    for sign in (1.0, -1.0):
        on = run_waterfall(sign * receiver, 0.0, p0, P, CSA.uncollateralised(), deflator=w)
        off = run_waterfall(sign * receiver, 0.0, p0, P, CSA.uncollateralised())
        more_owed = abs(on.cva_unilateral) > abs(off.cva_unilateral) * 1.01
        less_owing = abs(on.dva_unilateral) < abs(off.dva_unilateral) * 0.99
        assert (more_owed and less_owing) if sign > 0 else (not more_owed and not less_owing), (sign, on.cva_unilateral, off.cva_unilateral, on.dva_unilateral, off.dva_unilateral)
        # the funding legs read the same exposures
        assert (abs(on.fca) > abs(off.fca)) == (sign > 0) and (abs(on.fba) < abs(off.fba)) == (sign > 0)
