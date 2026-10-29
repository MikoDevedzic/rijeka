-- In-app news summaries (backend/news/summarize.py). Idempotent; run once:
--   paste into the Supabase SQL editor, or
--   cd backend && psql "$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" -f ../docs/migrations/2026-10-29_news_summaries.sql

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS description   text,          -- the feed's own blurb, HTML stripped
  ADD COLUMN IF NOT EXISTS summary       text,          -- Rijeka's own words, with a 'Why it matters' line
  ADD COLUMN IF NOT EXISTS summary_basis text,          -- 'article' (public bodies) or 'feed' (commercial publishers)
  ADD COLUMN IF NOT EXISTS summarized_at timestamptz;   -- set even when there was nothing to summarise

CREATE INDEX IF NOT EXISTS news_items_pending_summary
  ON news_items (coalesce(published_at, created_at) DESC)
  WHERE summary IS NULL AND summarized_at IS NULL;
