"""Recording a barrier over the API, on the stack: the record on the trade, the booked price reading it (a knock-out
is over, a knock-in is the plain option), the signed record untouched, and what is refused."""
import uuid
from datetime import date, timedelta

import pytest

from tests.integration import bodies as B

pytestmark = pytest.mark.integration

ASOF = date(2026, 11, 2)               # the stack's market (backend/stack/seed.py)


def _book_option(client, auth, ids, pairs, style, **style_over):
    btc = pairs["BTCUSD"]
    expiry = (date.today() + timedelta(days=90)).isoformat()
    q = client.post("/api/currency/option/price", json=B.option_price_request("BTCUSD", style, btc["spot"], expiry, True, 10), headers=auth)
    assert q.status_code == 200, q.text[:300]
    body = B.crypto_option(ids["a"], f"IT-KN-{uuid.uuid4().hex[:6].upper()}", btc, q.json(), style)
    body["terms"].update(style_over)
    r = client.post("/api/book/trade", json=body, headers=auth)
    assert r.status_code == 201, r.text[:400]
    return r.json()["trade"]


def _price(client, auth, tid, on=None):
    r = client.post("/price", json={"trade_id": tid, "valuation_date": (on or date.today()).isoformat(), "curves": [{"curve_id": "USD_SOFR"}], "states": True}, headers=auth)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _knock(client, auth, tid, **body):
    return client.post(f"/api/currency/knock/{tid}", json=body, headers=auth)


def test_a_knock_out_recorded_as_touched_is_over_and_the_record_can_be_taken_off(client, auth_a, auth_b, ids, pairs):
    t = _book_option(client, auth_a, ids, pairs, "BARRIER")                    # an up-and-out call with a rebate
    tid = t["id"]
    assert client.post(f"/api/chain/confirm/{tid}", headers=auth_a).status_code == 201
    before = _price(client, auth_a, tid)
    assert before["state"] == "LIVE" and before["npv"] > 0 and before["style"] == "BARRIER"
    today = date.today()
    r = _knock(client, auth_a, tid, knocked=True, on=today.isoformat(), level=151_200.5)
    assert r.status_code == 200, r.text[:300]
    terms = r.json()["trade"]["terms"]
    assert (terms["knocked"], terms["knock_date"], terms["knock_level"]) == (True, today.isoformat(), 151_200.5) and terms["knock_recorded"]["by"]
    assert {k: v for k, v in terms.items() if not k.startswith("knock")} == t["terms"], "no term of the trade changed"
    after = _price(client, auth_a, tid)
    assert after["state"] == "FIXED" and after["npv"] == 0 and after["spot01"] is None and after["vega"] is None
    assert "knocked out" in after["model"] and "rebate was paid at the hit" in after["model"] and after["fixing_date"] == today.isoformat()
    assert after["knock"] == {"knocked": True, "date": today.isoformat(), "level": 151_200.5, "outstanding": 0.0} and after["settlement_amount"] == 0
    # a client that does not read states is answered the option as booked, and told the trade is over
    old = client.post("/price", json={"trade_id": tid, "valuation_date": today.isoformat(), "curves": [{"curve_id": "USD_SOFR"}]}, headers=auth_a).json()
    assert old.get("state") != "FIXED" and old["npv"] > 0 and "knocked out" in old["model"] and "option as booked" in old["model"] and old["knock"] == {"knocked": True, "date": today.isoformat(), "level": 151_200.5, "outstanding": 0.0}
    # the signed record of the confirmation does not cover the knock state: it still verifies
    v = client.post(f"/api/chain/verify/{tid}", headers=auth_a).json()
    assert v["hash_matches"] is True
    # an XVA run has nothing left to simulate
    x = client.post("/api/xva/currency-option", json={"trade": {"instrument_type": "CRYPTO_OPTION", "terms": terms, "notional": 10, "maturity_date": t["maturity_date"]}, "paths": 200}, headers=auth_a)
    assert x.status_code == 422 and "nothing left to simulate" in x.text, x.text[:300]
    # taken off again, the option is priced as it was
    assert _knock(client, auth_a, tid, knocked=None).status_code == 200
    again = _price(client, auth_a, tid)
    assert again["state"] == "LIVE" and again["npv"] == pytest.approx(before["npv"], rel=1e-9)
    # refused: another firm's trade, a date before the trade or after today, 'never touched' before expiry
    assert _knock(client, auth_b, tid, knocked=True, on=today.isoformat()).status_code == 404
    for body, why in ((dict(knocked=True), "needs the date"), (dict(knocked=True, on=(today + timedelta(days=1)).isoformat()), "the earlier of today and the expiry"),
                      (dict(knocked=True, on="2020-01-01"), "between the trade date"), (dict(knocked=False), "once the option has expired")):
        bad = _knock(client, auth_a, tid, **body)
        assert bad.status_code == 422 and why in bad.text, bad.text[:300]


def test_a_knock_in_recorded_as_touched_is_priced_as_the_plain_option(client, auth_a, ids, pairs):
    t = _book_option(client, auth_a, ids, pairs, "BARRIER", barrier_type="UP_IN")
    tid = t["id"]
    alive = _price(client, auth_a, tid)
    assert _knock(client, auth_a, tid, knocked=True, on=date.today().isoformat()).status_code == 200
    plain = _price(client, auth_a, tid)
    assert plain["state"] == "LIVE" and plain["style"] == "EUROPEAN" and "knocked in" in plain["model"] and plain["knock"]["knocked"] is True
    # the plain call struck the same, priced directly
    q = client.post("/api/currency/option/price", json={"pair": "BTCUSD", "option_type": "CALL", "base_notional": 10, "direction": "BUY", "strike": float(t["terms"]["strike_price"]),
                                                        "expiry_date": t["terms"]["expiration_date"], "settlement_date": t["maturity_date"], "settlement_type": "NON_DELIVERABLE",
                                                        "valuation_date": date.today().isoformat()}, headers=auth_a)
    assert q.status_code == 200, q.text[:300]
    assert plain["npv"] == pytest.approx(q.json()["npv"], rel=1e-9) and plain["npv"] > alive["npv"] > 0, "a knock-in not yet in is worth less than the option it becomes"


def test_what_takes_no_record(client, auth_a, ids, pairs, booked):
    for key, why in (("IR_SWAP", "built for a digital asset's options"), ("CRYPTO_FORWARD", "built for a digital asset's options"), ("FX_OPTION_BARRIER", "built for a digital asset's options")):
        r = _knock(client, auth_a, booked[key]["id"], knocked=True, on=date.today().isoformat())
        assert r.status_code == 422 and why in r.text, (key, r.text[:200])
    plain = _book_option(client, auth_a, ids, pairs, "EUROPEAN")
    r = _knock(client, auth_a, plain["id"], knocked=True, on=date.today().isoformat())
    assert r.status_code == 422 and "has no barrier to record" in r.text
    assert _knock(client, auth_a, "not-a-uuid", knocked=True).status_code == 404
