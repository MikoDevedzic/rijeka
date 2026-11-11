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
- [ ] A change to `docs/methodology/rijeka_methodology.tex` or `docs/model_inventory.md`: rebuild the three prints and
      commit them with it: `cd docs/methodology && tectonic rijeka_methodology.tex`, copy the PDF to
      `frontend/public/methodology/`, and `cd frontend && npm run methodology` (the unit run fails when the pages are
      stale; nothing checks that the PDF is the source's, so read its first and last page).
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
- A production write happens only on the user's own words. Show the exact statements first.
- **The runner applies it** (`backend/db/migrate.py`, `docs/architecture.md` → Migrations in production). To
  approve a migration: quote the owner's words; `cd backend && python -m db.migrate --stage <file>` copies the file
  into `backend/db/approved/` and prints its line; add the line to `backend/db/migrations_approved.txt` with who
  approved it, the date and the words; `python -m db.migrate --check`; Edgar reviews the entry. It is applied when
  that commit's API starts. Never from a shell: the runner is off outside the deployed API.
- After the deploy, read `migrations` on the health endpoint: counts only, and `applied` must equal `approved`
  with `problems` 0. Anything else: the names and the reason (`missing`, `mismatch`, `changed`, `refused: <rule>`,
  `failed: <class> <SQLSTATE>`, `blocked: an earlier migration did not apply`, `busy: another instance is
  applying`) are on `GET /api/ops/migrations`, which needs the admin role, so the owner reads it. Read `schema` again (the presence checks re-check a negative answer; `chain/pending` within five
  minutes). A migration that did not apply leaves the API running on the old shape: fix forward with a new entry;
  an applied file is never edited.
- `crypto_fixings` is red between the fixings table appearing and the first tick that fills the last seven dates
  (within the half hour); red after that is a hole or a disputed date, and the tick's answer says which.
- The owner can still apply a file by hand in the database's own console. The runner does not look for the
  objects: an approved file is run again at the next start and then recorded, which is why each must be safe to
  run twice.

## 4. The chain

```bash
gh pr create --base main --head <branch> ...
gh pr checks <n>                       # backend tests, frontend build, integration tests, registry contract tests, self-host smoke
git push origin <sha>:main             # retry on a transient refusal
curl -s https://rijeka-api.onrender.com/api/ops/health   # until "commit" is the sha (only when the commit changes a file under backend/ that is not Markdown: Render deploys nothing else)
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
