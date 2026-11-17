# Release checklist

Jenn's checklist (`.claude/agents/jenn.md`). `docs/ops/deploy.md` explains why the chain is shaped this way;
this page is what to do, in order.

## 1. Before the pull request

- [ ] `git status`: only intended files, staged by explicit path. `.claude/launch.json` and other sessions'
      files are not yours.
- [ ] Frontend: `cd frontend && npm run lint -- --quiet && npm test && npm run build` (the lint is the one CI runs: `src`, the journeys and the config).
- [ ] Backend: `cd backend && python -m pytest -q --ignore=tests/integration --ignore=tests/reference`.
      A change to `.github/scripts/` (the production watch): `ruff check --config ruff.toml ../.github/scripts &&
      python -m pytest -q ../.github/scripts`, as CI's `backend tests` job runs them.
- [ ] **Tarik**: `cd frontend && npm run e2e` on the local stack. A new screen, tab or button has a journey.
      A change to confirmation, the chain code, the CONFIRM tab or the public register also runs `npm run e2e:chain`
      (a confirmation anchored on a local test chain; CI runs it on every pull request).
- [ ] **Lauren**, for a numbers change: `tests/reference`, the engine and replication tests, the pinned sample
      book; any movement has a line in `backend/tests/integration/GOLDEN_CHANGES.md`.
- [ ] **Christine**, for anything larger than a hotfix: a fresh review of `git diff main...HEAD`.
- [ ] **Machado**, when the change touches sign-in, roles, tenancy, keys, payments or a public endpoint.
- [ ] A change to `docs/methodology/rijeka_methodology.tex` or `docs/model_inventory.md`: rebuild the three prints and
      commit them with it: `cd docs/methodology && tectonic rijeka_methodology.tex`, copy the PDF to
      `frontend/public/methodology/`, and `cd frontend && npm run methodology` (the unit run fails when the pages are
      stale; nothing checks that the PDF is the source's, so read its first and last page).
- [ ] `CHANGELOG.md` and `backend/version.py` for a release that changes behaviour. A fix with nothing under
      `backend/` (frontend, docs, the verifier's page) leaves `version.py` alone so the API does not restart.
      The other way round: any file under `backend/` that is not Markdown restarts the API and the worker, a test or
      a stack script included (`render.yaml`: `rootDir: backend`), with or without a version: wait for health to
      report the commit before the app's release is moved.

## 2. Freeze windows

Ask: is there a demo or a client session in the next two hours? If yes, only a fix the user asks for by name
ships. Prefer frontend-only changes (Render deploys only for a file under `backend/` that is not Markdown, so the
API keeps running).

## 3. Migrations

`GET https://rijeka-api.onrender.com/api/ops/health` → `schema` lists every optional migration with `applied`,
the file and what it gates.

- A deploy may run ahead of its migration: the feature degrades (a seed, a default, a 409 on write), it does
  not crash.
- List what is pending and what else lives in the same file. One feature per file from now on; the 3 November
  jobs file bundles the worker tables with `pending_anchors`, which is why the confirm path waited on the worker;
  `2026-11-11_pending_anchors.sql` is that table on its own.
- A production write happens only on the user's own words. Show the exact statements first.
- A migration that takes something away from a running API (a dropped column, a narrowed type) is approved only
  after the release that stops using it has been read back from production, and in an approval of its own, never
  in the same commit as that release: the runner applies an approved file when the new API starts, while the old
  instance is still serving. `2026-11-17_legal_entity_margin_version.sql` is one (it needs 0.54.1 or later
  deployed, and the `destructive` flag). Its header says so; the header is not where a release is checked.
- **The runner applies it** (`backend/db/migrate.py`, `docs/architecture.md` → Migrations in production). To
  approve a migration: quote the owner's words; `cd backend && python -m db.migrate --stage <file>` copies the file
  into `backend/db/approved/` and prints its line; add the line to `backend/db/migrations_approved.txt` with who
  approved it, the date and the words; `python -m db.migrate --check`; Raja DB reviews the entry. It is applied when
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
gh pr checks <n>                       # all six: backend tests, frontend build, integration tests, browser journeys, registry contract tests, self-host smoke
backend/.venv/bin/python .github/scripts/watch.py        # production as it stands, before anything is pushed: it must say "nothing wrong"
git push origin <sha>:main             # retry on a transient refusal
curl -s https://rijeka-api.onrender.com/api/ops/health   # until "commit" is the sha three reads in a row (only when the commit changes a file under backend/ that is not Markdown: Render deploys nothing else)
gh workflow run release-sync
git ls-remote origin release           # at the sha; if it is not, dispatch release-sync again
curl -s https://app.rijeka.app/version.json              # until "commit" is the sha
backend/.venv/bin/python .github/scripts/watch.py --api-commit <sha> --app-commit <sha>   # everything a visitor touches, from outside (docs/ops/monitoring.md); leave a flag out when that side did not deploy
```

The watch before the push is there because of 15 November 2026: the database had stopped answering an hour and a
half before a release was pushed, the release went out onto a service that was already failing, and the first hour of
the outage was spent suspecting the release. A failing watch is understood first. If what fails is the thing the
release mends, say so in the report; otherwise nothing is pushed until production is whole.

One read of the new commit is not enough: while Render switches instances the old one still answers, and a
release move dispatched then reads the old commit, moves nothing and exits green (13 November 2026: the app stayed a
version behind for twenty-five minutes).

A failed check is read from the job log (`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`), fixed on the
branch and re-run. Nothing is pushed to `main` around a red check.

## 5. After

Report: the commit and version on the API and on the app, what changed for a user, what the user must do (a
hard refresh, a migration to approve), and what was not verified.

**An app that was open.** A release replaces the files each page is loaded from. A tab opened before it asks the
host which build it serves when a page's file does not arrive: after a release it reloads by itself on the next
page it opens (no trade window open, no message being typed) or says the desk was updated and offers the reload;
it no longer shows the browser's error. A file that does not arrive while the host still serves the same build is
not a release: the page says so, and it reaches the error log as `boundary-load`. One of those after a deploy
means a file is missing from the build: after the read-back look at the count of browser errors on
`GET /api/ops/health` (`client_errors`) and, signed in, at the entries themselves. Say so when
reporting a release to someone who had the app open, and release changes that are ready together as one.

**A red watch for `health_alerts`.** The step that tells the operator of users' problems fails on purpose when
there is something to tell and nobody to tell it to (`NobodyToTell`): no account with the admin role has a support
room (it has one once it has opened the messenger) and the two mail settings are unset. It is mended by opening the
messenger as an admin, or by setting the mail; it is not a fault of the release. Any other failure of that step is.

## 6. Rollback

- **App:** `release` is a pointer. Moving it back to the previous commit restores the previous build
  (`git push --force origin <previous-sha>:release`), on the user's word.
- **API:** revert the commit on a branch and run the chain; or roll back in the Render dashboard (the user).
- **Database:** a new empty table can be dropped; anything holding data is restored only with the user.
