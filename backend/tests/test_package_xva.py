"""A package of legs on one pair as one netting set (pricing/fx_xva.package_xva): every leg valued by its own
engine on one grid and one driver, so the legs net path by path. The package engine is checked against the
single-leg engines it is made of (which the reference suite and the Excel replications check): a package of one leg
is that leg's own run draw for draw, a package's paths are the sum of its legs', and offsetting legs net to nothing."""
import numpy as np
import pytest

from pricing import fx_xva
from pricing.csa import CSA
from pricing.fx_exotic import ExoticSpec
from pricing.fx_vol import parse_surface

SMILE = parse_surface([{"tenor": "1M", "quote_type": "ATM", "rate": 7.0}, {"tenor": "1M", "quote_type": "RR25", "rate": 1.0}, {"tenor": "1M", "quote_type": "BF25", "rate": 0.3},
                       {"tenor": "1Y", "quote_type": "ATM", "rate": 9.0}, {"tenor": "1Y", "quote_type": "RR25", "rate": 1.5}, {"tenor": "1Y", "quote_type": "BF25", "rate": 0.4}])


def _fwd(t=0.5, direction="BUY", strike=1.17, forward=1.17, n=1e7, **kw):
    return fx_xva.ForwardXvaInput(pair="EURUSD", base_notional=n, forward=forward, strike=strike, t_years=t, df_quote_t=float(np.exp(-0.04 * t)),
                                  quote_zero=0.04, direction=direction, vol_pct=8.0, spot01=n * forward * 0.01 * (1 if direction == "BUY" else -1), **kw)


def _opt(option_type="CALL", direction="BUY", strike=1.17, style="EUROPEAN", t=0.5, **kw):
    spec = (ExoticSpec("TOUCH", "CALL", payout=1e6, touch_type="ONE_TOUCH", barrier=1.25) if style == "TOUCH"
            else ExoticSpec(style, option_type, strike=strike, **kw))
    return fx_xva.OptionXvaInput(pair="EURUSD", base_notional=1e7, spot=1.16, forward=1.17, t_expiry=t - 0.02, t_settle=t, df_quote_t=float(np.exp(-0.04 * t)),
                                 quote_zero=0.04, vol=0.08, spec=spec, direction=direction, spot01=50000.0)


SIX = ("cva", "dva", "fva", "fba", "kva", "mva", "colva")


@pytest.mark.parametrize("csa", [CSA.uncollateralised(), CSA.from_request({"preset": "BILATERAL"}), CSA.on_chain(im_exchanged=True)])
def test_a_package_of_one_forward_is_the_forward_on_its_own(csa):
    inp = _fwd()
    one, m1 = fx_xva.forward_xva(inp, csa, n_paths=500)
    pkg, m2 = fx_xva.package_xva([inp], csa, n_paths=500)
    assert np.array_equal(m1["_paths"], m2["_paths"]), "the same draws, the same grid, the same marks"
    for k in SIX + ("im_0", "ead_0"):
        assert getattr(pkg, k) == pytest.approx(getattr(one, k), rel=1e-12, abs=1e-9), k
    assert pkg.ee == pytest.approx(one.ee) and pkg.pfe == pytest.approx(one.pfe)


@pytest.mark.parametrize("style,kw", [("EUROPEAN", {}), ("AMERICAN", {}), ("DIGITAL", {"payout": 1e6}), ("BARRIER", {"barrier_type": "UP_OUT", "barrier": 1.25}),
                                      ("DOUBLE_BARRIER", {"barrier_type": "KNOCK_OUT", "lower": 1.05, "upper": 1.30}), ("TOUCH", {})])
@pytest.mark.parametrize("pillars", [None, SMILE])
def test_a_package_of_one_option_is_the_option_on_its_own(style, kw, pillars):
    inp = _opt(style=style, **kw)
    inp.pillars = pillars
    one, m1 = fx_xva.option_xva(inp, CSA.on_chain(im_exchanged=True), n_paths=300)
    pkg, m2 = fx_xva.package_xva([inp], CSA.on_chain(im_exchanged=True), n_paths=300)
    assert np.array_equal(m1["_paths"], m2["_paths"])
    for k in SIX + ("im_0", "ead_0"):
        assert getattr(pkg, k) == pytest.approx(getattr(one, k), rel=1e-12, abs=1e-9), (style, k)


def test_the_package_is_the_sum_of_its_legs_on_the_same_paths_and_a_leg_is_nothing_after_it_settles():
    legs = [_fwd(t=0.25, strike=1.16), _fwd(t=0.5, strike=1.17), _fwd(t=1.0, strike=1.18), _opt("PUT", "BUY", 1.12, t=0.75)]
    V, p0, v0, rows = fx_xva.simulate_package_paths(legs, n_paths=400)
    assert V.shape == (400, 12) and len(p0) == 14, "monthly to the longest settlement"
    assert np.allclose(V, sum(r["paths"] for r in rows)) and v0 == pytest.approx(sum(r["v0"] for r in rows))
    assert not rows[0]["paths"][:, 3:].any() and rows[0]["paths"][:, 2].any(), "the 3M forward: marks to month 3, nothing after"
    assert not rows[3]["paths"][:, 9:].any() and (rows[3]["paths"] >= -1e-6).all(), "the bought put: one-sided, gone after 9M"
    # each forward starts at its own price: N·(F − K)·DF
    assert rows[0]["v0"] == pytest.approx(1e7 * (1.17 - 1.16) * np.exp(-0.04 * 0.25))
    # one driver: at any grid date every forward of the pair has moved by the same factor
    nz = {}
    fx_xva.simulate_package_paths(legs[:3], n_paths=50, noise_out=nz)
    m = nz["m"]
    assert m.shape == (50, 12) and abs(float(m.mean()) - 1.0) < 0.05, "M is a martingale from 1"


def test_a_bought_and_a_sold_forward_net_to_nothing_and_netting_never_adds_exposure():
    buy, sell = _fwd(direction="BUY"), _fwd(direction="SELL")
    wf, meta = fx_xva.package_xva([buy, sell], CSA.uncollateralised(), n_paths=500)
    assert not meta["_paths"].any() and wf.cva == 0 and wf.dva == 0 and wf.fva == 0 and wf.fba == 0 and wf.im_0 == 0
    # stated limit: the capital add-on is the sum of the legs' add-ons, so KVA does not net to zero
    assert wf.kva < 0
    legs = [_fwd(t=0.25, strike=1.16), _fwd(t=0.5, direction="SELL", strike=1.18), _opt("CALL", "SELL", 1.22), _opt("PUT", "BUY", 1.12)]
    V, _, _, rows = fx_xva.simulate_package_paths(legs, n_paths=600)
    net = np.mean(np.maximum(V, 0.0), axis=0)
    gross = sum(np.mean(np.maximum(r["paths"], 0.0), axis=0) for r in rows)
    assert (net <= gross + 1e-6).all() and net.sum() < gross.sum(), "the set's expected exposure is at most the sum of the legs'"


def test_a_collar_is_the_put_less_the_call_on_every_path_and_margin_is_on_the_net_delta():
    put, call = _opt("PUT", "BUY", 1.12), _opt("CALL", "SELL", 1.22)
    V, _, v0, rows = fx_xva.simulate_package_paths([put, call], n_paths=300)
    Vp, _, v0p = fx_xva.simulate_option_paths(put, n_paths=300)
    Vc, _, v0c = fx_xva.simulate_option_paths(call, n_paths=300)
    assert np.allclose(V, Vp + Vc) and v0 == pytest.approx(v0p + v0c), "same grid, same draws: the legs' own runs add up"
    put.spot01, call.spot01 = -30000.0, -20000.0
    wf, meta = fx_xva.package_xva([put, call], CSA.on_chain(im_exchanged=True), n_paths=300)
    assert wf.im_0 == pytest.approx(50000.0 * fx_xva.SIMM_FX_RW_G10), "the weight on |−30,000 − 20,000|, not on each leg"
    assert "net spot sensitivity" in meta["im_basis"] and "2 legs" in meta["model"]


def test_the_add_on_is_each_legs_own_while_it_is_alive():
    short, long_ = _fwd(t=0.25), _fwd(t=1.0)
    csa = CSA.uncollateralised()
    grid, unm = fx_xva.package_addons([short, long_], csa, 12, 1.0 / 12)
    alone, _ = fx_xva.package_addons([long_], csa, 12, 1.0 / 12)
    assert unm is None and len(grid) == 12
    assert grid[0] > alone[0] and grid[1] > alone[1], "both legs alive in months 1 and 2"
    assert grid[3:] == pytest.approx(alone[3:]), "the 3M leg has settled: the long leg's add-on alone"
    assert grid[-1] == 0.0
    g2, u2 = fx_xva.package_addons([short, long_], CSA.from_request({"preset": "BILATERAL"}), 12, 1.0 / 12)
    assert u2 is not None and len(u2) == 12, "a margined set also carries the unmargined add-on, for the CRE52.2 cap"


def test_a_package_is_on_one_pair_and_has_a_leg():
    other = _fwd()
    other.pair = "GBPUSD"
    with pytest.raises(ValueError, match="same pair"):
        fx_xva.simulate_package_paths([_fwd(), other])
    with pytest.raises(ValueError, match="at least one leg"):
        fx_xva.simulate_package_paths([])


def test_the_route_refuses_what_is_not_a_currency_leg_and_names_the_leg():
    from fastapi import HTTPException
    from api.routes.xva import package_inputs
    from datetime import date
    with pytest.raises(HTTPException) as e:
        package_inputs(None, "u", [{"instrument_type": "IR_SWAP"}], val_date=date.today(), vol_pct=None, vol_mode="SURFACE")
    assert e.value.status_code == 422 and "leg 1" in e.value.detail
    with pytest.raises(HTTPException) as e:
        package_inputs(None, "u", [{"instrument_type": "FX_OPTION", "notional": 1e6, "terms": {"currency_pair": "EURUSD"}}], val_date=date.today(), vol_pct=None, vol_mode="SURFACE")
    assert e.value.status_code == 422 and "terms" in e.value.detail
