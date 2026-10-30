-- Bloomberg integration migration
-- Run in Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT).

CREATE TABLE IF NOT EXISTS bloomberg_ticker_overrides (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  curve_id     TEXT        NOT NULL,
  tenor        TEXT        NOT NULL,
  ticker       TEXT        NOT NULL,
  field        TEXT        NOT NULL DEFAULT 'PX_LAST',
  created_by   UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bloomberg_ticker_overrides_unique UNIQUE (curve_id, tenor, created_by)
);

CREATE INDEX IF NOT EXISTS bto_curve_id_idx    ON bloomberg_ticker_overrides (curve_id);
CREATE INDEX IF NOT EXISTS bto_created_by_idx  ON bloomberg_ticker_overrides (created_by);

ALTER TABLE bloomberg_ticker_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bto_select_authenticated"
  ON bloomberg_ticker_overrides FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "bto_insert_authenticated"
  ON bloomberg_ticker_overrides FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "bto_update_authenticated"
  ON bloomberg_ticker_overrides FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

-- Verify:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'bloomberg_ticker_overrides';
-- Expected: 3 rows — SELECT, INSERT, UPDATE
