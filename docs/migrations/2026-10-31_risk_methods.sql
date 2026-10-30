-- Method choices for market risk and counterparty credit, per firm.
--   var_method   FULL_REVAL (reprice the book on each historical day; the ladder VaR rides along as the
--                linear comparison) | LADDER (sensitivities-based, linear)
--   ccr_sampling HISTORICAL (monthly steps are blocks of observed daily changes, same block for every
--                factor) | GAUSSIAN (correlated normal shocks)
-- The code defaults to FULL_REVAL / HISTORICAL and tolerates these columns being absent.
ALTER TABLE risk_settings
  ADD COLUMN IF NOT EXISTS var_method   text NOT NULL DEFAULT 'FULL_REVAL',
  ADD COLUMN IF NOT EXISTS ccr_sampling text NOT NULL DEFAULT 'HISTORICAL';
ALTER TABLE risk_settings DROP CONSTRAINT IF EXISTS risk_settings_var_method_check;
ALTER TABLE risk_settings ADD CONSTRAINT risk_settings_var_method_check CHECK (var_method IN ('FULL_REVAL', 'LADDER'));
ALTER TABLE risk_settings DROP CONSTRAINT IF EXISTS risk_settings_ccr_sampling_check;
ALTER TABLE risk_settings ADD CONSTRAINT risk_settings_ccr_sampling_check CHECK (ccr_sampling IN ('HISTORICAL', 'GAUSSIAN'));
