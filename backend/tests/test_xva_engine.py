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
    simm_ir_risk_weight, interp_spread,
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
    base = dict(notional=1e7, maturity_y=maturity_y, dt=dt, theta=theta,
                ir01=4550.0)
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
        m_t = max(M0 - t, 0.0)
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

    def test_legacy_mva_when_im_exchanged_without_vm(self):
        """IM without VM: MVA equals the legacy formula on the legacy IM."""
        paths, p0, theta, T = make_paths()
        P = default_params(theta)
        csa = CSA(preset="UNCOLLATERALISED", collateralised=False, im_exchanged=True,
                  mpor_days=10.0)
        wf  = run_waterfall(paths, 0.0, p0, P, csa)
        im_0 = abs(P.ir01) * simm_ir_risk_weight(P.maturity_y)
        ref = legacy_waterfall(paths, p0, P, im_0=im_0)
        assert wf.im_0 == pytest.approx(im_0)
        assert wf.mva == pytest.approx(ref["mva"], rel=1e-12)

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
        assert im.im_0 == pytest.approx(abs(self.P.ir01) * simm_ir_risk_weight(5.0))

    def test_simm_im_scales_with_sqrt_mpor(self):
        bi = self._run(CSA.bilateral())
        oc = self._run(CSA.on_chain())
        assert oc.im_0 / bi.im_0 == pytest.approx(math.sqrt(5 / 10), rel=1e-9)
        assert oc.simm_rw / oc.simm_rw_10d == pytest.approx(math.sqrt(0.5), rel=1e-9)
        assert bi.simm_rw == pytest.approx(bi.simm_rw_10d)

    def test_im_yield_pickup_reduces_mva(self):
        a = self._run(CSA.on_chain(im_yield_pickup_bp=0.0))
        b = self._run(CSA.on_chain(im_yield_pickup_bp=30.0))
        assert abs(b.mva) < abs(a.mva)
        c = self._run(CSA.on_chain(im_yield_pickup_bp=55.0))   # == ftp → free IM
        assert c.mva == pytest.approx(0.0, abs=1e-6)

    def test_sa_ccr_maturity_factor(self):
        assert CSA.uncollateralised().sa_ccr_maturity_factor(4.0) == pytest.approx(1.0)
        assert CSA.uncollateralised().sa_ccr_maturity_factor(0.25) == pytest.approx(0.5)
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

    def test_on_chain_im_is_29pct_lower(self):
        paths, p0, theta, T = make_paths()
        P = default_params(theta)
        bi = run_waterfall(paths, 0.0, p0, P, CSA.bilateral())
        oc = run_waterfall(paths, 0.0, p0, P, CSA.on_chain())
        assert 1 - oc.im_0 / bi.im_0 == pytest.approx(0.2929, abs=1e-3)


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
        assert d["simm_mpor_scale"] == pytest.approx(math.sqrt(0.5))
        assert d["mpor_years"] == pytest.approx(5 / 250)
