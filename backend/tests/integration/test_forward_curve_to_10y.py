"""A forward curve on a real database, to ten years (0.22.0): a desk's points are saved with a tenor switched off,
the pair says which tenors are quotes, a forward beyond the last quote is parity plus that quote's basis held as a
rate and says it is implied, and a date between two quotes is as it always was. The rows written are removed at
the end, so the pinned book is valued on the seed's market as before."""
from __future__ import annotations

import math
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from tests.integration.conftest import USER_A

pytestmark = pytest.mark.integration
PAIR = "SOLUSD"
POINTS = {"3M": 1.10, "6M": 2.35, "1Y": 5.10, "2Y": 11.40, "3Y": 99.0}      # the 3Y is saved switched off


def _price(client, auth, days: int, **more) -> dict:
    r = client.post("/api/currency/forward/price", headers=auth,
                    json={"pair": PAIR, "base_notional": 100, "settlement_date": (date.today() + timedelta(days=days)).isoformat(), **more})
    assert r.status_code == 200, r.text[:400]
    return r.json()


@pytest.fixture
def curve(client, auth_a):
    from db.session import SessionLocal
    r = client.post("/api/currency/forward-curve", headers=auth_a, json={"pair": PAIR, "points": POINTS, "off": ["3Y"], "source": "MANUAL"})
    assert r.status_code == 200, r.text[:400]
    yield r.json()
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
                   {"u": USER_A, "c": f"{PAIR}_FWD", "d": date.today()})
        db.commit()
    finally:
        db.close()


def test_the_pair_says_which_tenors_are_quotes(client, auth_a, curve):
    assert curve["forward_points"] == {"3M": 1.10, "6M": 2.35, "1Y": 5.10, "2Y": 11.40}
    assert curve["forward_points_off"] == {"3Y": 99.0}
    assert curve["forward_points_extrapolated"] == []
    assert curve["forward_curve"]["tenors"] == ["3M", "6M", "1Y", "2Y"]
    pairs = client.get("/api/currency/pairs", headers=auth_a).json()
    assert pairs["forward_tenors"][-1] == "10Y" and pairs["tenor_days"]["10Y"] == 3650
    assert pairs["ticket_tenors"][-5:] == ["3Y", "4Y", "5Y", "7Y", "10Y"]
    row = next(p for p in pairs["pairs"] if p["pair"] == PAIR)
    assert row["tenor_dates"]["forward"]["10Y"] > row["tenor_dates"]["forward"]["2Y"]


def test_two_switched_on_tenors_are_needed(client, auth_a):
    r = client.post("/api/currency/forward-curve", headers=auth_a, json={"pair": PAIR, "points": {"1Y": 5.0, "2Y": 11.0}, "off": ["2Y"], "source": "MANUAL"})
    assert r.status_code == 422 and "switched on" in r.text


def test_inside_the_quotes_a_forward_is_as_it_was(client, auth_a, curve):
    at = _price(client, auth_a, 365)
    assert at["forward_kind"] == "QUOTED" and at["market_points"] == pytest.approx(5.10)
    assert at["forward"] == pytest.approx(at["spot"] + 5.10, rel=1e-9)
    mid = _price(client, auth_a, 500)
    assert mid["forward_kind"] == "INTERPOLATED" and mid["forward_method"] == "linear in time between 1Y and 2Y"
    assert mid["market_points"] == pytest.approx(5.10 + (11.40 - 5.10) * (500 - 365) / 365)
    assert "market points" in mid["forward_source"]


def test_beyond_the_last_quote_the_basis_is_held_as_a_rate_and_the_forward_is_called_implied(client, auth_a, curve):
    last = _price(client, auth_a, 730)
    assert last["forward_kind"] == "QUOTED"
    b = math.log((last["spot"] + 11.40) / last["implied_forward"]) / 2.0          # what the 2Y quote shows over parity, a year
    for days in (1095, 1825, 3650):
        r = _price(client, auth_a, days)
        assert r["forward_kind"] == "IMPLIED", days
        assert r["forward"] == pytest.approx(r["implied_forward"] * math.exp(b * days / 365.0), rel=1e-9), days
        assert r["forward_basis_rate_bp"] == pytest.approx(b * 1e4, abs=1e-6)
        assert r["forward_method"].startswith("parity plus the 2Y basis held flat as a rate")
        assert r["forward_source"].startswith("implied beyond the last quoted tenor (2Y")
    # the switched-off 3Y point (99.0) priced nothing: three years is implied from the 2Y, not quoted
    three = _price(client, auth_a, 1095)
    assert three["market_points"] != pytest.approx(99.0) and three["market_points"] > 11.40
    # and it is not the old rule, which held the 2Y points flat for ever
    ten = _price(client, auth_a, 3650)
    assert ten["market_points"] > 3 * 11.40


def test_priced_from_yields_every_forward_is_parity_and_says_so(client, auth_a, curve):
    r = client.post("/api/currency/forward-mode", headers=auth_a, json={"mode": "IMPLIED"})
    assert r.status_code == 200, r.text[:300]
    try:
        five = _price(client, auth_a, 1825)
        assert five["forward_kind"] == "IMPLIED" and five["forward"] == pytest.approx(five["implied_forward"])
        assert five["forward_basis_rate_bp"] is None
    finally:
        assert client.post("/api/currency/forward-mode", headers=auth_a, json={"mode": "MARKET"}).status_code == 200
