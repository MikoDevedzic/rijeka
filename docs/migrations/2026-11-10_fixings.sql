-- Stored fixings for digital assets (backend/settlement, api/routes/currencies.py, market_data/deribit.py).
-- Idempotent; safe to run on any database. Before it is applied the app stores no fixing: a trade whose fixing
-- date has been reached is valued on the stored spot and flagged provisional, the fixings route serves the
-- caller's stored spots, and the feed's tick answers {"stored": false} without asking the venue anything.

-- One row per pair, date and source. user_id NULL is a shared row, written only by the feed (origin FEED) and
-- never overwritten: a published fixing is a fact. A row with a user_id is that account's own entry (origin
-- MANUAL); a second entry for the same key supersedes the first, which is kept with superseded_at set.
-- A trade settles on the row of the source its terms name, the account's own row before the shared one, and
-- never on another source's price (backend/settlement/rule.py).
CREATE TABLE IF NOT EXISTS fixings (
  id             uuid PRIMARY KEY,
  user_id        uuid,                                -- NULL: shared, the feed's; otherwise the account that entered it
  pair           text NOT NULL,                       -- BTCUSD, ETHUSD, SOLUSD
  fixing_date    date NOT NULL,
  fixing_time    text,                                -- as the source publishes it: '08:00 UTC', '16:00 London'
  source         text NOT NULL,                       -- the settlement price source, as a trade's terms name it
  value          double precision NOT NULL,           -- quote currency per unit of base
  observed_at    timestamptz NOT NULL DEFAULT now(),
  origin         text NOT NULL CHECK (origin IN ('FEED', 'MANUAL')),
  created_by     uuid,
  superseded_at  timestamptz
);

-- One live row per owner, pair, date and source; the nil uuid stands for the shared owner so that two shared
-- rows for the same key collide as two rows of one account do.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fixings_live
  ON fixings (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), pair, fixing_date, source)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fixings_pair_date ON fixings (pair, fixing_date);

-- No policies: the API connects as the table owner and enforces tenancy in code; nothing else reads the table.
ALTER TABLE fixings ENABLE ROW LEVEL SECURITY;
