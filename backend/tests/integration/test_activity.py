"""The activity record against the stack: a deliberate act of a signed-in account becomes a counter of that account's
day, what the app asks for by itself and what was refused do not, the browser's own route keeps only the list's
words, a row goes with its account, and the read-out is the admin's alone."""
import os
import uuid

import pytest
import sqlalchemy as sa

from tests.integration.conftest import USER_A, USER_B, set_role

pytestmark = pytest.mark.integration


def _sql(statement: str, **params):
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.begin() as c:
            r = c.execute(sa.text(statement), params)
            return r.all() if r.returns_rows else None
    finally:
        eng.dispose()


def _counters(uid: str) -> dict:
    return {(r[0], r[1]): r[2] for r in _sql("SELECT event, detail, n FROM activity_daily WHERE user_id = :u", u=uid)}


def _fresh():
    from activity import store
    store.flush()                                                            # what earlier tests' requests left in the buffer
    _sql("DELETE FROM activity_daily WHERE user_id IN (:a, :b)", a=USER_A, b=USER_B)


def test_a_deliberate_act_is_counted_for_its_account_and_nothing_else_is(client, auth_a, auth_b):
    from activity import store
    _fresh()
    # the app's own reads, however many: nothing
    for path in ("/api/trades/", "/api/risk/limits", "/api/me/booking-defaults", "/api/collateral/instruments"):
        assert client.get(path, headers=auth_a).status_code == 200
    assert client.post("/api/book/trade", json={}, headers=auth_a).status_code == 422           # refused: not a booking
    assert client.post("/api/me/activity", json={"event": "view", "route": "/blotter"}).status_code in (401, 403)     # no account
    # what the browser says a person did
    assert client.post("/api/me/activity", json={"event": "view", "route": "/risk/ccr"}, headers=auth_a).json() == {"accepted": True}
    assert client.post("/api/me/activity", json={"event": "view", "route": "/risk/ccr?tab=2"}, headers=auth_a).json() == {"accepted": True}
    assert client.post("/api/me/activity", json={"event": "priced", "detail": "CRYPTO"}, headers=auth_a).json() == {"accepted": True}
    assert client.post("/api/me/activity", json={"event": "view", "route": "/a/private/address"}, headers=auth_a).json() == {"accepted": False}
    assert client.post("/api/me/activity", json={"event": "view", "route": "/blotter"}, headers=auth_b).json() == {"accepted": True}
    # and what the route alone says was deliberate
    assert client.post("/api/risk/limits", json={}, headers=auth_a).status_code in (200, 201, 422)
    assert store.flush()["kept"] is True
    a, b = _counters(USER_A), _counters(USER_B)
    assert a.pop(("risk", "limits saved"), 1) == 1                           # counted only if the save was accepted
    assert a == {("view", "counterparty risk"): 2, ("priced", "crypto"): 1}
    assert b == {("view", "blotter"): 1}
    # a second flush adds to the day's row, it does not replace it
    client.post("/api/me/activity", json={"event": "view", "route": "/risk/ccr"}, headers=auth_a)
    store.flush()
    assert _counters(USER_A)[("view", "counterparty risk")] == 3
    # nothing of the request is in the row: an address is its family, a detail is the list's word
    stored = _sql("SELECT DISTINCT event, detail FROM activity_daily WHERE user_id IN (:a, :b)", a=USER_A, b=USER_B)
    assert {tuple(r) for r in stored} <= {("view", "counterparty risk"), ("view", "blotter"), ("priced", "crypto"), ("risk", "limits saved")}


def test_a_row_goes_with_its_account_and_a_row_for_no_account_costs_only_itself(client, auth_a):
    from activity import store
    _fresh()
    gone = str(uuid.uuid4())
    _sql("INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) "
         "VALUES (:id, 'authenticated', 'authenticated', :e, '{}'::jsonb, '{}'::jsonb)", id=gone, e=f"{gone[:8]}@rijeka.test")
    store.add(gone, "view", "blotter")
    assert store.flush()["written"] == 1 and _counters(gone) == {("view", "blotter"): 1}
    _sql("DELETE FROM auth.users WHERE id = :id", id=gone)
    assert _counters(gone) == {}                                             # deleted with the account
    # its token may outlive it for an hour: its row is refused by the table, the other account's is still written
    store.add(gone, "view", "blotter"); store.add(USER_A, "view", "blotter")
    before = store._state["dropped"]
    assert store.flush() == {"written": 1, "kept": True}
    assert _counters(USER_A) == {("view", "blotter"): 1} and _counters(gone) == {} and store._state["dropped"] == before + 1


def test_the_read_out_is_the_admins_and_counts_accounts(client, auth_a, auth_b):
    from activity import store
    store.flush()
    assert client.get("/api/ops/adoption", headers=auth_b).status_code == 403
    set_role(USER_A, "admin")
    try:
        r = client.get("/api/ops/adoption", headers=auth_a)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["recording"] is True and j["unread"] == [] and j["dropped"] >= 0 and len(j["weeks"]) == 8 and len(j["cohorts"]) == 6
        assert [f["step"] for f in j["funnel"]] == ["created", "used", "returned", "priced", "booked", "xva", "confirmed"]
        assert not any(row["email"].endswith("@rijeka.test") for row in j["rows"])              # the journeys' accounts are not accounts
        assert j["accounts"] == j["rows_total"] and "admins" in j["note"] and "24 hours" in j["note"]
    finally:
        set_role(USER_A, "trader")
    assert client.get("/api/ops/health").json()["schema"]["activity"]["applied"] is True
