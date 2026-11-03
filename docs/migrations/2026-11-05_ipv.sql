-- Independent price verification (backend/ipv, api/routes/ipv.py). Idempotent; safe to run on any database.
-- Tolerance rules per firm: the first matching rule (most specific first) decides the tolerance and the materiality
-- threshold for an input's pillar. unit: bp (rates, funding), vol_bp (swaption normal vol), vol_pt (FX vol), pct (spot).
CREATE TABLE IF NOT EXISTS ipv_tolerances (
  id              uuid PRIMARY KEY,
  firm_id         uuid NOT NULL,
  input_pattern   text NOT NULL,            -- glob on the curve id: USD_SOFR, *_VOL, *_SWVOL_ATM, *_SPOT, *
  pillar_pattern  text NOT NULL DEFAULT '*',-- glob on the pillar key: 10Y, 1Yx5Y, 1Y|RR25, *
  tol             numeric(18,6) NOT NULL,
  unit            text NOT NULL,
  materiality_usd numeric(24,6) NOT NULL DEFAULT 0,
  note            text,
  set_by          uuid,
  set_by_name     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipv_tolerances_unit_check CHECK (unit IN ('bp', 'vol_bp', 'vol_pt', 'pct'))
);
CREATE INDEX IF NOT EXISTS ix_ipv_tolerances_firm ON ipv_tolerances (firm_id);

-- One run per account, date and scope: the inputs with their pillars, sensitivities, states and the figures.
CREATE TABLE IF NOT EXISTS ipv_runs (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL,
  run_date          date NOT NULL,
  scope_key         text NOT NULL DEFAULT 'GLOBAL',   -- GLOBAL | DESK:<name> | BOOK:<name> | TRADER:<id>
  scope             jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'OPEN',     -- OPEN | SIGNED
  flash_usd         numeric(24,6),
  first_order_usd   numeric(24,6),
  second_order_usd  numeric(24,6),
  xva_usd           numeric(24,6),
  official_usd      numeric(24,6),
  inputs            jsonb NOT NULL,
  unvalued          jsonb,
  applied_at        timestamptz,
  signed_at         timestamptz,
  signed_by         uuid,
  signed_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, run_date, scope_key)
);
CREATE INDEX IF NOT EXISTS ix_ipv_runs_user_date ON ipv_runs (user_id, run_date);

-- The market-data events: an override of one pillar for one date and scope, with its author and reason.
CREATE TABLE IF NOT EXISTS ipv_overrides (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  run_date        date NOT NULL,
  scope_key       text NOT NULL DEFAULT 'GLOBAL',
  curve_id        text NOT NULL,
  pillar          text NOT NULL,
  desk_value      numeric(24,8),
  override_value  numeric(24,8) NOT NULL,
  reason          text,
  author_user_id  uuid NOT NULL,
  author_name     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_ipv_overrides_user_date ON ipv_overrides (user_id, run_date);

-- An independent mark per curve and date: a controller's upload, or a self-host's second feed. The desk's own
-- snapshot stays what it is; market_data_snapshots holds one row per curve and date and its source list is closed.
CREATE TABLE IF NOT EXISTS ipv_independent_marks (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  curve_id        text NOT NULL,
  valuation_date  date NOT NULL,
  quotes          jsonb NOT NULL,
  source          text NOT NULL DEFAULT 'UPLOAD',
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, curve_id, valuation_date)
);

ALTER TABLE ipv_tolerances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipv_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipv_overrides         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipv_independent_marks ENABLE ROW LEVEL SECURITY;
