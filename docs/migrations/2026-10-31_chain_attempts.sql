-- Anchoring attempts, for the relayer budget (chain/budget.py). One row is written before each
-- transaction is sent, so attempts that revert or time out still count against the caps.
-- Written and read by the API's role only. The code counts in memory until this table exists.
CREATE TABLE IF NOT EXISTS chain_attempts (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at       timestamptz NOT NULL DEFAULT now(),
  user_id  uuid NOT NULL,
  firm_id  uuid,
  kind     text NOT NULL
);
CREATE INDEX IF NOT EXISTS chain_attempts_at ON chain_attempts (at);
ALTER TABLE chain_attempts ENABLE ROW LEVEL SECURITY;
