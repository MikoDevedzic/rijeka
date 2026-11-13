"""docs/migrations/2026-11-13_trades_written_by_the_api.sql on the stack's database: before it, a signed-in user writes
their own rows of trades, legs and events straight to the table (a hosted project's default grants and the one policy
for every command); after it they read them and write nothing. Run inside one transaction that is rolled back."""
from __future__ import annotations

import json
import pathlib
import uuid

import pytest
from sqlalchemy import text

from tests.integration import bodies as B

pytestmark = pytest.mark.integration
MIGRATION = pathlib.Path(__file__).resolve().parents[3] / "docs" / "migrations" / "2026-11-13_trades_written_by_the_api.sql"
TABLES = ("trades", "trade_legs", "trade_events")
AS_BEFORE = "".join(
    f"DROP POLICY IF EXISTS {t}_read_own ON public.{t}; DROP POLICY IF EXISTS {t}_rls ON public.{t}; "
    f"CREATE POLICY {t}_rls ON public.{t} TO authenticated USING (((user_id IS NULL) OR (user_id = auth.uid()))) "
    f"WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid()))); GRANT SELECT, INSERT, UPDATE, DELETE ON public.{t} TO authenticated; "
    for t in TABLES)


def _as(conn, uid: str) -> None:
    conn.execute(text("SET LOCAL ROLE authenticated"))
    conn.execute(text("SELECT set_config('request.jwt.claims', :c, true), set_config('request.jwt.claim.sub', :u, true)"),
                 {"c": json.dumps({"sub": uid, "role": "authenticated"}), "u": uid})          # both spellings: the stack's auth.uid() and a hosted one's


def _written(conn, sql: str, **params):
    """How many rows the statement wrote, or None when it was refused for want of a privilege. Run in a savepoint
    that is rolled back, so nothing it wrote stays and the transaction goes on."""
    sp = conn.begin_nested()
    try:
        n = conn.execute(text(sql), params).rowcount
        sp.rollback()
        return n
    except Exception as e:                                      # noqa: BLE001
        sp.rollback()
        assert "permission denied" in str(e).lower(), str(e)[:200]
        return None


def test_a_signed_in_user_reads_their_trades_and_writes_none_of_them(client, auth_a, ids, stack):
    from db.session import engine
    j = client.post("/api/book/trade", json=B.swap(ids["a"], f"IT-WR-{uuid.uuid4().hex[:6].upper()}"), headers=auth_a).json()
    tid, a, b = j["trade"]["id"], ids["a"]["user_id"], ids["b"]["user_id"]
    writes = (("UPDATE public.trades SET status = 'CONFIRMED' WHERE id = :t", "a status"),
              ("UPDATE public.trade_legs SET notional = 1 WHERE trade_id = :t", "a leg"),
              ("DELETE FROM public.trade_legs WHERE trade_id = :t", "a delete"),
              ("INSERT INTO public.trade_events (id, trade_id, user_id, event_type, event_date, effective_date, payload) "
               "VALUES (gen_random_uuid(), :t, :u, 'AMENDED', current_date, current_date, '{\"attestation\": {}}'::jsonb)", "an event with an invented record"))
    conn = engine.connect()
    tx = conn.begin()
    try:
        # as a hosted project stood before the migration: the way round the API is open
        conn.exec_driver_sql(AS_BEFORE)
        _as(conn, a)
        for sql, what in writes:
            assert (_written(conn, sql, t=tid, u=a) or 0) >= 1, f"before the migration {what} is written straight to the table"
        conn.execute(text("RESET ROLE"))
        # the migration, twice (it is run again on every start that finds it unapplied elsewhere)
        for _ in range(2):
            conn.exec_driver_sql(MIGRATION.read_text())
        policies = conn.execute(text("SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(:t) ORDER BY 1"), {"t": list(TABLES)}).all()
        assert [tuple(p) for p in policies] == [(t, f"{t}_read_own", "SELECT") for t in sorted(TABLES)], policies
        _as(conn, a)
        assert conn.execute(text("SELECT count(*) FROM public.trades WHERE id = :t"), {"t": tid}).scalar() == 1, "its own trade is read"
        assert conn.execute(text("SELECT count(*) FROM public.trade_legs WHERE trade_id = :t"), {"t": tid}).scalar() >= 1
        assert conn.execute(text("SELECT count(*) FROM public.trade_events WHERE trade_id = :t"), {"t": tid}).scalar() == 1
        for sql, what in writes:
            assert _written(conn, sql, t=tid, u=a) is None, f"after the migration {what} is refused"
        conn.execute(text("RESET ROLE"))
        _as(conn, b)
        for t in TABLES:
            col = "id" if t == "trades" else "trade_id"
            assert conn.execute(text(f"SELECT count(*) FROM public.{t} WHERE {col} = :t"), {"t": tid}).scalar() == 0, f"another firm reads none of {t}"
        conn.execute(text("RESET ROLE"))
    finally:
        tx.rollback()
        conn.close()
    # and the API, which is the way in, still writes: the trade is cancelled by its route
    assert client.post(f"/api/trade-events/cancel/{tid}", headers={**auth_a, "Idempotency-Key": str(uuid.uuid4())}, json={}).status_code == 201
