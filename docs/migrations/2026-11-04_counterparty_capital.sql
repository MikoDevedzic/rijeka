-- Counterparty capital attributes (pricing/capital.py, pricing/collateral.py). Every column is nullable and
-- the application treats null as today's behaviour: a corporate, unrated, cash and government securities,
-- close-out netting enforceable. Idempotent; safe to run on any database.
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS counterparty_type text;          -- BANK | BROKER_DEALER | CORPORATE | FUND | SOVEREIGN | CRYPTO_NATIVE  (CRE20)
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS rating_bucket text;              -- AAA_AA | A | BBB | BB_B | BELOW_B | UNRATED
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS risk_weight_override numeric(8,4);
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS cva_sector text;                 -- MAR50.16 Table 1 sector key
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS umr_in_scope boolean;            -- a buy-side counterparty under the uncleared margin rules
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS eligible_collateral jsonb;       -- catalogue codes the CSA admits
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS posted_composition jsonb;        -- {code: weight} of what we post
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS received_composition jsonb;      -- {code: weight} of what we receive
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS netting_enforceable boolean;     -- perfection and safe harbour hold in close-out
ALTER TABLE counterparties DROP CONSTRAINT IF EXISTS counterparties_type_check;
ALTER TABLE counterparties ADD CONSTRAINT counterparties_type_check
  CHECK (counterparty_type IS NULL OR counterparty_type IN ('BANK', 'BROKER_DEALER', 'CORPORATE', 'FUND', 'SOVEREIGN', 'CRYPTO_NATIVE'));
ALTER TABLE counterparties DROP CONSTRAINT IF EXISTS counterparties_rating_check;
ALTER TABLE counterparties ADD CONSTRAINT counterparties_rating_check
  CHECK (rating_bucket IS NULL OR rating_bucket IN ('AAA_AA', 'A', 'BBB', 'BB_B', 'BELOW_B', 'UNRATED'));
