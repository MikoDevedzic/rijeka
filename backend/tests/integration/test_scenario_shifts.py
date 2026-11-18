"""A scenario through the routes, on the stack's market: with no shift each route answers as it always has; with one
it answers the production pricer's figure on the moved market (a parallel bp of the curve moves the value by about
its IR01, a bp of vol by about its vega); a shift out of bounds is refused. The CURVE SCENARIO tab of a rates ticket
asks exactly these."""
from __future__ import annotations

import pytest

from tests.integration.test_golden_book import ASOF, EFF, MAT, _legs

pytestmark = pytest.mark.integration

CAP = {"notional": 10_000_000, "tenor_y": 5, "cap_rate": 0.04, "freq_per_year": 4, "curve_id": "USD_SOFR", "valuation_date": ASOF}
FLOOR = {"notional": 10_000_000, "tenor_y": 5, "floor_rate": 0.03, "freq_per_year": 4, "curve_id": "USD_SOFR", "valuation_date": ASOF}
COLLAR = {"notional": 10_000_000, "tenor_y": 5, "cap_rate": 0.045, "floor_rate": 0.025, "freq_per_year": 4, "curve_id": "USD_SOFR", "valuation_date": ASOF}
SWAPTION = {"notional": 10_000_000, "expiry_y": 1.0, "tenor_y": 5, "strike": 0.04, "vol_bp": 86.5, "is_payer": True, "pay_freq_y": 1.0,
            "valuation_date": ASOF, "curve_id": "USD_SOFR"}
OPTIONS = [("/api/price/cap", CAP, "npv", "ir01", "vega"), ("/api/price/floor", FLOOR, "npv", "ir01", "vega"),
           ("/api/price/collar", COLLAR, "net_npv", "net_ir01", "net_vega")]


def _post(client, auth, url, body):
    r = client.post(url, json=body, headers=auth)
    assert r.status_code == 200, f"{url}: {r.status_code} {r.text[:300]}"
    return r.json()


@pytest.mark.parametrize("url,body,npv,ir01,vega", OPTIONS)
def test_a_cap_floor_or_collar_without_a_shift_is_what_it_was_and_moves_by_its_sensitivities(client, auth_a, url, body, npv, ir01, vega):
    base = _post(client, auth_a, url, body)
    zero = _post(client, auth_a, url, {**body, "curve_flat_bp": 0, "curve_shift_bp": {}, "vol_shift_bp": 0})
    for k in (npv, ir01, vega):
        assert zero[k] == base[k], k
    # one bp on every quote of the curve: the production pricer on the moved curve, about its IR01
    up = _post(client, auth_a, url, {**body, "curve_flat_bp": 1})
    assert up[npv] != base[npv]
    # (the vol is held where the saved curve put the trade on the smile, so this is the IR01 the ticket shows)
    # to a tenth: the ticket's IR01 moves the forwards in parallel, the scenario moves the quotes the curve is built from
    assert up[npv] - base[npv] == pytest.approx(base[ir01], rel=0.10, abs=25.0)
    # one bp of vol on each leg, about the vega
    vol = _post(client, auth_a, url, {**body, "vol_shift_bp": 1})
    assert vol[npv] - base[npv] == pytest.approx(base[vega], rel=0.05, abs=5.0)
    # both at once is neither alone
    both = _post(client, auth_a, url, {**body, "curve_flat_bp": 1, "vol_shift_bp": 1})
    assert both[npv] not in (up[npv], vol[npv], base[npv])


def test_a_tenors_own_shift_adds_to_the_flat_one(client, auth_a):
    flat = _post(client, auth_a, "/api/price/cap", {**CAP, "curve_flat_bp": 10})
    one = _post(client, auth_a, "/api/price/cap", {**CAP, "curve_shift_bp": {"5Y": 10}})
    base = _post(client, auth_a, "/api/price/cap", CAP)
    assert one["npv"] != base["npv"] and one["npv"] != flat["npv"]
    # a tenor the curve does not quote moves nothing
    none = _post(client, auth_a, "/api/price/cap", {**CAP, "curve_shift_bp": {"77Y": 50}})
    assert none["npv"] == base["npv"]


def test_a_swap_and_a_swaption_take_the_same_shift(client, auth_a):
    curves = [{"curve_id": "USD_SOFR", "quotes": []}]
    base = _post(client, auth_a, "/price/preview", {"legs": _legs(0.0375), "valuation_date": ASOF, "curves": curves})
    zero = _post(client, auth_a, "/price/preview", {"legs": _legs(0.0375), "valuation_date": ASOF, "curves": [{**curves[0], "shift_flat_bp": 0, "shift_bp": {}}]})
    assert zero["npv"] == base["npv"] and zero["ir01"] == base["ir01"]
    up = _post(client, auth_a, "/price/preview", {"legs": _legs(0.0375), "valuation_date": ASOF, "curves": [{**curves[0], "shift_flat_bp": 1}]})
    # a basis point on every quote against the ticket's IR01, which is a basis point on the zero curve: the two differ
    # with the curve's shape (the reference suite bounds the difference at 3.5 % of DV01; 2.3 % on the stack's curve)
    assert up["npv"] - base["npv"] == pytest.approx(base["ir01"], rel=0.035, abs=5.0)

    sw = _post(client, auth_a, "/api/price/swaption", {**SWAPTION, "effective_date": EFF, "maturity_date": MAT})
    sw0 = _post(client, auth_a, "/api/price/swaption", {**SWAPTION, "effective_date": EFF, "maturity_date": MAT, "curve_flat_bp": 0})
    assert sw0["npv"] == sw["npv"]
    sw1 = _post(client, auth_a, "/api/price/swaption", {**SWAPTION, "effective_date": EFF, "maturity_date": MAT, "curve_flat_bp": 1})
    assert sw1["npv"] != sw["npv"]
    assert sw1["npv"] - sw["npv"] == pytest.approx(sw["ir01"], rel=0.15, abs=25.0)

    # at the money (no strike sent): the moved curve prices the strike the saved curve gave, not a new one
    atm = {k: v for k, v in SWAPTION.items() if k != "strike"}
    a0 = _post(client, auth_a, "/api/price/swaption", {**atm, "effective_date": EFF, "maturity_date": MAT})
    a1 = _post(client, auth_a, "/api/price/swaption", {**atm, "effective_date": EFF, "maturity_date": MAT, "curve_flat_bp": 10})
    assert a1["strike"] == a0["strike"]
    # ... at the vol it priced at (the pricer reads another vol off the surface once the forward has left the strike)
    assert a1["npv"] - a0["npv"] == pytest.approx(a0["dv01_curve"] * 10, rel=0.15, abs=50.0)
    up, dn = (_post(client, auth_a, "/api/price/swaption", {**atm, "effective_date": EFF, "maturity_date": MAT, "curve_flat_bp": bp}) for bp in (1, -1))
    assert up["npv"] - a0["npv"] == pytest.approx(a0["dv01_curve"], rel=0.1, abs=5.0)
    assert dn["npv"] - a0["npv"] == pytest.approx(-a0["dv01_curve"], rel=0.1, abs=5.0)          # down is down: no jump at the money
    # a vol shift moves the vol it priced at, by about the vega a bp; a typed strike away from the money too
    v1 = _post(client, auth_a, "/api/price/swaption", {**atm, "effective_date": EFF, "maturity_date": MAT, "vol_shift_bp": 1})
    assert v1["npv"] - a0["npv"] == pytest.approx(a0["vega"], rel=0.05, abs=5.0)
    otm = _post(client, auth_a, "/api/price/swaption", {**SWAPTION, "effective_date": EFF, "maturity_date": MAT})
    otm1 = _post(client, auth_a, "/api/price/swaption", {**SWAPTION, "effective_date": EFF, "maturity_date": MAT, "vol_shift_bp": 1})
    assert otm1["npv"] - otm["npv"] == pytest.approx(otm["vega"], rel=0.05, abs=5.0)
    zero = _post(client, auth_a, "/api/price/swaption", {**SWAPTION, "effective_date": EFF, "maturity_date": MAT, "vol_shift_bp": 0, "curve_flat_bp": 0})
    assert zero["npv"] == otm["npv"] and zero["vol_bp"] == otm["vol_bp"]


def test_the_saved_curve_shifted_is_the_curve_of_its_own_quotes_sent_shifted(client, auth_a):
    """The two branches of the curve builder against each other: the saved snapshot moved by the server, and the same
    quotes read from the snapshot, moved here and sent."""
    from api.routes.pricer import _map_qt
    snap = client.get("/api/market-data/snapshots/USD_SOFR/latest", headers=auth_a).json()
    assert snap["exists"] and len(snap["quotes"]) > 10
    own = {"5Y": 7.0, "2Y": -3.0}
    sent = [{"tenor": q["tenor"], "quote_type": _map_qt(q.get("quote_type", "OIS")), "rate": float(q["rate"]) / 100 + (2.0 + own.get(q["tenor"], 0.0)) / 10000.0}
            for q in snap["quotes"] if q.get("enabled", True) and q.get("rate") is not None]
    body = {"legs": _legs(0.0375), "valuation_date": ASOF}
    by_server = _post(client, auth_a, "/price/preview", {**body, "curves": [{"curve_id": "USD_SOFR", "quotes": [], "shift_flat_bp": 2.0, "shift_bp": own}]})
    by_hand = _post(client, auth_a, "/price/preview", {**body, "curves": [{"curve_id": "USD_SOFR", "quotes": sent}]})
    assert by_server["npv"] == pytest.approx(by_hand["npv"], abs=0.02)
    assert by_server["npv"] != _post(client, auth_a, "/price/preview", {**body, "curves": [{"curve_id": "USD_SOFR", "quotes": []}]})["npv"]


def test_a_receiver_and_a_swaption_away_from_the_money_move_with_the_curve_at_the_vol_they_priced_at(client, auth_a):
    dates = {"effective_date": "2027-11-04", "maturity_date": "2032-11-04"}
    for extra in ({"is_payer": False}, {"strike": 0.045}, {"strike": 0.03, "is_payer": False}):
        body = {**SWAPTION, **dates, **extra}
        base = _post(client, auth_a, "/api/price/swaption", body)
        up, dn = (_post(client, auth_a, "/api/price/swaption", {**body, "curve_flat_bp": bp}) for bp in (1, -1))
        assert up["npv"] - base["npv"] == pytest.approx(base["dv01_curve"], rel=0.1, abs=5.0), extra
        assert dn["npv"] - base["npv"] == pytest.approx(-base["dv01_curve"], rel=0.1, abs=5.0), extra
        assert up["strike"] == base["strike"]
        # the scenario's answer names the vol it priced at: the one the saved curve gave, typed or the surface's
        assert up["vol_bp"] == pytest.approx(base["sabr_vol_bp"] if base.get("is_sabr_vol") else base["vol_bp"], abs=1e-6)
    # a vol shift far below zero stops at the floor and still prices
    low = _post(client, auth_a, "/api/price/swaption", {**SWAPTION, **dates, "vol_shift_bp": -1000})
    assert low["vol_bp"] == pytest.approx(0.01) and low["npv"] >= 0


def test_a_bermudans_vol_shift_moves_the_models_own_sigma_and_its_curve_shift_the_tree(client, auth_a):
    """A Bermudan is priced on the Hull-White tree at the model's σ, one number. A vol shift moves that σ (not the
    swaption surface), the answer names the σ it priced at, and a basis point of it is the vega the ticket reports."""
    berm = {**SWAPTION, "expiry_y": 5.0, "structure": "BERMUDAN", "exercise_schedule_y": [1, 2, 3, 4, 5], "effective_date": "2031-11-04", "maturity_date": "2036-11-04"}
    base = client.post("/api/price/swaption", json=berm, headers=auth_a)
    if base.status_code != 200:          # the stack has no Hull-White calibration: the tree cannot price, with or without a shift
        assert base.status_code == 422 and client.post("/api/price/swaption", json={**berm, "vol_shift_bp": 5}, headers=auth_a).status_code == 422
        pytest.skip("the stack holds no Hull-White calibration: a Bermudan's σ shift is not exercised")
    b = base.json()
    up = _post(client, auth_a, "/api/price/swaption", {**berm, "vol_shift_bp": 1})
    dn = _post(client, auth_a, "/api/price/swaption", {**berm, "vol_shift_bp": -1})
    assert up["vol_bp"] == pytest.approx(b["vol_bp"] + 1) and up["hw1f_params"]["sigma_bp"] == up["vol_bp"]
    assert up["npv"] > b["npv"] > dn["npv"]                                          # an option is worth more at a higher vol
    # the route's own vega is the central bump of one basis point either side: this holds the shift to the same σ the
    # vega is of (it would fail if the shift went to a surface vol), not the tree's own correctness, which the
    # Jamshidian comparison holds (figures rounded to cents)
    assert (up["npv"] - dn["npv"]) / 2 == pytest.approx(b["vega"], abs=0.02)
    assert up["npv"] - b["npv"] == pytest.approx(b["vega"], rel=0.05)                # one-sided, as a scenario shifts it: the vega to first order
    low = _post(client, auth_a, "/api/price/swaption", {**berm, "vol_shift_bp": -1000})
    assert low["vol_bp"] == pytest.approx(0.01) and low["vega"] is None              # floored and still priced; no vega where the bump below would be a negative σ
    moved = _post(client, auth_a, "/api/price/swaption", {**berm, "curve_flat_bp": 10})
    assert moved["npv"] != b["npv"] and moved["vol_bp"] == b["vol_bp"]               # the curve moves the tree, not the σ


@pytest.mark.parametrize("freq", [1, 2, 4, 12])
def test_a_collar_is_its_cap_less_its_floor_at_the_tickets_own_frequency(client, auth_a, freq):
    """A collar is a cap bought and a floor sold on the same periods: the ticket's. Until 0.44.2 the route priced both
    legs quarterly whatever frequency the ticket sent, so a semi-annual, annual or monthly collar was not the cap
    less the floor that the cap and floor tickets price at that frequency. With a scenario's shifts as without."""
    for shift in ({}, {"curve_flat_bp": 10, "vol_shift_bp": 5}):
        collar = _post(client, auth_a, "/api/price/collar", {**COLLAR, "freq_per_year": freq, **shift})
        cap = _post(client, auth_a, "/api/price/cap", {**CAP, "cap_rate": COLLAR["cap_rate"], "freq_per_year": freq, **shift})
        floor = _post(client, auth_a, "/api/price/floor", {**FLOOR, "floor_rate": COLLAR["floor_rate"], "freq_per_year": freq, **shift})
        assert collar["n_caplets"] == cap["n_caplets"]                                   # the same periods
        assert collar["cap_npv"] == cap["npv"] and collar["floor_npv"] == floor["npv"]    # each leg is that ticket's own price
        assert collar["net_npv"] == pytest.approx(cap["npv"] - floor["npv"], abs=0.011)   # each figure is rounded to cents
        assert collar["net_ir01"] == pytest.approx(cap["ir01"] - floor["ir01"], abs=0.011)
        assert collar["net_vega"] == pytest.approx(cap["vega"] - floor["vega"], abs=0.011)
    quarterly = _post(client, auth_a, "/api/price/collar", {**COLLAR, "freq_per_year": 4})
    here = _post(client, auth_a, "/api/price/collar", {**COLLAR, "freq_per_year": freq})
    assert (here["n_caplets"] == quarterly["n_caplets"]) == (freq == 4)                  # another frequency is other periods
    assert _post(client, auth_a, "/api/price/collar", {k: v for k, v in COLLAR.items() if k != "freq_per_year"})["net_npv"] == quarterly["net_npv"]   # none sent: quarterly, as before


@pytest.mark.parametrize("url,body", [("/api/price/cap", CAP), ("/api/price/floor", FLOOR), ("/api/price/collar", COLLAR)])
def test_a_frequency_that_is_not_a_schedule_is_refused(client, auth_a, url, body):
    """The periods step a whole number of months. Nought was a 500, five priced fifty months as five years, and
    thirteen or a negative number priced the trade at nothing with a 200; the collar ignored the field until it
    read it. Each is now refused as terms, on all three routes."""
    for bad in (0, -1, 5, 7, 13, 365, 1000):
        r = client.post(url, json={**body, "freq_per_year": bad}, headers=auth_a)
        assert r.status_code == 422 and "freq_per_year" in r.text, (url, bad, r.status_code, r.text[:160])
    for good in (1, 2, 3, 4, 6, 12):
        assert client.post(url, json={**body, "freq_per_year": good}, headers=auth_a).status_code == 200, (url, good)


@pytest.mark.parametrize("url,body", [("/api/price/swaption", SWAPTION), ("/api/price/floor", FLOOR), ("/api/price/collar", COLLAR)])
@pytest.mark.parametrize("extra", [{"curve_flat_bp": 1001}, {"curve_shift_bp": {"5Y": -2000}}, {"vol_shift_bp": 5000}])
def test_every_route_refuses_a_shift_out_of_bounds(client, auth_a, url, body, extra):
    r = client.post(url, json={**body, **extra}, headers=auth_a)
    assert r.status_code == 422, (url, extra, r.text[:200])


@pytest.mark.parametrize("extra", [{"curve_flat_bp": 1001}, {"curve_shift_bp": {"5Y": -2000}}, {"vol_shift_bp": 5000}, {"curve_flat_bp": 600, "curve_shift_bp": {"5Y": 600}}])
def test_a_shift_out_of_bounds_is_refused(client, auth_a, extra):
    r = client.post("/api/price/cap", json={**CAP, **extra}, headers=auth_a)
    assert r.status_code == 422, r.text[:200]


def test_a_swaption_with_no_vol_in_its_request_prices_at_the_surfaces_point_and_says_so(client, auth_a):
    """0.57.0. Until then an absent vol was 86.5 bp whatever the expiry, the tenor or the day's surface. Now it is the
    nearest point of the desk's ATM swaption grid (the vol a booked option is revalued at), named in the answer; the
    ticket shows the same number before PRICE from GET /api/price/swaption/vol. A vol in the request is still the
    vol, and MANUAL."""
    from market_data import demo_feed as f
    bare = {k: v for k, v in SWAPTION.items() if k not in ("vol_bp", "strike")}
    typed = _post(client, auth_a, "/api/price/swaption", {**bare, "vol_bp": 86.5, "effective_date": EFF, "maturity_date": MAT})
    assert typed["vol_bp"] == 86.5 and typed["vol_tier"] == "MANUAL" and typed["vol_source"] is None

    read = _post(client, auth_a, "/api/price/swaption", {**bare, "effective_date": EFF, "maturity_date": MAT})
    grid = f.atm_normal_vol_bp(1, 5)                                         # the stack's surface, on its 1Yx5Y point
    assert read["vol_bp"] == pytest.approx(grid, abs=1e-9) and read["vol_tier"] == "QUOTED"
    assert read["vol_source"]["point"] == "1Yx5Y" and read["vol_source"]["asof"] and read["vol_source"]["source"] == "USD_SWVOL_ATM nearest point"
    assert read["npv"] == pytest.approx(typed["npv"] * grid / 86.5, rel=1e-6)   # at the money the price is proportional to the vol

    r = client.get("/api/price/swaption/vol", params={"curve_id": "USD_SOFR", "expiry_y": 1.0, "tenor_y": 5.0, "valuation_date": ASOF}, headers=auth_a)
    assert r.status_code == 200, r.text[:200]
    shown = r.json()
    assert shown["vol_bp"] == read["vol_bp"] and shown["tier"] == "QUOTED" and shown["point"] == "1Yx5Y" and shown["currency"] == "USD"
    # off the grid: three months of 92 days on a four-year swap is the nearest point's, and says which
    off = client.get("/api/price/swaption/vol", params={"curve_id": "USD_SOFR", "expiry_y": 92 / 365, "tenor_y": 4.0, "valuation_date": ASOF}, headers=auth_a).json()
    assert off["tier"] == "NEAREST" and off["point"] in ("1Yx3Y", "1Yx5Y") and off["vol_bp"] in (f.atm_normal_vol_bp(1, 3), f.atm_normal_vol_bp(1, 5))
    # a currency with no surface: the desk default, said
    eur = client.get("/api/price/swaption/vol", params={"curve_id": "EUR_ESTR", "expiry_y": 1.0, "tenor_y": 5.0, "valuation_date": ASOF}, headers=auth_a).json()
    assert eur["tier"] == "DEFAULT" and eur["vol_bp"] == 85.0 and eur["point"] is None
    # what is not a curve or not a number of years is refused; nobody without an account is answered
    assert client.get("/api/price/swaption/vol", params={"curve_id": "NOPE"}, headers=auth_a).status_code == 422
    assert client.get("/api/price/swaption/vol", params={"expiry_y": 0}, headers=auth_a).status_code == 422
    assert client.get("/api/price/swaption/vol").status_code in (401, 403)
    assert client.post("/api/price/swaption", json={**bare, "vol_bp": -1}, headers=auth_a).status_code == 422

