"""One state of a scenario for an option of any style (pricing/fx_exotic.scenario_npv, POST /api/currency/option/scenario):
the ticket's own state gives the ticket's own NPV, a shocked state is the pricer at those inputs, and a spot at or
beyond a barrier is valued as touched, which is the limit of the pricer's value as spot comes to the barrier."""
import math
from uuid import uuid4

import pytest

from pricing.fx_exotic import ExoticSpec, beyond_barrier, price_exotic, scenario_npv, value_touched

S0, R, RB, VOLA, T, N = 1.165, 0.0385, 0.02, 0.085, 0.5, 1e7
F0, DF0 = S0 * math.exp((R - RB) * T), math.exp(-R * T)
Q = 250_000.0

STYLES = {
    "american put": ExoticSpec("AMERICAN", "PUT", strike=1.17),
    "digital call, quote": ExoticSpec("DIGITAL", "CALL", strike=1.18, payout=Q),
    "digital put, base": ExoticSpec("DIGITAL", "PUT", strike=1.15, payout=Q, payout_currency="BASE"),
    "up-and-out call, rebate": ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=1.25, rebate=0.002),
    "up-and-in call, rebate": ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_IN", barrier=1.25, rebate=0.002),
    "down-and-out put": ExoticSpec("BARRIER", "PUT", strike=1.16, barrier_type="DOWN_OUT", barrier=1.08),
    "down-and-in put": ExoticSpec("BARRIER", "PUT", strike=1.16, barrier_type="DOWN_IN", barrier=1.08),
    "double knock-out call": ExoticSpec("DOUBLE_BARRIER", "CALL", strike=1.17, barrier_type="KNOCK_OUT", lower=1.08, upper=1.26),
    "double knock-in call": ExoticSpec("DOUBLE_BARRIER", "CALL", strike=1.17, barrier_type="KNOCK_IN", lower=1.08, upper=1.26),
    "one-touch up, at hit": ExoticSpec("TOUCH", touch_type="ONE_TOUCH", barrier=1.25, payout=Q, pay_at_hit=True),
    "one-touch down, at expiry": ExoticSpec("TOUCH", touch_type="ONE_TOUCH", barrier=1.08, payout=Q),
    "no-touch up": ExoticSpec("TOUCH", touch_type="NO_TOUCH", barrier=1.25, payout=Q),
    "double one-touch": ExoticSpec("TOUCH", touch_type="DOUBLE_ONE_TOUCH", lower=1.08, upper=1.26, payout=Q),
    "double no-touch": ExoticSpec("TOUCH", touch_type="DOUBLE_NO_TOUCH", lower=1.08, upper=1.26, payout=Q),
}
MARKET = dict(base_notional=N, spot=S0, forward=F0, df_quote=DF0, t_expiry=T, vol=VOLA)


@pytest.mark.parametrize("name", list(STYLES))
def test_the_tickets_own_state_gives_the_tickets_own_value_and_a_shocked_state_the_pricers(name):
    spec = STYLES[name]
    for direction in ("BUY", "SELL"):
        npv, hit = scenario_npv(spec, direction=direction, **MARKET)
        assert not hit and npv == price_exotic(spec, direction=direction, **MARKET).npv          # the same arithmetic, to the last bit
    # a shock that stays inside the barriers: spot +1 %, the forward with it and 8 pips more, +25 bp on the quote curve, +1.5 vol points
    there = dict(base_notional=N, spot=S0 * 1.01, forward=F0 * 1.01 + 0.0008, df_quote=DF0 * math.exp(-0.0025 * T), t_expiry=T, vol=VOLA + 0.015)
    npv, hit = scenario_npv(spec, spot_ref=S0, **there)
    assert not hit and npv == price_exotic(spec, **there).npv and npv != scenario_npv(spec, **MARKET)[0]


def _edges(spec):
    """(barrier, a step from the market's side towards it) for each barrier of the option."""
    if spec.style == "DOUBLE_BARRIER" or (spec.style == "TOUCH" and spec.touch_type.startswith("DOUBLE")):
        return [(spec.upper, -1.0), (spec.lower, 1.0)]
    return [(spec.barrier, -1.0 if spec.barrier > S0 else 1.0)]


@pytest.mark.parametrize("name", [k for k, s in STYLES.items() if s.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH")])
def test_touched_is_the_limit_of_the_pricer_at_the_barrier(name):
    """Inside the barrier the pricer; at it and beyond, the touched value. The two meet, so a scenario's value does
    not jump as a spot shock crosses. Close to a barrier the pricer's value is a straight line in the distance, so
    the line through its values two millionths and one millionth of spot inside, read at the barrier, is its limit:
    that limit is the touched value to a thousandth of the quote currency, on 10m of notional or a payout of 250,000
    (measured: within 0.00006 on every barrier of every style here). The gap a millionth inside is itself up to 14,
    which is why the limit is taken and not the nearest value."""
    spec = STYLES[name]
    scale = N if spec.style in ("BARRIER", "DOUBLE_BARRIER") else 1.0
    f = lambda s: F0 * s / S0                                       # the forward moves with spot, the carry held
    at_spot = lambda s: scenario_npv(spec, **{**MARKET, "spot": s, "forward": f(s)}, spot_ref=S0)
    for H, inward in _edges(spec):
        (two, hit_two), (one, hit_one) = at_spot(H * (1 + inward * 2e-6)), at_spot(H * (1 + inward * 1e-6))
        (v_at, hit_at), (_, hit_past) = at_spot(H), at_spot(H * (1 - inward * 0.02))
        assert not hit_two and not hit_one and hit_at and hit_past
        assert v_at == scale * value_touched(spec, H, R, R - math.log(f(H) / H) / T, VOLA, T)          # the function it says it is
        assert 2 * one - two == pytest.approx(v_at, abs=1e-3), f"{name} at {H}: the pricer's limit is {2 * one - two}, the touched value {v_at}"
        assert abs(one - v_at) <= 15.0                                                              # and no jump a screen would show


def test_what_a_touched_option_is_worth():
    f = lambda s: F0 * s / S0
    at = lambda spec, s, **kw: scenario_npv(spec, **{**MARKET, "spot": s, "forward": f(s), **kw}, spot_ref=S0)
    plain = lambda kind, K, s: price_exotic(ExoticSpec("EUROPEAN", kind, strike=K), **{**MARKET, "spot": s, "forward": f(s)}).npv
    # a knock-out is its rebate, paid at the touch, whatever the spot beyond; sold, it is owed
    assert at(STYLES["up-and-out call, rebate"], 1.27) == (pytest.approx(0.002 * N), True)
    assert at(STYLES["up-and-out call, rebate"], 1.30, direction="SELL") == (pytest.approx(-0.002 * N), True)
    assert at(STYLES["down-and-out put"], 1.05) == (0.0, True) and at(STYLES["double knock-out call"], 1.27) == (0.0, True)
    # a knock-in is the plain option at that spot: the knock-in's rebate is lost with the touch
    assert at(STYLES["up-and-in call, rebate"], 1.27)[0] == pytest.approx(plain("CALL", 1.17, 1.27), rel=1e-12)
    assert at(STYLES["down-and-in put"], 1.05)[0] == pytest.approx(plain("PUT", 1.16, 1.05), rel=1e-12)
    assert at(STYLES["double knock-in call"], 1.07)[0] == pytest.approx(plain("CALL", 1.17, 1.07), rel=1e-12)
    # a one-touch is its payout: in full when paid at the hit, discounted from settlement when paid at expiry
    assert at(STYLES["one-touch up, at hit"], 1.26) == (Q, True)
    assert at(STYLES["one-touch down, at expiry"], 1.07)[0] == pytest.approx(Q * DF0, rel=1e-12)
    assert at(STYLES["double one-touch"], 1.27)[0] == pytest.approx(Q * DF0, rel=1e-12)
    assert at(STYLES["no-touch up"], 1.26) == (0.0, True) and at(STYLES["double no-touch"], 1.07) == (0.0, True)
    # a single touch level stands on the side the market's spot says: 1.08 is below 1.165, so a spot above it has not touched
    assert not beyond_barrier(STYLES["one-touch down, at expiry"], 1.20, S0) and beyond_barrier(STYLES["one-touch down, at expiry"], 1.08, S0)
    # a style with no barrier is never touched
    assert not at(STYLES["american put"], 0.9)[1] and not at(STYLES["digital call, quote"], 2.0)[1]


def test_the_terms_are_checked_against_the_markets_spot_not_the_shocked_one():
    with pytest.raises(ValueError, match="above spot"):
        scenario_npv(ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=1.10), **MARKET)
    with pytest.raises(ValueError, match="positive"):
        scenario_npv(STYLES["american put"], **{**MARKET, "vol": 0.0})


def test_the_route(monkeypatch):
    from api.routes import currencies
    import main
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    spec = STYLES["up-and-out call, rebate"]
    body = {"option_type": "CALL", "direction": "BUY", "base_notional": N, "strike": 1.17, "t_expiry": T, "spot": S0, "style": "BARRIER",
            "barrier_type": "UP_OUT", "barrier": 1.25, "rebate": 0.002,
            "states": [{"spot": S0, "forward": F0, "df_quote": DF0, "vol_pct": VOLA * 100},
                       {"spot": 1.27, "forward": F0 * 1.27 / S0, "df_quote": DF0, "vol_pct": VOLA * 100}]}
    assert c.post("/api/currency/option/scenario", json=body).status_code in (401, 403)             # signed in, or nothing
    main.app.dependency_overrides[currencies.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    try:
        r = c.post("/api/currency/option/scenario", json=body)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["style"] == "BARRIER" and "survival" in j["method"]
        assert j["values"][0] == {"npv": price_exotic(spec, **MARKET).npv, "touched": False}
        assert j["values"][1] == {"npv": pytest.approx(0.002 * N), "touched": True}
        # terms the pricer refuses at the market's spot are the request's answer; a list too long is refused whole
        assert c.post("/api/currency/option/scenario", json={**body, "barrier": 1.10}).status_code == 422
        assert c.post("/api/currency/option/scenario", json={**body, "direction": "HOLD"}).status_code == 422
        assert c.post("/api/currency/option/scenario", json={**body, "states": body["states"][:1] * (currencies.SCENARIO_STATES_MAX + 1)}).status_code == 422
        assert c.post("/api/currency/option/scenario", json={**body, "states": []}).status_code == 422
        assert c.post("/api/currency/option/scenario", json={**body, "states": [{**body["states"][0], "vol_pct": 0}]}).status_code == 422
        # a market the pricer cannot value is that cell's answer; the others are priced
        monkeypatch.setattr(currencies, "scenario_npv", lambda spec, **kw: (_ for _ in ()).throw(OverflowError("x")) if kw["spot"] > 1.2 else (1.0, False))
        mixed = c.post("/api/currency/option/scenario", json=body).json()["values"]
        assert mixed[0] == {"npv": 1.0, "touched": False} and mixed[1]["npv"] is None and "pricer" in mixed[1]["error"]
    finally:
        main.app.dependency_overrides.clear()
