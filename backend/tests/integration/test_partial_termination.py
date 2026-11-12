"""A partial termination over the API, on the stack (no chain: the record is signed and not anchored, so the booking
changes and the event says so; the anchored path is the chain journey's, frontend/e2e/chain). The trade stays on a
smaller notional, the fee joins its fees, the price and the XVA read the new notional, and what cannot be reduced is
refused in words."""
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
    """POST /price as the trade window sends it for a booked trade."""
    r = client.post("/price", json={"trade_id": tid, "valuation_date": ASOF, "curves": [{"curve_id": "USD_SOFR"}], "states": True}, headers=auth)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _partial(client, auth, tid, **body):
    return client.post(f"/api/chain/partial-terminate/{tid}", json=body, headers={**auth, "Idempotency-Key": str(uuid.uuid4())})


def test_a_pending_swap_is_reduced_on_the_trade_and_on_every_leg(client, auth_a, auth_b, ids):
    j = _book(client, auth_a, B.swap(ids["a"], f"IT-PT-SWAP-{_tag()}"))
    tid, n0 = j["trade"]["id"], float(j["trade"]["notional"])
    legs0 = {leg["id"]: float(leg["notional"]) for leg in j["legs"]}
    before = _price(client, auth_a, tid)
    pay = (date.today() + timedelta(days=2)).isoformat()
    r = _partial(client, auth_a, tid, new_notional=str(n0 * 0.4), fee={"direction": "RECEIVE", "amount": 12500, "date": pay})
    assert r.status_code == 201, r.text[:400]
    out = r.json()
    assert out["trade"]["status"] == "PENDING" and float(out["trade"]["notional"]) == pytest.approx(n0 * 0.4)
    assert {leg["id"]: float(leg["notional"]) for leg in out["legs"]} == {k: pytest.approx(v * 0.4) for k, v in legs0.items()}
    fees = out["trade"]["terms"]["fees"]
    assert fees[-1]["type"] == "UNWIND" and fees[-1]["direction"] == "RECEIVE" and fees[-1]["amount"] == 12500 and fees[-1]["date"] == pay
    ev = client.get(f"/api/trade-events/{tid}", headers=auth_a).json()
    assert [e["event_type"] for e in ev] == ["PARTIAL_TERMINATION", "BOOKED"]
    pt = ev[0]["payload"]["partial_termination"]
    assert float(pt["from_notional"]) == n0 and float(pt["to_notional"]) == pytest.approx(n0 * 0.4) and pt["anchored"] is False and pt["fee"]["amount"] == 12500
    assert ev[0]["counterparty_confirmed"] is False, "nothing is claimed about the counterparty when no record was signed"
    # the price reads the booking: 40 % of the notional is 40 % of the value and of the risk
    after = _price(client, auth_a, tid)
    assert abs(before["npv"]) > 1.0, "a swap off the par rate has a value to scale"
    assert after["npv"] == pytest.approx(0.4 * before["npv"], rel=1e-6, abs=0.02)
    assert after["ir01"] == pytest.approx(0.4 * before["ir01"], rel=1e-6, abs=0.01)
    # again, from the reduced notional; and the same request twice is one termination
    key = str(uuid.uuid4())
    again = [client.post(f"/api/chain/partial-terminate/{tid}", json={"new_notional": str(n0 * 0.1)}, headers={**auth_a, "Idempotency-Key": key}) for _ in range(2)]
    assert [x.status_code for x in again] == [201, 201] and float(again[1].json()["trade"]["notional"]) == pytest.approx(n0 * 0.1)
    assert [e["event_type"] for e in client.get(f"/api/trade-events/{tid}", headers=auth_a).json()].count("PARTIAL_TERMINATION") == 2
    # refused: not below, not zero, not another firm's trade, not a fee in the past
    for body, why in (({"new_notional": str(n0)}, "below the trade's"), ({"new_notional": "0"}, "above zero"),
                      ({"new_notional": str(n0 * 0.05), "fee": {"direction": "PAY", "amount": 5, "date": "2020-01-01"}}, "today or later")):
        bad = _partial(client, auth_a, tid, **body)
        assert bad.status_code == 422 and why in bad.text, bad.text[:300]
    assert _partial(client, auth_b, tid, new_notional="1").status_code == 404
    assert client.post(f"/api/chain/partial-termination-request/{tid}", json={"new_notional": "1"}, headers=auth_a).status_code == 409, "no anchored record to supersede"


def test_a_confirmed_digital_asset_forward_is_reduced_in_its_record_and_priced_on_what_is_left(client, auth_a, ids, pairs):
    btc = pairs["BTCUSD"]
    settle = (date.fromisoformat(ASOF) + timedelta(days=120)).isoformat()
    q = client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY", "settlement_date": settle,
                                                         "forward_rate": 100_000}, headers=auth_a)
    assert q.status_code == 200, q.text[:300]
    j = _book(client, auth_a, B.crypto_forward(ids["a"], f"IT-PT-CRF-{_tag()}", btc, q.json()))
    tid = j["trade"]["id"]
    assert client.post(f"/api/chain/confirm/{tid}", headers=auth_a).status_code == 201
    before = _price(client, auth_a, tid)
    r = _partial(client, auth_a, tid, new_notional="2.5", fee={"direction": "PAY", "amount": 900, "date": date.today().isoformat()})
    assert r.status_code == 201, r.text[:400]
    t = r.json()["trade"]
    assert t["status"] == "CONFIRMED" and float(t["notional"]) == 2.5 and float(t["terms"]["notional_amount"]) == 2.5
    assert t["terms"]["fees"][-1] == {"type": "UNWIND", "direction": "PAY", "amount": 900.0, "currency": "USD", "date": date.today().isoformat(),
                                      "note": "partial termination"}
    assert [e["event_type"] for e in client.get(f"/api/trade-events/{tid}", headers=auth_a).json()][:2] == ["PARTIAL_TERMINATION", "CONFIRMED"]
    after = _price(client, auth_a, tid)
    assert abs(before["npv"]) > 1.0, "a value to scale"
    assert after["npv"] == pytest.approx(0.25 * before["npv"], rel=1e-9, abs=0.01)
    assert after["spot01"] == pytest.approx(0.25 * before["spot01"], rel=1e-9)
    # with no chain the record that was signed is the old one, and verify says the booking has moved on from it
    v = client.post(f"/api/chain/verify/{tid}", headers=auth_a).json()
    assert v["hash_matches"] is False


def test_a_currency_forward_keeps_its_rate_and_its_cash_moves_with_the_notional(client, auth_a, ids, pairs):
    eur = pairs["EURUSD"]
    settle = (date.fromisoformat(ASOF) + timedelta(days=183)).isoformat()
    q = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": 10_000_000, "direction": "BUY",
                                                         "settlement_date": settle}, headers=auth_a)
    assert q.status_code == 200, q.text[:300]
    j = _book(client, auth_a, B.fx_forward(ids["a"], f"IT-PT-FXF-{_tag()}", eur, q.json()))
    t0 = j["trade"]
    r = _partial(client, auth_a, t0["id"], new_notional="4000000")
    assert r.status_code == 201, r.text[:400]
    t = r.json()["trade"]
    assert float(t["terms"]["base_notional"]) == 4_000_000 and float(t["terms"]["forward_rate"]) == float(t0["terms"]["forward_rate"])
    if t0["terms"].get("quote_notional") not in (None, ""):
        assert float(t["terms"]["quote_notional"]) == pytest.approx(0.4 * float(t0["terms"]["quote_notional"]), abs=0.01)
    assert _price(client, auth_a, t0["id"])["base_notional"] == 4_000_000
    assert "fees" not in t["terms"] or t["terms"]["fees"] == (t0["terms"].get("fees") or [])


def test_a_touch_and_a_terminal_trade_are_refused(client, auth_a, ids, pairs, booked):
    r = _partial(client, auth_a, booked["IR_SWAP"]["id"], new_notional="-1")
    assert r.status_code == 422
    j = _book(client, auth_a, B.swap(ids["a"], f"IT-PT-CXL-{_tag()}"))
    assert client.post(f"/api/trade-events/cancel/{j['trade']['id']}", headers={**auth_a, "Idempotency-Key": str(uuid.uuid4())}).status_code in (200, 201)
    gone = _partial(client, auth_a, j["trade"]["id"], new_notional="1")
    assert gone.status_code == 422 and "only a pending or confirmed trade" in gone.text


def test_one_leg_of_a_package_is_refused_before_and_after_it_is_confirmed(client, auth_a, ids, pairs):
    from tests.integration.test_chain import _package
    pk = _package(client, auth_a, ids, pairs, n=2, structure="CUSTOM", tag="PTP")
    tids = [t["id"] for t in pk["trades"]]
    r = _partial(client, auth_a, tids[0], new_notional="1")
    assert r.status_code == 409 and "one leg of a package" in r.text, r.text[:300]           # pending: the tag alone says so
    assert client.post("/api/chain/confirm-package", json={"trade_ids": tids}, headers={**auth_a, "Idempotency-Key": str(uuid.uuid4())}).status_code == 201
    r = _partial(client, auth_a, tids[1], new_notional="1")
    assert r.status_code == 409 and "package" in r.text, r.text[:300]


def test_a_number_no_trade_has_is_refused_and_costs_nothing(client, auth_a, booked):
    for bad in ("1E-999999999", "1E+25", "NaN", "Infinity"):
        r = _partial(client, auth_a, booked["IR_SWAP"]["id"], new_notional=bad)
        assert r.status_code == 422, (bad, r.status_code, r.text[:200])

