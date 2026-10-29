-- P&L foundation: end-of-day marks, daily attributed P&L per trade, sign-offs.
-- Run in the Supabase SQL editor. Idempotent.

CREATE TABLE IF NOT EXISTS eod_marks (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  trade_id    uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  mark_date   date NOT NULL,
  npv         numeric(24,6) NOT NULL,
  ccy         text NOT NULL,
  ir01        numeric(24,6),
  ir01_disc   numeric(24,6),
  spot01      numeric(24,6),
  theta       numeric(24,6),
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trade_id, mark_date)
);
CREATE INDEX IF NOT EXISTS ix_eod_marks_user_date ON eod_marks (user_id, mark_date);

CREATE TABLE IF NOT EXISTS pnl_daily (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  trade_id     uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  pnl_date     date NOT NULL,
  prev_date    date,
  kind         text NOT NULL,            -- EXPLAINED | NEW | UNWIND
  ccy          text NOT NULL,
  total        numeric(24,6) NOT NULL,   -- in the trade's currency
  usd          numeric(24,6),            -- reporting currency at the close
  market_usd   numeric(24,6),
  trading_usd  numeric(24,6),
  rows         jsonb NOT NULL,           -- the attribution rows
  desk         text,
  book         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trade_id, pnl_date)
);
CREATE INDEX IF NOT EXISTS ix_pnl_daily_user_date ON pnl_daily (user_id, pnl_date);

CREATE TABLE IF NOT EXISTS pnl_signoffs (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,         -- whose book
  pnl_date        date NOT NULL,
  role            text NOT NULL,         -- TRADER | CONTROLLER
  signer_user_id  uuid NOT NULL,
  signer_name     text,
  comment         text,
  usd_signed      numeric(24,6),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pnl_signoffs_user_date ON pnl_signoffs (user_id, pnl_date);

ALTER TABLE eod_marks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pnl_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pnl_signoffs ENABLE ROW LEVEL SECURITY;
