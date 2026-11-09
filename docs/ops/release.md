# Release checklist

Jarvis's checklist (`.claude/agents/jarvis.md`). `docs/ops/deploy.md` explains why the chain is shaped this way;
this page is what to do, in order.

## 1. Before the pull request

- [ ] `git status`: only intended files, staged by explicit path. `.claude/launch.json` and other sessions'
      files are not yours.
- [ ] Frontend: `cd frontend && npm run lint -- --quiet && npm test && npm run build` (the lint is the one CI runs: `src`, the journeys and the config).
- [ ] Backend: `cd backend && python -m pytest -q --ignore=tests/integration --ignore=tests/reference`.
- [ ] **Quinn**: `cd frontend && npm run e2e` on the local stack. A new screen, tab or button has a journey.
- [ ] **Ada**, for a numbers change: `tests/reference`, the engine and replication tests, the pinned sample
      book; any movement has a line in `backend/tests/integration/GOLDEN_CHANGES.md`.
- [ ] **Vera**, for anything larger than a hotfix: a fresh review of `git diff main...HEAD`.
- [ ] **Magnus**, when the change touches sign-in, roles, tenancy, keys, payments or a public endpoint.
- [ ] `CHANGELOG.md` and `backend/version.py` for a release that changes behaviour. A frontend- or docs-only
      fix leaves `version.py` alone so the API does not restart.

## 2. Freeze windows

Ask: is there a demo or a client session in the next two hours? If yes, only a fix the user asks for by name
ships. Prefer frontend-only changes (Render ignores `frontend/`, `docs/` and `*.md`, so the API keeps running).

## 3. Migrations

`GET https://rijeka-api.onrender.com/api/ops/health` → `schema` lists every optional migration with `applied`,
the file and what it gates.

- A deploy may run ahead of its migration: the feature degrades (a seed, a default, a 409 on write), it does
  not crash.
- List what is pending and what else lives in the same file. One feature per file from now on; the 3 November
  jobs file bundles the worker tables with `pending_anchors`, which is why the confirm path waited on the worker.
- A production write happens only on the user's own words. Show the exact statements first. Apply with
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>` from `backend/` with `.env` sourced, never printing it.
- After applying, read `schema` again (the presence checks re-check a negative answer; `chain/pending` within
  five minutes).

## 4. The chain

```bash
gh pr create --base main --head <branch> ...
gh pr checks <n>                       # backend tests, frontend build, integration tests, registry contract tests, self-host smoke
git push origin <sha>:main             # retry on a transient refusal
curl -s https://rijeka-api.onrender.com/api/ops/health   # until "commit" is the sha (not for a frontend- or docs-only commit)
gh workflow run release-sync
curl -s https://app.rijeka.app/version.json              # until "commit" is the sha
```

A failed check is read from the job log (`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`), fixed on the
branch and re-run. Nothing is pushed to `main` around a red check.

## 5. After

Report: the commit and version on the API and on the app, what changed for a user, what the user must do (a
hard refresh, a migration to approve), and what was not verified.

## 6. Rollback

- **App:** `release` is a pointer. Moving it back to the previous commit restores the previous build
  (`git push --force origin <previous-sha>:release`), on the user's word.
- **API:** revert the commit on a branch and run the chain; or roll back in the Render dashboard (the user).
- **Database:** a new empty table can be dropped; anything holding data is restored only with the user.
