-- Demo market data (market_data/demo_feed.py) stamps its provenance as
-- 'DEMO · <providers> · as of <date>'. The source whitelists on the two
-- tables that carry one predate it; widen them so a DEMO-prefixed source is
-- accepted. Idempotent. Run once against the hosted database:
--
--   cd backend && psql "$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" -f ../docs/migrations/2026-10-29_demo_market_data_source.sql
--
-- or paste the statements into the Supabase SQL editor.

ALTER TABLE market_data_snapshots
  DROP CONSTRAINT IF EXISTS market_data_snapshots_source_check;
ALTER TABLE market_data_snapshots
  ADD CONSTRAINT market_data_snapshots_source_check
  CHECK (source = ANY (ARRAY['MANUAL'::text, 'BLOOMBERG'::text, 'REFINITIV'::text, 'IMPORT'::text])
         OR source LIKE 'DEMO%');

ALTER TABLE cap_vol_surface
  DROP CONSTRAINT IF EXISTS cap_vol_surface_source_check;
ALTER TABLE cap_vol_surface
  ADD CONSTRAINT cap_vol_surface_source_check
  CHECK (source = ANY (ARRAY['BLOOMBERG'::text, 'MANUAL'::text, 'INTERP'::text, 'IMPORT'::text])
         OR source LIKE 'DEMO%');
