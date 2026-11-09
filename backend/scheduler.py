"""In-process batch scheduler and release sync.

Every batch the desk depends on (news, summaries, FX and crypto spot, the demo market data
rebuild, end-of-day P&L, market risk, counterparty credit) was driven only by a GitHub Actions
cron. GitHub runs scheduled workflows on a best-effort basis: on 2026-10-30 the half-hourly
news tick fired three times in the day and the five-minute release sync not once. This thread
runs the same sequence inside the API process, which on Render is always on. The workflows
stay as a second driver and as the external check that mails the owner when a batch is stale.
Both call the same functions; every batch is idempotent for a day, so a second run costs time,
not correctness.

Enabled by RIJEKA_SCHEDULER=1, or by default when the process runs on Render (Render sets
RENDER); RIJEKA_SCHEDULER=0 turns it off. Tests set neither, so nothing starts there.

Cadence: the marks group every RIJEKA_SCHEDULER_MARKS_MINUTES (10): digital-asset spot, option
vols and forwards, three public requests to the venue and three for the spot; the half-hourly group every RIJEKA_SCHEDULER_MINUTES (30),
which also carries crypto_fixings: the venue's daily delivery prices (published at 08:00 UTC) into the fixings
store. The tick itself decides what to ask (api/routes/demo_market_data.refresh_fixings): one public request per
asset that has a date missing, none once every date is stored, and a slower retry for a date that stays missing;
the daily group every
RIJEKA_SCHEDULER_DAILY_HOURS (2), which is what the workflow managed on a good day and keeps
the risk and credit batches off the single CPU most of the time; the every_cycle group on
every pass of the loop (a minute): today only chain_reconcile, which follows anchors whose
transaction was still unmined when the confirm request returned (chain/pending.py) and is a
single cheap query when nothing is in flight.

The worker tier (worker.py) takes the on-demand runs (a user's RUN NOW, the risk backfill)
when it is deployed; the daily batches stay here on purpose: they are idempotent for a day and
already off the request path, and moving them would only add a dependency on the worker being
up for data the health check watches.

Release sync: the frontend deploys from the `release` branch, which must point at the commit
the API is serving. When RIJEKA_GITHUB_TOKEN is set (a fine-grained token with Contents:
read and write on the repository), a freshly started process waits until the public health
URL reports its own commit, confirms that commit is on main, and moves `release` to it. The
release-sync workflow does the same from the outside whenever GitHub gets round to running it.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

log = logging.getLogger(__name__)

STEP_TIMEOUT_NOTE = "steps run in sequence; a failing one is recorded and the next runs"

GROUPS = ("half_hourly", "marks", "daily", "every_cycle")      # the order groups run in when several are due

# name, group, how to run it with (db, secret)
STEPS: list[tuple[str, str, Callable[..., Any]]] = []


def _define_steps() -> list[tuple[str, str, Callable[..., Any]]]:
    # Imported here so importing this module never imports the routers (and the tests can
    # replace the list without touching the database).
    from api.routes import ccr, currencies, demo_market_data, news, pnl, risk
    return [
        ("news", "half_hourly", lambda db, s: news.tick(db=db, x_rijeka_cron=s)),
        ("summaries", "half_hourly", lambda db, s: news.summarize(limit=12, db=db, x_rijeka_cron=s)),
        ("spots", "half_hourly", lambda db, s: currencies.tick(db=db, x_rijeka_cron=s)),
        ("crypto_fixings", "half_hourly", lambda db, s: demo_market_data.fixings_tick(count=3, dry_run=False, force=False, db=db, x_rijeka_cron=s)),
        ("crypto_marks", "marks", lambda db, s: demo_market_data.crypto_tick(dry_run=False, db=db, x_rijeka_cron=s)),
        ("market_data", "daily", lambda db, s: demo_market_data.tick(dry_run=False, db=db, x_rijeka_cron=s)),
        ("pnl", "daily", lambda db, s: pnl.eod_tick(db=db, x_rijeka_cron=s)),
        ("risk", "daily", lambda db, s: risk.daily_tick(db=db, x_rijeka_cron=s)),
        ("ccr", "daily", lambda db, s: ccr.daily_tick(db=db, x_rijeka_cron=s)),
        ("chain_reconcile", "every_cycle", lambda db, s: _reconcile(db)),
    ]


def _reconcile(db) -> dict:
    """Anchors in flight: the registry or the receipt decides, the CONFIRMED event follows (chain/pending.py).
    The API process owns the relayer, so this runs here and not in the worker."""
    from chain import pending
    return pending.reconcile_pending(db)


def enabled() -> bool:
    v = os.getenv("RIJEKA_SCHEDULER", "auto").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return bool(os.getenv("RENDER"))


def _minutes() -> float:
    return float(os.getenv("RIJEKA_SCHEDULER_MINUTES", "30"))


def _marks_minutes() -> float:
    return float(os.getenv("RIJEKA_SCHEDULER_MARKS_MINUTES", "10"))


def _daily_hours() -> float:
    return float(os.getenv("RIJEKA_SCHEDULER_DAILY_HOURS", "2"))


# ── state, shown in GET /api/ops/health as `scheduler` ───────────────────────
_state: dict[str, Any] = {"enabled": False, "started_at": None, "last_cycle": None,
                          "steps": {}, "release_sync": None}
_lock = threading.Lock()
_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_last_group_run: dict[str, float] = {}


def status() -> dict:
    with _lock:
        return {"enabled": _state["enabled"], "started_at": _state["started_at"],
                "last_cycle": _state["last_cycle"], "steps": dict(_state["steps"]),
                "release_sync": _state["release_sync"]}


def _record(name: str, ok: bool, detail: str) -> None:
    with _lock:
        _state["steps"][name] = {"at": datetime.now(timezone.utc).isoformat(), "ok": ok, "detail": detail[:200]}


def due(group: str, now: Optional[float] = None) -> bool:
    """Whether a group should run now; the first call for a group is always due; every_cycle always is."""
    if group == "every_cycle":
        return True
    now = time.time() if now is None else now
    period = {"marks": _marks_minutes() * 60, "half_hourly": _minutes() * 60}.get(group, _daily_hours() * 3600)
    last = _last_group_run.get(group)
    return last is None or now - last >= period - 5


def run_step(name: str, fn: Callable[..., Any], secret: str, session_factory=None) -> bool:
    """One batch in its own session; the result or the error is recorded, never raised."""
    if not secret:
        _record(name, False, "RIJEKA_CRON_SECRET is not set")
        return False
    if session_factory is None:
        from db.session import SessionLocal
        session_factory = SessionLocal
    db = session_factory()
    try:
        out = fn(db, secret)
        try:
            db.commit()
        except Exception:                 # noqa: BLE001 — a step that already closed its work
            db.rollback()
        _record(name, True, str(out))
        return True
    except Exception as e:                # noqa: BLE001 — recorded; the next step runs
        try:
            db.rollback()
        except Exception:                 # noqa: BLE001
            pass
        log.warning("scheduler: %s failed: %s: %s", name, type(e).__name__, str(e)[:500])
        _record(name, False, f"{type(e).__name__} (the message is in the server log)")   # the record is public on /api/ops/health
        return False
    finally:
        db.close()


def run_cycle(steps=None, now: Optional[float] = None, session_factory=None) -> list[str]:
    """Runs every due group once; returns the names that ran."""
    steps = STEPS or _define_steps() if steps is None else steps
    now = time.time() if now is None else now
    secret = os.getenv("RIJEKA_CRON_SECRET", "")
    ran: list[str] = []
    for group in GROUPS:
        if not due(group, now):
            continue
        _last_group_run[group] = now
        for name, g, fn in steps:
            if g != group:
                continue
            run_step(name, fn, secret, session_factory)
            ran.append(name)
    with _lock:
        _state["last_cycle"] = datetime.now(timezone.utc).isoformat()
    return ran


# ── release sync ─────────────────────────────────────────────────────────────
def github(method: str, path: str, token: str, body: Optional[dict] = None) -> tuple[int, Any]:
    """One GitHub REST call; replaced in tests."""
    import httpx
    r = httpx.request(method, f"https://api.github.com{path}", json=body, timeout=30,
                      headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rijeka-api"})
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, None


def live_commit(url: str) -> Optional[str]:
    """The commit the public API reports; replaced in tests."""
    import httpx
    try:
        r = httpx.get(f"{url.rstrip('/')}/api/ops/health", timeout=30)
        return (r.json() or {}).get("commit") or None
    except Exception:                     # noqa: BLE001 — not up yet
        return None


API_PATHS_EXCLUDED = ("frontend/", "netlify_drop/", "docs/", ".github/")   # workflows are not in the API image either


def frontend_only(files: list[str]) -> bool:
    """True when every changed path is outside the API (what render.yaml's buildFilter skips)."""
    return bool(files) and all(f.startswith(API_PATHS_EXCLUDED) or f.endswith(".md") for f in files)


def sync_release(own: str, repo: str, token: str, gh=github, branch: str = "release",
                 base: str = "main") -> str:
    """Moves `release` to `own` when `own` is on `base` and `release` is elsewhere; to `base`'s head instead
    when `base` is ahead of `own` on frontend, landing-site or docs changes only (Render does not deploy
    those, so the API never serves them, but the frontend must). Returns what happened."""
    code, ref = gh("GET", f"/repos/{repo}/git/ref/heads/{branch}", token)
    current = (ref or {}).get("object", {}).get("sha") if code == 200 else None
    code, cmp = gh("GET", f"/repos/{repo}/compare/{base}...{own}", token)
    if code != 200 or (cmp or {}).get("status") not in ("identical", "behind"):
        return f"commit is not on {base} (compare {code}: {(cmp or {}).get('status')}); left alone"
    target = own
    if (cmp or {}).get("status") == "behind":
        code2, ahead = gh("GET", f"/repos/{repo}/compare/{own}...{base}", token)
        files = [f.get("filename", "") for f in (ahead or {}).get("files", [])] if code2 == 200 else []
        if frontend_only(files):
            code3, head = gh("GET", f"/repos/{repo}/git/ref/heads/{base}", token)
            if code3 == 200 and (head or {}).get("object", {}).get("sha"):
                target = head["object"]["sha"]
    if current == target:
        return "release already at this commit"
    own = target
    if current is None:
        code, _ = gh("POST", f"/repos/{repo}/git/refs", token, {"ref": f"refs/heads/{branch}", "sha": own})
    else:
        code, _ = gh("PATCH", f"/repos/{repo}/git/refs/heads/{branch}", token, {"sha": own, "force": True})
    return f"release -> {own[:7]}" if code in (200, 201) else f"GitHub refused the move ({code})"


def _release_sync_once(wait_seconds: int = 900) -> None:
    own = os.getenv("RENDER_GIT_COMMIT") or ""
    token = os.getenv("RIJEKA_GITHUB_TOKEN") or ""
    repo = os.getenv("RIJEKA_GITHUB_REPO", "MikoDevedzic/rijeka")
    url = os.getenv("RIJEKA_PUBLIC_API_URL") or os.getenv("RENDER_EXTERNAL_URL") or ""
    def note(s: str) -> None:
        with _lock:
            _state["release_sync"] = {"at": datetime.now(timezone.utc).isoformat(), "commit": own[:7] or None, "result": s}
    if not own or not token or not url:
        note("off: needs RENDER_GIT_COMMIT, RIJEKA_GITHUB_TOKEN and a public URL")
        return
    deadline = time.time() + wait_seconds
    while not _stop.is_set() and time.time() < deadline:
        if live_commit(url) == own:
            break
        _stop.wait(60)
    else:
        note("the public URL never reported this commit; release left alone")
        return
    try:
        note(sync_release(own, repo, token))
    except Exception as e:                # noqa: BLE001
        note(f"failed: {type(e).__name__}")


# ── thread ───────────────────────────────────────────────────────────────────
def _loop() -> None:
    _stop.wait(90)                        # let the process take traffic first
    if not _stop.is_set():
        _release_sync_once()
    while not _stop.is_set():
        try:
            run_cycle()
        except Exception as e:            # noqa: BLE001 — the loop must outlive any one cycle
            log.exception("scheduler: cycle failed: %s", e)
        _stop.wait(60)


def start() -> bool:
    """Called at application startup; a no-op unless enabled."""
    global _thread
    if not enabled() or _thread is not None:
        return False
    _stop.clear()
    with _lock:
        _state.update(enabled=True, started_at=datetime.now(timezone.utc).isoformat())
    _thread = threading.Thread(target=_loop, name="rijeka-scheduler", daemon=True)
    _thread.start()
    log.info("scheduler: started (every %s min; daily group every %s h)", _minutes(), _daily_hours())
    return True


def stop() -> None:
    _stop.set()
