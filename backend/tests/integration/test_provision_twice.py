"""A new account provisioned twice at the same moment (the tab that signed up and the tab the email link opened)
gets one workspace and two answers, not a workspace and a 500. Before the account's lock in `provision`, both
requests found nothing and both inserted, and the second failed on the entity's unique key. The wait for that lock
has an end: behind a request that does not finish, a second one fails by itself and makes nothing. Everything the
test writes is removed at the end."""
from __future__ import annotations

import threading
import uuid

import pytest
import sqlalchemy as sa

from tests.integration.conftest import STACK_URL

pytestmark = pytest.mark.integration

ROUNDS = 3          # the collision was every time without the lock; three rounds is not a matter of luck


def _remove(c, uid) -> None:
    firms = [r[0] for r in c.execute(sa.text("SELECT firm_id FROM firm_members WHERE user_id = :u"), {"u": uid})]
    c.execute(sa.text("DELETE FROM firm_members WHERE user_id = :u"), {"u": uid})
    for f in firms:
        c.execute(sa.text("DELETE FROM module_events WHERE firm_id = :f"), {"f": f})
        c.execute(sa.text("DELETE FROM firm_leis WHERE firm_id = :f"), {"f": f})
        c.execute(sa.text("DELETE FROM firms WHERE id = :f"), {"f": f})
    for kind in ("book", "desk", "firm"):
        c.execute(sa.text("DELETE FROM org_nodes WHERE user_id = :u AND node_type = :k"), {"u": uid, "k": kind})
    for table in ("counterparties", "legal_entities", "market_data_snapshots", "swaption_vol_skew", "cap_vol_surface", "xva_calibration"):
        c.execute(sa.text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": uid})
    c.execute(sa.text("DELETE FROM profiles WHERE id = :u"), {"u": uid})
    c.execute(sa.text("DELETE FROM auth.users WHERE id = :u"), {"u": uid})


def test_two_provisions_of_a_new_account_at_once_both_answer(stack, monkeypatch):
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
    from api.routes import demo
    from db.session import SessionLocal
    eng = sa.create_engine(STACK_URL)
    made = []
    try:
        for _ in range(ROUNDS):
            uid = uuid.uuid4(); email = f"twice-{uid.hex[:8]}@example.test"; made.append(uid)
            with eng.begin() as c:
                c.execute(sa.text("INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) "
                                  "VALUES (:u, 'authenticated', 'authenticated', :e, '{}'::jsonb, '{}'::jsonb)"), {"u": uid, "e": email})
            gate = threading.Barrier(2); answers, failures = [], []

            def go(uid=uid, email=email, gate=gate, answers=answers, failures=failures):
                db = SessionLocal()
                try:
                    gate.wait(timeout=10)
                    answers.append(demo.provision(db=db, user={"sub": str(uid), "email": email}))
                except Exception as e:      # noqa: BLE001 — the test reports it below
                    failures.append(f"{type(e).__name__}: {str(getattr(e, 'orig', e)).splitlines()[0][:160]}")
                finally:
                    db.rollback(); db.close()
            threads = [threading.Thread(target=go) for _ in range(2)]
            [t.start() for t in threads]; [t.join(timeout=60) for t in threads]
            assert failures == [], failures
            assert len(answers) == 2
            assert sorted(bool(a["created"]) for a in answers) == [False, True]          # one made the workspace, the other found it
            assert answers[0]["own_entity"]["id"] == answers[1]["own_entity"]["id"]
            with eng.connect() as c:
                counts = c.execute(sa.text(
                    "SELECT (SELECT count(*) FROM firm_members WHERE user_id = :u), (SELECT count(*) FROM legal_entities WHERE user_id = :u), "
                    "(SELECT count(*) FROM counterparties WHERE user_id = :u), (SELECT count(*) FROM org_nodes WHERE user_id = :u)"), {"u": uid}).first()
            assert tuple(counts) == (1, 2, 1, 3)
    finally:
        with eng.begin() as c:
            for uid in made:
                _remove(c, uid)
        eng.dispose()


def test_a_provision_behind_one_that_does_not_finish_gives_up_and_makes_nothing(stack, monkeypatch):
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
    from sqlalchemy.exc import OperationalError
    from api.routes import demo
    from db.session import SessionLocal
    monkeypatch.setattr(demo, "LOCK_WAIT", "300ms")
    eng = sa.create_engine(STACK_URL)
    uid = uuid.uuid4(); email = f"twice-{uid.hex[:8]}@example.test"
    with eng.begin() as c:
        c.execute(sa.text("INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) "
                          "VALUES (:u, 'authenticated', 'authenticated', :e, '{}'::jsonb, '{}'::jsonb)"), {"u": uid, "e": email})
    holder = eng.connect(); held = holder.begin()
    try:
        holder.execute(sa.text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"demo-provision:{uid}"})      # the request that does not finish
        db = SessionLocal()
        try:
            with pytest.raises(OperationalError) as e:
                demo.provision(db=db, user={"sub": str(uid), "email": email})
            assert "lock timeout" in str(e.value).lower()
        finally:
            db.rollback(); db.close()
        with eng.connect() as c:
            assert c.execute(sa.text("SELECT count(*) FROM legal_entities WHERE user_id = :u"), {"u": uid}).scalar() == 0
        held.rollback()                                                                                             # it ends; the next provision goes through
        db = SessionLocal()
        try:
            out = demo.provision(db=db, user={"sub": str(uid), "email": email})
            assert out["created"].get("own_entity") is True
            assert db.execute(sa.text("SELECT current_setting('lock_timeout')")).scalar() in ("0", "0ms")           # the limit did not outlive its transaction
        finally:
            db.rollback(); db.close()
    finally:
        if held.is_active: held.rollback()
        holder.close()
        with eng.begin() as c:
            _remove(c, uid)
        eng.dispose()
