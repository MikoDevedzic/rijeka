"""Two bookings by one user inside one second get two references, against the real index (uq_trades_user_ref).

tests/test_trade_ref.py holds the same rule against a session that imitates the index; here it is PostgreSQL
that refuses the duplicate, the savepoint that survives it, and a second transaction that has to wait for the
first before it learns the name is taken.

The bookings are a user's of their own (user E, made here), so the book the other modules value is not touched. Each
test freezes the clock at a second of its own.
"""
from __future__ import annotations

import os
import re
import threading
import types
import uuid
from datetime import date

import pytest
import sqlalchemy as sa

pytestmark = pytest.mark.integration

USER_E = "0000000e-0000-4000-8000-0000000000ee"       # a, b, c and d are other modules' people and firms
SHAPE = re.compile(r"^TRD-\d{8}$")


@pytest.fixture(scope="module")
def auth_e(stack) -> dict:
    from middleware.auth import forget_role
    from stack.token import mint
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.begin() as c:
            c.execute(sa.text("INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) "
                              "VALUES (:id, 'authenticated', 'authenticated', 'user_e@rijeka.test', '{}'::jsonb, '{}'::jsonb) "
                              "ON CONFLICT (id) DO NOTHING"), {"id": USER_E})
            c.execute(sa.text("UPDATE profiles SET role = 'trader' WHERE id = :id"), {"id": USER_E})
    finally:
        eng.dispose()
    forget_role(USER_E)
    return {"Authorization": f"Bearer {mint(USER_E, 'user_e@rijeka.test', 'trader')}"}


@pytest.fixture
def at_second(monkeypatch):
    """Freeze the clock the reference is read from. Returns the function that sets the second."""
    from api.routes import _trade_ref

    def freeze(second: int) -> str:
        monkeypatch.setattr(_trade_ref, "time", types.SimpleNamespace(time=lambda: second + 0.25))
        return _trade_ref.generated_ref(second)
    return freeze


def _body(ref: str | None = None) -> dict:
    """The app's swap body with no parties (user E has none) and, unless given, no reference."""
    from tests.integration import bodies as B
    body = B.swap({"own_entity_id": None, "counterparty_id": None}, ref)
    if ref is None:
        del body["trade_ref"]
    return body


def _stored(trade_id: str) -> tuple:
    """(trade_ref on the row, trade_ref in the BOOKED event) as the database has them."""
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.connect() as c:
            row = c.execute(sa.text("SELECT trade_ref FROM trades WHERE id = :id"), {"id": trade_id}).scalar()
            ev = c.execute(sa.text("SELECT payload->'trade'->>'trade_ref' FROM trade_events WHERE trade_id = :id AND event_type = 'BOOKED'"), {"id": trade_id}).scalar()
            return row, ev
    finally:
        eng.dispose()


def _refs(client, auth) -> list:
    return [t["trade_ref"] for t in client.get("/api/trades/", headers=auth).json()]


def test_two_tickets_in_one_second(client, auth_e, at_second):
    clock = at_second(1_700_000_100)
    first = client.post("/api/trades/", json=_body(), headers=auth_e)
    second = client.post("/api/trades/", json=_body(), headers=auth_e)
    assert (first.status_code, second.status_code) == (200, 200), second.text            # the second was 500
    a, b = first.json(), second.json()
    assert a["trade_ref"] == clock == "TRD-00000100" and b["trade_ref"] == "TRD-00000101"
    assert {a["trade_ref"], b["trade_ref"]} <= set(_refs(client, auth_e))
    for t in (a, b):                                                                       # the row and its BOOKED event agree on the name
        assert _stored(t["id"]) == (t["trade_ref"], t["trade_ref"])
        assert [e["event_type"] for e in client.get(f"/api/trade-events/{t['id']}", headers=auth_e).json()] == ["BOOKED"]


def test_two_atomic_bookings_in_one_second(client, auth_e, at_second):
    at_second(1_700_000_200)
    first = client.post("/api/book/trade", json=_body(), headers=auth_e)
    second = client.post("/api/book/trade", json=_body(), headers=auth_e)
    assert (first.status_code, second.status_code) == (201, 201), second.text            # the second was 409
    a, b = first.json(), second.json()
    assert [a["trade"]["trade_ref"], b["trade"]["trade_ref"]] == ["TRD-00000200", "TRD-00000201"]
    for j in (a, b):                                                                       # the retry kept the booking whole: legs and event
        assert _stored(j["trade"]["id"]) == (j["trade"]["trade_ref"],) * 2                         # and the event names the trade as the row does
        assert len(j["legs"]) == 2 and len(client.get(f"/api/trade-legs/{j['trade']['id']}", headers=auth_e).json()) == 2
        assert [e["event_type"] for e in client.get(f"/api/trade-events/{j['trade']['id']}", headers=auth_e).json()] == ["BOOKED"]


def test_the_two_routes_and_a_run_of_bookings_in_one_second(client, auth_e, at_second):
    at_second(1_700_000_300)
    refs = []
    for i in range(12):                                                                    # past the eight tried in a row
        if i % 2:
            r = client.post("/api/book/trade", json=_body(), headers=auth_e)
            assert r.status_code == 201, r.text
            refs.append(r.json()["trade"]["trade_ref"])
        else:
            r = client.post("/api/trades/", json=_body(), headers=auth_e)
            assert r.status_code == 200, r.text
            refs.append(r.json()["trade_ref"])
    assert len(set(refs)) == 12 and all(SHAPE.match(r) for r in refs)
    assert refs[:8] == [f"TRD-{300 + k:08d}" for k in range(8)]


def test_a_double_press_with_one_idempotency_key_books_once(client, auth_e, at_second):
    at_second(1_700_000_400)
    key = str(uuid.uuid4())
    first = client.post("/api/book/trade", json=_body(), headers={**auth_e, "Idempotency-Key": key})
    again = client.post("/api/book/trade", json=_body(), headers={**auth_e, "Idempotency-Key": key})
    assert first.status_code == 201 and again.status_code == 201 and again.json()["idempotent_replay"] is True
    assert again.json()["trade"]["id"] == first.json()["trade"]["id"]
    assert _refs(client, auth_e).count("TRD-00000400") == 1 and "TRD-00000401" not in _refs(client, auth_e)


def test_a_supplied_reference_is_kept_and_a_supplied_duplicate_is_refused(client, auth_e, at_second):
    at_second(1_700_000_500)
    first = client.post("/api/trades/", json=_body(), headers=auth_e).json()["trade_ref"]
    leg_two = f"{first}-2"                                                                 # how a package names its further legs
    r = client.post("/api/trades/", json=_body(leg_two), headers=auth_e)
    assert r.status_code == 200 and r.json()["trade_ref"] == leg_two == "TRD-00000500-2"
    for path in ("/api/trades/", "/api/book/trade"):
        dup = client.post(path, json=_body(leg_two), headers=auth_e)
        assert dup.status_code == 409 and leg_two in dup.json()["detail"], (path, dup.text)   # /api/trades/ was 500
    assert _refs(client, auth_e).count(leg_two) == 1
    after = client.post("/api/trades/", json=_body(), headers=auth_e)                      # and the book still takes bookings
    assert after.status_code == 200 and after.json()["trade_ref"] == "TRD-00000501"


def _row(ref: str):
    from db.models import Trade
    return Trade(id=uuid.uuid4(), trade_ref=ref, status="PENDING", store="WORKING", asset_class="RATES", instrument_type="IR_SWAP",
                 structure="VANILLA", notional=1_000_000, notional_ccy="USD", trade_date=date(2026, 11, 10), effective_date=date(2026, 11, 12),
                 maturity_date=date(2031, 11, 12), terms={}, user_id=uuid.UUID(USER_E), created_by=uuid.UUID(USER_E), version_seq=0)


def test_a_collision_leaves_the_rest_of_the_callers_transaction_in_place(stack, auth_e, at_second):
    """commit=False bookings (the counterparty's booking from a card) run inside a larger unit of work: what was
    written before the name was found taken must still be there when the caller commits."""
    from api.routes._trade_ref import insert_trade
    from db.models import Trade
    from db.session import SessionLocal
    at_second(1_700_000_600)
    db = SessionLocal()
    try:
        insert_trade(db, _row, None); db.commit()                                         # TRD-00000600 is taken
        earlier = insert_trade(db, _row, "EARLIER-IN-THE-SAME-TRANSACTION")               # flushed, not committed
        later = insert_trade(db, _row, None)                                               # collides once, inside its savepoint
        assert later.trade_ref == "TRD-00000601"
        db.commit()
        refs = {r for (r,) in db.query(Trade.trade_ref).filter(Trade.id.in_([earlier.id, later.id]))}
        assert refs == {"EARLIER-IN-THE-SAME-TRANSACTION", "TRD-00000601"}
    finally:
        db.rollback(); db.close()


def test_two_bookings_in_flight_at_once(stack, auth_e, at_second):
    """The case a read-before-write cannot settle: the first booking has its name but has not committed. The
    second waits on the index, is refused when the first commits, and takes the next name."""
    from api.routes._trade_ref import insert_trade
    from db.session import SessionLocal
    at_second(1_700_000_700)
    one, two = SessionLocal(), SessionLocal()
    out: dict = {}

    def second_booking():
        try:
            out["ref"] = insert_trade(two, _row, None).trade_ref
            two.commit()
        except Exception as e:                                                              # noqa: BLE001 — reported by the assert below
            two.rollback()
            out["error"] = e

    try:
        first = insert_trade(one, _row, None)
        assert first.trade_ref == "TRD-00000700"
        t = threading.Thread(target=second_booking)
        t.start()
        t.join(1.0)
        assert t.is_alive() and not out, "the second booking must wait for the first to commit or roll back"
        one.commit()
        t.join(15)
        assert not t.is_alive()
        assert out == {"ref": "TRD-00000701"}, out
    finally:
        one.rollback(); one.close(); two.close()


# ── a package: one trade ID, a leg ID for each leg, one transaction ─────────────────────────────

def _legs(n: int) -> list[dict]:
    return [_body() for _ in range(n)]


def test_a_package_is_booked_whole_under_one_trade_id_with_a_leg_id_each(client, auth_e, at_second):
    from api.routes import _trade_ref as R
    at_second(1_795_100_000)
    r = client.post("/api/book/package", json={"structure": "strip", "legs": _legs(3)}, headers=auth_e)
    assert r.status_code == 201, r.text[:400]
    j = r.json()
    pid = j["package"]["trade_id"]
    assert SHAPE.match(pid) and pid == R.generated_ref(1_795_100_000 + R.PACKAGE_OFFSET)
    assert j["package"] == {"trade_id": pid, "structure": "STRIP", "legs": 3}
    assert [t["trade_ref"] for t in j["trades"]] == [f"{pid}-1", f"{pid}-2", f"{pid}-3"]
    assert [t["strategy"] for t in j["trades"]] == [f"STRIP {pid} 1/3", f"STRIP {pid} 2/3", f"STRIP {pid} 3/3"]
    assert len({t["id"] for t in j["trades"]}) == 3 and all(t["status"] == "PENDING" for t in j["trades"])
    for t in j["trades"]:
        row, ev = _stored(t["id"])
        assert row == ev == t["trade_ref"], "the BOOKED event names the leg as its row does"
    # no row carries the bare trade ID, and a single trade booked later is not given it
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.connect() as c:
            assert c.execute(sa.text("SELECT count(*) FROM trades WHERE user_id = :u AND trade_ref = :r"), {"u": USER_E, "r": pid}).scalar() == 0
    finally:
        eng.dispose()
    at_second(1_795_100_000 + R.PACKAGE_OFFSET)          # the second whose single-trade name is the package's ID
    single = client.post("/api/book/trade", json=_body(), headers=auth_e)
    assert single.status_code == 201 and single.json()["trade"]["trade_ref"] not in (pid,) and not single.json()["trade"]["trade_ref"].startswith(pid + "-")
    # the next package in the first second takes the next name
    at_second(1_795_100_000)
    again = client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(2)}, headers=auth_e).json()
    assert again["package"]["trade_id"] not in (pid, single.json()["trade"]["trade_ref"])


def test_a_package_with_one_bad_leg_books_nothing(client, auth_e, at_second, monkeypatch):
    from fastapi import HTTPException
    from api.routes import booking
    at_second(1_795_200_000)
    eng = sa.create_engine(os.environ["DATABASE_URL"])

    def count() -> int:
        with eng.connect() as c:
            return c.execute(sa.text("SELECT count(*) FROM trades WHERE user_id = :u"), {"u": USER_E}).scalar()
    try:
        before = count()
        # the third leg is refused inside the transaction, after two legs were written to it
        real, calls = booking.book_trade, []

        def third_refused(db, user_id, body, key=None, **kw):
            calls.append(body.trade_ref)
            if len(calls) == 3:
                raise HTTPException(status_code=422, detail="refused by the test")
            return real(db, user_id, body, key, **kw)
        monkeypatch.setattr(booking, "book_trade", third_refused)
        r = client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(3)}, headers=auth_e)
        monkeypatch.setattr(booking, "book_trade", real)
        assert r.status_code == 422 and "leg 3 of 3" in r.text and "Nothing was booked" in r.text, r.text[:300]
        assert len(calls) == 3 and calls[0].endswith("-1") and calls[1].endswith("-2")
        assert count() == before, "all or nothing: the two legs written before the refusal are gone"
        # a leg the booking itself refuses, named
        mixed = _body()
        mixed["counterparty_id"] = str(uuid.uuid4())
        r = client.post("/api/book/package", json={"structure": "CUSTOM", "legs": [_body(), _body(), mixed]}, headers=auth_e)
        assert r.status_code == 422 and "leg 3" in r.text and "between the same two parties" in r.text
        # shape rules, before anything is written
        assert client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(1)}, headers=auth_e).status_code == 422
        assert client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(25)}, headers=auth_e).status_code == 422
        assert client.post("/api/book/package", json={"structure": "BUTTERFLY", "legs": _legs(2)}, headers=auth_e).status_code == 422
        named = _body("MINE-1")
        assert client.post("/api/book/package", json={"structure": "CUSTOM", "legs": [named, _body()]}, headers=auth_e).status_code == 422
        assert count() == before
    finally:
        eng.dispose()


def test_a_double_press_books_the_package_once(client, auth_e, at_second):
    at_second(1_795_300_000)
    key = str(uuid.uuid4())
    body = {"structure": "COLLAR", "legs": _legs(2)}
    a = client.post("/api/book/package", json=body, headers={**auth_e, "Idempotency-Key": key})
    b = client.post("/api/book/package", json=body, headers={**auth_e, "Idempotency-Key": key})
    assert a.status_code == 201 and b.status_code == 201
    assert b.json()["idempotent_replay"] is True and b.json()["package"] == a.json()["package"]
    assert [t["id"] for t in b.json()["trades"]] == [t["id"] for t in a.json()["trades"]]
    assert client.post("/api/book/package", json=body, headers={**auth_e, "Idempotency-Key": "not-a-uuid"}).status_code == 400



def test_a_package_whose_trade_id_was_taken_meanwhile_takes_the_next(client, auth_e, at_second, monkeypatch):
    """Found by review: two bookings in one second can reach for the same trade ID; the one that loses was told
    409 although nothing was wrong with it."""
    from api.routes import _trade_ref as R
    from api.routes import booking
    at_second(1_795_400_000)
    first = client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(2)}, headers=auth_e).json()
    taken = first["package"]["trade_id"]
    real, calls = booking.free_package_id, []

    def stale(db, user_id):
        calls.append(1)
        return taken if len(calls) == 1 else real(db, user_id)      # the look that raced: it still says the name is free
    monkeypatch.setattr(booking, "free_package_id", stale)
    r = client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(2)}, headers=auth_e)
    assert r.status_code == 201, r.text[:300]
    assert len(calls) == 2 and r.json()["package"]["trade_id"] not in (taken,) and r.json()["package"]["trade_id"] == R.generated_ref(1_795_400_000 + R.PACKAGE_OFFSET + 1)
    # a double press with one key that lost the same race is answered with the first booking
    import uuid as _u
    key = str(_u.uuid4())
    a = client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(2)}, headers={**auth_e, "Idempotency-Key": key}).json()
    calls.clear()
    monkeypatch.setattr(booking, "free_package_id", lambda db, user_id: a["package"]["trade_id"])
    monkeypatch.setattr(booking, "IdempotencyKey", booking.IdempotencyKey)
    # the cache is looked up before anything is written, so this is the plain replay; the in-flight case is the same code path after a collision
    b = client.post("/api/book/package", json={"structure": "CUSTOM", "legs": _legs(2)}, headers={**auth_e, "Idempotency-Key": key}).json()
    assert b["idempotent_replay"] is True and b["package"] == a["package"]
