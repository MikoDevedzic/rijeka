-- ============================================================
-- Rijeka — trades table migration
-- Supabase SQL Editor → Database → SQL Editor → New query
-- Paste this entire file, click Run
-- ============================================================

CREATE TABLE IF NOT EXISTS trades (

  -- ── Identity ──────────────────────────────────────────────
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trade_ref             TEXT UNIQUE NOT NULL,
  uti                   TEXT,                                        -- UTI for regulatory reporting

  -- ── Lifecycle ─────────────────────────────────────────────
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','LIVE','MATURED','CANCELLED','TERMINATED')),

  -- 3-store architecture (History / Production / Working)
  store                 TEXT NOT NULL DEFAULT 'WORKING'
                          CHECK (store IN ('HISTORY','PRODUCTION','WORKING')),

  -- ── Classification ────────────────────────────────────────
  asset_class           TEXT NOT NULL
                          CHECK (asset_class IN ('RATES','FX','CREDIT','EQUITY','COMMODITY')),
  instrument_type       TEXT NOT NULL,   -- IR_SWAP, FX_FORWARD, XCCY_SWAP, CDS, etc.

  -- ── Entities ──────────────────────────────────────────────
  own_legal_entity_id   UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
  counterparty_id       UUID REFERENCES counterparties(id) ON DELETE RESTRICT,

  -- ── Economics ─────────────────────────────────────────────
  notional              NUMERIC(24, 6),
  notional_ccy          TEXT NOT NULL,
  trade_date            DATE NOT NULL,
  effective_date        DATE NOT NULL,
  maturity_date         DATE NOT NULL,

  -- JSONB for instrument-specific terms.
  -- IR_SWAP example:  {"pay_receive":"PAY","fixed_rate":0.0425,"float_index":"USD_SOFR",...}
  -- FX_FWD example:   {"buy_currency":"EUR","sell_currency":"USD","fx_rate":1.0850,...}
  -- CDS example:      {"reference_entity":"APPLE INC","cds_spread_bps":120,"recovery_rate":0.40,...}
  terms                 JSONB NOT NULL DEFAULT '{}',

  -- ── Curve assignments ─────────────────────────────────────
  -- IDs reference the 54-curve catalogue in ratesCurves.js
  discount_curve_id     TEXT,
  forecast_curve_id     TEXT,

  -- ── Portfolio ─────────────────────────────────────────────
  desk                  TEXT,
  book                  TEXT,
  strategy              TEXT,

  -- ── Audit ─────────────────────────────────────────────────
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            UUID REFERENCES auth.users(id),
  last_modified_at      TIMESTAMPTZ DEFAULT NOW(),
  last_modified_by      UUID REFERENCES auth.users(id)

);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trades_status         ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_asset_class    ON trades(asset_class);
CREATE INDEX IF NOT EXISTS idx_trades_store          ON trades(store);
CREATE INDEX IF NOT EXISTS idx_trades_counterparty   ON trades(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_trades_own_entity     ON trades(own_legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_trades_trade_date     ON trades(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_trades_instrument     ON trades(instrument_type);
CREATE INDEX IF NOT EXISTS idx_trades_terms_gin      ON trades USING GIN (terms);  -- fast JSONB queries

-- ── Auto-update last_modified_at ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_trade_modified()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_modified_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trades_modified_trigger ON trades;
CREATE TRIGGER trades_modified_trigger
  BEFORE UPDATE ON trades
  FOR EACH ROW
  EXECUTE FUNCTION update_trade_modified();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_trades" ON trades;
DROP POLICY IF EXISTS "authenticated_insert_trades"  ON trades;
DROP POLICY IF EXISTS "authenticated_update_trades"  ON trades;
DROP POLICY IF EXISTS "authenticated_delete_trades"  ON trades;

CREATE POLICY "authenticated_select_trades"
  ON trades FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_trades"
  ON trades FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_update_trades"
  ON trades FOR UPDATE TO authenticated USING (true);

CREATE POLICY "authenticated_delete_trades"
  ON trades FOR DELETE TO authenticated USING (true);

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'trades' AND table_schema = 'public') AS column_count
FROM information_schema.tables
WHERE table_name = 'trades' AND table_schema = 'public';
