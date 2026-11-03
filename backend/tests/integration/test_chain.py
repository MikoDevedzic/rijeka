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
