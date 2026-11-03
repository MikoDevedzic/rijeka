"""The waterfall's capital extension: the defaults reproduce today's result bit for bit; the regulatory CSA, the
multi-class add-on and the CVA-capital leg each move only what they should."""
import math

import numpy as np
import pytest

from pricing.capital import CapitalInputs
from pricing.collateral import preset
from pricing.csa import CSA
from pricing.sa_ccr import SaccrTrade
from pricing.xva_engine import WaterfallParams, run_waterfall
from tests.test_xva_engine import make_paths


def _setup(n=1500, M=5.0):
    paths, p0, theta, T = make_paths(n_paths=n, maturity_y=M, seed=3)
    params = WaterfallParams(notional=1e7, maturity_y=M, dt=1.0 / 12, theta=theta, ir01=4_500.0)
    return paths, p0, params


def _run(csa, **kw):
    paths, p0, params = _setup()
    return run_waterfall(paths, 0.0, p0, params, csa, np.random.default_rng(1), **kw)


@pytest.mark.parametrize("csa", [CSA.uncollateralised(), CSA.bilateral(threshold_cp=2e5, mta=5e4), CSA.on_chain()])
def test_defaults_are_the_previous_engine(csa):
    a, b = _run(csa), _run(csa, reg_csa=None, capital=None, saccr=None)
    for k in ("cva", "dva", "fva", "fba", "kva", "mva", "ead_0", "capital_0", "im_0", "mf_0"):
        assert getattr(a, k) == getattr(b, k), k
    assert a.kva_ccr == pytest.approx(a.kva) and a.kva_cva == 0.0 and a.k_cva_0 == 0.0
    assert a.rwa_0 == pytest.approx(a.ead_0) and a.rc_0 >= 0 and 0.05 <= a.multiplier_0 <= 1.0


def test_an_all_recognised_regime_equals_the_plain_csa():
    base = CSA.bilateral(threshold_cp=2e5, mta=5e4, im_exchanged=True)
    r = preset("CASH_GOVT", base)
    r.posted = r.received = {"CASH": 1.0}
    a, b = _run(base), _run(r.economic_csa(), reg_csa=r.regulatory_csa())
    for k in ("cva", "fva", "kva", "mva", "ead_0"):
        assert getattr(a, k) == pytest.approx(getattr(b, k), rel=1e-12), k


def test_an_unrecognised_regime_raises_capital_and_keeps_the_economic_exposure():
    base = CSA.bilateral(im_exchanged=True)
    r = preset("PLUS_STABLECOIN", base, netting_enforceable=True)       # exchanged, not recognised
    plain = _run(base)
    reg = _run(r.economic_csa(), reg_csa=r.regulatory_csa())
    assert reg.cva == pytest.approx(plain.cva) and reg.fva == pytest.approx(plain.fva)   # the economic view is unchanged
    assert not reg.regulatory_margined and reg.mf_0 == pytest.approx(1.0)                 # unmargined MF at 5y
    assert reg.ead_0 > plain.ead_0 and abs(reg.kva) > abs(plain.kva)
    # unenforceable: the economic exposure goes gross too
    gross = preset("PLUS_STABLECOIN", base)
    g = _run(gross.economic_csa(), reg_csa=gross.regulatory_csa())
    assert abs(g.cva) > abs(plain.cva) and g.ead_0 >= reg.ead_0 * 0.99


def test_the_cva_capital_leg_adds_to_kva_and_scales_with_the_weight():
    csa = CSA.bilateral(im_exchanged=True)
    plain = _run(csa)
    bank = _run(csa, capital=CapitalInputs.for_counterparty("BANK", "A"))
    assert bank.kva_ccr == pytest.approx(plain.kva * 0.30, rel=1e-9)       # RW 100 % → 30 %, same hurdle
    assert bank.kva_cva < 0 and bank.kva == pytest.approx(bank.kva_ccr + bank.kva_cva)
    hy = _run(csa, capital=CapitalInputs.for_counterparty("BANK", "BB_B"))
    assert hy.kva_cva == pytest.approx(bank.kva_cva * 0.12 / 0.05, rel=1e-9)
    assert hy.rwa_0 == pytest.approx(hy.ead_0 * 1.0) and bank.rwa_0 == pytest.approx(bank.ead_0 * 0.30)
    # K_CVA at the first grid point (one step in) by hand from the engine's own EAD
    m = 5.0 - 1.0 / 12
    df = (1 - math.exp(-0.05 * m)) / (0.05 * m)
    assert bank.k_cva_0 == pytest.approx(0.65 / 1.4 * 0.05 * m * bank.ead_0 * df, rel=1e-9)


def test_the_multi_class_add_on_reproduces_the_single_factor_one_for_one_swap():
    csa = CSA.bilateral(im_exchanged=True)
    plain = _run(csa)
    one = _run(csa, saccr=[SaccrTrade("IR", "USD", 1e7, 0.0, 5.0, 5.0, 1.0)])
    assert one.ead_0 == pytest.approx(plain.ead_0, rel=1e-9) and one.kva == pytest.approx(plain.kva, rel=1e-9)
    # a forward in the set is an FX add-on, 4 % of notional × MF, on top
    two = _run(csa, saccr=[SaccrTrade("IR", "USD", 1e7, 0.0, 5.0, 5.0, 1.0), SaccrTrade("FX", "EURUSD", 2e6, 0.0, 1.0, 1.0, 1.0)])
    assert two.addon_0 == pytest.approx(one.addon_0 + 0.04 * 2e6 * csa.sa_ccr_maturity_factor(1.0), rel=1e-9)


def test_a_large_mta_cannot_make_margining_worse_than_no_margining():
    """CRE52.2: with a 5m MTA on a 10m swap the margined RC floor would exceed the unmargined exposure; the EAD is capped."""
    big = CSA.bilateral(threshold_cp=0.0, mta=5e6, im_exchanged=False)
    plain = _run(CSA.uncollateralised())
    capped = _run(big)
    assert capped.ead_0 <= plain.ead_0 * (1 + 1e-9)
    assert abs(capped.kva) <= abs(plain.kva) * (1 + 1e-9)
    small = _run(CSA.bilateral(threshold_cp=0.0, mta=0.0, im_exchanged=False))
    assert small.ead_0 < plain.ead_0                                   # the ordinary margined set is below the cap
