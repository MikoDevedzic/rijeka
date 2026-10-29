-- Market risk: the firm's limits, VaR settings, the stored daily report; the RISK role.
-- Run in the Supabase SQL editor. Idempotent.

CREATE TABLE IF NOT EXISTS risk_limits (
  id           uuid PRIMARY KEY,
  firm_id      uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  metric       text NOT NULL,            -- VAR_99_1D, IR01, IR01:<curve>, KR01:<curve>:<bucket>, SPOT01:<asset>, NPV, STRESS:<id>
  scope        text NOT NULL DEFAULT 'ALL',   -- ALL | DESK | BOOK
  scope_name   text,
  limit_value  numeric(24,6) NOT NULL,
  warn_pct     numeric(6,2) NOT NULL DEFAULT 80,
  note         text,
  set_by       uuid,
  set_by_name  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_risk_limits_firm ON risk_limits (firm_id) WHERE active;

CREATE TABLE IF NOT EXISTS risk_settings (
  firm_id               uuid PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
  confidence            numeric(5,4) NOT NULL DEFAULT 0.99,
  secondary_confidence  numeric(5,4) NOT NULL DEFAULT 0.95,
  horizon_days          integer NOT NULL DEFAULT 1,
  window_days           integer NOT NULL DEFAULT 730,
  min_observations      integer NOT NULL DEFAULT 60,
  updated_by            uuid,
  updated_by_name       text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_daily (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  risk_date   date NOT NULL,
  report      jsonb NOT NULL,
  var_1d      numeric(24,6),
  ir01_usd    numeric(24,6),
  npv_usd     numeric(24,6),
  breaches    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, risk_date)
);
CREATE INDEX IF NOT EXISTS ix_risk_daily_user_date ON risk_daily (user_id, risk_date);

ALTER TABLE risk_limits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_daily    ENABLE ROW LEVEL SECURITY;

-- the market risk manager: sets limits and VaR settings; cannot book
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['viewer'::text, 'trader'::text, 'controller'::text, 'management'::text, 'risk'::text, 'admin'::text]));

-- sign-off policy per firm: TWO_PERSON (trader then a different controller) or SINGLE (one signature finalises)
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS signoff_policy text NOT NULL DEFAULT 'TWO_PERSON';
