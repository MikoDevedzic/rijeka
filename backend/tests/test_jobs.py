"""The job queue, the worker loop and the routes' fallback: enqueue and claim shapes (FOR UPDATE SKIP
LOCKED, oldest first, kinds restricted), the status view the pages read, when a route expects a
worker, a handler's progress on the row, DONE/FAILED recording, idle backoff, and the scheduler's
every-cycle group that carries the chain reconciliation."""
import uuid
from datetime import datetime, timezone

import pytest

from jobs import queue as Q
from jobs.handlers import Progress
import worker as W


class _DB:
    """A fake session that keeps the SQL it was given and answers from a script per substring."""
    def __init__(self, answers=None):
        self.sql, self.params, self.commits, self.rollbacks, self.closed = [], [], 0, 0, False
        self.answers = answers or {}
    def execute(self, sql, params=None):
        s = str(sql); self.sql.append(s); self.params.append(params or {})
        v = None
        for key, val in self.answers.items():
            if key in s:
                v = val() if callable(val) else val
                break
        class R:
            def __init__(_s, v): _s.v = v; _s.rowcount = v if isinstance(v, int) else 0
            def scalar(_s): return _s.v
            def first(_s): return _s.v
            def all(_s): return _s.v or []
        return R(v)
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1
    def close(self): self.closed = True


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    Q._table.update(at=0.0, present=None)
    monkeypatch.delenv("RIJEKA_WORKER", raising=False); monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("RIJEKA_WORKER_KINDS", raising=False)


def _job(**over):
    j = {"id": str(uuid.uuid4()), "user_id": str(uuid.uuid4()), "kind": "ccr_run", "params": {}, "status": "QUEUED", "progress": {},
         "result": None, "error": None, "created_at": datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc), "started_at": None,
         "finished_at": None, "worker": None, "attempts": 0}
    j.update(over); return j


# ── queue ────────────────────────────────────────────────────────────────────

def test_enqueue_writes_a_queued_row_with_json_params_and_commits():
    db = _DB()
    jid = Q.enqueue(db, "u-1", "ccr_run", {"ctx": {"sub": "u-1"}, "counterparty": None})
    uuid.UUID(jid)
    assert "INSERT INTO jobs" in db.sql[0] and "'QUEUED'" in db.sql[0]
    assert db.params[0]["k"] == "ccr_run" and '"sub": "u-1"' in db.params[0]["p"] and db.commits == 1


def test_claim_takes_the_oldest_queued_row_of_the_kinds_with_skip_locked():
    row = _job(status="RUNNING", worker="w1", attempts=1)
    db = _DB({"UPDATE jobs SET status = 'RUNNING'": row})
    got = Q.claim(db, "w1", ["ccr_run", "risk_backfill"])
    s = db.sql[0]
    assert "FOR UPDATE SKIP LOCKED" in s and "ORDER BY created_at ASC" in s and "kind = ANY(:kinds)" in s and "LIMIT 1" in s
    assert db.params[0]["kinds"] == ["ccr_run", "risk_backfill"] and db.params[0]["w"] == "w1"
    assert got["id"] == row["id"] and got["status"] == "RUNNING" and db.commits == 1
    assert Q.claim(_DB(), "w1", ["ccr_run"]) is None
    assert Q.claim(_DB(), "w1", []) is None


def test_progress_finish_and_fail_update_the_row():
    db = _DB()
    Q.progress(db, "j1", {"current": "BANK A", "done": 1, "total": 3})
    Q.finish(db, "j1", {"stored": 3})
    Q.fail(db, "j1", "x" * 500)
    assert "progress = COALESCE(progress, '{}'::jsonb) ||" in db.sql[0] and '"done": 1' in db.params[0]["p"]
    assert "status = 'DONE'" in db.sql[1] and '"stored": 3' in db.params[1]["r"]
    assert "status = 'FAILED'" in db.sql[2] and len(db.params[2]["e"]) == 300
    assert db.commits == 3


def test_status_view_has_the_keys_the_pages_read():
    assert Q.as_status(None) is None
    q = Q.as_status(_job())
    assert q["running"] is True and q["queued"] is True and q["status"] == "QUEUED" and q["done"] == 0 and q["total"] == 0
    assert q["started"] == "2026-11-03T09:00:00+00:00" and q["finished"] is None and q["error"] is None
    r = Q.as_status(_job(status="RUNNING", progress={"current": "BANK A", "done": 2, "total": 5}, started_at=datetime(2026, 11, 3, 9, 1, tzinfo=timezone.utc)))
    assert r["running"] and not r["queued"] and r["current"] == "BANK A" and r["done"] == 2 and r["total"] == 5 and r["started"].endswith("09:01:00+00:00")
    d = Q.as_status(_job(status="DONE", result={"stored": 4}, finished_at=datetime(2026, 11, 3, 9, 5, tzinfo=timezone.utc)))
    assert d["running"] is False and d["result"] == {"stored": 4} and d["finished"].endswith("09:05:00+00:00")
    f = Q.as_status(_job(status="FAILED", error="boom"))
    assert f["running"] is False and f["error"] == "boom"


def test_latest_is_per_user_or_for_anyone():
    db = _DB({"SELECT": _job()})
    assert Q.latest(db, "u-1", "ccr_run")["kind"] == "ccr_run" and "user_id = :u" in db.sql[0]
    Q.latest(db, None, "risk_backfill")
    assert "user_id = :u" not in db.sql[1] and db.params[1] == {"k": "risk_backfill"}


def test_worker_expected_follows_the_flag_then_render_and_always_needs_the_table(monkeypatch):
    present = {"v": True}
    monkeypatch.setattr(Q, "tables_present", lambda db: present["v"])
    assert Q.worker_expected(None) is False                       # neither flag nor Render
    monkeypatch.setenv("RENDER", "true")
    assert Q.worker_expected(None) is True
    monkeypatch.setenv("RIJEKA_WORKER", "0")
    assert Q.worker_expected(None) is False
    monkeypatch.setenv("RIJEKA_WORKER", "1"); monkeypatch.delenv("RENDER")
    assert Q.worker_expected(None) is True
    present["v"] = False
    assert Q.worker_expected(None) is False                       # forced on, but no table: threads


def test_tables_present_is_cached_and_false_when_the_check_fails():
    db = _DB({"to_regclass": "jobs"})
    assert Q.tables_present(db) is True and Q.tables_present(db) is True and len(db.sql) == 1
    Q._table.update(at=0.0, present=None)
    class Boom(_DB):
        def execute(self, sql, params=None): raise RuntimeError("no db")
    b = Boom()
    assert Q.tables_present(b) is False and b.rollbacks == 1


def test_worker_status_without_the_table_or_a_heartbeat():
    assert Q.worker_status(None)["present"] is False
    class Row:
        def __init__(self, **kw): self.__dict__.update(kw)
    db = _DB({"to_regclass": "jobs", "FROM worker_heartbeat": None, "FILTER (WHERE status = 'QUEUED')": Row(queued=2, running=1)})
    st = Q.worker_status(db)
    assert st["present"] is False and st["queued"] == 2 and st["running"] == 1 and "no worker" in st["reason"]
    db = _DB({"to_regclass": "jobs", "FROM worker_heartbeat": Row(worker="w1", at=datetime.now(timezone.utc), kinds="ccr_run", current_job=None),
              "FILTER (WHERE status = 'QUEUED')": Row(queued=0, running=0)})
    st = Q.worker_status(db)
    assert st["present"] and st["ok"] and st["worker"] == "w1" and st["age_s"] <= 1


# ── handlers and the worker loop ─────────────────────────────────────────────

def test_progress_dict_reports_every_update_and_still_behaves_as_a_dict():
    seen = []
    p = Progress(seen.append)
    p.update(current="BANK A", done=1, total=3); p.update({"done": 2})
    assert p == {"current": "BANK A", "done": 2, "total": 3} and seen == [{"current": "BANK A", "done": 1, "total": 3}, {"done": 2}]
    bad = Progress(lambda patch: (_ for _ in ()).throw(RuntimeError("db gone")))
    bad.update(done=1)                                            # progress is advisory: never raises
    assert bad["done"] == 1


def test_run_job_records_done_with_the_result_in_its_own_session():
    dbs = []
    def factory():
        d = _DB(); dbs.append(d); return d
    calls = []
    def handler(db, job, report):
        report({"done": 1, "total": 1}); calls.append(job["id"]); return {"stored": 1}
    job = _job(kind="ccr_run")
    assert W.run_job(job, factory, handlers={"ccr_run": handler}) is True
    assert calls == [job["id"]]
    finish = [d for d in dbs if any("status = 'DONE'" in s for s in d.sql)]
    prog = [d for d in dbs if any("progress = COALESCE" in s for s in d.sql)]
    assert len(finish) == 1 and len(prog) == 1 and finish[0] is not dbs[0] and all(d.closed for d in dbs)


def test_run_job_records_failed_with_the_error_and_an_unknown_kind_fails_at_once():
    dbs = []
    def factory():
        d = _DB(); dbs.append(d); return d
    def boom(db, job, report): raise ValueError("feed down")
    assert W.run_job(_job(), factory, handlers={"ccr_run": boom}) is False
    failed = [d for d in dbs if any("status = 'FAILED'" in s for s in d.sql)]
    assert len(failed) == 1 and failed[0].params[0]["e"].startswith("ValueError: feed down") and dbs[0].rollbacks == 1
    dbs.clear()
    assert W.run_job(_job(kind="mystery"), factory, handlers={}) is False
    assert any("no handler for kind 'mystery'" in (p.get("e") or "") for d in dbs for p in d.params)


def test_idle_backoff_doubles_to_ten_seconds_and_resets_after_a_job():
    d = W.POLL_S
    seq = []
    for _ in range(5):
        d = W.next_delay(d, idle=True); seq.append(d)
    assert seq == [4.0, 8.0, 10.0, 10.0, 10.0]
    assert W.next_delay(10.0, idle=False) == W.POLL_S


def test_kinds_come_from_the_environment_and_unknown_ones_are_dropped(monkeypatch):
    assert W.kinds() == ["ccr_run", "risk_backfill", "capital_run", "ipv_run"]
    monkeypatch.setenv("RIJEKA_WORKER_KINDS", "risk_backfill, nope")
    assert W.kinds() == ["risk_backfill"]


def test_loop_once_claims_runs_and_heartbeats(monkeypatch):
    job = _job(kind="ccr_run")
    claims = iter([job, None])
    beats, ran = [], []
    monkeypatch.setattr(Q, "tables_present", lambda db: True)
    monkeypatch.setattr(Q, "requeue_stale", lambda db: 0)
    monkeypatch.setattr(Q, "heartbeat", lambda db, name, kinds, started, cur: beats.append((name, cur)))
    monkeypatch.setattr(Q, "claim", lambda db, name, kinds: next(claims, None))
    monkeypatch.setattr(W, "run_job", lambda j, f, handlers=None: ran.append(j["id"]) or True)
    assert W.loop(session_factory=_DB, name="w-test", once=True) == 1
    assert ran == [job["id"]] and beats[0] == ("w-test", None) and beats[1] == ("w-test", job["id"])


def test_loop_exits_when_the_table_is_missing(monkeypatch):
    monkeypatch.setattr(Q, "tables_present", lambda db: False)
    assert W.loop(session_factory=_DB, name="w-test", once=True) == 0


# ── the scheduler's every-cycle group ────────────────────────────────────────

def test_every_cycle_group_runs_on_each_cycle(monkeypatch):
    import scheduler as S
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3")
    monkeypatch.setattr(S, "_last_group_run", {})
    monkeypatch.setattr(S, "_state", {"enabled": True, "started_at": None, "last_cycle": None, "steps": {}, "release_sync": None})
    seen = []
    steps = [("news", "half_hourly", lambda db, s: seen.append("news")), ("chain_reconcile", "every_cycle", lambda db, s: seen.append("rec") or {"open": 0})]
    assert S.run_cycle(steps, now=1000, session_factory=_DB) == ["news", "chain_reconcile"]
    assert S.run_cycle(steps, now=1060, session_factory=_DB) == ["chain_reconcile"]
    assert seen == ["news", "rec", "rec"] and S.due("every_cycle", now=1061)
    assert any(n == "chain_reconcile" for n, g, f in S._define_steps() if g == "every_cycle")


def test_health_reports_the_worker_without_a_database():
    from api.routes import ops
    assert ops.worker_status(None)["present"] is False
