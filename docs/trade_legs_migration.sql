
-- ============================================================
-- Rijeka — trade_legs migration
-- Sprint 3B: dedicated legs table (leg UUIDs as PKs)
--
-- Previously: legs lived in trades.terms JSONB array.
-- Now:        each leg is a first-class row.
-- trades.terms.legs[] remains as cache — trade_legs is truth.
-- ============================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS trade_legs (
  -- Identity
  id                  UUID        PRIMARY KEY,          -- leg_id (set client-side, crypto.randomUUID())
  trade_id            UUID        NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  leg_ref             TEXT        NOT NULL,             -- e.g. TRD-12345678-L1
  leg_seq             INTEGER     NOT NULL DEFAULT 0,   -- 0-based ordering within trade
  leg_type            TEXT        NOT NULL,
  direction           TEXT        NOT NULL,             -- PAY | RECEIVE

  -- Notional
  currency            TEXT        NOT NULL,
  notional            NUMERIC(24,6),
  notional_type       TEXT        NOT NULL DEFAULT 'BULLET',  -- BULLET|LINEAR_AMORT|MORTGAGE|CUSTOM
  notional_schedule   JSONB,                            -- [{date, amount}] for CUSTOM / LINEAR_AMORT

  -- ISDA Schedule
  effective_date      DATE,
  maturity_date       DATE,
  first_period_start  DATE,                             -- irregular first period
  last_period_end     DATE,                             -- irregular last period
  day_count           TEXT,                             -- ACT/360, ACT/365F, 30/360 etc
  payment_frequency   TEXT,                             -- MONTHLY|QUARTERLY|SEMI_ANNUAL|ANNUAL|ZERO
  reset_frequency     TEXT,                             -- FLOAT legs only
  bdc                 TEXT,                             -- FOLLOWING|MOD_FOLLOWING|PRECEDING|MOD_PRECEDING
  stub_type           TEXT,                             -- SHORT_FRONT|SHORT_BACK|LONG_FRONT|LONG_BACK
  payment_calendar    TEXT,                             -- USNY, GBLO, EUTA etc
  payment_lag         INTEGER     DEFAULT 0,

  -- Fixed rate (FIXED / ZERO_COUPON / STEP_UP legs)
  fixed_rate          NUMERIC(12,8),                   -- decimal e.g. 0.035 = 3.5%
  fixed_rate_type     TEXT        DEFAULT 'FLAT',       -- FLAT | STEP
  fixed_rate_schedule JSONB,                            -- [{effective_date, rate}]

  -- Float (FLOAT / CMS / BASIS legs)
  spread              NUMERIC(12,8),                   -- decimal
  spread_type         TEXT        DEFAULT 'FLAT',       -- FLAT | STEP
  spread_schedule     JSONB,                            -- [{effective_date, spread}]
  forecast_curve_id   TEXT,
  cap_rate            NUMERIC(12,8),
  floor_rate          NUMERIC(12,8),
  leverage            NUMERIC(8,4) DEFAULT 1.0,
  ois_compounding     TEXT,                             -- FLAT|STRAIGHT|SPREAD_EXCLUSIVE|NONE

  -- Curves
  discount_curve_id   TEXT,

  -- Instrument-specific overflow
  -- Holds XCCY, CDS, equity, commodity, inflation, variance fields
  -- that don't warrant dedicated columns at this stage
  terms               JSONB       NOT NULL DEFAULT '{}',

  -- Sprint 5 blockchain
  leg_hash            TEXT,

  -- Audit
  booked_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID        REFERENCES auth.users(id),
  last_modified_at    TIMESTAMPTZ,
  last_modified_by    UUID        REFERENCES auth.users(id),

  -- Constraints
  CONSTRAINT trade_legs_leg_type_check CHECK (
    leg_type IN (
      'FIXED', 'FLOAT', 'ZERO_COUPON', 'INFLATION',
      'CMS', 'CDS_FEE', 'CDS_CONTINGENT',
      'TOTAL_RETURN', 'EQUITY_RETURN', 'EQUITY_FWD',
      'VARIANCE', 'DIVIDEND',
      'COMMODITY_FLOAT', 'EMISSIONS_FLOAT',
      'RPA_FEE', 'RPA_CONTINGENT'
    )
  ),
  CONSTRAINT trade_legs_direction_check CHECK (direction IN ('PAY', 'RECEIVE')),
  CONSTRAINT trade_legs_notional_type_check CHECK (
    notional_type IN ('BULLET', 'LINEAR_AMORT', 'MORTGAGE', 'CUSTOM')
  ),
  CONSTRAINT trade_legs_fixed_rate_type_check CHECK (fixed_rate_type IN ('FLAT', 'STEP')),
  CONSTRAINT trade_legs_spread_type_check     CHECK (spread_type IN ('FLAT', 'STEP')),
  CONSTRAINT trade_legs_leg_seq_check         CHECK (leg_seq >= 0)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS trade_legs_trade_id_idx
  ON trade_legs (trade_id);

CREATE INDEX IF NOT EXISTS trade_legs_trade_seq_idx
  ON trade_legs (trade_id, leg_seq);   -- primary query: all legs for a trade in order

CREATE INDEX IF NOT EXISTS trade_legs_leg_type_idx
  ON trade_legs (leg_type);

-- 3. RLS
ALTER TABLE trade_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trade_legs_select_authenticated"
  ON trade_legs FOR SELECT TO authenticated USING (true);

CREATE POLICY "trade_legs_insert_authenticated"
  ON trade_legs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "trade_legs_update_authenticated"
  ON trade_legs FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- No DELETE policy — legs are never hard-deleted (use trade status + events).

-- ============================================================
-- 4. BACKFILL — migrate existing legs from trades.terms JSONB
--
-- Run this AFTER the table is created.
-- Pulls each leg from the trades.terms.legs[] array and inserts
-- it as a proper row. Safe to run multiple times (ON CONFLICT DO NOTHING).
-- ============================================================
INSERT INTO trade_legs (
  id, trade_id, leg_ref, leg_seq, leg_type, direction,
  currency, notional, notional_type,
  effective_date, maturity_date,
  day_count, payment_frequency, reset_frequency,
  bdc, payment_calendar, payment_lag,
  fixed_rate, fixed_rate_type,
  spread, forecast_curve_id,
  discount_curve_id,
  terms, booked_at, created_at, created_by
)
SELECT
  (leg->>'leg_id')::UUID,
  t.id                                AS trade_id,
  COALESCE(leg->>'leg_ref', t.trade_ref || '-L' || (idx+1)::TEXT) AS leg_ref,
  idx                                 AS leg_seq,
  COALESCE(leg->>'leg_type', 'FIXED') AS leg_type,
  COALESCE(leg->>'direction', 'PAY')  AS direction,
  COALESCE(leg->>'currency', t.notional_ccy, 'USD') AS currency,
  COALESCE((leg->>'notional')::NUMERIC, t.notional) AS notional,
  COALESCE(leg->>'notional_type', 'BULLET') AS notional_type,
  t.effective_date,
  t.maturity_date,
  leg->>'day_count'         AS day_count,
  leg->>'payment_frequency' AS payment_frequency,
  leg->>'reset_frequency'   AS reset_frequency,
  leg->>'bdc'               AS bdc,
  leg->>'payment_calendar'  AS payment_calendar,
  COALESCE((leg->>'payment_lag')::INTEGER, 0) AS payment_lag,
  (leg->>'fixed_rate')::NUMERIC        AS fixed_rate,
  COALESCE(leg->>'fixed_rate_type', 'FLAT') AS fixed_rate_type,
  (leg->>'spread')::NUMERIC            AS spread,
  leg->>'forecast_curve_id' AS forecast_curve_id,
  t.discount_curve_id,
  leg                                  AS terms,
  (leg->>'booked_at')::TIMESTAMPTZ     AS booked_at,
  t.created_at,
  t.created_by
FROM
  trades t,
  jsonb_array_elements(t.terms->'legs') WITH ORDINALITY AS arr(leg, idx)
WHERE
  t.terms->'legs' IS NOT NULL
  AND jsonb_typeof(t.terms->'legs') = 'array'
  AND (leg->>'leg_id') IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Verify backfill
SELECT COUNT(*) AS legs_migrated FROM trade_legs;

-- ============================================================
-- DONE. Verify with:
--   SELECT t.trade_ref, l.leg_seq, l.leg_type, l.direction, l.currency
--   FROM trade_legs l JOIN trades t ON t.id = l.trade_id
--   ORDER BY t.trade_ref, l.leg_seq;
-- ============================================================
