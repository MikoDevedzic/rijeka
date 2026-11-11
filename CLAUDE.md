# Working on Rijeka

Rijeka is an open-source OTC derivatives desk: a FastAPI backend (`backend/`, Render), a React/Vite frontend
(`frontend/`, Netlify from the `release` branch), a Supabase database that local development and production
share, and an on-chain confirmation registry. `docs/architecture.md` is the map.

## Nothing ships that harms what already works

Every change goes through the same gates. Each gate has a name and an agent definition in `.claude/agents/`.

| Who | Role | When | What "passed" means |
|---|---|---|---|
| **Quinn** | Browser tester | every frontend or API change | `cd frontend && npm run e2e` green on the local stack; a new screen or button has a journey in the same change |
| **Ada** | Numbers guardian | any change to pricing, XVA, exposure, capital, collateral, P&L or risk | `tests/reference` green, the engine and replication tests green, the pinned sample book unchanged or its movement explained in `GOLDEN_CHANGES.md` |
| **Emmy** | Model validator | any change that adds or changes a formula, a product, a risk measure or the construction of a market input | each calculation has a reference comparison, an Excel replication and a methodology section, or `docs/model_inventory.md` says which is missing; one figure re-derived independently by a fresh agent |
| **Iris** | Design keeper | any change that adds or alters a screen, a table, a field, a button, a colour or a size | `cd frontend && npm run design` shows no count risen; the changed screen compared in pictures with a screen that shows the same kind of thing; a field and the figure beside it measured alike; `docs/design.md` followed or amended |
| **Vera** | Independent reviewer | anything larger than a one-line hotfix | a fresh agent has read `git diff main...HEAD` cold and its findings are fixed or answered |
| **Magnus** | Security reviewer | sign-in, roles, tenancy, keys, payments, public endpoints, user-supplied text | no finding left open |
| **Nikola** | Architect | any change that adds or removes a service, an outside dependency or data source, a table, a scheduled job, a setting or a public endpoint | `docs/architecture.md` and `docs/ops/environment.md` match the code, checked by a fresh agent against the diff; the new piece follows the pattern the system already has for its kind |
| **Edgar** | Database keeper | any change that adds or alters a table, column, function, trigger, policy or grant, writes to the database in a new way, or touches the migration runner or its approved list | migrations are one feature each, safe to re-run, locked down and tolerated when absent; `docs/schema.sql` agrees with them; nothing is on the approved list that the owner did not approve in his own words |
| **Jarvis** | Release manager | every deploy | `docs/ops/release.md` followed; the commit read back from production |
| **Petra** | Project manager | every proposal and decision | recorded in `_docs/BACKLOG.md` (local only) with its status |

A one-line hotfix asked for by name may skip Vera; it never skips lint, tests and Jarvis's checklist.

## Standing rules

- **Production is shared.** The local `.env` points at the production database. A script that writes is a
  production write. Production writes happen only when the user asks for that write in their own words; show
  the exact statements first. A migration reaches production through the runner (`backend/db/migrate.py`): the
  deployed API applies what is on `backend/db/migrations_approved.txt`, and a line goes on that list only with
  the user's words quoted beside it. An agent never reads or writes the hosted database from a shell, by any
  route (`backend/scripts/export_schema.sh` is the owner's to run). Tests
  and journeys run on the local stack (`backend/stack/README.md`), never on the hosted database.
- **Secrets.** Never print tokens, keys, connection strings or `.env` contents. Never enter credentials on a
  hosted site.
- **Git.** Work on a branch, stage by explicit path (never `git add -A`; another session shares this checkout),
  never commit `.claude/launch.json`. `main` is protected by five checks.
- **Frontend.** `npm run lint -- --quiet` before every commit (the same command CI runs, over `src`, the journeys and the config): the build does not catch an undefined variable.
- **Deploy ahead of migration.** Every new table or column is read through a presence check that tolerates its
  absence and never caches a negative answer; add it to `OPTIONAL_MIGRATIONS` in `backend/api/routes/ops.py`
  so `GET /api/ops/health` reports it under `schema`. One feature per migration file: do not bundle tables that
  are safe to apply at different times.
- **Freeze windows.** Ask about demos or client sessions before a deploy. Within two hours of one, only a fix
  the user asks for by name ships, frontend-only where possible.
- **Sources.** Public standards only (Basel, ISDA, CFTC, published papers). Nothing from any client engagement:
  no names, instruments, numbers, text or code.
- **Say what is verified.** "Live" means the commit was read back from production. "Tested" names the suite.
  What was not checked is stated. A rule written on the map or in the changelog ("X is never overwritten") is
  checked against every writer of that table, not only the one the change added.
- **Lessons.** A role does not remember its last run. What a role missed, and a later check caught, is written
  into that role's definition in the same week; `_docs/team/ledger.json` (local) records the run and the lesson.
