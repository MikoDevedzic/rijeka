-- Margin terms the capital attribution reads (ccr/capital_report.py, ccr/exposure.csa_from_counterparty).
-- Null = daily margining, no dispute doubling: today's behaviour. Idempotent.
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS margin_frequency_days integer;   -- re-margining every N business days: MPoR = 9 + N, floored at 10 (CRE52.50)
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS mpor_disputed boolean;           -- more than two disputes in two quarters: the floor doubles (CRE52.51)
ALTER TABLE counterparties DROP CONSTRAINT IF EXISTS counterparties_margin_frequency_check;
ALTER TABLE counterparties ADD CONSTRAINT counterparties_margin_frequency_check
  CHECK (margin_frequency_days IS NULL OR (margin_frequency_days >= 1 AND margin_frequency_days <= 60));
