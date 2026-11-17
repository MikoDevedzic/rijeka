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
    """A steeply inverted spread curve implies survival that rises between two dates. Survival is held where it stood
    (as the wrong-way branch's path_survival holds it): the step is charged nothing, the next step starts from the
    held level, and the default probabilities of all the steps sum to one less the lowest survival."""
    paths = np.abs(_paths()) + 1.0
    inverted = [{"t": 0.25, "spread_bp": 900.0}, {"t": 0.5, "spread_bp": 100.0}, {"t": 1.0, "spread_bp": 100.0}]
    P = WaterfallParams(notional=1e7, maturity_y=T * DT, dt=DT, theta=0.035, cp_cds_curve=inverted)
    wf = run_waterfall(paths, 0.0, P0, P, CSA.uncollateralised())
    from pricing.xva_engine import interp_spread
    ee = paths.mean(axis=0)
    raw = [1.0] + [math.exp(-(interp_spread(inverted, 85.0, (i + 1) * DT) / P.lgd) * (i + 1) * DT) for i in range(T)]
    assert any(raw[i + 1] > raw[i] for i in range(T)), "the curve does imply a rising survival somewhere"
    held = [1.0]
    for i in range(T):
        held.append(min(raw[i + 1], held[-1]))
    by_hand = -P.lgd * sum(ee[i] * (held[i] - held[i + 1]) * P0[i + 1] for i in range(T))
    assert wf.cva == pytest.approx(by_hand, rel=1e-12) and wf.cva < 0
    assert sum(held[i] - held[i + 1] for i in range(T)) == pytest.approx(1.0 - min(raw), rel=1e-12)


SLOPED_OWN = [{"t": 1.0, "spread_bp": 38.0}, {"t": 2.0, "spread_bp": 41.0}, {"t": 3.0, "spread_bp": 44.0}, {"t": 5.0, "spread_bp": 48.0}]
SLOPED_FTP = [{"t": 1.0, "spread_bp": 42.0}, {"t": 2.0, "spread_bp": 46.0}, {"t": 3.0, "spread_bp": 50.0}, {"t": 5.0, "spread_bp": 55.0}]


def test_on_sloped_curves_dva_and_the_benefit_together_credit_the_funding_spread_once():
    """The model validator, 17 November 2026: with the own-credit curve read as a term spread DVA charges the FORWARD
    spread of each step, and a basis taken from the spot spread left DVA plus the benefit 10 to 18 % above the funding
    spread on the default curves. Both curves are now read the same way (step_spread): step by step, what DVA credits
    and what FBA credits add to the funding spread of that step."""
    from pricing.xva_engine import step_spread
    n, steps, dt = 20_000, 60, 1.0 / 12
    rng = np.random.default_rng(3)
    paths = -np.abs(np.cumsum(rng.standard_normal((n, steps)) * 80_000.0 * math.sqrt(dt), axis=1)) - 1.0     # we owe, on every path
    p0 = [math.exp(-0.035 * k * dt) for k in range(steps + 2)]
    P = WaterfallParams(notional=1e7, maturity_y=steps * dt, dt=dt, theta=0.035, cp_cds_bp=1e-9,
                        own_cds_curve=SLOPED_OWN, ftp_curve=SLOPED_FTP)
    wf = run_waterfall(paths, 0.0, p0, P, CSA.uncollateralised())
    ene = -paths.mean(axis=0)
    # by hand: the funding spread of each step on what we owe, while we are alive (the counterparty cannot default here)
    from pricing.xva_engine import interp_spread
    q = [1.0] + [math.exp(-(interp_spread(SLOPED_OWN, 42.0, (i + 1) * dt) / P.own_lgd) * (i + 1) * dt) for i in range(steps)]
    once = sum(step_spread(SLOPED_FTP, 55.0, i * dt, (i + 1) * dt) * ene[i] * 0.5 * (q[i] + q[i + 1]) * dt * p0[i + 1] for i in range(steps))
    assert wf.fba > 0 and wf.dva > 0
    assert wf.dva + wf.fba == pytest.approx(once, rel=2e-3), "the two together are the funding spread, credited once"
    # the step's own spread is the forward of the term curve: above the spot spread where the curve rises
    assert step_spread(SLOPED_OWN, 42.0, 2.0, 3.0) == pytest.approx((44.0 * 3 - 41.0 * 2) / 1e4, rel=1e-12)
    assert step_spread(None, 55.0, 2.0, 3.0) == 55.0 / 1e4 and step_spread(SLOPED_FTP, 55.0, 0.0, 1.0) == pytest.approx(42.0 / 1e4)
    # a flat curve given as a curve is the flat spread at every step
    flat = [{"t": 1.0, "spread_bp": 55.0}, {"t": 5.0, "spread_bp": 55.0}]
    assert all(step_spread(flat, 55.0, k * dt, (k + 1) * dt) == pytest.approx(55.0 / 1e4, rel=1e-12) for k in range(steps))



def test_margin_is_funded_at_the_forward_spread_of_each_step():
    """The model validator's second read, 17 November 2026: MVA took the forward reading of the funding curve with FCA
    and FBA and had no test of its own. By hand, with the forward written from the tenors' spreads and not through
    step_spread: the margin posted, at the step's funding spread less what the margin earns, floored at zero."""
    from pricing.xva_engine import interp_spread
    n, steps, dt, im = 500, 60, 1.0 / 12, 250_000.0
    paths = np.cumsum(np.random.default_rng(5).standard_normal((n, steps)) * 60_000.0 * math.sqrt(dt), axis=1)
    p0 = [math.exp(-0.035 * k * dt) for k in range(steps + 2)]

    def forward(i):                                           # the spread of step i, from the term spreads at its two ends
        t0, t1 = i * dt, (i + 1) * dt
        return (interp_spread(SLOPED_FTP, 55.0, t1) * t1 - (interp_spread(SLOPED_FTP, 55.0, t0) * t0 if t0 > 0 else 0.0)) / dt

    seen = []
    for pickup in (0.0, 20.0, 60.0):
        P = WaterfallParams(notional=1e7, maturity_y=steps * dt, dt=dt, theta=0.035, ftp_curve=SLOPED_FTP, im_amount=im)
        wf = run_waterfall(paths, 0.0, p0, P, CSA.on_chain(im_yield_pickup_bp=pickup))
        hand = -sum(im * max(forward(i) - pickup / 1e4, 0.0) * dt * p0[i + 1] for i in range(steps))
        assert wf.mva == pytest.approx(hand, rel=1e-12) and wf.mva < 0
        seen.append(wf.mva)
    assert seen[0] < seen[1] < seen[2]                        # a margin that earns more costs less to fund
    # the forward, not the tenor's spread: on a rising curve the margin costs more than the quoted spreads would say
    quoted = -sum(im * interp_spread(SLOPED_FTP, 55.0, (i + 1) * dt) * dt * p0[i + 1] for i in range(steps))
    assert seen[0] < quoted
    # a flat spread is charged as it is
    P = WaterfallParams(notional=1e7, maturity_y=steps * dt, dt=dt, theta=0.035, ftp_bp=55.0, im_amount=im)
    flat = run_waterfall(paths, 0.0, p0, P, CSA.on_chain())
    assert flat.mva == pytest.approx(-sum(im * 55.0 / 1e4 * dt * p0[i + 1] for i in range(steps)), rel=1e-12)
