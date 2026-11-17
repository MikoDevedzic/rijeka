"""An amendment of named terms over the API, on the stack (no chain: a record is signed and not anchored, so the
booking changes and the event says so; the anchored path is the chain journey's). A pending trade's change is a
correction, a confirmed trade's an amendment; the price reads the new terms; the signed record that stood before
is still the one shown; and what cannot be amended is refused in words."""
import uuid
from datetime import date, timedelta

import pytest

from tests.integration import bodies as B

pytestmark = pytest.mark.integration

ASOF = "2026-11-02"                    # the stack's market (backend/stack/seed.py)


def _book(client, auth, body) -> dict:
    r = client.post("/api/book/trade", json=body, headers=auth)
    assert r.status_code == 201, r.text[:400]
    return r.json()


def _tag() -> str:
    return uuid.uuid4().hex[:6].upper()


def _price(client, auth, tid):
    r = client.post("/price", json={"trade_id": tid, "valuation_date": ASOF, "curves": [{"curve_id": "USD_SOFR"}], "states": True}, headers=auth)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _amend(client, auth, tid, terms, **more):
    return client.post(f"/api/chain/amend-terms/{tid}", json={"terms": terms, **more}, headers={**auth, "Idempotency-Key": str(uuid.uuid4())})


def test_a_pending_swap_is_corrected_and_a_confirmed_one_amended_with_the_price_reading_the_new_terms(client, auth_a, auth_b, ids):
    j = _book(client, auth_a, B.swap(ids["a"], f"IT-AM-SWAP-{_tag()}"))
    tid, n0 = j["trade"]["id"], float(j["trade"]["notional"])
    fixed = next(leg for leg in j["legs"] if leg["leg_type"] == "FIXED")
    can = client.get(f"/api/chain/amendable/{tid}", headers=auth_a).json()
    assert can["kind"] == "CORRECTION" and can["anchored"] is False and can["why_not"] is None
    offered = {t["key"]: t for t in can["terms"]}
    assert set(offered) == {"notional", "fixed_rate", "spread"} and float(offered["fixed_rate"]["now"]) == pytest.approx(float(fixed["fixed_rate"]) * 100)
    before = _price(client, auth_a, tid)
    new_pct = float(offered["fixed_rate"]["now"]) + 0.25
    r = _amend(client, auth_a, tid, {"fixed_rate": str(new_pct)}, reason="coupon mistyped")
    assert r.status_code == 201, r.text[:400]
    out = r.json()
    assert out["trade"]["status"] == "PENDING"
    assert float(next(leg for leg in out["legs"] if leg["leg_type"] == "FIXED")["fixed_rate"]) == pytest.approx(new_pct / 100)
    if (j["trade"].get("terms") or {}).get("fixed_rate") is not None:
        assert out["trade"]["terms"]["fixed_rate"] == pytest.approx(new_pct / 100), "the copy the ticket reads moves with the leg"
    assert out["amendment"]["kind"] == "CORRECTION" and out["amendment"]["anchored"] is False and out["amendment"]["reason"] == "coupon mistyped"
    ev = client.get(f"/api/trade-events/{tid}", headers=auth_a).json()
    assert [e["event_type"] for e in ev] == ["AMENDED", "BOOKED"]
    assert ev[0]["counterparty_confirmed"] is False and "attestation" not in ev[0]["payload"], "nothing is claimed about a signature"
    assert ev[0]["payload"]["amendment"]["terms"][0]["key"] == "fixed_rate"
    after = _price(client, auth_a, tid)
    assert after["npv"] != pytest.approx(before["npv"], abs=1.0), "a quarter point on the coupon moves the value"
    assert after["ir01"] == pytest.approx(before["ir01"], rel=0.05), "and leaves the rate risk about where it was"

    # confirmed (signed, on no chain): an amendment; the notional goes up on the trade and every leg
    assert client.post(f"/api/chain/confirm/{tid}", headers=auth_a).status_code == 201
    signed = client.get(f"/api/chain/attestation/{tid}", headers=auth_a).json()["attestation"]
    assert signed and signed["trade_hash"]
    assert client.get(f"/api/chain/amendable/{tid}", headers=auth_a).json()["kind"] == "AMENDMENT"
    key = str(uuid.uuid4())
    twice = [client.post(f"/api/chain/amend-terms/{tid}", json={"terms": {"notional": str(n0 * 1.5), "spread": "10"}}, headers={**auth_a, "Idempotency-Key": key}) for _ in range(2)]
    assert [x.status_code for x in twice] == [201, 201], twice[0].text[:300]
    t2 = twice[1].json()
    assert float(t2["trade"]["notional"]) == pytest.approx(n0 * 1.5) and all(float(leg["notional"]) == pytest.approx(n0 * 1.5) for leg in t2["legs"])
    assert float(next(leg for leg in t2["legs"] if leg["leg_type"] == "FLOAT")["spread"]) == pytest.approx(0.001)
    ev = client.get(f"/api/trade-events/{tid}", headers=auth_a).json()
    assert [e["event_type"] for e in ev][:3] == ["AMENDED", "CONFIRMED", "AMENDED"], "the same request twice is one amendment"
    am = ev[0]["payload"]["amendment"]
    assert am["kind"] == "AMENDMENT" and am["increase"] is True and [t["key"] for t in am["terms"]] == ["notional", "spread"]
    assert _price(client, auth_a, tid)["ir01"] == pytest.approx(1.5 * after["ir01"], rel=0.02)
    # the record that was signed is still the one shown, and verify says the booking has moved on from it
    still = client.get(f"/api/chain/attestation/{tid}", headers=auth_a).json()["attestation"]
    assert still and still["trade_hash"] == signed["trade_hash"], "an unsigned change does not hide the signed record"
    assert client.post(f"/api/chain/verify/{tid}", headers=auth_a).json()["hash_matches"] is False

    # refused: a decrease, nothing changed, a term the trade does not have, another firm's trade, a viewer of nothing
    for terms, why in (({"notional": str(n0)}, "partially terminate"), ({"spread": "10"}, "already has"), ({"strike": "1"}, "has no strike"),
                       ({"maturity_date": "2031-01-01"}, "not a term an amendment can set"), ({}, "at least one term")):
        bad = _amend(client, auth_a, tid, terms)
        assert bad.status_code == 422 and why in bad.text, bad.text[:300]
    assert _amend(client, auth_b, tid, {"spread": "20"}).status_code == 404
    assert client.get(f"/api/chain/amendable/{tid}", headers=auth_b).status_code == 404
    assert client.post(f"/api/chain/amend-terms/{tid}", json={"terms": {"spread": "20"}}).status_code in (401, 403)


def test_a_digital_asset_forwards_price_and_a_currency_forwards_rate_are_amended_in_the_record(client, auth_a, ids, pairs):
    settle = (date.fromisoformat(ASOF) + timedelta(days=120)).isoformat()
    q = client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY", "settlement_date": settle,
                                                         "forward_rate": 100_000}, headers=auth_a)
    assert q.status_code == 200, q.text[:300]
    j = _book(client, auth_a, B.crypto_forward(ids["a"], f"IT-AM-CRF-{_tag()}", pairs["BTCUSD"], q.json()))
    tid = j["trade"]["id"]
    assert client.post(f"/api/chain/confirm/{tid}", headers=auth_a).status_code == 201
    before = _price(client, auth_a, tid)
    offered = {t["key"]: t for t in client.get(f"/api/chain/amendable/{tid}", headers=auth_a).json()["terms"]}
    assert set(offered) == {"notional", "forward_price"}
    p0 = float(offered["forward_price"]["now"])
    assert p0 == pytest.approx(float(j["trade"]["terms"]["forward_price"]))
    r = _amend(client, auth_a, tid, {"forward_price": str(round(p0 + 1000, 2))})
    assert r.status_code == 201, r.text[:400]
    t = r.json()["trade"]
    assert t["status"] == "CONFIRMED" and float(t["terms"]["forward_price"]) == pytest.approx(p0 + 1000, abs=0.01) and float(t["terms"]["notional_amount"]) == 10
    after = _price(client, auth_a, tid)
    # a bought forward struck 1,000 higher on 10 coins is worth 10,000 less, discounted
    assert before["npv"] - after["npv"] == pytest.approx(10_000, rel=0.05)

    settle = (date.fromisoformat(ASOF) + timedelta(days=183)).isoformat()
    q = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": 10_000_000, "direction": "BUY",
                                                         "settlement_date": settle}, headers=auth_a)
    assert q.status_code == 200, q.text[:300]
    f = _book(client, auth_a, B.fx_forward(ids["a"], f"IT-AM-FXF-{_tag()}", pairs["EURUSD"], q.json()))["trade"]
    rate = round(float(f["terms"]["forward_rate"]) + 0.01, 5)
    r = _amend(client, auth_a, f["id"], {"forward_rate": str(rate), "notional": "12000000"})
    assert r.status_code == 201, r.text[:400]
    t = r.json()["trade"]
    assert float(t["terms"]["forward_rate"]) == rate and float(t["terms"]["base_notional"]) == 12_000_000 and float(t["notional"]) == 12_000_000
    if f["terms"].get("quote_notional") not in (None, ""):
        assert float(t["terms"]["quote_notional"]) == pytest.approx(12_000_000 * rate, abs=0.01)
    assert _price(client, auth_a, f["id"])["base_notional"] == 12_000_000


def test_a_terminal_trade_a_package_leg_and_a_cap_are_refused_or_offered_only_what_they_have(client, auth_a, ids, booked):
    j = _book(client, auth_a, B.swap(ids["a"], f"IT-AM-CXL-{_tag()}"))
    assert client.post(f"/api/trade-events/cancel/{j['trade']['id']}", headers={**auth_a, "Idempotency-Key": str(uuid.uuid4())}).status_code in (200, 201)
    gone = _amend(client, auth_a, j["trade"]["id"], {"fixed_rate": "3"})
    assert gone.status_code == 422 and "only a pending or confirmed trade" in gone.text
    can = client.get(f"/api/chain/amendable/{j['trade']['id']}", headers=auth_a).json()
    assert can["terms"] == [] and "only a pending or confirmed trade" in can["why_not"]
    if "IR_CAP" in booked:
        keys = [t["key"] for t in client.get(f"/api/chain/amendable/{booked['IR_CAP']['id']}", headers=auth_a).json()["terms"]]
        assert "fixed_rate" not in keys and "strike" not in keys, "a cap's strike is not amended here yet"
