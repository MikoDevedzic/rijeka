-- Module switches per firm (backend/modules.py, api/routes/modules.py). Null modules = every module on: today's
-- behaviour. A switch hides and un-gates, never deletes. Every change is a row in module_events. Idempotent.
ALTER TABLE firms ADD COLUMN IF NOT EXISTS modules jsonb;            -- {"PNL": true, "MARKET_RISK": false, ...}
ALTER TABLE firms ADD COLUMN IF NOT EXISTS modules_preset text;      -- DEALER | CORPORATE | FUND | CLASSROOM | CUSTOM
CREATE TABLE IF NOT EXISTS module_events (
  id        uuid PRIMARY KEY,
  firm_id   uuid NOT NULL,
  user_id   uuid NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  preset    text,
  before    jsonb,
  after     jsonb NOT NULL,
  note      text
);
CREATE INDEX IF NOT EXISTS ix_module_events_firm ON module_events (firm_id, at DESC);
ALTER TABLE module_events ENABLE ROW LEVEL SECURITY;
