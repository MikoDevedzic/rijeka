"""The worker process: `python -m worker` from backend/ (the `worker` service in render.yaml).

Claims one job at a time from the jobs table (jobs/queue.py), runs its handler (jobs/handlers.py)
in its own session, records DONE or FAILED, and writes a heartbeat row the API shows on
GET /api/ops/health. Polls every 2 s; when idle the poll backs off, doubling to 10 s. SIGTERM
(Render's stop) finishes the job in hand and exits. RIJEKA_WORKER_KINDS restricts the kinds
this process takes (comma-separated; default every handler). RIJEKA_WORKER_NAME names it in the
heartbeat (default host:pid).

The worker never sends a chain transaction: the relayer nonce is owned by the API process,
and a pending anchor is reconciled there (chain/pending.py), not here."""
from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from jobs import queue as Q
from jobs.handlers import HANDLERS

log = logging.getLogger("rijeka.worker")

POLL_S = 2.0
IDLE_MAX_S = 10.0
HEARTBEAT_EVERY_S = 15.0
_stop = threading.Event()


def worker_name() -> str:
    return os.getenv("RIJEKA_WORKER_NAME") or f"{os.getenv('RENDER_INSTANCE_ID') or socket.gethostname()}:{os.getpid()}"


def kinds() -> list[str]:
    raw = (os.getenv("RIJEKA_WORKER_KINDS") or "").strip()
    wanted = [k.strip() for k in raw.split(",") if k.strip()] if raw else list(HANDLERS)
    unknown = [k for k in wanted if k not in HANDLERS]
    if unknown:
        log.warning("worker: RIJEKA_WORKER_KINDS names kinds without a handler: %s", unknown)
    return [k for k in wanted if k in HANDLERS]


def next_delay(current: float, idle: bool) -> float:
    """Exponential backoff while idle, reset to the poll period as soon as a job ran."""
    return min(max(current, POLL_S) * 2, IDLE_MAX_S) if idle else POLL_S


def run_job(job: dict, session_factory, handlers=None) -> bool:
    """One job in its own session; progress and the outcome go to the row in sessions of their own
    so the handler's transaction is never committed by a progress write. Returns True on DONE."""
    handlers = handlers or HANDLERS
    jid = job["id"]
    handler = handlers.get(job["kind"])

    def report(patch: dict) -> None:
        s = session_factory()
        try:
            Q.progress(s, jid, patch)
        finally:
            s.close()

    def record(fn, *a) -> None:
        s = session_factory()
        try:
            fn(s, jid, *a)
        finally:
            s.close()

    if handler is None:
        record(Q.fail, f"no handler for kind {job['kind']!r}")
        return False
    db = session_factory()
    t0 = time.time()
    try:
        result = handler(db, job, report)
        try:
            db.commit()
        except Exception:                # noqa: BLE001 — a handler that already closed its work
            db.rollback()
        record(Q.finish, result)
        log.info("worker: %s %s done in %.1fs", job["kind"], jid[:8], time.time() - t0)
        return True
    except Exception as e:               # noqa: BLE001 — recorded on the row; the loop goes on
        try:
            db.rollback()
        except Exception:                # noqa: BLE001
            pass
        log.warning("worker: %s %s failed: %s: %s", job["kind"], jid[:8], type(e).__name__, str(e)[:300])
        record(Q.fail, f"{type(e).__name__}: {str(e)[:250]}")
        return False
    finally:
        db.close()


def loop(session_factory=None, name: Optional[str] = None, once: bool = False) -> int:
    """The claim-run-record loop until SIGTERM; `once` runs a single iteration (tests). Returns jobs run."""
    if session_factory is None:
        from db.session import SessionLocal
        session_factory = SessionLocal
    name = name or worker_name()
    ks = kinds()
    started = datetime.now(timezone.utc)
    ran = 0
    delay = POLL_S
    last_beat = 0.0
    s = session_factory()
    try:
        if not Q.tables_present(s):
            log.error("worker: the jobs table is missing; apply docs/migrations/2026-11-03_jobs.sql. Exiting.")
            return 0
        n = Q.requeue_stale(s)
        if n:
            log.info("worker: requeued %d stale job(s)", n)
    finally:
        s.close()
    log.info("worker %s: kinds %s", name, ks)
    while not _stop.is_set():
        job = None
        s = session_factory()
        try:
            if time.time() - last_beat >= HEARTBEAT_EVERY_S:
                Q.heartbeat(s, name, ks, started, None); last_beat = time.time()
            job = Q.claim(s, name, ks)
        except Exception as e:           # noqa: BLE001 — the database blinked; try again after the delay
            try:
                s.rollback()
            except Exception:            # noqa: BLE001
                pass
            log.warning("worker: claim failed: %s", type(e).__name__)
        finally:
            s.close()
        if job is not None:
            s = session_factory()
            try:
                Q.heartbeat(s, name, ks, started, job["id"]); last_beat = time.time()
            finally:
                s.close()
            run_job(job, session_factory)
            ran += 1
        delay = next_delay(delay, idle=job is None)
        if once:
            break
        _stop.wait(delay)
    log.info("worker %s: stopped after %d job(s)", name, ran)
    return ran


def _install_signals() -> None:
    def handler(signum, frame):          # noqa: ARG001
        log.info("worker: signal %s, finishing the job in hand", signum)
        _stop.set()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, handler)
        except ValueError:               # not the main thread
            pass


def main() -> None:
    logging.basicConfig(level=os.getenv("RIJEKA_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    os.environ["TZ"] = "America/New_York"          # the desk's clock, as main.py sets it: the API and the worker agree on today
    if hasattr(time, "tzset"):
        time.tzset()                     # glibc reads TZ once, at `import time`: setting the variable is not enough
    _install_signals()
    loop()


if __name__ == "__main__":
    main()
