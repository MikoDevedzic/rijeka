# Deploy order: API first, then the app

Two hosts deploy from this repository:

- **rijeka-api** on Render deploys every commit that reaches `main` (`autoDeployTrigger:
  commit`), a few minutes after the push. CI is enforced before that, by branch protection:
  nothing reaches `main` without the three checks. Until 2 November 2026 Render waited for the
  checks again itself and missed GitHub's check-suite event on three of four pushes, leaving
  the API undeployed until a manual deploy.
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

The same scheduler runs every batch in-process on Render: digital-asset spot, option vols and
forwards every 10 minutes; news, summaries and spot every 30 minutes; the demo market data rebuild,
end-of-day P&L, market risk and counterparty credit every 2 hours (`RIJEKA_SCHEDULER_MARKS_MINUTES`,
`RIJEKA_SCHEDULER_MINUTES`, `RIJEKA_SCHEDULER_DAILY_HOURS`). It is on whenever
`RENDER` is set, or with `RIJEKA_SCHEDULER=1`; `RIJEKA_SCHEDULER=0` turns it off. It needs
`RIJEKA_CRON_SECRET`, the same value the workflow sends. `.github/workflows/news-tick.yml`
remains the second driver and the alarm: its last step fails the run when a batch is stale,
and GitHub mails the owner. `GET /api/ops/health` shows both views: the data's freshness per
batch and the scheduler's last cycle per step.

The landing site rijeka.app is separate (root `netlify_drop/`, deployed with the CLI).

## The worker

`render.yaml` declares a second service, **rijeka-worker** (`type: worker`, same repository,
`rootDir: backend`, `python -m worker`). Creating it is a Blueprint sync click in Render once
`docs/migrations/2026-11-03_jobs.sql` is applied (it adds `jobs`, `worker_heartbeat` and
`pending_anchors`). The worker claims rows from `jobs` (`SELECT … FOR UPDATE SKIP LOCKED`, so two
workers never take one job), runs the handler in a session of its own (`backend/jobs/handlers.py`:
the counterparty-credit RUN NOW and the risk-history backfill), writes progress into the row, records
DONE or FAILED, and upserts a heartbeat every 15 s. `GET /api/ops/health` shows it under `worker`
(last heartbeat, age, queue depth). SIGTERM finishes the job in hand and exits; a job whose worker
died is requeued at the next start (`requeue_stale`, three attempts).

The routes decide per request: `POST /api/ccr/run` and `POST /api/risk/history/backfill` enqueue
when the `jobs` table exists and a worker is expected (`RIJEKA_WORKER=1`; the default is on under
Render once the table exists), else they start the in-process thread exactly as before, so a deploy
ahead of the migration or without the worker service changes nothing. `GET /api/ccr/status` and
`GET /api/risk/history` read the job row, with the in-memory dict as the fallback, in the same shape
the pages already consume (`running`, `done`, `total`, `current`, `error`, `result`, plus `status`,
`queued`, `job_id`, `worker`). With `RIJEKA_WORKER=1` and no worker running, runs queue until one
starts; set it to `0` to go back to threads.

The daily batches and the release move stay in the API process (`scheduler.py`): they are
idempotent for a day, already off the request path, and the health check watches their output; the
worker only takes the runs a person starts. The worker never sends a chain transaction: the relayer
nonce belongs to the API process (`RIJEKA_WORKER_KINDS` on the service lists `ccr_run,risk_backfill,capital_run,ipv_run`; the last two are the book's capital under regimes, `POST /api/capital/portfolio`, and the IPV run, `POST /api/ipv/run`).

## Confirm is asynchronous beyond 25 s

`POST /api/chain/confirm/{trade_id}` still sends the transaction from the API process (nonce
ownership) and still answers 201 with the CONFIRMED event when the receipt arrives in time. The
difference is the wait: `RIJEKA_CHAIN_SYNC_WAIT_S` (25 s) instead of the backend's three minutes.
When the block has not come by then and the registry has no record yet, the route stores the signed
record (parties, signatures, EIP-712 domain, hash) with the transaction hash in `pending_anchors`
and answers **202** `{pending: true, tx_hash, explorer_tx, note, trade, legs}`; nothing is written
to the trade. The scheduler's `chain_reconcile` step (every cycle, a minute) and
`POST /api/chain/reconcile/{trade_id}` (owner only; the trade window polls it every 10 s for up to
10 minutes) then check the registry record and the receipt and, once anchored, apply the same
lifecycle transition the synchronous path applies (`chain/pending.py: apply_confirmed`), exactly
once: the row is taken `FOR UPDATE` and flipped in the transaction that writes the event. A
reverted transaction, or one the node no longer knows after 15 minutes, marks the row FAILED with
the reason; the trade stays PENDING and the button offers RETRY. A second confirm while a
transaction is in flight reconciles instead of sending again.

Without the `pending_anchors` table the route waits the full receipt timeout in the request, as
before. Countersign (the chat card), amend and terminate stay synchronous: countersign's caller
posts to the room after the committed event, and amend applies the booking changes in the
transaction that writes the event, so neither is a small extension of the pattern.

