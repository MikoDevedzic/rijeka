"""
pricing/xva_engine.py + pricing/csa.py

1. Uncollateralised parity: the engine reproduces the waterfall that used to
   be inlined in api/routes/xva.py (reference copy below) to machine
   precision, so the refactor changed no number.
2. CSA mechanics: collateral removes exposure, MPoR leaves a residual whose
   variance scales with sqrt(MPoR), thresholds add it back, IM scales with
   sqrt(MPoR/10), SA-CCR maturity factor switches to the margined form.
3. Ordering: EE and every VA are monotone
   uncollateralised ≥ bilateral CSA ≥ on-chain.
"""
import math

import numpy as np
import pytest

from pricing.csa import CSA
from pricing.xva_engine import (
    WaterfallParams, run_waterfall, lagged_values, collateral_held,
    interp_spread, model_im, IM_CONFIDENCE,
)


# ── Synthetic swap-like paths ────────────────────────────────────────────────

def make_paths(n_paths=4000, maturity_y=5.0, dt=1.0 / 12, notional=1e7,
               sigma_bp=80.0, seed=7, v0=0.0):
    """
    MtM paths with a swap's shape: a random walk in the rate scaled by an
    annuity that decays to zero at maturity. Gaussian increments, so the
    Brownian-bridge assumptions hold exactly.
    """
    rng = np.random.default_rng(seed)
    T = int(round(maturity_y / dt))
    r = np.zeros(n_paths)
    paths = np.zeros((n_paths, T))
    sig = sigma_bp / 1e4
    for i in range(T):
        r += sig * math.sqrt(dt) * rng.standard_normal(n_paths)
        t = (i + 1) * dt
        ann = max(maturity_y - t, 0.0) * 0.95           # rough annuity
        paths[:, i] = notional * ann * r + v0 * (ann / (maturity_y * 0.95))
    theta = 0.035
    p0 = [math.exp(-theta * k * dt) for k in range(T + 2)]
    return paths, p0, theta, T


def default_params(theta, maturity_y=5.0, dt=1.0 / 12, **kw):
    base = dict(notional=1e7, maturity_y=maturity_y, dt=dt, theta=theta)
    base.update(kw)
    return WaterfallParams(**base)


# ── Reference: the waterfall as it was inlined in the route (pre-CSA) ───────

def legacy_waterfall(paths, p0_grid, P: WaterfallParams, im_0):
    T = paths.shape[1]; DT = P.dt; N = P.notional; M0 = P.maturity_y
    SF_IR, ALPHA, CAP_R = 0.005, 1.4, 0.08
    ee  = np.mean(np.maximum(paths, 0), axis=0).tolist()
    ene = np.mean(np.minimum(paths, 0), axis=0).tolist()
    mean_v = np.mean(paths, axis=0)
    ftp_flat = P.ftp_bp / 1e4
    cva = dva = fva = fba = kva = mva = 0.0
    qcp = qow = 1.0
    for i in range(T):
        t = (i + 1) * DT; disc = p0_grid[i + 1]
        cp_s = interp_spread(P.cp_cds_curve, P.cp_cds_bp, t)
        ow_s = interp_spread(P.own_cds_curve, P.own_cds_bp, t)
        ftp_t = interp_spread(P.ftp_curve, P.ftp_bp, t) if P.ftp_curve else ftp_flat
        fba_s = ftp_t * P.fba_ratio
        nqcp = math.exp(-(cp_s / P.lgd) * t)
        nqow = math.exp(-(ow_s / P.own_lgd) * t)
        cva += P.lgd * ee[i] * (qcp - nqcp) * disc * P.wwr_multiplier
        dva -= P.own_lgd * abs(ene[i]) * (qow - nqow) * disc
        fva += ftp_t * ee[i] * DT * disc
        fba -= fba_s * abs(ene[i]) * DT * disc
        m_t = max(M0 - t + 0.5 * DT, 0.0)          # the remaining life at the middle of the step (0.27.0)
        if m_t > 0:
            sd_t = (1 - math.exp(-0.05 * m_t)) / 0.05
            mf_t = math.sqrt(min(m_t, 1.0))
            addon = SF_IR * N * sd_t * mf_t
            rc_t = max(float(mean_v[i]), 0.0)
            mult = min(1.0, 0.05 + 0.95 * math.exp(float(mean_v[i]) / (1.9 * addon))) if addon > 0 else 1.0
            ead_t = ALPHA * (rc_t + mult * addon)
            k_t = CAP_R * P.counterparty_rw * ead_t
            kva += P.hurdle_rate * k_t * DT * disc
            im_t = im_0 * (m_t / M0)
            mva -= im_t * ftp_t * DT * disc
        qcp, qow = nqcp, nqow
    return dict(cva=-abs(cva), dva=abs(dva), fva=-abs(fva), fba=abs(fba),
                kva=-abs(kva), mva=-abs(mva), ee=ee, ene=ene)


# ── 1. Parity ────────────────────────────────────────────────────────────────

class TestUncollateralisedParity:

    def test_matches_legacy_loop(self):
        paths, p0, theta, T = make_paths(v0=150_000.0)
        P = default_params(theta)
        wf  = run_waterfall(paths, 150_000.0, p0, P, CSA.uncollateralised())
        ref = legacy_waterfall(paths, p0, P, im_0=0.0)
        for k in ("cva", "dva", "fva", "fba", "kva"):
            assert getattr(wf, k) == pytest.approx(ref[k], rel=1e-12, abs=1e-9), k
        assert wf.mva == 0.0
        np.testing.assert_allclose(wf.ee,  ref["ee"],  rtol=1e-12)
        np.testing.assert_allclose(wf.ene, ref["ene"], rtol=1e-12)
        np.testing.assert_allclose(wf.ee, wf.ee_gross)
        assert all(c == 0.0 for c in wf.collateral_mean)

    def test_mva_of_a_margin_the_desk_sets_is_its_funding_cost_over_the_life(self):
        """IM without VM, the amount set by the desk and held for the life: MVA is that amount funded at the
        spread over every step of the life, the one that ends on maturity included (0.27.0: until then that step
        was not charged)."""
        paths, p0, theta, T = make_paths()
        P = default_params(theta, im_amount=250_000.0)
        csa = CSA(preset="UNCOLLATERALISED", collateralised=False, im_exchanged=True,
                  mpor_days=10.0)
        wf  = run_waterfall(paths, 0.0, p0, P, csa)
        assert wf.im_0 == 250_000.0 and set(wf.im_profile) == {250_000.0} and wf.im_received_profile == wf.im_profile
        assert "desk" in wf.im_basis
        by_hand = -sum(250_000.0 * (P.ftp_bp / 1e4) * P.dt * p0[i + 1] for i in range(T))
        assert wf.mva == pytest.approx(by_hand, rel=1e-12)
        # no margin exchanged: none charged, whatever was typed
        assert run_waterfall(paths, 0.0, p0, P, CSA.uncollateralised()).mva == 0.0

    def test_receive_direction_is_mirror(self):
        paths, p0, theta, T = make_paths()
        P = default_params(theta)
        a = run_waterfall(paths,  0.0, p0, P, CSA.uncollateralised())
        b = run_waterfall(-paths, 0.0, p0, P, CSA.uncollateralised())
        np.testing.assert_allclose(a.ee, [-x for x in b.ene], rtol=1e-12)


# ── 2. Collateral mechanics ─────────────────────────────────────────────────

class TestBrownianBridgeLag:

    def test_zero_lag_is_identity(self):
        paths, *_ = make_paths(n_paths=500)
        out = lagged_values(paths, 0.0, 1 / 12, 0.0, np.random.default_rng(1))
        np.testing.assert_array_equal(out, paths)

    def test_full_step_lag_shifts_grid(self):
        paths, *_ = make_paths(n_paths=500)
        out = lagged_values(paths, 0.0, 1 / 12, 1 / 12, np.random.default_rng(1))
        np.testing.assert_array_equal(out[:, 1:], paths[:, :-1])
        np.testing.assert_array_equal(out[:, 0], 0.0)

    @pytest.mark.parametrize("mpor_days", [2.0, 5.0, 10.0, 15.0])
    def test_margin_period_move_has_correct_variance(self, mpor_days):
        """Var[V(t) − V(t−δ)] must equal (δ/dt)·Var[ΔV] — the property linear
        interpolation fails (it gives (δ/dt)²)."""
        dt = 1 / 12
        n = 200_000
        rng = np.random.default_rng(3)
        # Pure Brownian path, 3 steps
        inc = rng.standard_normal((n, 3)) * 1000.0
        paths = np.cumsum(inc, axis=1)
        delta = mpor_days / 250.0
        out = lagged_values(paths, 0.0, dt, delta, np.random.default_rng(4))
        move = paths[:, 2] - out[:, 2]
        expected = (delta / dt) * 1000.0 ** 2
        assert np.var(move) == pytest.approx(expected, rel=0.03)
        # and the linear-interpolation answer is materially wrong
        lin_var = ((delta / dt) ** 2) * 1000.0 ** 2
        assert np.var(move) > 1.2 * lin_var


class TestCollateralHeld:

    def test_symmetric_no_threshold(self):
        v = np.array([100.0, -50.0, 0.0])
        c = collateral_held(v, CSA.bilateral())
        np.testing.assert_array_equal(c, v)

    def test_thresholds_and_mta(self):
        v = np.array([600.0, 300.0, -800.0, -100.0])
        csa = CSA.bilateral(threshold_cp=500.0, threshold_own=200.0, mta=150.0)
        c = collateral_held(v, csa)
        # 600−500 = 100 < MTA → 0 ; 300 < TH → 0 ; −(800−200) = −600 ; −100 within TH → 0
        np.testing.assert_array_equal(c, [0.0, 0.0, -600.0, 0.0])

    def test_uncollateralised_is_zero(self):
        v = np.array([1.0, -1.0])
        np.testing.assert_array_equal(collateral_held(v, CSA.uncollateralised()), 0.0)


class TestCSAEffects:

    def setup_method(self):
        self.paths, self.p0, self.theta, self.T = make_paths(v0=100_000.0)
        self.P = default_params(self.theta)

    def _run(self, csa):
        return run_waterfall(self.paths, 100_000.0, self.p0, self.P, csa,
                             rng=np.random.default_rng(11))

    def test_perfect_collateral_kills_exposure(self):
        tight = CSA(preset="X", collateralised=True, mpor_days=0.01, im_exchanged=False)
        wf = self._run(tight)
        assert sum(wf.ee) < 0.02 * sum(wf.ee_gross)
        assert abs(wf.cva) < 0.02 * abs(self._run(CSA.uncollateralised()).cva)

    def test_mpor_residual_scales_with_sqrt_mpor(self):
        """Residual EE under a longer MPoR ≈ sqrt(ratio) × residual under shorter."""
        e5  = sum(self._run(CSA(collateralised=True, mpor_days=5.0)).ee)
        e20 = sum(self._run(CSA(collateralised=True, mpor_days=20.0)).ee)
        assert e20 / e5 == pytest.approx(2.0, rel=0.15)

    def test_threshold_adds_exposure_back(self):
        no_th = self._run(CSA.bilateral(im_exchanged=False))
        th    = self._run(CSA.bilateral(threshold_cp=250_000.0, im_exchanged=False))
        assert sum(th.ee) > 1.5 * sum(no_th.ee)
        assert abs(th.cva) > abs(no_th.cva)

    def test_im_received_reduces_exposure_and_costs_mva(self):
        no_im = self._run(CSA.bilateral(im_exchanged=False))
        im    = self._run(CSA.bilateral(im_exchanged=True))
        assert sum(im.ee) < sum(no_im.ee)
        assert no_im.mva == 0.0 and im.mva < 0.0
        assert "engine's estimate" in im.im_basis and "not ISDA SIMM" in im.im_basis and no_im.im_basis == "none"

    def test_the_engines_margin_is_the_percentile_it_says_it_is(self):
        """The estimate is the 99th percentile rise (what we call) and fall (what we post) of the value over the
        margin period, about its mean, at each date: rebuilt here from the lag the engine drew."""
        csa = CSA.bilateral()
        wf = self._run(csa)
        lag = lagged_values(self.paths, 100_000.0, self.P.dt, csa.mpor_years, np.random.default_rng(11))
        move = self.paths - lag
        move = move - move.mean(axis=0)
        assert wf.im_received_profile == pytest.approx(np.percentile(move, 99.0, axis=0))
        assert wf.im_profile == pytest.approx(np.percentile(-move, 99.0, axis=0))
        assert IM_CONFIDENCE == 99.0 and wf.im_0 == wf.im_profile[0]
        # about 1 % of paths move by more than the margin at a date, each way
        over = (move > np.array(wf.im_received_profile)[None, :]).mean()
        assert 0.005 < over < 0.015

    def test_a_scheduled_move_every_path_makes_is_not_margined(self):
        """A payment or the passage of time moves every path alike: the margin is on the move about the mean."""
        lag = np.zeros((500, 3))
        jump = np.full((500, 3), 1_000_000.0)
        recv, post = model_im(jump, lag)
        assert (recv == 0).all() and (post == 0).all()
        rng = np.random.default_rng(5)
        noise = rng.standard_normal((500, 3)) * 1000.0
        r2, p2 = model_im(jump + noise, lag)
        r3, p3 = model_im(noise, lag)
        assert r2 == pytest.approx(r3) and p2 == pytest.approx(p3)

    def test_the_margin_scales_with_the_square_root_of_the_margin_period(self):
        bi = self._run(CSA.bilateral())
        oc = self._run(CSA.on_chain())
        # 5 business days against 10: a diffusion's move scales by sqrt(1/2), to the sampling of the bridge
        assert sum(oc.im_profile) / sum(bi.im_profile) == pytest.approx(math.sqrt(5 / 10), rel=0.08)

    def test_margin_only_without_variation_margin_does_not_move_any_other_number(self):
        """IM without VM draws its own lag from its own generator: the gross profiles are the run's without IM."""
        a = self._run(CSA.uncollateralised())
        b = self._run(CSA(preset="UNCOLLATERALISED", collateralised=False, im_exchanged=True, mpor_days=10.0))
        assert b.ee_gross == a.ee_gross and b.pfe == a.pfe and b.im_0 > 0 and b.mva < 0
        assert sum(b.ee) < sum(a.ee), "the margin we hold stands between us and their default"

    def test_im_yield_pickup_reduces_mva(self):
        a = self._run(CSA.on_chain(im_yield_pickup_bp=0.0))
        b = self._run(CSA.on_chain(im_yield_pickup_bp=30.0))
        assert abs(b.mva) < abs(a.mva)
        c = self._run(CSA.on_chain(im_yield_pickup_bp=55.0))   # == ftp → free IM
        assert c.mva == pytest.approx(0.0, abs=1e-6)

    def test_sa_ccr_maturity_factor(self):
        assert CSA.uncollateralised().sa_ccr_maturity_factor(4.0) == pytest.approx(1.0)
        assert CSA.uncollateralised().sa_ccr_maturity_factor(0.25) == pytest.approx(0.5)
        # CRE52.48: M is floored at ten business days (0.27.0; the mid-step reading reaches lives this short on a fine grid)
        assert CSA.uncollateralised().sa_ccr_maturity_factor(0.01) == CSA.uncollateralised().sa_ccr_maturity_factor(0.0) == pytest.approx(0.2)
        assert CSA.bilateral().sa_ccr_maturity_factor(4.0) == pytest.approx(1.5 * math.sqrt(10 / 250))
        assert CSA.on_chain().sa_ccr_maturity_factor(4.0) == pytest.approx(1.5 * math.sqrt(5 / 250))
        # bilateral floor: asking for 5bd on a bilateral CSA still gets 10bd
        assert CSA.bilateral(mpor_days=5.0).mpor_days == 10.0

    def test_kva_falls_under_margining(self):
        un = self._run(CSA.uncollateralised())
        bi = self._run(CSA.bilateral())
        oc = self._run(CSA.on_chain())
        assert abs(un.kva) > abs(bi.kva) > abs(oc.kva)
        assert bi.mf_0 == pytest.approx(0.3) and oc.mf_0 == pytest.approx(0.2121, rel=1e-3)


# ── 3. Ordering: uncollateralised ≥ bilateral ≥ on-chain ────────────────────

class TestWaterfallOrdering:

    @pytest.mark.parametrize("v0", [-200_000.0, 0.0, 200_000.0])
    def test_every_va_monotone(self, v0):
        paths, p0, theta, T = make_paths(v0=v0)
        P = default_params(theta)
        un = run_waterfall(paths, v0, p0, P, CSA.uncollateralised(), np.random.default_rng(5))
        bi = run_waterfall(paths, v0, p0, P, CSA.bilateral(),         np.random.default_rng(5))
        oc = run_waterfall(paths, v0, p0, P, CSA.on_chain(),          np.random.default_rng(5))
        assert sum(un.ee)  >= sum(bi.ee)  >= sum(oc.ee)
        assert abs(un.cva) >= abs(bi.cva) >= abs(oc.cva)
        assert abs(un.fva) >= abs(bi.fva) >= abs(oc.fva)
        assert abs(un.kva) >= abs(bi.kva) >= abs(oc.kva)
        assert abs(bi.mva) >= abs(oc.mva)                 # sqrt(5/10) IM
        # Bilateral CSA removes most of the credit risk; on-chain a bit more.
        assert abs(bi.cva) < 0.35 * abs(un.cva)
        assert abs(oc.cva) < abs(bi.cva)

    def test_on_chain_margin_is_about_29pct_lower(self):
        """Half the margin period: the estimate is lower by about 1 − sqrt(1/2), to the sampling of the bridge."""
        paths, p0, theta, T = make_paths()
        P = default_params(theta)
        bi = run_waterfall(paths, 0.0, p0, P, CSA.bilateral())
        oc = run_waterfall(paths, 0.0, p0, P, CSA.on_chain())
        assert 1 - sum(oc.im_profile) / sum(bi.im_profile) == pytest.approx(0.2929, abs=0.06)


# ── CSA request parsing ──────────────────────────────────────────────────────

class TestCSAFromRequest:

    def test_none_is_uncollateralised(self):
        c = CSA.from_request(None)
        assert not c.collateralised and not c.im_exchanged

    def test_presets_and_overrides(self):
        c = CSA.from_request({"preset": "bilateral", "threshold_cp": 5e5, "mta": 1e5, "mpor_days": 12})
        assert c.collateralised and c.im_exchanged
        assert (c.threshold_cp, c.mta, c.mpor_days) == (5e5, 1e5, 12)
        o = CSA.from_request({"preset": "ON_CHAIN"})
        assert o.settlement == "on_chain" and o.mpor_days == 5.0 and o.mta == 0.0
        u = CSA.from_request({"preset": "UNCOLLATERALISED", "im_exchanged": True})
        assert not u.collateralised and u.im_exchanged

    def test_rejects_bad_mpor(self):
        with pytest.raises(ValueError):
            CSA.from_request({"preset": "BILATERAL", "mpor_days": 0})

    def test_to_dict_roundtrip_fields(self):
        d = CSA.on_chain().to_dict()
        assert "simm_mpor_scale" not in d, "no SIMM scaling: Rijeka does not compute SIMM"
        assert d["mpor_years"] == pytest.approx(5 / 250)


# ── ColVA: the carry of the variation margin against cash at OIS ──────────────

def test_colva_is_zero_for_cash_and_the_closed_form_for_a_spread():
    paths, p0, theta, _T = make_paths(n_paths=1500, seed=3)
    v0 = 0.0
    params = default_params(theta)
    base = CSA.bilateral(threshold_cp=0.0, mta=0.0, im_exchanged=True)
    wf0 = run_waterfall(paths, v0, p0, params, base, np.random.default_rng(1))
    assert wf0.colva == 0.0 and wf0.xva_total == wf0.cva + wf0.dva + wf0.fva + wf0.fba + wf0.kva + wf0.mva
    # the posted VM earns 100 bp over OIS: ColVA = 100 bp · Σ mean(posted) · Δt · DF, a benefit; every other VA is unchanged
    sp = CSA(**{**base.__dict__, "vm_post_carry_bp": 100.0})
    wf1 = run_waterfall(paths, v0, p0, params, sp, np.random.default_rng(1))
    coll = np.array(wf1.collateral_mean)
    for k in ("cva", "dva", "fva", "fba", "kva", "mva"):
        assert getattr(wf1, k) == getattr(wf0, k), k
    assert wf1.colva > 0 and wf1.xva_total == pytest.approx(wf0.xva_total + wf1.colva)
    # the closed form on the engine's own posted mean: mean(max(−C, 0)) per step
    rng = np.random.default_rng(1)
    from pricing.xva_engine import lagged_values
    v_lag = lagged_values(paths, v0, 1.0 / 12, sp.mpor_years, rng)
    c = collateral_held(v_lag, sp)
    post = np.mean(np.maximum(-c, 0.0), axis=0)
    dt = 1.0 / 12
    expect = sum(post[i] * 0.01 * dt * p0[i + 1] for i in range(len(post)))
    assert wf1.colva == pytest.approx(expect, rel=1e-9)
    assert np.allclose(coll, np.mean(c, axis=0))
    # received VM in an asset earning nothing while OIS is rebated: a cost on what we hold
    rc = CSA(**{**base.__dict__, "vm_recv_carry_bp": -400.0})
    wf2 = run_waterfall(paths, v0, p0, params, rc, np.random.default_rng(1))
    assert wf2.colva < 0 and wf2.cva == wf0.cva
