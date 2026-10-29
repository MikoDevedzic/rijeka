-- Counterparty credit: the stored run per account, date and counterparty; batch settings. Idempotent.
CREATE TABLE IF NOT EXISTS ccr_daily (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL,
  run_date          date NOT NULL,
  counterparty_id   uuid,
  counterparty      text NOT NULL,
  report            jsonb NOT NULL,
  peak_pfe95        numeric(24,6),
  epe_1y            numeric(24,6),
  cva               numeric(24,6),
  current_exposure  numeric(24,6),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, run_date, counterparty)
);
CREATE INDEX IF NOT EXISTS ix_ccr_daily_user_date ON ccr_daily (user_id, run_date);
ALTER TABLE ccr_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS ccr_paths integer NOT NULL DEFAULT 2000;
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS ccr_drift text NOT NULL DEFAULT 'zero';
-- which XVA components net into the signed P&L (the rest are shown)
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS xva_netted text NOT NULL DEFAULT 'CVA,DVA,FVA,FBA';
