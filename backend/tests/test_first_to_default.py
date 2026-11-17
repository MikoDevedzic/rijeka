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


def test_the_weight_is_the_probability_of_defaulting_first():
    """Against the exact probability, with constant intensities: P(counterparty defaults in the step, before us) =
    Q_cp·Q_own at the step's start × λ_cp / (λ_cp + λ_own) × (1 − exp(−(λ_cp + λ_own)·Δ)). The engine's midpoint rule
    is that to second order in the step. With an exposure of one on every path and no discounting, CVA / LGD_cp and
    DVA / LGD_own ARE the two first-to-default probabilities. The two loss rates differ in half the cases, so a weight
    built on the wrong party's loss rate (the intensity is spread / LGD) would not pass. Tolerances are a little above
    what was measured on 17 November 2026: 2e-7, 2e-6, 9e-5 with one party at 4,000 bp, 2e-6 and 7e-6."""
    one = np.ones((10, T))
    flat = [1.0] * (T + 2)
    for (cp, own, lgd, own_lgd, tol) in ((250.0, 120.0, 1.0, 1.0, 5e-7), (1200.0, 900.0, 1.0, 1.0, 5e-6), (40.0, 4000.0, 1.0, 1.0, 2e-4),
                                         (250.0, 120.0, 0.4, 0.7, 5e-6), (1200.0, 900.0, 0.7, 0.4, 2e-5)):
        P = WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.0, cp_cds_bp=cp, own_cds_bp=own, lgd=lgd, own_lgd=own_lgd)
        owed = run_waterfall(one, 1.0, flat, P, CSA.uncollateralised())
        owe = run_waterfall(-one, -1.0, flat, P, CSA.uncollateralised())
        lc, lo = cp / 1e4 / lgd, own / 1e4 / own_lgd
        both = math.exp(-(lc + lo) * T * DT)
        exact_c = lc / (lc + lo) * (1.0 - both)
        exact_o = lo / (lc + lo) * (1.0 - both)
        assert -owed.cva / lgd == pytest.approx(exact_c, rel=tol), (cp, own, lgd, own_lgd)
        assert owe.dva / own_lgd == pytest.approx(exact_o, rel=tol), (cp, own, lgd, own_lgd)
        # one of us first, or neither. (For the midpoint rule this sum is an identity of the algebra, so it says the
        # rule is coherent, not that it is right: the comparison with the exact probabilities above says that.)
        assert -owed.cva / lgd + owe.dva / own_lgd + both == pytest.approx(1.0, abs=1e-12)
        # without the weight the two default probabilities and joint survival sum to more than one: the overlap
        assert -owed.cva_unilateral / lgd + owe.dva_unilateral / own_lgd + both > 1.0


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
    assert wf.dva + wf.fba == pytest.approx(once, rel=2e-6)              # measured: 3.5e-7
    assert (wf.dva_unilateral + wf.fba) / once - 1.0 == pytest.approx(0.0483, abs=0.002), "what it was: 4.8 % over"


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
    # a tied party's independent figure: ITS default from the curve, the other party as it is (here, on the path)
    qc = lambda k: math.exp(-(250.0 / 1e4 / P.lgd) * k * DT)
    qo = lambda k: math.exp(-(120.0 / 1e4 / P.own_lgd) * k * DT)
    cva_i = -P.lgd * sum(float(np.mean(pos[:, i] * 0.5 * (so[:, i] + so[:, i + 1]))) * (qc(i) - qc(i + 1)) * P0[i + 1] for i in range(T))
    dva_i = P.own_lgd * sum(float(np.mean(-neg[:, i] * 0.5 * (sc[:, i] + sc[:, i + 1]))) * (qo(i) - qo(i + 1)) * P0[i + 1] for i in range(T))
    assert wf.cva_independent == pytest.approx(cva_i, rel=1e-12) and wf.dva_independent == pytest.approx(dva_i, rel=1e-12)
    # one party tied: its independent figure is the run without the link; the other party has none of its own, and
    # its charge moves only through the weight
    _, plain = _run(paths, cp_cds_bp=250.0, own_cds_bp=120.0)
    _, one = _run(paths, wrong_way={"x": x, "beta_cp": b_cp, "beta_own": 0.0}, cp_cds_bp=250.0, own_cds_bp=120.0)
    assert one.cva_independent == pytest.approx(plain.cva, rel=1e-12) and one.dva_independent is None
    dva1 = P.own_lgd * sum(float(np.mean(-neg[:, i] * 0.5 * (sc[:, i] + sc[:, i + 1]))) * (qo(i) - qo(i + 1)) * P0[i + 1] for i in range(T))
    assert one.dva == pytest.approx(dva1, rel=1e-12) and one.dva_unilateral == pytest.approx(plain.dva_unilateral, rel=1e-12)
    # and with the exposure read as the mean of each step's two ends (a currency ticket's grid), the same weight
    Pa = WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.035, cp_cds_bp=250.0, own_cds_bp=120.0)
    avg = run_waterfall(paths, 0.0, P0, Pa, CSA.uncollateralised(), wrong_way={"x": x, "beta_cp": b_cp, "beta_own": b_ow}, average_exposure=True)
    mid = 0.5 * (np.column_stack((np.zeros(len(paths)), pos[:, :-1])) + pos)
    cva_a = -P.lgd * sum(float(np.mean(mid[:, i] * (sc[:, i] - sc[:, i + 1]) * 0.5 * (so[:, i] + so[:, i + 1]))) * P0[i + 1] for i in range(T))
    assert avg.cva == pytest.approx(cva_a, rel=1e-12)


def test_under_a_link_the_weight_behaves_as_the_definition_says_it_must():
    """Properties that follow from the definition and are not the code written out again (the model validator,
    17 November 2026: the by-hand test above restates the engine's own expression)."""
    paths = _paths(n=4000)
    rng = np.random.default_rng(4)
    x = np.cumsum(rng.standard_normal(paths.shape) * 0.6 * math.sqrt(DT), axis=1)
    kw = dict(cp_cds_bp=250.0, own_cds_bp=120.0)
    _, plain = _run(paths, **kw)
    # 1. a market variable that is the same on every path ties nothing: every figure is the run without the link
    same = np.tile(x[0], (len(paths), 1))
    _, tied = _run(paths, wrong_way={"x": same, "beta_cp": -1.5, "beta_own": 0.9}, **kw)
    assert tied.cva == pytest.approx(plain.cva, rel=1e-10) and tied.dva == pytest.approx(plain.dva, rel=1e-10)
    # 2. an exposure that is the same on every path cannot be the wrong or the right way round: with ONE party tied
    #    the mean survival is the curve's, so both charges are the plain run's
    level = np.tile(paths.mean(axis=0) + 50_000.0, (len(paths), 1))
    _, p2 = _run(level, **kw)
    for betas in ({"beta_cp": -1.5, "beta_own": 0.0}, {"beta_cp": 0.0, "beta_own": 0.9}):
        _, t2 = _run(level, wrong_way={"x": x, **betas}, **kw)
        assert t2.cva == pytest.approx(p2.cva, rel=1e-9) and t2.dva == pytest.approx(p2.dva, rel=1e-9), betas
    # 3. BOTH tied to the same variable in the same direction, on that level exposure: the two defaults now come
    #    together more often than independent defaults would (both intensities are high on the same paths), so the
    #    counterparty is less often the first, and so are we: both charges are smaller than the plain run's.
    #    In opposite directions they come together less often: both are larger.
    _, same_way = _run(level, wrong_way={"x": x, "beta_cp": -1.5, "beta_own": -1.5}, **kw)
    _, opposite = _run(level, wrong_way={"x": x, "beta_cp": -1.5, "beta_own": 1.5}, **kw)
    assert abs(same_way.cva) < abs(p2.cva) < abs(opposite.cva)
    # the unweighted figures do not see any of it: a level exposure, each curve repriced on average
    assert same_way.cva_unilateral == pytest.approx(p2.cva_unilateral, rel=1e-9) and opposite.cva_unilateral == pytest.approx(p2.cva_unilateral, rel=1e-9)


def test_the_total_is_the_sum_of_the_weighted_charges():
    paths = _paths()
    _, wf = _run(paths, cp_cds_bp=250.0, own_cds_bp=120.0)
    assert wf.xva_total == pytest.approx(wf.cva + wf.dva + wf.fca + wf.fba + wf.kva + wf.mva + wf.colva, rel=1e-15)
