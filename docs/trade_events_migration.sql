
-- ============================================================
-- Rijeka — trade_events migration
-- Sprint 3A: immutable event stream foundation
-- Run in Supabase SQL Editor (or via psql)
-- ============================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS trade_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id              UUID        NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,

  -- What happened and when
  event_type            TEXT        NOT NULL,
  event_date            DATE        NOT NULL,          -- calendar date of the event
  effective_date        DATE        NOT NULL,          -- when it takes economic effect

  -- Payloads
  payload               JSONB       NOT NULL DEFAULT '{}',    -- event-specific data
  pre_state             JSONB       NOT NULL DEFAULT '{}',    -- trade row BEFORE event
  post_state            JSONB       NOT NULL DEFAULT '{}',    -- trade row AFTER event

  -- Confirmation
  counterparty_confirmed BOOLEAN    NOT NULL DEFAULT FALSE,
  confirmation_hash     TEXT,                         -- SHA256 for Sprint 5 blockchain

  -- Audit (immutable — no updated_at)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID        REFERENCES auth.users(id),

  -- Enforce valid event types
  CONSTRAINT trade_events_event_type_check CHECK (
    event_type IN (
      'BOOKED',
      'ACTIVATED',
      'AMENDED',
      'BOOK_TRANSFER',
      'STORE_CHANGE',
      'PARTIAL_TERMINATION',
      'NOVATED',
      'TERMINATED',
      'MATURED',
      'CANCELLED',
      'DEFAULTED',
      'COMPRESSION',
      'CREDIT_EVENT'
    )
  )
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS trade_events_trade_id_idx
  ON trade_events (trade_id);

CREATE INDEX IF NOT EXISTS trade_events_event_type_idx
  ON trade_events (event_type);

CREATE INDEX IF NOT EXISTS trade_events_created_at_idx
  ON trade_events (created_at DESC);

CREATE INDEX IF NOT EXISTS trade_events_trade_created_idx
  ON trade_events (trade_id, created_at DESC);  -- primary query pattern

-- 3. RLS — immutable: SELECT + INSERT only, never UPDATE or DELETE
ALTER TABLE trade_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trade_events_select_authenticated"
  ON trade_events
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "trade_events_insert_authenticated"
  ON trade_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Explicitly no UPDATE or DELETE policies — event stream is append-only.

-- 4. Helpful view: latest event per trade (for blotter status display)
CREATE OR REPLACE VIEW trade_latest_event AS
SELECT DISTINCT ON (trade_id)
  trade_id,
  id          AS event_id,
  event_type  AS latest_event_type,
  event_date  AS latest_event_date,
  created_at  AS latest_event_at,
  created_by  AS latest_event_by
FROM trade_events
ORDER BY trade_id, created_at DESC;

-- Grant view access
GRANT SELECT ON trade_latest_event TO authenticated;

-- ============================================================
-- DONE. Verify with:
--   SELECT COUNT(*) FROM trade_events;
--   \d trade_events
-- ============================================================
