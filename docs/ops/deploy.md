# Deploy order: API first, then the app

Two hosts deploy from this repository:

- **rijeka-api** on Render builds `main` after the commit's CI checks pass (Render's
  "wait for CI"), about ten minutes after a push.
- **app.rijeka.app** on Netlify builds the **`release`** branch, not `main`.

`release` is moved to the commit the live API is serving (`GET /api/ops/health` reports it as
`commit`, from Render's `RENDER_GIT_COMMIT`). The frontend therefore lands a few minutes after
the API that serves it, never before; a failed API deploy leaves the frontend where it was; a
Render rollback rolls the frontend back too (the push is forced, `release` is a pointer, not
history).

Two things do the move:

1. **The API itself**, at startup (`backend/scheduler.py`). About ninety seconds after a new
   process starts it waits until the public URL reports its own commit, confirms the commit is
   on `main`, and moves `release` through the GitHub API. This needs `RIJEKA_GITHUB_TOKEN` in
   the Render environment: a fine-grained personal access token for the `rijeka` repository
   only, permission **Contents: read and write**, nothing else, with an expiry. Optional:
   `RIJEKA_GITHUB_REPO` (default `MikoDevedzic/rijeka`) and `RIJEKA_PUBLIC_API_URL` (default
   Render's `RENDER_EXTERNAL_URL`). The health body shows the outcome under
   `scheduler.release_sync`.
2. **`.github/workflows/release-sync.yml`**, a five-minute schedule doing the same from the
   outside. GitHub runs schedules on a best-effort basis (on 2026-10-30 this one did not fire
   once in a day), so it is the backstop and the manual button:
   `gh workflow run release-sync` deploys the frontend by hand.

Why not a job in `ci.yml`: Render waits for all of the commit's checks, so a check that
waited for Render would never finish.

## Batches

The same scheduler runs every batch in-process on Render: news, summaries and spot every
30 minutes; the demo market data rebuild, end-of-day P&L, market risk and counterparty credit
every 2 hours (`RIJEKA_SCHEDULER_MINUTES`, `RIJEKA_SCHEDULER_DAILY_HOURS`). It is on whenever
`RENDER` is set, or with `RIJEKA_SCHEDULER=1`; `RIJEKA_SCHEDULER=0` turns it off. It needs
`RIJEKA_CRON_SECRET`, the same value the workflow sends. `.github/workflows/news-tick.yml`
remains the second driver and the alarm: its last step fails the run when a batch is stale,
and GitHub mails the owner. `GET /api/ops/health` shows both views: the data's freshness per
batch and the scheduler's last cycle per step.

The landing site rijeka.app is separate (root `netlify_drop/`, deployed with the CLI).
