-- 2026-11-16 · what went wrong for the people using the desk (backend/health/).
--
-- One row per problem: an error a browser reported (the app's own reports: a page that did not load, a render
-- error, a chat message that was not sent), a request the API answered with a 5xx, or one it took too long over.
-- With the account when there was one, so the operator can tell who was affected and write to them; `alerted_at`
-- is when the alert step looked at it and `rang` whether a message to the operator named it. Also one row a day of kind `digest`, the mark that the day's summary was sent.
--
-- Written only by the API (health/store.py); read only by the admin role (GET /api/ops/problems) and by the
-- alert step. A browser's report is text from outside: it is cut to a length and anything shaped like a sign-in
-- token is removed before it is kept (api/routes/ops.py: scrub). Rows older than 30 days are deleted by the API.
--
-- The account is kept by reference: when an account is deleted its problems stay, without the account
-- (ON DELETE SET NULL). Row-level security is on with no policy: the browser's roles read and write nothing here.
-- Safe to run again. To undo: DROP TABLE health_events;  (nothing else refers to it).

CREATE TABLE IF NOT EXISTS health_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  at           timestamptz NOT NULL DEFAULT now(),
  kind         text        NOT NULL,                 -- browser | api | slow | digest
  source       text        NOT NULL DEFAULT '',      -- browser: window, promise, boundary, boundary-load, chat ...; api: the method
  route        text        NOT NULL DEFAULT '',      -- browser: the page; api: the route as declared, never an id
  status       integer,
  ms           integer,
  message      text        NOT NULL DEFAULT '',
  stack        text,
  release      text,
  user_agent   text,
  user_id      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  fingerprint  text        NOT NULL,
  alerted_at   timestamptz,                         -- when the alert step looked at it
  rang         boolean     NOT NULL DEFAULT false,   -- whether a message to the operator named it then
  CONSTRAINT health_events_kind_check CHECK (kind IN ('browser', 'api', 'slow', 'digest'))
);
CREATE INDEX IF NOT EXISTS ix_health_events_at ON health_events (at);
CREATE INDEX IF NOT EXISTS ix_health_events_unalerted ON health_events (at) WHERE alerted_at IS NULL;
ALTER TABLE health_events ENABLE ROW LEVEL SECURITY;
