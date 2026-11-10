"""Wrong-way risk in CVA and DVA (pricing/xva_engine.path_survival): the default intensity moves with the asset on
each path, h = c(t)·(asset / its forward)^b, with c(t) solved date by date so the mean survival is the credit
curve's (Hull and White, "CVA and Wrong-Way Risk", Financial Analysts Journal 68(5), 2012). Checked here against
its own definition, against a Gauss–Hermite quadrature that shares no code with the Monte Carlo, and for the
direction every desk expects. With the link off nothing moves (the other XVA tests and the replications)."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.csa import CSA
from pricing.fx_exotic import ExoticSpec
from pricing.xva_engine import hazard_beta, path_survival


def _fwd(direction="BUY", t=1.0, vol=60.0, n=10.0, F=100_000.0):
    return fx_xva.ForwardXvaInput(pair="BTCUSD", base_notional=n, forward=F, strike=F, t_years=t, df_quote_t=math.exp(-0.04 * t),
                                  quote_zero=0.04, direction=direction, vol_pct=vol, spot01=n * F * 0.01)


def test_the_desks_number_is_the_exponent():
    assert hazard_beta(1.0) == 0.0
    assert hazard_beta(2.0) == pytest.approx(-1.0) and hazard_beta(4.0) == pytest.approx(-2.0) and hazard_beta(0.5) == pytest.approx(1.0)
    # the intensity when the asset halves against its forward is k times what it is at the forward
    for k in (0.5, 1.5, 3.0):
        assert math.exp(hazard_beta(k) * math.log(0.5)) == pytest.approx(k)
    for bad in (0.0, -1.0, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            hazard_beta(bad)


def test_the_credit_curve_is_repriced_exactly_and_only_the_paths_differ():
    rng = np.random.default_rng(3)
    x = np.cumsum(rng.standard_normal((4000, 24)) * 0.6 * math.sqrt(1 / 12), axis=1)
    q_mkt = [math.exp(-0.03 * (k + 1) / 12) for k in range(24)]
    flat = path_survival(x, 0.0, q_mkt, 1 / 12)
    assert np.allclose(flat[:, 1:], np.array(q_mkt)[None, :], atol=1e-13), "no link: the market's survival on every path"
    for beta in (-2.0, -1.0, 0.7):
        q = path_survival(x, beta, q_mkt, 1 / 12)
        assert q.shape == (4000, 25) and (q[:, 0] == 1.0).all()
        assert np.allclose(q[:, 1:].mean(axis=0), q_mkt, atol=1e-12), "the mean survival is the curve's at every date"
        assert (np.diff(q, axis=1) <= 1e-15).all() and (q >= 0).all() and (q <= 1).all()
        # a path where the asset has fallen has survived less (beta < 0), and the reverse
        low, high = x[:, -1] < np.quantile(x[:, -1], 0.2), x[:, -1] > np.quantile(x[:, -1], 0.8)
        assert (q[low, -1].mean() < q[high, -1].mean()) == (beta < 0)


def test_the_solved_intensity_is_the_definitions_on_two_states():
    """Two states, half the paths each: the survivals must satisfy the definition, which is checked by substitution."""
    x = np.array([[math.log(0.5)], [math.log(2.0)]] * 500)
    beta, dt, target = hazard_beta(3.0), 0.25, 0.97
    q = path_survival(x, beta, [target], dt)
    q_dn, q_up = q[0, 1], q[1, 1]
    assert (q_dn + q_up) / 2 == pytest.approx(target, abs=1e-13)
    # h_dn / h_up = (0.5 / 2)^beta = 3 · 3 = 9: the intensity is 3× at half the forward and a third at double
    assert math.log(q_dn) / math.log(q_up) == pytest.approx(9.0, rel=1e-9)


def test_a_flat_or_rising_survival_curve_defaults_nobody_in_that_step():
    x = np.zeros((10, 3))
    q = path_survival(x - 1.0, -1.0, [0.99, 0.99, 0.98], 0.5)
    assert np.allclose(q[:, 1], 0.99) and np.allclose(q[:, 2], q[:, 1]) and np.allclose(q[:, 3].mean(), 0.98)
    assert (path_survival(x, -1.0, [0.0, 0.0, 0.0], 0.5)[:, 1:] == 0).all()


def _quadrature_cva(sign, n, F, K, r, sigma, T, steps, spread_bp, lgd, beta, order=48):
    """CVA of an uncollateralised forward with the same definition, by Gauss–Hermite quadrature over the steps'
    normals (two steps): no random numbers and none of the engine's code."""
    assert steps == 2
    dt = T / steps
    z, w = np.polynomial.hermite_e.hermegauss(order)
    w = w / math.sqrt(2 * math.pi)
    z1, z2 = np.meshgrid(z, z, indexing="ij")
    w2 = np.outer(w, w)
    x1 = -0.5 * sigma ** 2 * dt + sigma * math.sqrt(dt) * z1
    x2 = x1 - 0.5 * sigma ** 2 * dt + sigma * math.sqrt(dt) * z2
    df_T = math.exp(-r * T)
    e1 = np.maximum(sign * n * (F * np.exp(x1) - K) * df_T / math.exp(-r * dt), 0.0)
    e2 = np.maximum(sign * n * (F * np.exp(x2) - K) * df_T / math.exp(-r * 2 * dt), 0.0)
    Q = [math.exp(-(spread_bp / 1e4 / lgd) * (k + 1) * dt) for k in range(2)]

    def solve(prev, wt, target):
        lo, hi = 0.0, 1e4
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            if float((w2 * prev * np.exp(-mid * wt)).sum()) > target:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)
    wt1, wt2 = np.exp(beta * x1) * dt, np.exp(beta * x2) * dt
    q0 = np.ones_like(x1)
    q1 = q0 * np.exp(-solve(q0, wt1, Q[0]) * wt1)
    q2 = q1 * np.exp(-solve(q1, wt2, Q[1]) * wt2)
    disc = [math.exp(-r * dt), math.exp(-r * 2 * dt)]
    return -lgd * (float((w2 * e1 * (q0 - q1)).sum()) * disc[0] + float((w2 * e2 * (q1 - q2)).sum()) * disc[1])


@pytest.mark.parametrize("direction,k", [("BUY", 3.0), ("SELL", 3.0), ("SELL", 0.5), ("BUY", 1.0)])
def test_the_monte_carlo_agrees_with_a_quadrature_of_the_same_definition(direction, k):
    T = 2 / 12                        # two monthly steps: the quadrature is two-dimensional
    inp = _fwd(direction, t=T, vol=60.0)
    wf, meta = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=40000, cp_cds_bp=300.0, lgd=0.6, cp_hazard_if_halves=k)
    ref = _quadrature_cva(1.0 if direction == "BUY" else -1.0, 10.0, 100_000.0, 100_000.0, 0.04, 0.60, T, 2, 300.0, 0.6, hazard_beta(k))
    assert wf.cva == pytest.approx(ref, rel=0.02), (wf.cva, ref)      # sampling error at 40,000 paths is about 0.8 %
    if k == 1.0:
        assert meta["wwr"] is None and wf.cva_independent is None
    else:
        ind = _quadrature_cva(1.0 if direction == "BUY" else -1.0, 10.0, 100_000.0, 100_000.0, 0.04, 0.60, T, 2, 300.0, 0.6, 0.0)
        assert wf.cva_independent == pytest.approx(ind, rel=0.02)
        assert meta["wwr"]["cva_independent"] == wf.cva_independent and meta["wwr"]["cp_hazard_if_halves"] == k


def test_the_direction_is_the_one_a_desk_expects():
    """A counterparty whose credit worsens as the coin falls (k > 1): owed money when the coin has FALLEN is the
    wrong way (a sold forward, a bought put), owed when it has risen is the right way (a bought forward)."""
    csa = CSA.uncollateralised()
    sold, _ = fx_xva.forward_xva(_fwd("SELL"), csa, n_paths=4000, cp_hazard_if_halves=3.0)
    bought, _ = fx_xva.forward_xva(_fwd("BUY"), csa, n_paths=4000, cp_hazard_if_halves=3.0)
    assert sold.cva < sold.cva_independent < 0, "wrong way: the charge is larger than with independence"
    assert bought.cva_independent < bought.cva < 0, "right way: smaller"
    assert abs(sold.cva) > 1.5 * abs(sold.cva_independent), "at a crypto vol the effect is not a rounding"
    # a counterparty whose credit improves as the coin falls reverses both
    rev, _ = fx_xva.forward_xva(_fwd("SELL"), csa, n_paths=4000, cp_hazard_if_halves=0.5)
    assert rev.cva_independent < rev.cva < 0
    # a stronger link is a larger charge, monotonically
    charges = [fx_xva.forward_xva(_fwd("SELL"), csa, n_paths=4000, cp_hazard_if_halves=k)[0].cva for k in (1.0, 1.5, 2.0, 3.0, 5.0)]
    assert charges == sorted(charges, reverse=True)


def test_with_the_link_off_every_number_is_the_one_before_and_the_independent_figure_is_that_run():
    csa = CSA.from_request({"preset": "BILATERAL"})
    base, m0 = fx_xva.forward_xva(_fwd("SELL"), csa, n_paths=1500)
    one, m1 = fx_xva.forward_xva(_fwd("SELL"), csa, n_paths=1500, cp_hazard_if_halves=1.0, own_hazard_if_halves=1.0)
    for f in ("cva", "dva", "fva", "fba", "kva", "mva", "colva"):
        assert getattr(one, f) == getattr(base, f), f
    assert m0["wwr"] is None and m1["wwr"] is None
    linked, _ = fx_xva.forward_xva(_fwd("SELL"), csa, n_paths=1500, cp_hazard_if_halves=3.0)
    assert linked.cva_independent == pytest.approx(base.cva, rel=1e-12), "what it would be with independence: the run without the link"
    assert linked.dva == base.dva and linked.dva_independent is None, "our own default was left independent"
    for f in ("fva", "fba", "kva", "mva", "colva"):
        assert getattr(linked, f) == getattr(base, f), "only the credit terms move"


def test_our_own_default_can_be_linked_too_and_it_moves_dva_alone():
    csa = CSA.uncollateralised()
    base, _ = fx_xva.forward_xva(_fwd("BUY"), csa, n_paths=3000)
    own, meta = fx_xva.forward_xva(_fwd("BUY"), csa, n_paths=3000, own_hazard_if_halves=3.0)
    # we owe when the coin has fallen (a bought forward under water) and our own intensity is then higher: DVA is larger
    assert own.dva > own.dva_independent > 0 and own.dva_independent == pytest.approx(base.dva, rel=1e-12)
    assert own.cva == base.cva and own.cva_independent is None and meta["wwr"]["own_hazard_if_halves"] == 3.0


def test_options_and_packages_take_the_link():
    csa = CSA.uncollateralised()
    put = fx_xva.OptionXvaInput(pair="BTCUSD", base_notional=10.0, spot=99_000.0, forward=100_000.0, t_expiry=0.48, t_settle=0.5, df_quote_t=0.98,
                                quote_zero=0.04, vol=0.6, spec=ExoticSpec("EUROPEAN", "PUT", strike=90_000.0), direction="BUY", spot01=-3000.0)
    wf, meta = fx_xva.option_xva(put, csa, n_paths=3000, cp_hazard_if_halves=3.0)
    assert wf.cva < wf.cva_independent < 0 and meta["wwr"]["model"], "a bought put pays when the coin has fallen: the wrong way"
    call = fx_xva.OptionXvaInput(pair="BTCUSD", base_notional=10.0, spot=99_000.0, forward=100_000.0, t_expiry=0.48, t_settle=0.5, df_quote_t=0.98,
                                 quote_zero=0.04, vol=0.6, spec=ExoticSpec("EUROPEAN", "CALL", strike=110_000.0), direction="BUY", spot01=3000.0)
    wf, _ = fx_xva.option_xva(call, csa, n_paths=3000, cp_hazard_if_halves=3.0)
    assert wf.cva_independent < wf.cva <= 0, "a bought call pays when it has risen: the right way"
    legs = [_fwd("SELL", t=0.25), _fwd("SELL", t=0.5)]
    pkg, meta = fx_xva.package_xva(legs, csa, n_paths=3000, cp_hazard_if_halves=3.0)
    plain, _ = fx_xva.package_xva(legs, csa, n_paths=3000)
    assert pkg.cva < pkg.cva_independent < 0 and pkg.cva_independent == pytest.approx(plain.cva, rel=1e-12) and meta["wwr"]["cp_hazard_if_halves"] == 3.0
    one, _ = fx_xva.package_xva([_fwd("SELL", t=0.5)], csa, n_paths=1000, cp_hazard_if_halves=2.0)
    single, _ = fx_xva.forward_xva(_fwd("SELL", t=0.5), csa, n_paths=1000, cp_hazard_if_halves=2.0)
    assert one.cva == pytest.approx(single.cva, rel=1e-12), "a package of one is the trade, with the link as without"
