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

pytestmark = pytest.mark.usefixtures("monthly_steps")     # monthly steps, as these figures were worked (tests/conftest.py)

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
    V, p0, v0, rows = fx_xva.simulate_package_paths(legs, n_paths=400, keep_leg_paths=True)
    assert "paths" not in fx_xva.simulate_package_paths(legs, n_paths=50)[3][0], "a leg's matrix is kept only when asked for"
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
    # the add-on is SA-CCR's on the legs together: one hedging set, the two deltas cancel, so the capital is nothing too
    assert wf.kva == 0 and "foreign exchange class" in meta["capital_basis"]
    # the older CEM branch still adds the legs' notionals: stated, not hidden
    assert fx_xva.package_xva([buy, sell], CSA.uncollateralised(), n_paths=300, capital_model="cem")[0].kva < 0
    legs = [_fwd(t=0.25, strike=1.16), _fwd(t=0.5, direction="SELL", strike=1.18), _opt("CALL", "SELL", 1.22), _opt("PUT", "BUY", 1.12)]
    V, _, _, rows = fx_xva.simulate_package_paths(legs, n_paths=600, keep_leg_paths=True)
    assert [r["ee_gross_peak"] for r in rows] == pytest.approx([float(np.max(np.mean(np.maximum(r["paths"], 0.0), axis=0))) for r in rows])
    net = np.mean(np.maximum(V, 0.0), axis=0)
    gross = sum(np.mean(np.maximum(r["paths"], 0.0), axis=0) for r in rows)
    assert (net <= gross + 1e-6).all() and net.sum() < gross.sum(), "the set's expected exposure is at most the sum of the legs'"


def test_a_collar_is_the_put_less_the_call_on_every_path_and_margin_is_on_the_net_delta():
    put, call = _opt("PUT", "BUY", 1.12), _opt("CALL", "SELL", 1.22)
    V, _, v0, rows = fx_xva.simulate_package_paths([put, call], n_paths=300)
    Vp, _, v0p = fx_xva.simulate_option_paths(put, n_paths=300)
    Vc, _, v0c = fx_xva.simulate_option_paths(call, n_paths=300)
    assert np.allclose(V, Vp + Vc) and v0 == pytest.approx(v0p + v0c), "same grid, same draws: the legs' own runs add up"
    wf, meta = fx_xva.package_xva([put, call], CSA.on_chain(im_exchanged=True), n_paths=300)
    assert wf.im_0 > 0 and "engine's estimate" in meta["im_basis"] and "2 legs" in meta["model"]
    typed, _ = fx_xva.package_xva([put, call], CSA.on_chain(im_exchanged=True), n_paths=300, im_amount=2_000_000.0)
    assert typed.im_0 == 2_000_000.0 and set(typed.im_profile) == {2_000_000.0}, "the desk's amount, held for the life"


def test_a_settlement_between_two_grid_dates_is_carried_to_the_later_one_not_dropped():
    """Found by the validator: on the package's grid a leg that settles between two dates lost its last stretch."""
    nz = {}
    off = _fwd(t=0.2, strike=1.16)                       # settles between month 2 (0.1667) and month 3 (0.25)
    V, _, _, rows = fx_xva.simulate_package_paths([off, _fwd(t=1.0)], n_paths=300, keep_leg_paths=True, noise_out=nz)
    leg = rows[0]["paths"]
    assert leg[:, 2] == pytest.approx(1e7 * (1.17 * nz["m"][:, 2] - 1.16)), "month 3: the settled amount, nothing left to discount"
    assert leg[:, 1].any() and not leg[:, 3:].any()
    # an option expiring at 0.10 and settling at 0.12, between month 1 and month 2: its payoff stands at month 2
    opt = _opt("CALL", "BUY", 1.17, t=0.12)
    V, _, _, rows = fx_xva.simulate_package_paths([opt, _fwd(t=0.5)], n_paths=300, keep_leg_paths=True)
    o = rows[0]["paths"]
    assert (o[:, 1] >= 0).all() and o[:, 1].any() and not o[:, 2:].any(), "the payoff at the first date after it settles, then nothing"
    assert (o[:, 1] == 0).any(), "at that date it is a payoff (some paths out of the money), not a time value"


def test_margin_follows_the_legs_as_they_settle():
    """A calendar spread: the two legs ride one driver, so the set hardly moves while both stand and little margin
    is called; once the near leg has settled the margin is the far leg's own. (Found by the validator on the first
    version, which took margin on today's net sensitivity and ran it off to the longest leg.)"""
    far, near = _fwd(t=0.5, direction="BUY"), _fwd(t=0.25, direction="SELL")
    csa = CSA.on_chain(im_exchanged=True)
    wf, _ = fx_xva.package_xva([far, near], csa, n_paths=1000)
    alone, _ = fx_xva.forward_xva(far, csa, n_paths=1000)
    assert wf.im_profile[0] < 0.05 * alone.im_profile[0], "both legs standing: the set moves by the discounting between them only"
    assert wf.im_profile[4:] == pytest.approx(alone.im_profile[4:]), "from the month after the near leg settles: the far leg's margin as on its own"
    assert wf.im_received_profile[4:] == pytest.approx(alone.im_received_profile[4:])
    assert fx_xva.package_xva([far, near], CSA.uncollateralised(), n_paths=300)[0].im_0 == 0


def test_a_leg_that_settles_is_a_payment_not_a_move_in_the_margin_or_the_collateral():
    """Found by the validator: a 3M forward deep in the money beside a 1Y forward. The date after the near leg
    paid, the margin jumped to some 660,000 against 37,000 for the far leg alone: the cash that had left the set
    was read as a move over the margin period (and stood as collateral for a step)."""
    near = _fwd(t=0.25, strike=1.00, n=1e7)                 # some 1.7m in the money: it pays that at month 3
    far = _fwd(t=1.0, n=1e6)
    csa = CSA.bilateral()
    pkg, _ = fx_xva.package_xva([near, far], csa, n_paths=1500)
    alone, _ = fx_xva.forward_xva(far, csa, n_paths=1500)
    # from the first date after the settlement the set IS the far leg: its margin, each way, and its exposure
    assert pkg.im_profile[3:] == pytest.approx(alone.im_profile[3:], rel=1e-9)
    assert pkg.im_received_profile[3:] == pytest.approx(alone.im_received_profile[3:], rel=1e-9)
    assert pkg.ee[3:] == pytest.approx(alone.ee[3:], rel=1e-9, abs=1e-6) and pkg.ene[3:] == pytest.approx(alone.ene[3:], rel=1e-9, abs=1e-6)
    assert max(pkg.im_profile[3:]) < 3 * alone.im_profile[0], "no spike at the settlement"
    # and without the correction the spike is there: the same paths with no record of what settled
    nz = {}
    V, p0, v0, _ = fx_xva.simulate_package_paths([near, far], n_paths=1500, noise_out=nz)
    assert nz["settled"] is not None and not nz["settled"][:, :3].any() and nz["settled"][:, 3:].any()
    from pricing.xva_engine import WaterfallParams, run_waterfall
    raw = run_waterfall(V, v0, p0, WaterfallParams(notional=1.0, maturity_y=1.0, dt=1 / 12, theta=0.04), csa)
    assert raw.im_profile[3] > 5 * pkg.im_profile[3], "what the validator saw"
    # a package whose legs all end together has nothing settling early: the run is untouched
    fx_xva.simulate_package_paths([_fwd(t=0.5), _fwd(t=0.5, direction="SELL", strike=1.2)], n_paths=50, noise_out=nz)
    assert nz["settled"] is None


def test_the_older_capital_model_takes_the_legs_own_add_ons_too():
    one = _fwd(t=0.5)
    a, _ = fx_xva.forward_xva(one, CSA.uncollateralised(), n_paths=300, capital_model="cem")
    b, _ = fx_xva.package_xva([one], CSA.uncollateralised(), n_paths=300, capital_model="cem")
    assert b.kva == pytest.approx(a.kva, rel=1e-12) and b.ead_0 == pytest.approx(a.ead_0, rel=1e-12)
    grid, _, cem = fx_xva.package_addons([_fwd(t=0.25), _fwd(t=1.0)], CSA.uncollateralised(), 12, 1.0 / 12)
    _, _, cem_alone = fx_xva.package_addons([_fwd(t=1.0)], CSA.uncollateralised(), 12, 1.0 / 12)
    assert cem[0] > cem_alone[0] and cem[3:] == pytest.approx(cem_alone[3:]), "a settled leg's notional no longer counts"


def test_the_add_on_is_each_legs_own_while_it_is_alive():
    short, long_ = _fwd(t=0.25), _fwd(t=1.0)
    csa = CSA.uncollateralised()
    grid, unm, _ = fx_xva.package_addons([short, long_], csa, 12, 1.0 / 12)
    alone, _, _ = fx_xva.package_addons([long_], csa, 12, 1.0 / 12)
    assert unm is None and len(grid) == 12
    assert grid[0] > alone[0] and grid[1] > alone[1], "both legs alive in months 1 and 2"
    assert grid[3:] == pytest.approx(alone[3:]), "the 3M leg has settled: the long leg's add-on alone"
    assert grid[-1] > 0.0, "the step that ends on the last settlement is charged like the others (0.27.0)"
    assert grid[2] > alone[2], "and so is the step that ends on the short leg's settlement"
    g2, u2, _ = fx_xva.package_addons([short, long_], CSA.from_request({"preset": "BILATERAL"}), 12, 1.0 / 12)
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
