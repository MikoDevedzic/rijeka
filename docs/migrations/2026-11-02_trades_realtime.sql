-- The blotter follows the trades table live (frontend/src/store/useTradesStore.js startLive):
-- a confirmation countersigned by the other firm, a booking made from a chat card or by a
-- colleague shows without a reload. Realtime applies the table's SELECT policy per subscriber
-- (trades_rls: user_id = auth.uid()), so each person streams their own rows only, exactly what
-- the blotter query returns. Same mechanism as chat_messages (migration 010).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trades') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;
  END IF;
END $$;
-- Verify: SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- Applied to the hosted database on 2026-11-02.
