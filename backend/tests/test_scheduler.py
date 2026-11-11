"""The in-process scheduler: when it is on, what is due, failures stay inside a step, and the release move."""
import scheduler as S


def test_enabled_follows_the_flag_then_render(monkeypatch):
    monkeypatch.delenv("RIJEKA_SCHEDULER", raising=False); monkeypatch.delenv("RENDER", raising=False)
    assert S.enabled() is False
    monkeypatch.setenv("RENDER", "true")
    assert S.enabled() is True
    monkeypatch.setenv("RIJEKA_SCHEDULER", "0")
    assert S.enabled() is False
    monkeypatch.delenv("RENDER"); monkeypatch.setenv("RIJEKA_SCHEDULER", "1")
    assert S.enabled() is True


def test_groups_are_due_on_their_own_cadence(monkeypatch):
    monkeypatch.setattr(S, "_last_group_run", {})
    assert S.due("half_hourly", now=1000) and S.due("daily", now=1000)
    S._last_group_run.update(half_hourly=1000, daily=1000)
    assert not S.due("half_hourly", now=1000 + 29 * 60)
    assert S.due("half_hourly", now=1000 + 30 * 60)
    assert not S.due("daily", now=1000 + 119 * 60)
    assert S.due("daily", now=1000 + 120 * 60)
    # digital-asset marks: every ten minutes, between the half-hourly group and the daily one
    assert S.due("marks", now=1000)
    S._last_group_run.update(marks=1000)
    assert not S.due("marks", now=1000 + 9 * 60) and S.due("marks", now=1000 + 10 * 60)
    monkeypatch.setenv("RIJEKA_SCHEDULER_MARKS_MINUTES", "15")
    assert not S.due("marks", now=1000 + 14 * 60) and S.due("marks", now=1000 + 15 * 60)
    assert S.GROUPS == ("half_hourly", "marks", "daily", "every_cycle")
    assert ("crypto_marks", "marks") in [(n, g) for n, g, _ in S._define_steps()]


class _Db:
    def __init__(self): self.committed = self.rolled = self.closed = False
    def commit(self): self.committed = True
    def rollback(self): self.rolled = True
    def close(self): self.closed = True


def test_a_failing_step_is_recorded_and_the_cycle_continues(monkeypatch):
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3")
    monkeypatch.setattr(S, "_last_group_run", {})
    monkeypatch.setattr(S, "_state", {"enabled": True, "started_at": None, "last_cycle": None, "steps": {}, "release_sync": None})
    seen = []
    def boom(db, s): raise RuntimeError("feed down")
    def fine(db, s): seen.append(s); return {"posted": 3}
    dbs = []
    def factory():
        d = _Db(); dbs.append(d); return d
    steps = [("news", "half_hourly", boom), ("spots", "half_hourly", fine), ("risk", "daily", fine)]
    ran = S.run_cycle(steps, now=5000, session_factory=factory)
    assert ran == ["news", "spots", "risk"] and seen == ["s3", "s3"]
    st = S.status()["steps"]
    assert st["news"]["ok"] is False and "RuntimeError" in st["news"]["detail"] and "feed down" not in st["news"]["detail"]   # the record is public
    assert st["spots"]["ok"] is True and "posted" in st["spots"]["detail"]
    assert dbs[0].rolled and dbs[1].committed and all(d.closed for d in dbs)
    # nothing is due a minute later; the daily group waits two hours
    assert S.run_cycle(steps, now=5060, session_factory=factory) == []
    assert S.run_cycle(steps, now=5000 + 1800, session_factory=factory) == ["news", "spots"]


def test_without_the_cron_secret_steps_do_not_run(monkeypatch):
    monkeypatch.delenv("RIJEKA_CRON_SECRET", raising=False)
    monkeypatch.setattr(S, "_state", {"enabled": True, "started_at": None, "last_cycle": None, "steps": {}, "release_sync": None})
    called = []
    assert S.run_step("news", lambda db, s: called.append(1), "", session_factory=_Db) is False
    assert called == [] and "RIJEKA_CRON_SECRET" in S.status()["steps"]["news"]["detail"]


def _gh_factory(release_sha, compare_status, log, ahead_files=None, main_sha="m" * 40):
    def gh(method, path, token, body=None):
        log.append((method, path, body))
        if path.endswith("/git/ref/heads/release"):
            return (200, {"object": {"sha": release_sha}}) if release_sha else (404, {"message": "Not Found"})
        if path.endswith("/git/ref/heads/main"):
            return 200, {"object": {"sha": main_sha}}
        if "/compare/main..." in path:
            return 200, {"status": compare_status}
        if "/compare/" in path:                       # own...main: what main has beyond the live commit
            return 200, {"status": "ahead", "files": [{"filename": f} for f in (ahead_files or [])]}
        return 200, {}
    return gh


def test_release_moves_only_to_a_commit_on_main():
    own = "a" * 40
    log = []
    assert S.sync_release(own, "o/r", "t", gh=_gh_factory("b" * 40, "behind", log)) == "release -> aaaaaaa"
    assert log[-1] == ("PATCH", "/repos/o/r/git/refs/heads/release", {"sha": own, "force": True})
    log.clear()
    assert "not on main" in S.sync_release(own, "o/r", "t", gh=_gh_factory("b" * 40, "diverged", log))
    assert all(m == "GET" for m, _, _ in log)
    assert S.sync_release(own, "o/r", "t", gh=_gh_factory(own, "identical", [])) == "release already at this commit"
    log.clear()
    assert S.sync_release(own, "o/r", "t", gh=_gh_factory(None, "identical", log)) == "release -> aaaaaaa"
    assert log[-1][0] == "POST" and log[-1][2]["ref"] == "refs/heads/release"


def test_release_follows_main_when_main_is_ahead_on_frontend_only():
    own, main = "a" * 40, "m" * 40
    log = []
    fe = ["frontend/src/App.jsx", "docs/ops/deploy.md", "README.md"]
    assert S.sync_release(own, "o/r", "t", gh=_gh_factory("b" * 40, "behind", log, ahead_files=fe, main_sha=main)) == f"release -> {main[:7]}"
    assert log[-1][2]["sha"] == main
    log.clear()
    assert S.sync_release(own, "o/r", "t", gh=_gh_factory("b" * 40, "behind", log, ahead_files=fe + ["backend/main.py"])) == "release -> aaaaaaa"
    assert S.sync_release(own, "o/r", "t", gh=_gh_factory(main, "behind", [], ahead_files=fe, main_sha=main)) == "release already at this commit"
    assert S.frontend_only([]) is False and S.frontend_only(["netlify_drop/index.html"]) is True
    assert S.frontend_only([".github/workflows/release-sync.yml", "README.md"]) is True


def test_what_render_does_not_deploy_is_not_waited_for():
    """Render builds the API from `backend/` (render.yaml: rootDir) and skips Markdown. Anything else on main is
    never served by the API, so `release` follows main's head. On 11 November 2026 a push that changed the
    verifier's page under `chain/` was taken for an API change and `release` stayed behind."""
    own, main = "a" * 40, "m" * 40
    outside = ["chain/verify/index.html", "chain/README.md", "CHANGELOG.md", ".claude/agents/jarvis.md", "render.yaml",
               "tests/reference/test_x.py", "frontend/src/components/docs/methodology/methodology.json", "backend/README.md"]
    assert S.frontend_only(outside) is True
    log = []
    assert S.sync_release(own, "o/r", "t", gh=_gh_factory("b" * 40, "behind", log, ahead_files=outside, main_sha=main)) == f"release -> {main[:7]}"
    for api in ("backend/main.py", "backend/requirements.txt", "backend/db/migrations/2026-11-05_collateral.sql", "backend/version.py"):
        assert S.frontend_only(outside + [api]) is False, api
    # a folder whose name only begins like the API's is not the API
    assert S.frontend_only(["backend_notes/x.py"]) is True
    assert S.frontend_only([".github/workflows/ci.yml", "backend/main.py"]) is False


def test_start_is_a_no_op_when_disabled(monkeypatch):
    monkeypatch.setenv("RIJEKA_SCHEDULER", "0")
    assert S.start() is False and S.status()["enabled"] is False


def test_health_body_carries_the_scheduler_state():
    import main
    from fastapi.testclient import TestClient
    body = TestClient(main.app).get("/api/ops/health").json()
    assert "scheduler" in body and set(body["scheduler"]) >= {"enabled", "steps", "release_sync"}
