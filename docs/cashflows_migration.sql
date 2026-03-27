
-- ============================================================
-- Rijeka — cashflows migration
-- Sprint 3C: generated cashflow schedule
-- Paste into Supabase SQL Editor → Run
-- ============================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS cashflows (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id            UUID        NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  leg_id              UUID        NOT NULL REFERENCES trade_legs(id) ON DELETE CASCADE,

  -- Period
  period_start        DATE        NOT NULL,
  period_end          DATE        NOT NULL,
  payment_date        DATE        NOT NULL,
  fixing_date         DATE,                           -- float legs only

  -- Amount
  currency            TEXT        NOT NULL,
  notional            NUMERIC(24,6),                  -- notional in effect for this period
  rate                NUMERIC(12,8),                  -- fixed rate or realised float rate
  dcf                 NUMERIC(10,8),                  -- day count fraction
  amount              NUMERIC(24,6) NOT NULL,         -- notional * rate * dcf (generated)

  -- Override (non-destructive — mirrors trades.terms.cashflow_overrides)
  amount_override     NUMERIC(24,6),                  -- set when user edits inline
  is_overridden       BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Status
  -- PROJECTED: not yet settled, amount may change (float fixing pending)
  -- CONFIRMED: fixing known, amount locked
  -- SETTLED:   cash has moved
  -- CANCELLED: trade terminated before this cashflow
  status              TEXT        NOT NULL DEFAULT 'PROJECTED',

  -- Sprint 5 blockchain
  cashflow_hash       TEXT,
  settlement_hash     TEXT,                           -- on-chain settlement proof

  -- Audit
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_modified_at    TIMESTAMPTZ,
  last_modified_by    UUID        REFERENCES auth.users(id),

  CONSTRAINT cashflows_status_check CHECK (
    status IN ('PROJECTED','CONFIRMED','SETTLED','CANCELLED')
  ),
  CONSTRAINT cashflows_period_check CHECK (period_end > period_start),
  CONSTRAINT cashflows_payment_check CHECK (payment_date >= period_end)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS cashflows_trade_id_idx
  ON cashflows (trade_id);

CREATE INDEX IF NOT EXISTS cashflows_leg_id_idx
  ON cashflows (leg_id);

CREATE INDEX IF NOT EXISTS cashflows_payment_date_idx
  ON cashflows (payment_date);

CREATE INDEX IF NOT EXISTS cashflows_trade_payment_idx
  ON cashflows (trade_id, payment_date);              -- primary query: all CFs for a trade in date order

CREATE INDEX IF NOT EXISTS cashflows_status_idx
  ON cashflows (status);

CREATE INDEX IF NOT EXISTS cashflows_leg_period_idx
  ON cashflows (leg_id, period_start);                -- for repricing by period

-- 3. RLS
ALTER TABLE cashflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashflows_select_authenticated"
  ON cashflows FOR SELECT TO authenticated USING (true);

CREATE POLICY "cashflows_insert_authenticated"
  ON cashflows FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "cashflows_update_authenticated"
  ON cashflows FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- No DELETE policy — cashflows are never hard-deleted.
-- Cancelled trades → status = CANCELLED on affected cashflows.

-- 4. Useful views

-- Net cashflow per payment date (aggregated across all legs)
CREATE OR REPLACE VIEW cashflow_net_by_date AS
SELECT
  trade_id,
  payment_date,
  currency,
  SUM(COALESCE(amount_override, amount)) AS net_amount,
  COUNT(*) AS leg_count
FROM cashflows
WHERE status != 'CANCELLED'
GROUP BY trade_id, payment_date, currency
ORDER BY trade_id, payment_date;

GRANT SELECT ON cashflow_net_by_date TO authenticated;

-- Upcoming cashflows across all trades (next 90 days)
CREATE OR REPLACE VIEW cashflows_upcoming AS
SELECT
  c.id,
  c.trade_id,
  c.leg_id,
  c.payment_date,
  c.currency,
  COALESCE(c.amount_override, c.amount) AS effective_amount,
  c.is_overridden,
  c.status,
  t.trade_ref,
  t.counterparty_id,
  t.desk,
  t.book
FROM cashflows c
JOIN trades t ON t.id = c.trade_id
WHERE c.payment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
  AND c.status IN ('PROJECTED','CONFIRMED')
ORDER BY c.payment_date;

GRANT SELECT ON cashflows_upcoming TO authenticated;

-- ============================================================
-- DONE. Verify with:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'cashflows';
--   -- Expected: SELECT, INSERT, UPDATE (no DELETE)
-- ============================================================
