"""First to default (pricing/xva_engine.py, 0.50.0): CVA counts the counterparty's default only while we have not
defaulted before it, DVA our own only while the counterparty has not. Each step's default probability is weighted by
the other party's survival at the middle of the step; on a path where a party's default is linked to the market, by
its survival on that path. The sums without the weight are kept as cva_unilateral and dva_unilateral."""
import math

import numpy as np
import pytest

from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, path_survival, run_waterfall

T, DT = 60, 1.0 / 12
P0 = [math.exp(-0.035 * k * DT) for k in range(T + 2)]


def _paths(seed=11, n=3000, scale=70_000.0):
    return np.cumsum(np.random.default_rng(seed).standard_normal((n, T)) * scale * math.sqrt(DT), axis=1)


def _run(paths, wrong_way=None, **kw):
    P = WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.035, **kw)
    return P, run_waterfall(paths, 0.0, P0, P, CSA.uncollateralised(), wrong_way=wrong_way)


def test_each_default_is_weighted_by_the_others_survival_at_the_middle_of_the_step():
    paths = _paths()
    P, wf = _run(paths, cp_cds_bp=250.0, own_cds_bp=120.0)
    ee, ene = np.maximum(paths, 0).mean(axis=0), np.minimum(paths, 0).mean(axis=0)
    qc = lambda k: math.exp(-(250.0 / 1e4 / P.lgd) * k * DT)
    qo = lambda k: math.exp(-(120.0 / 1e4 / P.own_lgd) * k * DT)
    cva = -P.lgd * sum(ee[i] * (qc(i) - qc(i + 1)) * 0.5 * (qo(i) + qo(i + 1)) * P0[i + 1] for i in range(T))
    dva = P.own_lgd * sum(-ene[i] * (qo(i) - qo(i + 1)) * 0.5 * (qc(i) + qc(i + 1)) * P0[i + 1] for i in range(T))
    uni_c = -P.lgd * sum(ee[i] * (qc(i) - qc(i + 1)) * P0[i + 1] for i in range(T))
    uni_d = P.own_lgd * sum(-ene[i] * (qo(i) - qo(i + 1)) * P0[i + 1] for i in range(T))
    assert wf.cva == pytest.approx(cva, rel=1e-12) and wf.dva == pytest.approx(dva, rel=1e-12)
    assert wf.cva_unilateral == pytest.approx(uni_c, rel=1e-12) and wf.dva_unilateral == pytest.approx(uni_d, rel=1e-12)
    # the weight only ever takes away: a default that comes second is not charged
    assert wf.cva_unilateral < wf.cva < 0 < wf.dva < wf.dva_unilateral
    assert wf.cva_independent is None and wf.dva_independent is None       # no link to the market in this run


def test_a_party_that_cannot_default_leaves_the_others_charge_as_it_was():
    paths = _paths()
    _, a = _run(paths, cp_cds_bp=250.0, own_cds_bp=1e-9)
    assert a.cva == pytest.approx(a.cva_unilateral, rel=1e-9)             # we cannot default first
    _, b = _run(paths, cp_cds_bp=1e-9, own_cds_bp=120.0)
    assert b.dva == pytest.approx(b.dva_unilateral, rel=1e-9)             # nor can the counterparty


def test_the_weight_is_the_probability_of_defaulting_first_and_the_three_outcomes_sum_to_one():
    """Against the exact probability, with constant intensities: P(counterparty defaults in the step, before us) =
    Q_cp·Q_own at the step's start × λ_cp / (λ_cp + λ_own) × (1 − exp(−(λ_cp + λ_own)·Δ)). The engine's midpoint rule
    is that to second order in the step. With an exposure of one on every path, no discounting and LGD of one, CVA
    and DVA ARE the two first-to-default probabilities, and with the chance both survive they are the whole of it."""
    one = np.ones((10, T))
    for (cp, own, tol) in ((250.0, 120.0, 2e-5), (1200.0, 900.0, 5e-4), (40.0, 4000.0, 1e-3)):
        P = WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.0, cp_cds_bp=cp, own_cds_bp=own, lgd=1.0, own_lgd=1.0)
        flat = [1.0] * (T + 2)
        owed = run_waterfall(one, 1.0, flat, P, CSA.uncollateralised())
        owe = run_waterfall(-one, -1.0, flat, P, CSA.uncollateralised())
        lc, lo = cp / 1e4, own / 1e4
        both = math.exp(-(lc + lo) * T * DT)
        exact_c = lc / (lc + lo) * (1.0 - both)
        exact_o = lo / (lc + lo) * (1.0 - both)
        assert -owed.cva == pytest.approx(exact_c, rel=tol) and owe.dva == pytest.approx(exact_o, rel=tol)
        assert -owed.cva + owe.dva + both == pytest.approx(1.0, abs=tol), "one of us first, or neither"
        # without the weight the two default probabilities and joint survival sum to more than one: the overlap
        assert -owed.cva_unilateral + owe.dva_unilateral + both > 1.0


def test_dva_and_the_funding_benefit_now_carry_one_weight_and_credit_the_funding_spread_once():
    """What the weight is for. On what we owe, DVA credits our own credit spread and FBA the basis above it. Until
    0.50.0 the first was weighted by our survival alone and the second by both parties': the two together stood 4.8 to
    4.9 % above the funding spread credited once on a five-year case. With the weight they are that, to second order."""
    paths = -np.abs(_paths()) - 1.0                                       # we owe, on every path
    P, wf = _run(paths, cp_cds_bp=85.0, own_cds_bp=42.0, ftp_bp=55.0)
    ene = -paths.mean(axis=0)
    qc = lambda k: math.exp(-(85.0 / 1e4 / P.lgd) * k * DT)
    qo = lambda k: math.exp(-(42.0 / 1e4 / P.own_lgd) * k * DT)
    once = sum(55.0 / 1e4 * ene[i] * 0.5 * (qc(i) * qo(i) + qc(i + 1) * qo(i + 1)) * DT * P0[i + 1] for i in range(T))
    assert wf.dva + wf.fba == pytest.approx(once, rel=1e-4)
    assert (wf.dva_unilateral + wf.fba) / once - 1.0 == pytest.approx(0.049, abs=0.01), "what it was: a few per cent over"


def test_where_a_default_is_linked_to_the_market_the_weight_is_that_partys_survival_on_the_path():
    paths = _paths(n=4000)
    rng = np.random.default_rng(2)
    x = np.cumsum(rng.standard_normal(paths.shape) * 0.6 * math.sqrt(DT), axis=1) - 0.5 * paths / 400_000.0   # a market variable, tied to the value
    b_cp, b_ow = -1.2, 0.8
    P, wf = _run(paths, wrong_way={"x": x, "beta_cp": b_cp, "beta_own": b_ow}, cp_cds_bp=250.0, own_cds_bp=120.0)
    mkt = lambda bp, lgd: [math.exp(-(bp / 1e4 / lgd) * (k + 1) * DT) for k in range(T)]
    sc = path_survival(x, b_cp, mkt(250.0, P.lgd), DT)
    so = path_survival(x, b_ow, mkt(120.0, P.own_lgd), DT)
    pos, neg = np.maximum(paths, 0), np.minimum(paths, 0)
    cva = -P.lgd * sum(float(np.mean(pos[:, i] * (sc[:, i] - sc[:, i + 1]) * 0.5 * (so[:, i] + so[:, i + 1]))) * P0[i + 1] for i in range(T))
    dva = P.own_lgd * sum(float(np.mean(-neg[:, i] * (so[:, i] - so[:, i + 1]) * 0.5 * (sc[:, i] + sc[:, i + 1]))) * P0[i + 1] for i in range(T))
    assert wf.cva == pytest.approx(cva, rel=1e-12) and wf.dva == pytest.approx(dva, rel=1e-12)
    # the independent figures are the run without the link, weight and all
    _, plain = _run(paths, cp_cds_bp=250.0, own_cds_bp=120.0)
    assert wf.cva_independent == pytest.approx(plain.cva, rel=1e-12) and wf.dva_independent == pytest.approx(plain.dva, rel=1e-12)
    # one party linked: the other's default probability is the curve's, and the weight on it is still read on the path
    _, one = _run(paths, wrong_way={"x": x, "beta_cp": b_cp, "beta_own": 0.0}, cp_cds_bp=250.0, own_cds_bp=120.0)
    qo = lambda k: math.exp(-(120.0 / 1e4 / P.own_lgd) * k * DT)
    dva1 = P.own_lgd * sum(float(np.mean(-neg[:, i] * 0.5 * (sc[:, i] + sc[:, i + 1]))) * (qo(i) - qo(i + 1)) * P0[i + 1] for i in range(T))
    assert one.dva == pytest.approx(dva1, rel=1e-12) and one.dva_unilateral == pytest.approx(plain.dva_unilateral, rel=1e-12)


def test_the_total_is_the_sum_of_the_weighted_charges():
    paths = _paths()
    _, wf = _run(paths, cp_cds_bp=250.0, own_cds_bp=120.0)
    assert wf.xva_total == pytest.approx(wf.cva + wf.dva + wf.fca + wf.fba + wf.kva + wf.mva + wf.colva, rel=1e-15)
