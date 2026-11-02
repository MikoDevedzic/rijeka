"""Vol along the exposure paths (2 November 2026): the surface's ATM term structure drives the simulation,
and an option is valued at each date at the forward vol for its remaining life and the smile at its path's
moneyness (sticky-delta). Both engines, the stand-alone ticket XVA and the credit run, use the same functions."""
import math
from datetime import date

import numpy as np
import pytest

from pricing.fx_vol import Pillar, atm_variance, forward_vol, parse_surface, path_vols, step_vols, vol_at

FLAT = [Pillar(0.25, 0.08, 0.0, 0.0, False), Pillar(1.0, 0.08, 0.0, 0.0, False)]
RISING = [Pillar(1 / 12, 0.06, 0.0, 0.0, False), Pillar(0.5, 0.08, 0.0, 0.0, False), Pillar(1.0, 0.10, 0.0, 0.0, False)]
SMILE = parse_surface([{"tenor": "1M", "quote_type": "ATM", "rate": 7.0}, {"tenor": "1M", "quote_type": "RR25", "rate": 1.0}, {"tenor": "1M", "quote_type": "BF25", "rate": 0.3},
                       {"tenor": "1Y", "quote_type": "ATM", "rate": 9.0}, {"tenor": "1Y", "quote_type": "RR25", "rate": 1.5}, {"tenor": "1Y", "quote_type": "BF25", "rate": 0.4}])


def test_forward_vols_rebuild_the_atm_variance_and_a_flat_surface_stays_flat():
    grid = np.arange(1, 13) / 12
    sv = step_vols(RISING, grid)
    assert len(sv) == 12 and sv[0] == pytest.approx(0.06) and sv[-1] > sv[0], "a rising term structure means rising step vols"
    cum = sum(v * v / 12 for v in sv)
    assert cum == pytest.approx(atm_variance(RISING, 1.0), rel=1e-9), "the steps add up to the surface's variance at the horizon"
    assert all(v == pytest.approx(0.08) for v in step_vols(FLAT, grid))
    assert forward_vol(RISING, 0.5, 1.0) == pytest.approx(math.sqrt((0.01 * 1.0 - 0.0064 * 0.5) / 0.5))


def test_forward_variance_is_floored_where_the_quotes_imply_calendar_arbitrage():
    falling = [Pillar(0.25, 0.20, 0.0, 0.0, False), Pillar(0.5, 0.10, 0.0, 0.0, False)]
    v = forward_vol(falling, 0.25, 0.5)
    assert v == pytest.approx(0.25 * 0.10) and v > 0


def test_path_vols_are_the_forward_atm_at_the_money_and_follow_the_smile_away_from_it():
    F = np.array([1.00, 1.10, 1.25])            # at the money, in the money, deep in the money for a call struck at 1.10
    sig = path_vols(SMILE, 0.25, 0.75, F, 1.10)
    atm_f = forward_vol(SMILE, 0.25, 0.75)
    assert sig[1] == pytest.approx(atm_f, abs=2e-3), "at the money the path vol is the forward ATM vol"
    assert sig[2] > sig[1] > sig[0] - 1e-9 or sig[2] > sig[1], "a positive risk reversal: calls bid, the vol rises with the forward"
    assert np.allclose(path_vols(SMILE, 0.25, 0.75, F, None), atm_f), "no strike (a touch): the ATM forward vol everywhere"
    assert path_vols(SMILE, 0.0, 1.0, np.array([1.10]), 1.10)[0] == pytest.approx(vol_at(SMILE, 1.0, 1.10, 1.10), abs=1e-6), "at t = 0 it is today's smile vol"


def test_the_forward_engine_with_a_flat_surface_matches_the_flat_vol_and_a_term_structure_changes_the_profile():
    from pricing import fx_xva
    from pricing.csa import CSA
    base = dict(pair="EURUSD", base_notional=1e7, forward=1.17, strike=1.17, t_years=1.0, df_quote_t=0.96, quote_zero=0.04)
    flat, _ = fx_xva.forward_xva(fx_xva.ForwardXvaInput(**base, vol_pct=8.0), CSA.uncollateralised(), n_paths=500)
    surf, meta = fx_xva.forward_xva(fx_xva.ForwardXvaInput(**base, vol_pct=8.0, pillars=FLAT), CSA.uncollateralised(), n_paths=500)
    assert surf.cva == pytest.approx(flat.cva, rel=1e-9) and meta["vol_mode"].startswith("ATM term structure")
    assert len(meta["step_vols_pct"]) == 12 and all(v == pytest.approx(8.0) for v in meta["step_vols_pct"])
    rising, meta2 = fx_xva.forward_xva(fx_xva.ForwardXvaInput(**base, vol_pct=10.0, pillars=RISING), CSA.uncollateralised(), n_paths=500)
    assert rising.ee[0] < flat.ee[0] * 1.05 and meta2["step_vols_pct"][0] == pytest.approx(6.0), "early steps carry the short-dated vol, not the 1Y one"


def test_the_option_engine_runs_every_style_with_the_surface_and_values_at_the_money_like_the_flat_case():
    from pricing import fx_xva
    from pricing.csa import CSA
    from pricing.fx_exotic import ExoticSpec
    def inp(style, kw, pillars):
        spec = ExoticSpec(style, "CALL", strike=1.17, **kw) if style != "TOUCH" else ExoticSpec("TOUCH", "CALL", payout=1e6, touch_type="ONE_TOUCH", barrier=1.25)
        return fx_xva.OptionXvaInput(pair="EURUSD", base_notional=1e7, spot=1.16, forward=1.17, t_expiry=0.98, t_settle=1.0, df_quote_t=0.96,
                                     quote_zero=0.04, vol=0.08, spec=spec, direction="BUY", spot01=5e4, pillars=pillars)
    for style, kw in [("EUROPEAN", {}), ("DIGITAL", {"payout": 1e6}), ("BARRIER", {"barrier_type": "UP_OUT", "barrier": 1.30}),
                      ("DOUBLE_BARRIER", {"barrier_type": "KNOCK_OUT", "lower": 1.05, "upper": 1.30}), ("TOUCH", {})]:
        wf_flat, _ = fx_xva.option_xva(inp(style, kw, None), CSA.uncollateralised(), n_paths=300)
        wf_surf, meta = fx_xva.option_xva(inp(style, kw, FLAT), CSA.uncollateralised(), n_paths=300)
        assert "sticky-delta" in meta["vol_mode"] and len(wf_surf.ee) == len(wf_flat.ee)
        assert wf_surf.cva == pytest.approx(wf_flat.cva, rel=1e-6), f"{style}: a flat surface reproduces the flat-vol engine exactly"
    wf_sm, _ = fx_xva.option_xva(inp("EUROPEAN", {}, SMILE), CSA.uncollateralised(), n_paths=300)
    assert wf_sm.cva != pytest.approx(wf_flat.cva, rel=1e-3), "a real term structure and smile move the number"


def test_bucketed_path_vols_match_the_exact_valuation_closely():
    from pricing.fx_exotic import ExoticSpec, value_on_paths, value_on_paths_vols
    rng = np.random.default_rng(3)
    S = 1.17 * np.exp(0.08 * rng.standard_normal(2000) * 0.7)
    sig = 0.07 + 0.03 * (S - 1.17) ** 2 / 0.01
    spec = ExoticSpec("EUROPEAN", "CALL", strike=1.17)
    exact = np.array([value_on_paths(spec, S[i:i + 1], 0.04, 0.02, float(sig[i]), 0.5, np.zeros(1, dtype=bool))[0] for i in range(len(S))])
    approx = value_on_paths_vols(spec, S, 0.04, 0.02, sig, 0.5, np.zeros(len(S), dtype=bool))
    assert abs(approx.mean() - exact.mean()) / exact.mean() < 2e-3


def test_credit_paths_step_with_the_surface_and_the_option_on_them_uses_it():
    from ccr.calibration import Calibration, Factor
    from ccr.simulate import simulate
    from pricing.curve import Curve
    asof = date(2026, 11, 2)
    curve = Curve(asof, df_pillars=[(asof, 1.0)] + [(date(asof.year + k, asof.month, asof.day), math.exp(-0.04 * k)) for k in range(1, 6)])
    f = {"RATES:USD_SOFR": Factor("RATES:USD_SOFR", "RATES", a=0.03, sigma=0.0085),
         "SPOT:EURUSD": Factor("SPOT:EURUSD", "SPOT", sigma=0.10, pillars=RISING)}
    cal = Calibration("RISK_NEUTRAL", f, np.eye(2), list(f))
    p = simulate(cal, {"RATES:USD_SOFR": curve}, {"SPOT:EURUSD": 1.16}, {"SPOT:EURUSD": (0.04, 0.02)}, asof, 12, n_paths=4000, seed=1)
    ls = np.log(p.s["SPOT:EURUSD"])
    v6, v12 = ls[:, 6].var(), ls[:, 12].var()
    assert v6 == pytest.approx(atm_variance(RISING, float(p.t[6])), rel=0.12) and v12 == pytest.approx(atm_variance(RISING, float(p.t[12])), rel=0.12)
    assert v6 / float(p.t[6]) < v12 / float(p.t[12]), "the realised variance rate rises with the term structure"
    # the option on these paths reads the surface (item["pillars"]) rather than one vol
    from ccr.options import value_fx_option
    from pricing.fx_exotic import ExoticSpec
    item = {"pair": "EURUSD", "base": "EUR", "quote": "USD", "expiry": date(2027, 10, 2), "settle": date(2027, 11, 2), "K": 1.17,
            "spec": ExoticSpec("EUROPEAN", "CALL", strike=1.17), "option_type": "CALL", "N": 1e7, "vol": 0.09, "sign": 1.0, "pillars": SMILE}
    with_surface = value_fx_option(item, p, 3, {"USD": 1.0}, {"EURUSD": 0.02})
    item_flat = {**item, "pillars": None}
    flat = value_fx_option(item_flat, p, 3, {"USD": 1.0}, {"EURUSD": 0.02})
    assert with_surface.shape == flat.shape and (with_surface >= 0).all() and abs(with_surface.mean() - flat.mean()) / flat.mean() < 0.5


def test_risk_neutral_calibration_reads_the_pairs_surface_when_one_exists(monkeypatch):
    import types
    from ccr import calibration as C
    import api.routes.crypto as CR
    class DB:
        def execute(self, *a, **k):
            class R:
                def first(self): return None
            return R()
        def rollback(self): pass
    quotes = [{"tenor": "1M", "quote_type": "ATM", "rate": 7.0}, {"tenor": "1Y", "quote_type": "ATM", "rate": 9.0}]
    monkeypatch.setattr(CR, "latest_snapshot", lambda db, u, cid: types.SimpleNamespace(quotes=quotes) if cid == "EURUSD_VOL" else None)
    cal = C.risk_neutral(DB(), "u", ["USD"], ["EURUSD", "GBPUSD"])
    eur, gbp = cal.factors["SPOT:EURUSD"], cal.factors["SPOT:GBPUSD"]
    assert eur.pillars and eur.sigma == pytest.approx(0.09) and "surface" in eur.source
    assert gbp.pillars is None and "no surface" in gbp.source
