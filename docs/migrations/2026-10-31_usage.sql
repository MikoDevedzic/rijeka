-- Usage beacons from the app (page views and funnel clicks), without cookies.
-- visitor is a daily-rotating one-way hash (address + user agent + day + server secret);
-- nothing here identifies a person. The code counts in memory until this table exists.
CREATE TABLE IF NOT EXISTS usage_hits (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at       timestamptz NOT NULL DEFAULT now(),
  event    text NOT NULL,
  route    text,
  visitor  text NOT NULL,
  release  text
);
CREATE INDEX IF NOT EXISTS usage_hits_at ON usage_hits (at);
ALTER TABLE usage_hits ENABLE ROW LEVEL SECURITY;   -- only the API's role writes and reads it
