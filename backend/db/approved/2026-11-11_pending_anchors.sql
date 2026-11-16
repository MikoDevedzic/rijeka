-- 2026-11-11_pending_anchors.sql: anchors whose transaction was sent but not yet mined when the confirm request
-- returned (backend/chain/pending.py), on their own.
--
-- The same table as the pending_anchors section of 2026-11-03_jobs.sql, which bundled it with the worker's tables
-- (jobs, worker_heartbeat); those are safe to apply only when the worker is alive, so the confirm path waited on
-- them. One feature per file: this one is safe on its own and at any time.
--
-- Idempotent; safe to run on any database, including one where the jobs file has been applied (every statement is
-- IF NOT EXISTS, and enabling row-level security twice is nothing). Until the table exists a confirm waits for the
-- receipt inside the request, as it does today. With it a slow block answers 202 and the trade reads ANCHORING
-- until the scheduler or POST /api/chain/reconcile/{trade_id} applies the receipt.

-- One PENDING row per trade. The attestation is the signed record without its anchor: parties, signatures, eip712.
CREATE TABLE IF NOT EXISTS pending_anchors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        uuid NOT NULL,
  user_id         uuid NOT NULL,
  kind            text NOT NULL DEFAULT 'confirm',
  trade_hash      text NOT NULL,
  tx_hash         text,                            -- null when the send itself timed out before a hash came back
  explorer_tx     text,
  attestation     jsonb NOT NULL,
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

-- No policies: the API connects as the table owner and enforces tenancy in code; nothing else reads the table.
-- (The jobs file gave signed-in users a SELECT policy on their own rows; no page reads this table, so none is made.)
ALTER TABLE pending_anchors ENABLE ROW LEVEL SECURITY;
