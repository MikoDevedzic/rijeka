-- 2026-11-13_trades_written_by_the_api.sql: the browser reads a firm's trades, legs and events; only the API writes them.
--
-- Each of the three tables had one policy for every command on a user's own rows (trades_rls, trade_legs_rls,
-- trade_events_rls), and a hosted project grants `authenticated` every privilege on a public table. So a signed-in
-- user, with their own token and the project's public key, could write those rows straight to the table, outside the
-- API: set a trade's status (a cancelled trade back to PENDING, a pending one to CONFIRMED with no event and no
-- signature), change its terms or its legs, delete it, and insert an event of any type with any payload, under a
-- trade of any firm whose id they held. The API's rules (a status changes by an event; a confirmation is signed)
-- did not apply there. Found 13 November 2026 after the owner asked whether a cancelled trade can be confirmed.
--
-- After this: `authenticated` may SELECT its own rows of the three tables (the blotter and its live updates read
-- `trades` that way) and may not INSERT, UPDATE or DELETE them; `anon` may not write them either. The policy's
-- "or the row has no owner" branch goes with it: user_id is NOT NULL on all three, so it matched nothing.
-- The API is not affected: it connects with a role that row-level security does not bind, and no page writes
-- these tables through the table API (the three unused writers in the trades store went in 0.32.4).
--
-- Not changed: the tables, their rows, the triggers on trade_events (which refuse UPDATE and DELETE for every
-- role), row-level security itself (it stays enabled), and every other table.
--
-- Idempotent: each policy is dropped if it is there and created again; a privilege revoked twice is revoked.

DROP POLICY IF EXISTS trades_rls ON public.trades;
DROP POLICY IF EXISTS trades_read_own ON public.trades;
CREATE POLICY trades_read_own ON public.trades FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.trades FROM authenticated, anon;

DROP POLICY IF EXISTS trade_legs_rls ON public.trade_legs;
DROP POLICY IF EXISTS trade_legs_read_own ON public.trade_legs;
CREATE POLICY trade_legs_read_own ON public.trade_legs FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.trade_legs FROM authenticated, anon;

DROP POLICY IF EXISTS trade_events_rls ON public.trade_events;
DROP POLICY IF EXISTS trade_events_read_own ON public.trade_events;
CREATE POLICY trade_events_read_own ON public.trade_events FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.trade_events FROM authenticated, anon;
