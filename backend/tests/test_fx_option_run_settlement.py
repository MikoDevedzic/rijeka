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


@pytest.mark.parametrize("style", ["BARRIER", "DOUBLE_BARRIER", "TOUCH", "AMERICAN"])
def test_a_style_that_reads_the_path_is_the_tickets_pricer_on_the_paths_that_have_not_knocked(style):
    """A barrier, a corridor and a touch on a path that has not touched, and an American (run as its European on the
    paths, a stated lower bound): the ticket's pricer at that date. Reverted to the expiry's reading these fail."""
    spec = SPECS[style]
    inp = _inp(spec)
    nz: dict = {}
    fx_xva.simulate_option_paths(inp, n_paths=100, seed=3, noise_out=nz)
    V, _, x = fx_xva._option_values(inp, nz["steps"], nz["dt"], nz["f_t"] / F0, nz["step_vols"], nz["clock"], 3)
    as_priced = ExoticSpec("EUROPEAN", spec.option_type, strike=spec.strike) if style == "AMERICAN" else spec
    from pricing.fx_exotic import value_on_paths
    dt, seen, differs = nz["dt"], 0, 0
    scale = N if style != "TOUCH" else 1.0
    for k in (1, nz["steps"] // 2):
        t = (k + 1) * dt
        df, tau = DFQ / math.exp(-inp.quote_zero * t), T_E - t
        # the reading, exactly: the paths' own routine on the whole column, given the rate and the carry implied HERE from
        # the discount factor and the forward to settlement (the routine values a column on one grid, so it is handed
        # the column the engine hands it)
        r_here = -math.log(df) / tau
        b_here = math.log(float(nz["f_t"][0, k]) / float(nz["s_t"][0, k])) / tau
        col = scale * value_on_paths(spec, nz["s_t"][:, k], r_here, r_here - b_here, VOL, tau, x["knocked"][:, k + 1], 1.0)
        assert np.allclose(V[:, k], col, rtol=1e-10, atol=1e-6), (style, k)
        at_expiry = scale * value_on_paths(spec, nz["s_t"][:, k], inp.quote_zero, x["r_b"], VOL, tau, x["knocked"][:, k + 1], 1.0)
        alive = ~x["knocked"][:, k + 1] & (np.abs(col) > 1.0)
        differs += int((np.abs(at_expiry - col)[alive] > 1e-7 * np.abs(col)[alive]).sum()); seen += int(alive.sum())
        # and the ticket's pricer, on single paths that have not touched. Its routine (value) and the paths' (on a grid) are
        # two pieces of arithmetic for one formula: on identical inputs they part by up to 1.3e-3 on a barrier and 4e-4
        # on a corridor, 1e-5 on a touch, so the pricer is held that loosely for those two
        for p in range(0, 100, 7):
            s_p = float(nz["s_t"][p, k])
            if x["knocked"][p, k + 1] or (style != "AMERICAN" and not (0.97 < s_p < 1.26)):      # the pricer refuses a spot at or beyond a level
                continue
            q = price_exotic(as_priced, base_notional=N, spot=s_p, forward=float(nz["f_t"][p, k]), df_quote=df, t_expiry=tau, vol=VOL, direction="BUY")
            assert V[p, k] == pytest.approx(q.npv, rel=3e-3 if style in ("BARRIER", "DOUBLE_BARRIER") else 3e-5, abs=1e-6), (style, k, p)
    assert seen > 50 and differs > 0.8 * seen, "the reading at the expiry, which this replaced, gives other figures on these paths"


def test_a_package_carries_the_same_reading_for_its_option_leg():
    """An option inside a package runs on the package's longer grid, where its expiry and its settlement fall between
    grid dates: it starts from the ticket's price there too, and every value is finite."""
    opt = _inp(SPECS["EUROPEAN"], t_expiry=0.40, t_settle=0.411, df_quote_t=math.exp(-0.041 * 0.411), quote_zero=0.041, forward=1.105)
    opt.spec = ExoticSpec("EUROPEAN", "CALL", strike=1.105)
    fwd = fx_xva.ForwardXvaInput(pair="EURUSD", base_notional=N, forward=1.13, strike=1.13, t_years=2.0, df_quote_t=math.exp(-0.041 * 2.0), quote_zero=0.041,
                                 direction="SELL", vol_pct=9.0, spot=S0)
    paths, _, v0, rows = fx_xva.simulate_package_paths([fwd, opt], n_paths=300)
    ticket = price_exotic(opt.spec, base_notional=N, spot=S0, forward=1.105, df_quote=opt.df_quote_t, t_expiry=0.40, vol=VOL, direction="BUY").npv
    assert np.isfinite(paths).all() and v0 == pytest.approx(ticket, rel=1e-10, abs=1e-6), "the forward is dealt at its fair rate: the package starts from the option's price"
    alone, _, v0_alone = fx_xva.simulate_option_paths(opt, n_paths=300)
    assert v0_alone == pytest.approx(ticket, rel=1e-12)


@pytest.mark.parametrize("style", ["BARRIER", "DOUBLE_BARRIER", "TOUCH", "DIGITAL", "EUROPEAN"])
def test_a_grid_date_seconds_before_the_expiry_is_read_as_the_expirys(style):
    """A date within an hour of the expiry is the payoff (fx_xva.AT_EXPIRY), not a closed form asked for seconds of
    time left: there a one-touch far from its level read tens of thousands of either sign, and with the rates scaled
    to settlement a corridor read a quarter low. The same option expiring ON the grid date gives the same values."""
    spec = SPECS[style]
    steps_at = 12
    probe = _inp(spec, grid_per_year=12)
    steps, dt = fx_xva.exposure_grid(probe.t_settle, 12)
    t_k = steps_at * dt
    nz: dict = {}
    on, _, _ = fx_xva.simulate_option_paths(_inp(spec, grid_per_year=12, t_expiry=t_k), n_paths=300, seed=4, noise_out=nz)
    near, _, _ = fx_xva.simulate_option_paths(_inp(spec, grid_per_year=12, t_expiry=t_k + 1e-7), n_paths=300, seed=4)
    assert nz["i_exp"] == steps_at - 1
    assert np.isfinite(near).all() and (near >= -1e-9).all(), style
    assert np.allclose(near[:, steps_at - 1:], on[:, steps_at - 1:], rtol=1e-9, atol=1e-6), (style, "the date three seconds before the expiry, and every date after")
    assert fx_xva.rates_to_settlement(0.06, 0.04, 0.02, 0.01) == pytest.approx((0.12, 0.08))


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
    # every reader of the table reads this one: the forward's run, the credit engine's factors, P&L and the credit
    # engine's revaluation through lookup_vol
    import inspect
    from ccr import calibration
    assert "from pricing.fx_xva import default_vol_pct" in inspect.getsource(calibration)
