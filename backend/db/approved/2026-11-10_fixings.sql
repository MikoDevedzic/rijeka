-- Stored fixings for digital assets (backend/settlement, api/routes/currencies.py, market_data/deribit.py).
-- Idempotent; safe to run on any database. Before it is applied the app stores no fixing: a trade whose fixing
-- date has been reached is valued on the stored spot and flagged provisional, the fixings route serves the
-- caller's stored spots, a new ticket starts on the licensed benchmark, and the feed's tick answers
-- {"stored": false} without asking the venue anything.

-- One row per pair, date and source. user_id NULL is a shared row, every account's: written by the feed (origin
-- FEED) after it agrees with an independent spot, never overwritten by the feed, and replaced only by an
-- administrator's correction (origin CORRECTION, with its author in created_by and its reason in note; the row it
-- replaces is kept with superseded_at set). A row with a user_id is that account's own entry (origin MANUAL); a
-- second entry for the same key supersedes the first, which is kept.
-- A trade settles on the row of the source its terms name, the account's own row before the shared one, and
-- never on another source's price (backend/settlement/rule.py).
CREATE TABLE IF NOT EXISTS fixings (
  id             uuid PRIMARY KEY,
  user_id        uuid,                                -- NULL: shared; otherwise the account that entered it
  pair           text NOT NULL,                       -- BTCUSD, ETHUSD, SOLUSD
  fixing_date    date NOT NULL,
  fixing_time    text,                                -- as the source publishes it: '08:00 UTC', '16:00 London'
  source         text NOT NULL,                       -- the settlement price source, as a trade's terms name it
  value          double precision NOT NULL,           -- quote currency per unit of base
  observed_at    timestamptz NOT NULL DEFAULT now(),
  origin         text NOT NULL,                       -- FEED | CORRECTION (shared) | MANUAL (an account's own)
  created_by     uuid,
  superseded_at  timestamptz,
  note           text,                                -- a correction's reason
  disputed_at    timestamptz                          -- set when the feed re-reads the date and the venue's value differs
);

-- The same columns for a database that ran the first version of this file (local stacks only).
ALTER TABLE fixings ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE fixings ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

-- Dropped and added, so a second run leaves the same three checks. A positive, finite number ('NaN' sorts above
-- 'Infinity' in PostgreSQL, so one comparison refuses both); and the owner follows from the origin: a shared row
-- is the feed's or a correction, an account's row is its own entry.
ALTER TABLE fixings DROP CONSTRAINT IF EXISTS fixings_origin_check;
ALTER TABLE fixings ADD CONSTRAINT fixings_origin_check CHECK (origin IN ('FEED', 'MANUAL', 'CORRECTION'));
ALTER TABLE fixings DROP CONSTRAINT IF EXISTS fixings_value_check;
ALTER TABLE fixings ADD CONSTRAINT fixings_value_check CHECK (value > 0 AND value < 'Infinity'::double precision);
ALTER TABLE fixings DROP CONSTRAINT IF EXISTS fixings_owner_check;
ALTER TABLE fixings ADD CONSTRAINT fixings_owner_check
  CHECK ((user_id IS NULL AND origin IN ('FEED', 'CORRECTION')) OR (user_id IS NOT NULL AND origin = 'MANUAL'));

-- One live row per owner, pair, date and source; the nil uuid stands for the shared owner so that two shared
-- rows for the same key collide as two rows of one account do.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fixings_live
  ON fixings (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), pair, fixing_date, source)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fixings_pair_date ON fixings (pair, fixing_date);

-- No policies: the API connects as the table owner and enforces tenancy in code; nothing else reads the table.
ALTER TABLE fixings ENABLE ROW LEVEL SECURITY;
