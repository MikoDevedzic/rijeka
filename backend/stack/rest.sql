-- rest.sql — what PostgREST needs on the local stack, for the browser journeys (frontend/e2e). Idempotent.
-- On a Supabase project these exist already: the caller's id and role read from the request's JWT claims, and
-- the default grants that let row-level security (not table privileges) decide what `authenticated` may see.

-- PostgREST sets request.jwt.claims (JSON); the older per-claim settings are kept for anything that sets them.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    )::text
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- ... except a firm's trades, legs and events, which the browser reads and only the API writes: the grant above is what a
-- hosted project gives by default, and docs/migrations/2026-11-13_trades_written_by_the_api.sql takes these away there
REVOKE INSERT, UPDATE, DELETE ON public.trades, public.trade_legs, public.trade_events FROM authenticated, anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
