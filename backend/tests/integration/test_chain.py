"""Confirmation with no chain configured: the NullBackend stores the signed attestation off-chain, verify agrees,
and a confirmed trade can no longer be deleted."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


def test_chain_status_is_the_null_backend(client, auth_a):
    j = client.get("/api/chain/status", headers=auth_a).json()
    assert j["backend"] == "NullBackend" and j["anchored"] is False


def test_delete_of_a_booked_pending_trade_is_refused_because_it_has_a_lifecycle(client, auth_a, booked):
    r = client.delete(f"/api/trades/{booked['IR_SWAP']['id']}", headers=auth_a)
    assert r.status_code == 409, r.text


def test_confirm_flips_pending_to_confirmed_with_an_attestation_and_verify_passes(client, auth_a, auth_b, booked):
    tid = booked["IR_SWAP"]["id"]
    r = client.post(f"/api/chain/confirm/{tid}", headers=auth_a)
    assert r.status_code == 201, r.text[:500]
    j = r.json()
    assert j["trade"]["status"] == "CONFIRMED"
    ev = client.get(f"/api/trade-events/{tid}", headers=auth_a).json()
    assert [e["event_type"] for e in ev] == ["CONFIRMED", "BOOKED"]
    att = client.get(f"/api/chain/attestation/{tid}", headers=auth_a)
    assert att.status_code == 200
    a = att.json().get("attestation") or att.json()
    assert a["trade_hash"].startswith("0x") and a["bilateral"] is False
    assert a["parties"]["own"]["key_source"] == "dev" and a["parties"]["counterparty"]["key_source"] == "dev"
    assert a["anchor"]["anchored"] is False
    v = client.post(f"/api/chain/verify/{tid}", headers=auth_a)
    assert v.status_code == 200, v.text[:300]
    vj = v.json()
    assert vj["hash_matches"] is True and vj["signatures_valid_for_current_state"] is True and vj["on_chain"] is None
    # the other tenant cannot see or verify it
    assert client.post(f"/api/chain/verify/{tid}", headers=auth_b).status_code == 404
    assert client.post(f"/api/chain/confirm/{tid}", headers=auth_b).status_code == 404


def test_a_confirmed_trade_cannot_be_confirmed_again_or_deleted(client, auth_a, booked):
    tid = booked["IR_SWAP"]["id"]
    assert client.post(f"/api/chain/confirm/{tid}", headers=auth_a).status_code == 409
    d = client.delete(f"/api/trades/{tid}", headers=auth_a)
    # trades.py refuses a non-PENDING trade before it looks at the lifecycle: 400; a PENDING one with events: 409
    assert d.status_code in (400, 409), d.text
    assert client.get("/api/trades/", headers=auth_a).json() and any(t["id"] == tid and t["status"] == "CONFIRMED"
                                                                    for t in client.get("/api/trades/", headers=auth_a).json())


def test_fx_option_confirms_too(client, auth_a, booked):
    tid = booked["FX_OPTION"]["id"]
    r = client.post(f"/api/chain/confirm/{tid}", headers=auth_a)
    assert r.status_code == 201, r.text[:500]
    v = client.post(f"/api/chain/verify/{tid}", headers=auth_a).json()
    assert v["hash_matches"] and v["signatures_valid_for_current_state"] and v["canonical"]["product"]["product"] in ("FX_OPTION", "FX_NDO")


# ── a package of trades confirmed as one ─────────────────────────────────────────────────────────

def _package(client, auth_a, ids, pairs, n=3, structure="STRIP", tag="PK"):
    """Book n BTC forwards a month apart as one package; returns the booking answer."""
    from datetime import date, timedelta
    from tests.integration import bodies as B
    btc = pairs["BTCUSD"]
    legs = []
    for k in range(1, n + 1):
        q = client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "FORWARD", "base_notional": 10, "direction": "BUY",
                                                              "settlement_date": (date.today() + timedelta(days=31 * k)).isoformat()}, headers=auth_a)
        assert q.status_code == 200, q.text[:300]
        body = B.crypto_forward(ids["a"], f"{tag}-{k}", btc, q.json())
        del body["trade_ref"]                    # the package names its legs
        legs.append(body)
    r = client.post("/api/book/package", json={"structure": structure, "legs": legs}, headers=auth_a)
    assert r.status_code == 201, r.text[:400]
    return r.json()


def test_a_package_is_confirmed_as_one_record_and_each_leg_verifies(client, auth_a, auth_b, ids, pairs):
    from chain.canonical import package_hash, package_payload
    pk = _package(client, auth_a, ids, pairs)
    pid = pk["package"]["trade_id"]
    tids = [t["id"] for t in pk["trades"]]
    assert [t["trade_ref"] for t in pk["trades"]] == [f"{pid}-1", f"{pid}-2", f"{pid}-3"]

    # every leg, or none: two of the three are refused, and so is a trade that is not a leg
    r = client.post("/api/chain/confirm-package", json={"trade_ids": tids[:2]}, headers=auth_a)
    assert r.status_code == 422 and "not all the legs" in r.text
    assert client.post("/api/chain/confirm-package", json={"trade_ids": tids + [tids[0]]}, headers=auth_a).status_code == 422
    assert client.post("/api/chain/confirm-package", json={"trade_ids": tids[:1]}, headers=auth_a).status_code == 422
    assert client.post("/api/chain/confirm-package", json={"trade_ids": tids}, headers=auth_b).status_code == 404, "another tenant's"

    r = client.post("/api/chain/confirm-package", json={"trade_ids": list(reversed(tids))}, headers=auth_a)     # the order given is not a term
    assert r.status_code == 201, r.text[:500]
    j = r.json()
    H = j["package"]["hash"]
    assert j["package"]["trade_id"] == pid and j["package"]["legs"] == 3 and H.startswith("0x") and len(H) == 66
    assert [t["status"] for t in j["trades"]] == ["CONFIRMED"] * 3 and [t["trade_ref"] for t in j["trades"]] == [f"{pid}-1", f"{pid}-2", f"{pid}-3"]
    record = j["package"]["record"]
    assert record["schema"] == "rijeka-package" and len(record["legs"]) == 3 and record["legs"] == sorted(record["legs"])
    assert "0x" + package_hash(package_payload(record["legs"], record["parties"])).hex() == H

    leg_hashes = []
    for i, tid in enumerate(tids, start=1):
        a = client.get(f"/api/chain/attestation/{tid}", headers=auth_a).json()
        att = a["attestation"]
        assert a["status"] == "CONFIRMED" and a["anchored_hash"] == H
        assert att["package"]["hash"] == H and att["package"]["trade_id"] == pid and (att["package"]["leg"], att["package"]["of"]) == (i, 3)
        assert att["trade_hash"] != H and att["trade_hash"] in record["legs"], "the leg keeps its own record and hash"
        leg_hashes.append(att["trade_hash"])
        v = client.post(f"/api/chain/verify/{tid}", headers=auth_a).json()
        assert v["hash_matches"] is True and v["recomputed_hash"] == att["trade_hash"]
        assert v["package"] == {"trade_id": pid, "leg": i, "of": 3, "hash": H, "recomputed_hash": H, "hash_matches": True, "leg_in_package": True}
        assert v["signatures_valid_for_current_state"] is True, "both signatures are over the package's hash"
        p = client.get(f"/api/chain/proof/{tid}", headers=auth_a).json()
        # the proof's signed record is the package's (what a verifier that knows nothing of packages checks), with
        # this leg's own record beside it
        assert p["canonical"] == record and p["trade_hash"] == H
        assert p["leg"]["trade_hash"] == att["trade_hash"] and (p["leg"]["leg"], p["leg"]["of"]) == (i, 3) and p["leg"]["canonical"]["schema"] == "rijeka-trade"
        assert p["leg"]["canonical"] == v["canonical"] and p["package"]["trade_id"] == pid
        from chain.canonical import trade_hash_hex
        assert trade_hash_hex(p["leg"]["canonical"]) == att["trade_hash"] and att["trade_hash"] in p["canonical"]["legs"]
        assert any("one of `canonical.legs`" in step for step in p["how_to_verify"])
        ev = client.get(f"/api/trade-events/{tid}", headers=auth_a).json()
        assert [e["event_type"] for e in ev] == ["CONFIRMED", "BOOKED"]
    assert sorted(leg_hashes) == record["legs"] and len(set(leg_hashes)) == 3, "each leg has a UTI and a record of its own"
    # one signature pair for the package: the same on every leg
    sigs = {client.get(f"/api/chain/attestation/{t}", headers=auth_a).json()["attestation"]["parties"]["own"]["signature"] for t in tids}
    assert len(sigs) == 1

    # confirmed: not again, as a package or one by one; and one leg cannot be amended or terminated on its own yet
    assert client.post("/api/chain/confirm-package", json={"trade_ids": tids}, headers=auth_a).status_code == 409
    assert client.post(f"/api/chain/confirm/{tids[0]}", headers=auth_a).status_code == 409
    for path, method in ((f"/api/chain/terminate-request/{tids[1]}", client.get), ):
        r = method(path, headers=auth_a)
        assert r.status_code == 409 and f"leg 2 of 3 of package {pid}" in r.text, r.text[:300]
    r = client.post(f"/api/chain/amend-request/{tids[0]}", json={"changes": {"trade": {"notional": 11}}}, headers=auth_a)
    assert r.status_code == 409 and "one leg of a package" in r.text, r.text[:300]


def test_a_package_confirmation_is_idempotent_and_a_single_leg_can_still_go_alone_before_it(client, auth_a, ids, pairs):
    import uuid as _uuid
    pk = _package(client, auth_a, ids, pairs, n=2, structure="CUSTOM", tag="PKI")
    tids = [t["id"] for t in pk["trades"]]
    key = str(_uuid.uuid4())
    a = client.post("/api/chain/confirm-package", json={"trade_ids": tids}, headers={**auth_a, "Idempotency-Key": key})
    b = client.post("/api/chain/confirm-package", json={"trade_ids": tids}, headers={**auth_a, "Idempotency-Key": key})
    assert a.status_code == 201 and b.status_code == 201 and b.json()["package"]["hash"] == a.json()["package"]["hash"]
    # a second package, whole and pending: ONE leg is not anchored alone (found by review: it would leave the package
    # unable ever to be one record), and the refusal costs nothing
    pk2 = _package(client, auth_a, ids, pairs, n=2, structure="CUSTOM", tag="PKS")
    t1, t2 = (t["id"] for t in pk2["trades"])
    pid2 = pk2["package"]["trade_id"]
    r = client.post(f"/api/chain/confirm/{t1}", headers=auth_a)
    assert r.status_code == 409 and f"leg of package {pid2}" in r.text and "confirm-package" in r.text, r.text[:300]
    assert client.get(f"/api/trade-events/{t1}", headers=auth_a).json()[0]["event_type"] == "BOOKED"
    # once a leg has gone its own way (confirmed off-chain here) the package is no longer whole: it is refused as
    # one, and the other leg is confirmed on its own, with a record of its own
    assert client.post(f"/api/trade-events/confirm/{t1}", headers=auth_a).status_code in (200, 201)
    assert client.post("/api/chain/confirm-package", json={"trade_ids": [t1, t2]}, headers=auth_a).status_code == 409
    assert client.post(f"/api/chain/confirm/{t2}", headers=auth_a).status_code == 201
    v = client.post(f"/api/chain/verify/{t2}", headers=auth_a).json()
    assert v["package"] is None and v["hash_matches"] and v["signatures_valid_for_current_state"]


def test_only_the_server_writes_a_package_tag(client, auth_a, ids, pairs):
    """Found by review: the link was a text field any booking could set, so trades that were never booked together
    could be tagged as a package and confirmed as one."""
    from datetime import date, timedelta
    from tests.integration import bodies as B
    btc = pairs["BTCUSD"]
    q = client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "FORWARD", "base_notional": 10, "direction": "BUY",
                                                          "settlement_date": (date.today() + timedelta(days=45)).isoformat()}, headers=auth_a).json()
    forged = "STRIP TRD-00000001 1/2"
    body = B.crypto_forward(ids["a"], "FORGE-1", btc, q)
    assert client.post("/api/book/trade", json={**body, "strategy": forged}, headers=auth_a).status_code == 422
    flat = {k: v for k, v in body.items() if k != "legs"}
    assert client.post("/api/trades/", json={**flat, "trade_ref": "FORGE-2", "strategy": forged}, headers=auth_a).status_code == 422
    # an honest strategy is still the desk's to write and change, and the older ticket's own grouping tag is only text
    ok = client.post("/api/book/trade", json={**body, "strategy": "Macro hedge"}, headers=auth_a)
    assert ok.status_code == 201, ok.text[:300]
    tid = ok.json()["trade"]["id"]
    assert client.put(f"/api/trades/{tid}", json={"strategy": "STRIP PKG-ABCD1234 1/2"}, headers=auth_a).status_code == 200
    assert client.put(f"/api/trades/{tid}", json={"strategy": forged}, headers=auth_a).status_code == 422
    # a real leg's tag is not edited, so a leg cannot be taken out of its package or moved into another
    pk = _package(client, auth_a, ids, pairs, n=2, structure="CUSTOM", tag="PKT")
    leg = pk["trades"][0]
    assert client.put(f"/api/trades/{leg['id']}", json={"strategy": "Macro hedge"}, headers=auth_a).status_code == 422
    assert client.put(f"/api/trades/{leg['id']}", json={"strategy": leg["strategy"].replace("1/2", "2/2")}, headers=auth_a).status_code == 422
    assert client.put(f"/api/trades/{leg['id']}", json={"strategy": leg["strategy"]}, headers=auth_a).status_code == 200, "the same tag is no change"
    # trades tagged by the older ticket (a PKG- reference) are not a package the server booked: not confirmed as one
    r = client.post("/api/chain/confirm-package", json={"trade_ids": [tid, leg["id"]]}, headers=auth_a)
    assert r.status_code == 422 and "not a leg of a package" in r.text


def test_a_single_trade_is_not_a_package(client, auth_a, ids, pairs, booked):
    r = client.post("/api/chain/confirm-package", json={"trade_ids": [booked["IR_CAP"]["id"], booked["IR_FLOOR"]["id"]]}, headers=auth_a)
    assert r.status_code in (409, 422), r.text[:300]
    if r.status_code == 422:
        assert "not a leg of a package" in r.text


# ── An option on a rate is signed under record v3: the record states the option (0.61.0) ──────────────────────
def _confirmed(client, auth, body) -> tuple[dict, dict]:
    r = client.post("/api/book/trade", json=body, headers=auth)
    assert r.status_code == 201, r.text[:400]
    tid = r.json()["trade"]["id"]
    c = client.post(f"/api/chain/confirm/{tid}", headers=auth)
    assert c.status_code == 201, c.text[:500]
    att = client.get(f"/api/chain/attestation/{tid}", headers=auth).json()["attestation"]
    v = client.post(f"/api/chain/verify/{tid}", headers=auth)
    assert v.status_code == 200, v.text[:300]
    return att, v.json()


def test_a_sold_swaption_is_signed_as_an_option_its_counterparty_bought(client, auth_a, ids):
    import uuid
    from tests.integration import bodies as B
    tag = uuid.uuid4().hex[:6]
    sold = B.swaption(ids["a"], f"IT-SWPT-SOLD-{tag}"); sold["terms"]["side"] = "SELL"
    att, v = _confirmed(client, auth_a, sold)
    assert att["schema_version"] == 3
    assert v["hash_matches"] is True and v["signatures_valid_for_current_state"] is True
    rec = v["canonical"]
    assert rec["schema_version"] == 3
    booker, cp = att["parties"]["own"]["lei"], att["parties"]["counterparty"]["lei"]
    o = rec["option"]
    assert (o["type"], o["buyer"], o["seller"], o["right"]) == ("SWAPTION", cp, booker, "PAYER")
    assert (o["expiry_date"], o["strike"], o["exercise_style"], o["settlement"]) == ("2027-11-02", "0.04", "EUROPEAN", "PHYSICAL")
    assert (o["premium_amount"], o["premium_currency"], o["premium_payment_date"]) == ("25000", "USD", "2026-11-04")
    fixed = next(l for l in rec["legs"] if l["leg_type"] == "FIXED")
    assert (fixed["payer"], fixed["receiver"]) == (cp, booker), "the buyer of a payer swaption pays the fixed rate if it exercises"
    assert (fixed["effective_date"], fixed["maturity_date"]) == ("2027-11-04", "2032-11-03")
    assert "effective_date" not in rec["trade"] and "maturity_date" not in rec["trade"]
    # the same terms bought: another record, with the sides the other way
    bought = B.swaption(ids["a"], f"IT-SWPT-BOUGHT-{tag}")
    att2, v2 = _confirmed(client, auth_a, bought)
    assert v2["canonical"]["option"]["buyer"] == booker
    assert next(l for l in v2["canonical"]["legs"] if l["leg_type"] == "FIXED")["payer"] == booker
    # the proof pack carries the record that was signed, and the paper is printed from it
    assert v2["hash_matches"] is True and att2["schema_version"] == 3


def test_a_cap_is_signed_with_its_premium_and_a_swap_is_signed_as_it_always_was(client, auth_a, ids):
    import uuid
    from tests.integration import bodies as B
    tag = uuid.uuid4().hex[:6]
    att, v = _confirmed(client, auth_a, B.cap(ids["a"], f"IT-CAP-V3-{tag}"))
    booker, cp = att["parties"]["own"]["lei"], att["parties"]["counterparty"]["lei"]
    assert att["schema_version"] == 3 and v["hash_matches"] is True
    assert v["canonical"]["option"] == {"type": "CAP", "buyer": booker, "seller": cp, "premium_amount": "123456.78", "premium_currency": "USD",
                                        "premium_payment_date": "2026-11-04", "premium_payer": booker, "premium_receiver": cp}
    assert v["canonical"]["legs"][0]["embedded_options"][0]["default_strike"] == "0.045"
    att, v = _confirmed(client, auth_a, B.swap(ids["a"], f"IT-SWAP-V2-{tag}"))
    assert att["schema_version"] == 2 and v["canonical"]["schema_version"] == 2 and "option" not in v["canonical"] and v["hash_matches"] is True
