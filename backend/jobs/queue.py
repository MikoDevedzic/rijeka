"""The job table (docs/migrations/2026-11-03_jobs.sql) as a queue.

A route enqueues a row; a worker claims the oldest QUEUED row of a kind it handles with
`SELECT ... FOR UPDATE SKIP LOCKED`, so several workers never take the same job and a claim
never waits on another worker's transaction; the handler writes progress into the row and the
worker records DONE or FAILED. Routes read the latest row for a user and kind and render it in
the shape the pages already consume (`as_status`): running, started, finished, error, result,
and the progress keys current / done / total.

Nothing here opens a session: every function takes the caller's. `tables_present` is cached
for five minutes like the other table checks, so a deployment ahead of the migration costs one
query per five minutes and falls back to the in-process thread.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text

log = logging.getLogger("rijeka.jobs")

ACTIVE = ("QUEUED", "RUNNING")
_table: dict[str, Any] = {"at": 0.0, "present": None}
COLUMNS = "id, user_id, kind, params, status, progress, result, error, created_at, started_at, finished_at, worker, attempts"


def _json(v: Any) -> str:
    return json.dumps(v if v is not None else {}, default=str)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rollback(db) -> None:
    try:
        db.rollback()
    except Exception:                    # noqa: BLE001
        pass


def tables_present(db) -> bool:
    """Whether the jobs table exists; cached for five minutes, False when the check itself fails."""
    if _table["present"] and time.time() - _table["at"] < 300:      # only a yes is remembered: a migration applied while the API runs is seen at once
        return True
    try:
        ok = bool(db.execute(text("SELECT to_regclass('public.jobs')")).scalar())
    except Exception:                    # noqa: BLE001
        _rollback(db)
        ok = False
    _table.update(at=time.time(), present=ok)
    return ok


def worker_expected(db) -> bool:
    """Whether a route should enqueue instead of starting a thread: RIJEKA_WORKER=1 forces it (the
    table must still exist), RIJEKA_WORKER=0 turns it off, and the default is on when the process
    runs on Render (RENDER is set) and the migration has been applied."""
    v = os.getenv("RIJEKA_WORKER", "auto").strip().lower()
    if v in ("0", "false", "no", "off"):
        return False
    if v in ("1", "true", "yes", "on"):
        return tables_present(db)
    return bool(os.getenv("RENDER")) and tables_present(db)


def _row(r) -> Optional[dict]:
    if r is None:
        return None
    m = r._mapping if hasattr(r, "_mapping") else r
    out = {k: m[k] for k in m.keys()}
    for k in ("params", "progress", "result"):
        if isinstance(out.get(k), str):
            try:
                out[k] = json.loads(out[k])
            except ValueError:
                pass
    out["id"] = str(out["id"]); out["user_id"] = str(out["user_id"])
    return out


def enqueue(db, user_id, kind: str, params: Optional[dict] = None) -> str:
    """Insert a QUEUED row; returns its id. Commits."""
    jid = str(uuid.uuid4())
    db.execute(text("INSERT INTO jobs (id, user_id, kind, params, status, progress, created_at) "
                    "VALUES (:id, :u, :k, CAST(:p AS jsonb), 'QUEUED', '{}'::jsonb, :t)"),
               {"id": jid, "u": str(user_id), "k": kind, "p": _json(params), "t": _now()})
    db.commit()
    return jid


def claim(db, worker_name: str, kinds: list[str]) -> Optional[dict]:
    """The oldest QUEUED job of one of `kinds`, marked RUNNING by this worker; None when there is none.
    FOR UPDATE SKIP LOCKED: two workers never claim the same row and never wait for each other."""
    if not kinds:
        return None
    r = db.execute(text(
        "UPDATE jobs SET status = 'RUNNING', started_at = :t, worker = :w, attempts = COALESCE(attempts, 0) + 1 "
        "WHERE id = (SELECT id FROM jobs WHERE status = 'QUEUED' AND kind = ANY(:kinds) "
        "            ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1) "
        f"RETURNING {COLUMNS}"), {"t": _now(), "w": worker_name, "kinds": list(kinds)}).first()
    db.commit()
    return _row(r)


def progress(db, job_id: str, patch: dict) -> None:
    """Merge `patch` into the row's progress. Commits; a failure is logged, never raised."""
    try:
        db.execute(text("UPDATE jobs SET progress = COALESCE(progress, '{}'::jsonb) || CAST(:p AS jsonb) WHERE id = :id"),
                   {"p": _json(patch), "id": str(job_id)})
        db.commit()
    except Exception as e:               # noqa: BLE001
        _rollback(db)
        log.debug("jobs: progress write failed: %s", type(e).__name__)


def finish(db, job_id: str, result: Any) -> None:
    db.execute(text("UPDATE jobs SET status = 'DONE', result = CAST(:r AS jsonb), finished_at = :t, error = NULL WHERE id = :id"),
               {"r": _json(result), "t": _now(), "id": str(job_id)})
    db.commit()


def fail(db, job_id: str, error: str) -> None:
    db.execute(text("UPDATE jobs SET status = 'FAILED', error = :e, finished_at = :t WHERE id = :id"),
               {"e": str(error)[:300], "t": _now(), "id": str(job_id)})
    db.commit()


def latest(db, user_id, kind: str) -> Optional[dict]:
    """The most recent job of `kind` for the user, or for anyone when user_id is None."""
    if user_id is None:
        r = db.execute(text(f"SELECT {COLUMNS} FROM jobs WHERE kind = :k ORDER BY created_at DESC LIMIT 1"), {"k": kind}).first()
    else:
        r = db.execute(text(f"SELECT {COLUMNS} FROM jobs WHERE user_id = :u AND kind = :k ORDER BY created_at DESC LIMIT 1"),
                       {"u": str(user_id), "k": kind}).first()
    return _row(r)


def requeue_stale(db, older_than_minutes: int = 90, max_attempts: int = 3) -> int:
    """RUNNING rows nobody has touched for `older_than_minutes` belong to a worker that died: back to
    QUEUED while attempts remain, else FAILED. Returns how many rows changed."""
    cutoff = _now().timestamp() - older_than_minutes * 60
    cutoff_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc)
    n = db.execute(text("UPDATE jobs SET status = CASE WHEN COALESCE(attempts, 0) < :m THEN 'QUEUED' ELSE 'FAILED' END, "
                        "error = CASE WHEN COALESCE(attempts, 0) < :m THEN error ELSE 'the worker running this job stopped' END, "
                        "finished_at = CASE WHEN COALESCE(attempts, 0) < :m THEN NULL ELSE :t END, worker = NULL "
                        "WHERE status = 'RUNNING' AND COALESCE(started_at, created_at) < :c"),
                   {"m": max_attempts, "t": _now(), "c": cutoff_dt}).rowcount
    db.commit()
    return int(n or 0)


def _iso(v) -> Optional[str]:
    if v is None:
        return None
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def as_status(job: Optional[dict]) -> Optional[dict]:
    """The row in the shape the pages read (CcrPage.jsx, RiskSettings.jsx): the in-memory dict's keys
    plus `status`, `queued`, `job_id` and `worker`."""
    if job is None:
        return None
    prog = job.get("progress") or {}
    status = job.get("status")
    return {"running": status in ACTIVE, "queued": status == "QUEUED", "status": status, "job_id": job["id"],
            "started": _iso(job.get("started_at")) or _iso(job.get("created_at")), "finished": _iso(job.get("finished_at")),
            "error": job.get("error"), "result": job.get("result"), "worker": job.get("worker"),
            "current": prog.get("current"), "done": prog.get("done", 0), "total": prog.get("total", 0)}


# ── heartbeat (worker_heartbeat, same migration) ─────────────────────────────

def heartbeat(db, worker_name: str, kinds: list[str], started_at: datetime, current_job: Optional[str]) -> None:
    try:
        db.execute(text("INSERT INTO worker_heartbeat (worker, at, kinds, started_at, current_job) VALUES (:w, :t, :k, :s, :j) "
                        "ON CONFLICT (worker) DO UPDATE SET at = EXCLUDED.at, kinds = EXCLUDED.kinds, current_job = EXCLUDED.current_job"),
                   {"w": worker_name, "t": _now(), "k": ",".join(kinds), "s": started_at, "j": current_job})
        db.commit()
    except Exception as e:               # noqa: BLE001
        _rollback(db)
        log.debug("jobs: heartbeat failed: %s", type(e).__name__)


def worker_status(db, stale_after_s: int = 120) -> dict:
    """For GET /api/ops/health: the newest heartbeat and the queue depth; {present: False} without the table."""
    if db is None or not tables_present(db):
        return {"present": False, "reason": "jobs table missing: apply docs/migrations/2026-11-03_jobs.sql"}
    try:
        hb = db.execute(text("SELECT worker, at, kinds, current_job FROM worker_heartbeat ORDER BY at DESC LIMIT 1")).first()
        q = db.execute(text("SELECT count(*) FILTER (WHERE status = 'QUEUED') AS queued, count(*) FILTER (WHERE status = 'RUNNING') AS running FROM jobs")).first()
    except Exception as e:               # noqa: BLE001
        _rollback(db)
        return {"present": False, "reason": f"{type(e).__name__} reading the worker tables"}
    if hb is None:
        return {"present": False, "reason": "no worker has reported yet", "queued": int(q.queued or 0), "running": int(q.running or 0)}
    at = hb.at if getattr(hb.at, "tzinfo", None) else hb.at.replace(tzinfo=timezone.utc)
    age = (_now() - at).total_seconds()
    return {"present": True, "ok": age <= stale_after_s, "worker": hb.worker, "last_heartbeat": at.isoformat(), "age_s": round(age),
            "kinds": hb.kinds, "current_job": str(hb.current_job) if hb.current_job else None,
            "queued": int(q.queued or 0), "running": int(q.running or 0)}
