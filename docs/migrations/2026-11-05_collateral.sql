-- Collateral as a first-class object (backend/collateral, api/routes/collateral.py, docs/collateral.md). Idempotent;
-- safe to run on any database. Before it is applied the app serves the public seed of instruments and no schedules,
-- and the counterparty record's class-level fields keep driving the regime (today's behaviour).

-- A firm's own instruments: rows added under the firm's names, or overrides of a seed entry (same code). The seed
-- itself lives in code (pricing/collateral.py SEED) so it is versioned with the rules it depends on.
CREATE TABLE IF NOT EXISTS collateral_instruments (
  id               uuid PRIMARY KEY,
  firm_id          uuid NOT NULL,                      -- the firm, or the user id for an account without a firm
  code             text NOT NULL,
  name             text NOT NULL,
  cls              text NOT NULL,                      -- pricing/collateral.py CATALOGUE code
  currency         text NOT NULL DEFAULT 'USD',
  issuer           text,
  rail             text NOT NULL DEFAULT 'bilateral',  -- bilateral | on_chain
  yield_kind       text NOT NULL DEFAULT 'NONE',       -- CURVE | FIXED | NONE
  yield_ref        text,                               -- the curve id for CURVE
  yield_bp         numeric(12,4) NOT NULL DEFAULT 0,   -- FIXED: the yield; CURVE: the spread over the curve's short rate
  chain_id         integer,
  token_address    text,
  csa_haircut_pct  numeric(8,4),                       -- a negotiated haircut; null = the class's CRE22.49 row
  active           boolean NOT NULL DEFAULT true,
  note             text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, code),
  CONSTRAINT collateral_instruments_rail_check CHECK (rail IN ('bilateral', 'on_chain')),
  CONSTRAINT collateral_instruments_yield_check CHECK (yield_kind IN ('CURVE', 'FIXED', 'NONE'))
);
CREATE INDEX IF NOT EXISTS ix_collateral_instruments_firm ON collateral_instruments (firm_id);
ALTER TABLE collateral_instruments ENABLE ROW LEVEL SECURITY;

-- The CSA's eligible-collateral annex per counterparty, versioned by effective date: the admitted instruments (for
-- VM, for IM, at a negotiated haircut and a concentration limit), what is posted and received today by instrument,
-- and the settlement rail. The counterparty's class-level fields are kept in step by the route.
CREATE TABLE IF NOT EXISTS collateral_schedules (
  id               uuid PRIMARY KEY,
  counterparty_id  uuid NOT NULL,
  user_id          uuid NOT NULL,                      -- the account that owns the counterparty (tenancy key)
  effective_from   date NOT NULL,
  eligible         jsonb NOT NULL,                     -- [{instrument, vm, im, csa_haircut_pct, limit_pct}]
  posted           jsonb NOT NULL,                     -- {instrument: weight}
  received         jsonb NOT NULL,
  rail             text NOT NULL DEFAULT 'bilateral',
  note             text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (counterparty_id, effective_from),
  CONSTRAINT collateral_schedules_rail_check CHECK (rail IN ('bilateral', 'on_chain'))
);
CREATE INDEX IF NOT EXISTS ix_collateral_schedules_cp ON collateral_schedules (counterparty_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS ix_collateral_schedules_user ON collateral_schedules (user_id);
ALTER TABLE collateral_schedules ENABLE ROW LEVEL SECURITY;
