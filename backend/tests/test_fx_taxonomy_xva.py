"""One risk taxonomy across products: FX and crypto forwards carry NPV, IR01, IR01_DISC, IR01_BASE
(or FUND01), FX01/BTC01 and THETA like a swap carries NPV, IR01, IR01_DISC, THETA; and their XVA
runs through the same waterfall."""
from datetime import date

import pytest

from pricing import fx_xva
from pricing.csa import CSA
from pricing.currency_forward import price_currency_forward
from pricing.curve import Curve


def _flat(val, r):
    # a flat continuous curve as a Curve with DF pillars
    from datetime import timedelta
    pts = [(val + timedelta(days=d), pow(2.718281828, -r * d / 365)) for d in (1, 30, 90, 180, 365, 730, 1825)]
    return Curve(valuation_date=val, df_pillars=pts)


def test_forward_risk_factors_add_up_and_carry_the_taxonomy_names():
    val = date(2026, 10, 29); settle = date(2027, 1, 28)
    r = price_currency_forward(base_currency="EUR", quote_currency="USD", base_notional=10_000_000, forward_rate=None,
                               spot=1.1133, valuation_date=val, settlement_date=settle,
                               quote_curve=_flat(val, 0.04), base_curve=_flat(val, 0.02), direction="BUY")
    assert r.npv == pytest.approx(0.0, abs=1e-6)                       # struck at the fair forward
    assert r.ir01 == pytest.approx(r.ir01_base + r.ir01_disc, abs=1e-9)
    assert r.ir01_disc == r.rho_quote_per_bp and r.ir01_base == r.rho_base_per_bp
    assert r.spot01 == r.delta_quote_per_pct and r.spot01 > 0          # long the base: gains when spot rises
    assert r.theta is not None and abs(r.theta) < abs(r.spot01)        # one day's carry is small
    assert r.ir01_base < 0 < r.ir01_disc                                # base rate up lowers F; quote rate up raises it


def test_theta_is_one_day_of_carry_on_an_off_market_strike():
    val = date(2026, 10, 29); settle = date(2027, 10, 29)
    r = price_currency_forward(base_currency="BTC", quote_currency="USD", base_notional=2, forward_rate=90_000,
                               spot=80_000, valuation_date=val, settlement_date=settle,
                               quote_curve=_flat(val, 0.04), base_rate=0.0, direction="BUY", pip=1.0)
    assert r.npv < 0                                                   # bought above the fair forward
    # theta is exactly tomorrow's price on the same spot and curves, minus today's
    from datetime import timedelta
    r1 = price_currency_forward(base_currency="BTC", quote_currency="USD", base_notional=2, forward_rate=90_000,
                                spot=80_000, valuation_date=val + timedelta(days=1), settlement_date=settle,
                                quote_curve=_flat(val + timedelta(days=1), 0.04), base_rate=0.0, direction="BUY", pip=1.0)
    assert r.theta == pytest.approx(r1.npv - r.npv, abs=0.5) and abs(r.theta) < 100


def test_forward_xva_profiles_and_signs():
    inp = fx_xva.ForwardXvaInput(pair="EURUSD", base_notional=10_000_000, forward=1.12, strike=1.12, t_years=1.0,
                                 df_quote_t=0.96, quote_zero=0.04, direction="BUY", vol_pct=8.0, spot01=107_000)
    wf, meta = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=3000)
    assert len(wf.ee) == 12 and meta["steps"] == 12 and meta["im_rw_per_pct"] == fx_xva.SIMM_FX_RW_G10
    assert all(e >= 0 for e in wf.ee) and all(n <= 0 for n in wf.ene) and wf.pfe[-1] > wf.ee[-1]
    assert wf.ee[-1] > wf.ee[0]                                        # exposure grows with the vol horizon
    assert wf.cva < 0 < wf.dva and wf.fva <= 0 and wf.kva <= 0 and wf.mva == 0   # no IM without a CSA
    assert abs(wf.ee[-1]) < 10_000_000 * 1.12 * 0.25                   # sane for 8 % vol over a year


def test_crypto_uses_the_assumed_im_weight_and_collateral_reduces_cva():
    inp = fx_xva.ForwardXvaInput(pair="BTCUSD", base_notional=10, forward=82_000, strike=82_000, t_years=0.25,
                                 df_quote_t=0.99, quote_zero=0.04, direction="SELL", vol_pct=55.0, spot01=-8_100)
    open_, _ = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=2000)
    coll, meta = fx_xva.forward_xva(inp, CSA.on_chain(im_exchanged=True), n_paths=2000)
    assert meta["im_rw_per_pct"] == fx_xva.CRYPTO_RW_ASSUMPTION and "outside SIMM" in meta["im_basis"]
    assert abs(coll.cva) < abs(open_.cva) and coll.mva < 0


def test_default_vols_exist_for_every_demo_pair():
    for pair in ("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "BTCUSD", "ETHUSD", "SOLUSD"):
        assert fx_xva.default_vol_pct(pair) > 0


def test_currency_xva_route_needs_auth():
    import main
    from fastapi.testclient import TestClient
    assert TestClient(main.app).post("/api/xva/currency", json={"pair": "EURUSD"}).status_code == 401
