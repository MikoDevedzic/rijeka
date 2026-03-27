-- ═══════════════════════════════════════════════════════════════
-- Sprint 4F: market_data_snapshots
-- Stores pillar quote snapshots per curve_id + valuation_date.
-- UNIQUE(curve_id, valuation_date) — one snapshot per curve per day.
-- quotes JSONB: [{tenor, quote_type, rate, enabled}, ...]
--   rate stored as percentage (5.310 = 5.310%), same as ratesCurves.js
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS market_data_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  curve_id         TEXT        NOT NULL,
  valuation_date   DATE        NOT NULL,
  quotes           JSONB       NOT NULL DEFAULT '[]',
  source           TEXT        NOT NULL DEFAULT 'MANUAL'
                               CHECK (source IN ('MANUAL','BLOOMBERG','REFINITIV','IMPORT')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID        REFERENCES auth.users(id),
  CONSTRAINT market_data_snapshots_curve_date_unique UNIQUE (curve_id, valuation_date)
);

CREATE INDEX IF NOT EXISTS mds_curve_id_idx       ON market_data_snapshots (curve_id);
CREATE INDEX IF NOT EXISTS mds_valuation_date_idx ON market_data_snapshots (valuation_date DESC);
CREATE INDEX IF NOT EXISTS mds_curve_date_idx     ON market_data_snapshots (curve_id, valuation_date DESC);

ALTER TABLE market_data_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mds_select_authenticated"
  ON market_data_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "mds_insert_authenticated"
  ON market_data_snapshots FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "mds_update_authenticated"
  ON market_data_snapshots FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Verify:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'market_data_snapshots';
-- Expected: 3 rows — SELECT, INSERT, UPDATE
