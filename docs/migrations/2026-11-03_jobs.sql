-- Background jobs for the worker tier (backend/jobs, backend/worker.py), the worker's heartbeat,
-- and anchors whose transaction was sent but not yet mined when the confirm request returned
-- (chain/pending.py). Idempotent. Written and read by the API's role; the policies let a signed-in
-- user read their own rows through PostgREST. Until these tables exist the code keeps today's
-- behaviour: runs in a thread of the API process, confirm waits for the receipt in the request.

-- ── jobs: one row per background run; the worker claims QUEUED rows with SKIP LOCKED ──────────
CREATE TABLE IF NOT EXISTS jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  kind        text NOT NULL,                       -- ccr_run | risk_backfill (jobs/handlers.py)
  params      jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED')),
  progress    jsonb NOT NULL DEFAULT '{}',         -- {current, done, total} while running
  result      jsonb,
  error       text,
  created_at  timestamptz DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz,
  worker      text,
  attempts    int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_jobs_status_created ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS ix_jobs_user_kind_created ON jobs (user_id, kind, created_at DESC);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jobs_select_own ON jobs;
CREATE POLICY jobs_select_own ON jobs FOR SELECT USING (user_id = auth.uid());

-- ── worker_heartbeat: one row per worker process, upserted every few seconds while it runs ────
CREATE TABLE IF NOT EXISTS worker_heartbeat (
  worker      text PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  kinds       text,
  started_at  timestamptz,
  current_job uuid
);
ALTER TABLE worker_heartbeat ENABLE ROW LEVEL SECURITY;

-- ── pending_anchors: a confirm whose transaction is in flight; reconciled by the scheduler and
--    by POST /api/chain/reconcile/{trade_id}. One PENDING row per trade. ─────────────────────────
CREATE TABLE IF NOT EXISTS pending_anchors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        uuid NOT NULL,
  user_id         uuid NOT NULL,
  kind            text NOT NULL DEFAULT 'confirm',
  trade_hash      text NOT NULL,
  tx_hash         text,                            -- null when the send itself timed out before a hash came back
  explorer_tx     text,
  attestation     jsonb NOT NULL,                  -- the signed record without its anchor: parties, signatures, eip712
  idempotency_key text,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ANCHORED','FAILED')),
  reason          text,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  checked_at      timestamptz,
  resolved_at     timestamptz,
  attempts        int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_anchors_trade_open ON pending_anchors (trade_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_pending_anchors_status_submitted ON pending_anchors (status, submitted_at);
ALTER TABLE pending_anchors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_anchors_select_own ON pending_anchors;
CREATE POLICY pending_anchors_select_own ON pending_anchors FOR SELECT USING (user_id = auth.uid());
