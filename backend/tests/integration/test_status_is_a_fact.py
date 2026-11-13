"""A trade's status is a lifecycle fact, not a field: it changes only through /api/trade-events and /api/chain, where
the change is an event. Until 13 November 2026 PUT /api/trades/{id} took any status on a trade that was not anchored,
so a cancelled trade could be set back to PENDING and then confirmed (the owner: "i think you are able to cancel the
trade and then confirm it"), and a pending one set to CONFIRMED with no event and no signature."""
from __future__ import annotations

import uuid

import pytest

from tests.integration import bodies as B

pytestmark = pytest.mark.integration


def _key(auth: dict) -> dict:
    return {**auth, "Idempotency-Key": str(uuid.uuid4())}


def _booked(client, auth, ids) -> dict:
    r = client.post("/api/book/trade", json=B.swap(ids["a"], f"IT-ST-{uuid.uuid4().hex[:6].upper()}"), headers=auth)
    assert r.status_code == 201, r.text[:300]
    return r.json()["trade"]


def _trade(client, auth, tid) -> dict:
    return next(t for t in client.get("/api/trades/", headers=auth).json() if t["id"] == tid)


def _status(client, auth, tid) -> str:
    return _trade(client, auth, tid)["status"]


def _events(client, auth, tid) -> list:
    return [e["event_type"] for e in client.get(f"/api/trade-events/{tid}", headers=auth).json()]


def test_a_cancelled_trade_is_not_confirmed_by_any_route(client, auth_a, ids):
    tid = _booked(client, auth_a, ids)["id"]
    assert client.post(f"/api/trade-events/cancel/{tid}", headers=_key(auth_a), json={"reason": "booked in error"}).status_code == 201
    assert _status(client, auth_a, tid) == "CANCELLED"
    for route in (f"/api/chain/confirm/{tid}", f"/api/trade-events/confirm/{tid}", f"/api/trade-events/cancel/{tid}"):
        r = client.post(route, headers=_key(auth_a))
        assert r.status_code == 409 and "CANCELLED" in r.text, (route, r.text[:200])
    # and it is not brought back by editing it: the way round that was open
    for word in ("PENDING", "CONFIRMED", "LIVE"):
        r = client.put(f"/api/trades/{tid}", json={"status": word}, headers=auth_a)
        assert r.status_code == 409 and "status is not edited" in r.text, (word, r.text[:200])
    assert _status(client, auth_a, tid) == "CANCELLED"
    assert client.post(f"/api/chain/confirm/{tid}", headers=_key(auth_a)).status_code == 409
    assert _events(client, auth_a, tid) == ["CANCELLED", "BOOKED"], "nothing after the cancellation"


def test_a_pending_trade_is_confirmed_by_an_event_and_not_by_an_edit(client, auth_a, ids):
    t = _booked(client, auth_a, ids)
    tid = t["id"]
    for word in ("CONFIRMED", "CANCELLED", "TERMINATED", "NONSENSE"):
        r = client.put(f"/api/trades/{tid}", json={"status": word}, headers=auth_a)
        assert r.status_code == 409 and "status is not edited" in r.text, (word, r.text[:200])
    assert _status(client, auth_a, tid) == "PENDING" and _events(client, auth_a, tid) == ["BOOKED"]
    # an edit that carries the status it already has is an edit of the rest, as before
    r = client.put(f"/api/trades/{tid}", json={"status": "PENDING", "desk": "RATES NY"}, headers=auth_a)
    assert r.status_code == 200 and r.json()["status"] == "PENDING", r.text[:200]
    assert _trade(client, auth_a, tid)["desk"] == "RATES NY"
    # the routes that are for it still confirm it
    r = client.post(f"/api/chain/confirm/{tid}", headers=_key(auth_a))
    assert r.status_code == 201 and r.json()["trade"]["status"] == "CONFIRMED", r.text[:200]
    assert _events(client, auth_a, tid)[0] == "CONFIRMED"
    r = client.put(f"/api/trades/{tid}", json={"status": "PENDING"}, headers=auth_a)
    assert r.status_code == 409, "nor is a confirmed trade set back"


def test_a_trade_is_not_cancelled_or_confirmed_off_chain_while_its_confirmation_is_in_flight(client, auth_a, ids, stack):
    from chain import pending as P
    from db.session import SessionLocal
    t = _booked(client, auth_a, ids)
    tid = t["id"]
    db = SessionLocal()
    try:
        if not P.tables_present(db):
            pytest.skip("the stack has no pending_anchors table")
        P.record(db, trade_id=tid, user_id=ids["a"]["user_id"], trade_hash="0x" + "ab" * 32, attestation={"trade_hash": "0x" + "ab" * 32},
                 idempotency_key=None, tx_hash="0x" + "cd" * 32, explorer_tx=None)
        for route, word in ((f"/api/trade-events/cancel/{tid}", "cancelling it"), (f"/api/trade-events/confirm/{tid}", "confirming it off chain")):
            r = client.post(route, headers=_key(auth_a), json={} if "cancel" in route else None)
            assert r.status_code == 409 and "in flight on the registry" in r.text and word in r.text, (route, r.text[:200])
        assert _status(client, auth_a, tid) == "PENDING"
    finally:
        from sqlalchemy import text
        db.execute(text("DELETE FROM pending_anchors WHERE trade_id = :t"), {"t": tid}); db.commit()      # leave the trade free for the runs after
        db.close()
    assert client.post(f"/api/trade-events/cancel/{tid}", headers=_key(auth_a), json={}).status_code == 201, "with nothing in flight it cancels"


def test_a_trade_is_booked_pending_whatever_the_request_says(client, auth_a, ids):
    body = {**B.swap(ids["a"], f"IT-ST-{uuid.uuid4().hex[:6].upper()}"), "status": "CONFIRMED"}
    r = client.post("/api/book/trade", json=body, headers=auth_a)
    assert r.status_code in (201, 422), r.text[:200]
    if r.status_code == 201:
        assert r.json()["trade"]["status"] == "PENDING", "a status sent with a booking is not taken"


def test_a_cancel_that_lands_while_a_confirmation_waits_is_not_overwritten(client, auth_a, ids):
    """The confirm route loads the trade, then waits on the chain. A cancel in between used to be overwritten by the
    confirmation that followed. The flip is held to the status its caller loaded, read again under a lock."""
    from api.routes.trade_events import _apply_lifecycle_transition
    from db.models import Trade
    from db.session import SessionLocal
    from fastapi import HTTPException
    tid = _booked(client, auth_a, ids)["id"]
    db = SessionLocal()
    try:
        stale = db.query(Trade).filter(Trade.id == tid).first()          # what the confirm route holds while it waits
        assert stale.status == "PENDING"
        assert client.post(f"/api/trade-events/cancel/{tid}", headers=_key(auth_a), json={}).status_code == 201      # another request, meanwhile
        with pytest.raises(HTTPException) as e:
            _apply_lifecycle_transition(db=db, user_id=stale.user_id, trade=stale, event_type="CONFIRMED", new_status="CONFIRMED", payload={}, idempotency_key=None)
        assert e.value.status_code == 409 and "no longer pending" in e.value.detail and "CANCELLED" in e.value.detail
    finally:
        db.close()
    assert _status(client, auth_a, tid) == "CANCELLED" and _events(client, auth_a, tid) == ["CANCELLED", "BOOKED"]


def test_the_terms_and_the_legs_of_a_trade_that_is_not_pending_are_not_edited(client, auth_a, ids):
    j = client.post("/api/book/trade", json=B.swap(ids["a"], f"IT-ST-{uuid.uuid4().hex[:6].upper()}"), headers=auth_a).json()
    tid, leg, terms = j["trade"]["id"], j["legs"][0], dict(j["trade"].get("terms") or {})
    # pending: its terms are edited
    r = client.put(f"/api/trades/{tid}", json={"terms": {**terms, "note": "as agreed on the call"}}, headers=auth_a)
    assert r.status_code == 200, r.text[:200]
    assert client.post(f"/api/trade-events/cancel/{tid}", headers=_key(auth_a), json={}).status_code == 201
    r = client.put(f"/api/trades/{tid}", json={"terms": {**terms, "note": "changed after the cancel"}}, headers=auth_a)
    assert r.status_code == 409 and "its terms are not edited" in r.text, r.text[:200]
    r = client.put(f"/api/trade-legs/leg/{leg['id']}", json={"payment_calendar": "LONDON"}, headers=auth_a)
    assert r.status_code == 409 and "while its trade is PENDING" in r.text, r.text[:200]
    assert _trade(client, auth_a, tid)["terms"].get("note") == "as agreed on the call"
    # the desk it sits on is not a term: that is still an edit
    assert client.put(f"/api/trades/{tid}", json={"desk": "RATES LDN"}, headers=auth_a).status_code == 200


def test_the_generic_event_route_takes_no_signed_record_and_no_event_another_route_owns(client, auth_a, ids):
    from datetime import date
    tid = _booked(client, auth_a, ids)["id"]
    base = {"trade_id": tid, "event_date": date.today().isoformat(), "effective_date": date.today().isoformat()}
    forged = {"attestation": {"trade_hash": "0x" + "11" * 32, "anchor": {"anchored": True, "block_number": 1}}}
    r = client.post("/api/trade-events/", json={**base, "event_type": "STORE_CHANGE", "payload": forged}, headers=auth_a)
    assert r.status_code == 422 and "carries no attestation" in r.text, r.text[:200]
    for kind, route in (("CANCELLED", "/api/trade-events/cancel"), ("TERMINATED", "/api/chain/terminate"), ("AMENDED", "/api/chain/amend")):
        r = client.post("/api/trade-events/", json={**base, "event_type": kind, "payload": {}}, headers=auth_a)
        assert r.status_code == 409 and route in r.text, (kind, r.text[:200])
    assert _status(client, auth_a, tid) == "PENDING" and _events(client, auth_a, tid) == ["BOOKED"]
    att = client.get(f"/api/chain/attestation/{tid}", headers=auth_a)
    assert att.status_code != 200 or not (att.json() or {}).get("anchor"), "no confirmation was invented"
