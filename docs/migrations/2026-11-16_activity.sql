-- 2026-11-16 · what each account does, by day (backend/activity/).
--
-- One row per account, day (UTC), kind of activity and detail: how many times, and the first and the last time that
-- day. Written only by the API (the buffer in activity/store.py, flushed every half minute); read only by
-- GET /api/ops/adoption, which needs the admin role. It holds no trade, no figure, no text a user typed and no
-- address, of a page or of a machine: the kinds are a fixed list (activity/events.py) and the detail is one of a
-- fixed list of words.
--
-- Until this table exists nothing is recorded: the API drops what it would have written.
--
-- The record belongs to its account: the row refers to auth.users and goes with it (ON DELETE CASCADE), so deleting
-- an account deletes what was counted for it. The API therefore cannot write a row for an account that is gone.
--
-- Row-level security is on with no policy: the browser's roles (anon, authenticated) read and write nothing here.
-- Safe to run again. To undo: DROP TABLE activity_daily;  (it holds counts only; nothing else refers to it).

CREATE TABLE IF NOT EXISTS activity_daily (
  user_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  day       date        NOT NULL,
  event     text        NOT NULL,
  detail    text        NOT NULL DEFAULT '',
  n         integer     NOT NULL DEFAULT 0,
  first_at  timestamptz NOT NULL DEFAULT now(),
  last_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, event, detail),
  CONSTRAINT activity_daily_event_check CHECK (char_length(event) BETWEEN 1 AND 40),
  CONSTRAINT activity_daily_detail_check CHECK (char_length(detail) <= 40)
);
CREATE INDEX IF NOT EXISTS ix_activity_daily_day ON activity_daily (day);
ALTER TABLE activity_daily ENABLE ROW LEVEL SECURITY;
