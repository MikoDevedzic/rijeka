"""0.63.0. Two defects the option's XVA workbook showed, and their fixes.

1. An option's XVA run read the forward and the discounting at the EXPIRY, where the ticket prices the option on the
   forward to SETTLEMENT, discounted from the settlement date (and the credit engine values it the same way): the run
   started a few days' carry and discounting off the ticket's price (0.09 % of the premium on an eighteen-month EURUSD
   call). The run now carries the ticket's reading along every path (pricing/fx_xva.rates_to_settlement).
2. Two tables for one default vol: an option on a pair with no surface was priced from pricing/fx_vol's table (10 %
   for a pair not in it, a digital asset included) and a forward's XVA run from pricing/fx_xva's (55 % for BTC). One
   table now, in pricing/fx_vol."""
from __future__ import annotations

import math

import numpy as np
import pytest

from pricing import fx_vol, fx_xva
from pricing.fx_exotic import ExoticSpec, price_exotic
from pricing.fx_option import price_fx_option

Phi = lambda x: 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))        # noqa: E731

S0, F0, DFQ, T_E, T_S, VOL, N = 1.10, 1.12, 0.94, 1.495, 1.506, 0.09, 10_000_000.0     # four days from expiry to settlement

SPECS = {
    "EUROPEAN": ExoticSpec("EUROPEAN", "CALL", strike=1.12),
    "EUROPEAN_PUT": ExoticSpec("EUROPEAN", "PUT", strike=1.10),
    "AMERICAN": ExoticSpec("AMERICAN", "PUT", strike=1.15),
    "DIGITAL": ExoticSpec("DIGITAL", "CALL", strike=1.13, payout=250_000.0, payout_currency="QUOTE"),
    "BARRIER": ExoticSpec("BARRIER", "CALL", strike=1.12, barrier=1.30, barrier_type="UP_OUT"),
    "DOUBLE_BARRIER": ExoticSpec("DOUBLE_BARRIER", "CALL", strike=1.12, lower=0.95, upper=1.32, barrier_type="KNOCK_OUT"),
    "TOUCH": ExoticSpec("TOUCH", "CALL", payout=250_000.0, barrier=1.28, touch_type="ONE_TOUCH"),
}


def _inp(spec, direction="BUY", **kw):
    base = dict(pair="EURUSD", base_notional=N, spot=S0, forward=F0, t_expiry=T_E, t_settle=T_S, df_quote_t=DFQ,
                quote_zero=-math.log(DFQ) / T_S, vol=VOL, spec=spec, direction=direction)
    base.update(kw)
    return fx_xva.OptionXvaInput(**base)


@pytest.mark.parametrize("style", list(SPECS))
def test_the_runs_value_today_is_the_tickets_price_for_every_style(style):
    """The value the exposure starts from is the figure the ticket's pricer gives for the same forward to settlement,
    discount factor to settlement, time to expiry and vol. Before 0.63.0 the European was 0.09 % off on these terms."""
    spec = SPECS[style]
    _, _, v0 = fx_xva.simulate_option_paths(_inp(spec), n_paths=200)
    ticket = price_exotic(spec, base_notional=N, spot=S0, forward=F0, df_quote=DFQ, t_expiry=T_E, vol=VOL, direction="BUY").npv
    assert v0 == pytest.approx(ticket, rel=1e-12), style
    _, _, sold = fx_xva.simulate_option_paths(_inp(spec, "SELL"), n_paths=200)
    assert sold == pytest.approx(-ticket, rel=1e-12)


def test_a_european_on_a_path_is_the_formula_on_the_forward_to_settlement():
    """Written out here, not through the engine's valuation: at a grid date t with τ = T_e − t left,
    V = N·DF_q(t,T_s)·[F_t·Φ(d₁) − K·Φ(d₂)], d₁ = [ln(F_t/K) + ½σ²τ]/(σ√τ); and the vanilla pricer agrees today."""
    spec = SPECS["EUROPEAN"]
    inp = _inp(spec)
    nz: dict = {}
    V, p0, v0 = fx_xva.simulate_option_paths(inp, n_paths=300, seed=11, noise_out=nz)
    steps, dt = nz["steps"], nz["dt"]
    r_q = inp.quote_zero
    for k in (0, steps // 2, steps - 2):
        t = (k + 1) * dt
        tau = T_E - t
        assert tau > 0
        df = DFQ / math.exp(-r_q * t)
        for p in (0, 7, 299):
            f = float(nz["f_t"][p, k])
            sT = VOL * math.sqrt(tau)
            d1 = (math.log(f / spec.strike) + 0.5 * sT * sT) / sT
            assert V[p, k] == pytest.approx(N * df * (f * Phi(d1) - spec.strike * Phi(d1 - sT)), rel=1e-10, abs=1e-6), (k, p)
    q = price_fx_option(base_currency="EUR", quote_currency="USD", base_notional=N, option_type="CALL", strike=spec.strike, spot=S0, forward=F0,
                        df_quote=DFQ, valuation_date=__import__("datetime").date(2026, 11, 23), expiry_date=__import__("datetime").date(2028, 5, 22),
                        settlement_date=__import__("datetime").date(2028, 5, 24), vol=VOL, direction="BUY", spot_date=None)
    sT = VOL * math.sqrt(q.t_expiry)
    d1 = (math.log(F0 / spec.strike) + 0.5 * sT * sT) / sT
    assert q.npv == pytest.approx(N * DFQ * (F0 * Phi(d1) - spec.strike * Phi(d1 - sT)), rel=1e-12), "the ticket's European: on the forward to settlement, discounted from settlement"


@pytest.mark.parametrize("style", ["EUROPEAN", "DIGITAL"])
def test_the_value_on_a_path_is_the_tickets_pricer_at_that_date(style):
    """On any path and date before the expiry the run's value is what the ticket's pricer answers there: the spot the
    path implies, the forward to settlement on the path, the discount factor from that date to settlement, the time left."""
    spec = SPECS[style]
    inp = _inp(spec)
    nz: dict = {}
    V, _, _ = fx_xva.simulate_option_paths(inp, n_paths=100, seed=3, noise_out=nz)
    dt = nz["dt"]
    for k in (1, nz["steps"] // 2):
        t = (k + 1) * dt
        for p in (0, 50, 99):
            x = price_exotic(spec, base_notional=N, spot=float(nz["s_t"][p, k]), forward=float(nz["f_t"][p, k]), df_quote=DFQ / math.exp(-inp.quote_zero * t),
                             t_expiry=T_E - t, vol=VOL, direction="BUY")
            assert V[p, k] == pytest.approx(x.npv, rel=1e-10, abs=1e-6), (style, k, p)


def test_the_discounted_value_is_a_martingale_from_the_tickets_price():
    inp = _inp(SPECS["EUROPEAN"])
    V, p0, v0 = fx_xva.simulate_option_paths(inp, n_paths=200_000, seed=5)
    steps = V.shape[1]
    for k in (steps // 3, steps - 2, steps - 1):
        assert float(V[:, k].mean()) * p0[k + 1] == pytest.approx(v0, rel=0.012), k       # about three standard errors at this vol


def test_the_value_a_margin_period_earlier_reads_settlement_too():
    """The lag's closed form before the expiry's own step: the forward to settlement at t − δ, discounted from the
    settlement date. Rebuilt here on the engine's own lagged level."""
    spec = SPECS["EUROPEAN"]
    inp = _inp(spec, grid_per_year=12)
    nz: dict = {}
    fx_xva.simulate_option_paths(inp, n_paths=50, seed=9, noise_out=nz)
    steps, dt = nz["steps"], nz["dt"]
    lag_y = 10.0 / 250.0
    noise = np.zeros((50, steps))
    lagged = nz["lag"](lag_y, np.random.default_rng(43), noise)
    m = nz["f_t"] / F0
    m_lag, t_lag, _ = fx_xva._lagged_driver(m, np.asarray(nz["step_vols"], dtype=float), dt, lag_y, np.random.default_rng(43), None, nz["clock"])
    r_q = inp.quote_zero
    for i in (0, steps // 2, steps - 2):                # not the last step: that one runs to the grid date (the paths' own reading)
        tl = float(t_lag[i]); tau = T_E - tl
        df = DFQ / math.exp(-r_q * tl)
        for p in (0, 25, 49):
            f = F0 * float(m_lag[p, i])
            sT = VOL * math.sqrt(tau)
            d1 = (math.log(f / spec.strike) + 0.5 * sT * sT) / sT
            assert lagged[p, i] == pytest.approx(N * df * (f * Phi(d1) - spec.strike * Phi(d1 - sT)), rel=1e-10, abs=1e-6), (i, p)


def test_one_table_for_the_vol_of_a_pair_with_no_surface():
    assert fx_xva.DEFAULT_VOL_PCT is fx_vol.DEFAULT_VOL_PCT and fx_xva.default_vol_pct is fx_vol.default_vol_pct
    for pair, lvl in (("EURUSD", 7.5), ("GBPUSD", 8.5), ("USDCHF", 7.5), ("USDCAD", 6.5), ("BTCUSD", 55.0), ("ETHUSD", 70.0), ("SOLUSD", 90.0),
                      ("NZDUSD", 10.0), ("DOGEUSD", 60.0)):
        assert fx_vol.default_vol_pct(pair) == lvl, pair
        vol, tier, note = fx_vol.lookup_vol(None, pair, 0.5, 1.0, 1.0)
        assert vol == pytest.approx(lvl / 100.0) and tier == "DEFAULT" and f"{lvl:.1f}%" in note, pair
    # an option on a digital asset with no surface is no longer priced at the currency fallback
    assert fx_vol.lookup_vol([], "BTCUSD", 0.25, 70_000.0, 70_000.0)[0] == pytest.approx(0.55)
