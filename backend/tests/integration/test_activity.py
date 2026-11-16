"""The activity record against the stack: a signed-in request that was answered becomes a counter of that account's
day, a refused one does not, the read-out is the admin's alone, and it counts accounts, not the platform's admins."""
import os

import pytest
import sqlalchemy as sa

from tests.integration.conftest import USER_A, USER_B, set_role

pytestmark = pytest.mark.integration


def _counters(uid: str) -> dict:
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.begin() as c:
            return {(r[0], r[1]): r[2] for r in c.execute(sa.text(
                "SELECT event, detail, n FROM activity_daily WHERE user_id = :u AND day = (now() AT TIME ZONE 'utc')::date"), {"u": uid}).all()}
    finally:
        eng.dispose()


def _wipe() -> None:
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.begin() as c:
            c.execute(sa.text("DELETE FROM activity_daily WHERE user_id IN (:a, :b)"), {"a": USER_A, "b": USER_B})
    finally:
        eng.dispose()


def test_an_answered_request_is_counted_for_its_account_and_a_refused_one_is_not(client, auth_a, auth_b, ids):
    from activity import store
    store.flush(); _wipe()
    assert client.get("/api/trades/", headers=auth_a).status_code == 200                        # seen, nothing more
    assert client.get("/api/risk/limits", headers=auth_a).status_code == 200                    # the risk view opened
    assert client.get("/api/me/booking-defaults", headers=auth_a).status_code == 200
    assert client.post("/api/book/trade", json={}, headers=auth_a).status_code == 422           # refused: not a booking
    assert client.get("/api/trades/").status_code in (401, 403)                                 # no account
    assert client.get("/api/ops/health").status_code == 200                                     # the operator's: nobody's
    assert client.get("/api/trades/", headers=auth_b).status_code == 200
    assert store.flush()["kept"] is True
    a, b = _counters(USER_A), _counters(USER_B)
    assert a == {("seen", ""): 3, ("risk", "market"): 1}
    assert b == {("seen", ""): 1}
    # a second flush adds to the day's row, it does not replace it
    assert client.get("/api/risk/limits", headers=auth_a).status_code == 200
    store.flush()
    assert _counters(USER_A) == {("seen", ""): 4, ("risk", "market"): 2}


def test_the_read_out_is_the_admins_and_counts_accounts(client, auth_a, auth_b):
    from activity import store
    store.flush()
    assert client.get("/api/ops/adoption", headers=auth_b).status_code == 403
    set_role(USER_A, "admin")
    try:
        r = client.get("/api/ops/adoption", headers=auth_a)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["recording"] is True and j["tracking_since"] is not None and len(j["weeks"]) == 8 and len(j["cohorts"]) == 6
        assert [f["step"] for f in j["funnel"]] == ["created", "returned", "priced", "booked", "xva", "confirmed"]
        emails = {row["email"] for row in j["rows"]}
        assert not any(e.endswith("@rijeka.test") for e in emails)                              # the journeys' accounts are not accounts
        assert j["accounts"] == j["rows_total"] and "admins" in j["note"]
    finally:
        set_role(USER_A, "trader")
    # the health report says whether the table is applied
    assert client.get("/api/ops/health").json()["schema"]["activity"]["applied"] is True
