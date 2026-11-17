"""The funding adjustment of the waterfall (pricing/xva_engine.py, 0.49.0): the cost on the whole funding spread, the
benefit on the funding basis alone so that it does not repeat DVA, both only while the two parties survive, and every
adjustment reported with the sign it was accumulated with."""
import math

import numpy as np
import pytest

from pricing.csa import CSA
from pricing.xva_engine import WaterfallParams, run_waterfall

T, DT = 12, 1.0 / 12
P0 = [math.exp(-0.035 * k * DT) for k in range(T + 2)]


def _paths(seed=7, n=4000, scale=60_000.0, drift=0.0):
    rng = np.random.default_rng(seed)
    return drift + np.cumsum(rng.standard_normal((n, T)) * scale * math.sqrt(DT), axis=1)


def _run(paths, **kw):
    P = WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.035, **kw)
    return P, run_waterfall(paths, 0.0, P0, P, CSA.uncollateralised())


def _by_hand(paths, P):
    """FCA and FBA from the profiles alone, written without the engine."""
    ee, ene = np.maximum(paths, 0).mean(axis=0), np.minimum(paths, 0).mean(axis=0)
    q = lambda bp, lgd, k: math.exp(-(bp / 1e4 / lgd) * k * DT)
    fca = fba = 0.0
    for i in range(T):
        alive = 0.5 * (q(P.cp_cds_bp, P.lgd, i) * q(P.own_cds_bp, P.own_lgd, i) + q(P.cp_cds_bp, P.lgd, i + 1) * q(P.own_cds_bp, P.own_lgd, i + 1))
        fca -= P.ftp_bp / 1e4 * ee[i] * alive * DT * P0[i + 1]
        fba += max(P.ftp_bp - P.own_cds_bp, 0.0) / 1e4 * (-ene[i]) * alive * DT * P0[i + 1]
    return fca, fba


def test_the_benefit_is_on_the_funding_basis_and_the_cost_on_the_whole_spread():
    paths = _paths()
    P, wf = _run(paths, ftp_bp=55.0, own_cds_bp=42.0)
    fca, fba = _by_hand(paths, P)
    assert wf.fca == pytest.approx(fca, rel=1e-12) and wf.fba == pytest.approx(fba, rel=1e-12)
    assert wf.fca < 0 < wf.fba
    # a symmetric book: the cost is on 55 bp, the benefit on 13 bp, so the benefit is 13/55 of the cost in size
    sym = np.concatenate((paths, -paths))
    P2, w2 = _run(sym, ftp_bp=55.0, own_cds_bp=42.0)
    assert w2.fba / -w2.fca == pytest.approx(13.0 / 55.0, rel=1e-9)


def test_a_desk_that_funds_at_its_own_credit_spread_has_no_benefit_beyond_its_dva():
    paths = _paths()
    for own in (55.0, 80.0):                                # funding at, or below, the desk's credit spread
        _, wf = _run(paths, ftp_bp=55.0, own_cds_bp=own)
        assert wf.fba == 0.0 and wf.dva > 0 and wf.fca < 0
    # the benefit and DVA together are then what DVA alone was: nothing is counted twice
    _, at = _run(paths, ftp_bp=55.0, own_cds_bp=55.0)
    assert at.fba + at.dva == pytest.approx(at.dva, rel=1e-12)
    # and each basis point of funding spread above the desk's credit adds the same benefit
    _, a = _run(paths, ftp_bp=65.0, own_cds_bp=55.0)
    _, b = _run(paths, ftp_bp=75.0, own_cds_bp=55.0)
    assert b.fba == pytest.approx(2.0 * a.fba, rel=1e-9)


def test_funding_stops_when_either_party_has_defaulted():
    paths = _paths()
    _, safe = _run(paths, cp_cds_bp=1e-6, own_cds_bp=1e-6, ftp_bp=55.0)
    _, risky = _run(paths, cp_cds_bp=600.0, own_cds_bp=1e-6, ftp_bp=55.0)
    assert abs(risky.fca) < abs(safe.fca) and abs(risky.fba) < abs(safe.fba)
    # with nobody able to default the weight is one: the unweighted sum
    ee = np.maximum(paths, 0).mean(axis=0)
    assert safe.fca == pytest.approx(-55e-4 * sum(ee[i] * DT * P0[i + 1] for i in range(T)), rel=1e-6)
    # a counterparty at 600 bp over a year survives about 90 %: the cost falls by about half the year's default probability
    assert risky.fca / safe.fca == pytest.approx(1.0 - 0.5 * (1 - math.exp(-0.06 / 0.4)), abs=0.03)


def test_every_adjustment_carries_the_sign_it_was_accumulated_with():
    P, wf = _run(_paths(), ftp_bp=55.0, own_cds_bp=42.0)
    assert wf.cva < 0 and wf.fca < 0 and wf.kva < 0 and wf.kva_ccr < 0
    assert wf.dva > 0 and wf.fba > 0
    assert wf.mva == 0.0 and wf.colva == 0.0                 # no margin is exchanged here
    assert wf.fva == wf.fca + wf.fba
    assert wf.xva_total == pytest.approx(wf.cva + wf.dva + wf.fca + wf.fba + wf.kva + wf.mva + wf.colva, rel=1e-12)
    # only owed to us: no DVA and no benefit, not a small positive made of rounding
    up = np.abs(_paths()) + 1.0
    _, w = _run(up, ftp_bp=55.0, own_cds_bp=42.0)
    assert w.dva == 0.0 and w.fba == 0.0 and w.cva < 0
    # only owed by us: no CVA and no cost
    _, w = _run(-up, ftp_bp=55.0, own_cds_bp=42.0)
    assert w.cva == 0.0 and w.fca == 0.0 and w.dva > 0 and w.fba > 0


def test_a_step_in_which_a_curves_survival_would_rise_defaults_nobody():
    """A steeply inverted spread curve implies survival that rises between two dates. The step is charged nothing; the
    negative default probability is not netted against the other steps, and the total keeps its sign."""
    paths = np.abs(_paths()) + 1.0
    inverted = [{"t": 0.25, "spread_bp": 900.0}, {"t": 0.5, "spread_bp": 100.0}, {"t": 1.0, "spread_bp": 100.0}]
    P = WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.035, cp_cds_curve=inverted)
    wf = run_waterfall(paths, 0.0, P0, P, CSA.uncollateralised())
    from pricing.xva_engine import interp_spread
    ee = paths.mean(axis=0)
    q = [1.0] + [math.exp(-(interp_spread(inverted, 85.0, (i + 1) * DT) / P.lgd) * (i + 1) * DT) for i in range(T)]
    assert any(q[i + 1] > q[i] for i in range(T)), "the curve does imply a rising survival somewhere"
    by_hand = -P.lgd * sum(ee[i] * max(q[i] - q[i + 1], 0.0) * P0[i + 1] for i in range(T))
    assert wf.cva == pytest.approx(by_hand, rel=1e-12) and wf.cva < 0
