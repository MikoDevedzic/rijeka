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
    assert up["npv"] - base["npv"] == pytest.approx(base["ir01"], rel=0.02, abs=5.0)

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


@pytest.mark.parametrize("extra", [{"curve_flat_bp": 1001}, {"curve_shift_bp": {"5Y": -2000}}, {"vol_shift_bp": 5000}, {"curve_flat_bp": 600, "curve_shift_bp": {"5Y": 600}}])
def test_a_shift_out_of_bounds_is_refused(client, auth_a, extra):
    r = client.post("/api/price/cap", json={**CAP, **extra}, headers=auth_a)
    assert r.status_code == 422, r.text[:200]
