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
| **Vera** | Independent reviewer | anything larger than a one-line hotfix | a fresh agent has read `git diff main...HEAD` cold and its findings are fixed or answered |
| **Magnus** | Security reviewer | sign-in, roles, tenancy, keys, payments, public endpoints, user-supplied text | no finding left open |
| **Nikola** | Architect | any change that adds or removes a service, an outside dependency or data source, a table, a scheduled job, a setting or a public endpoint | `docs/architecture.md` and `docs/ops/environment.md` match the code, checked by a fresh agent against the diff; the new piece follows the pattern the system already has for its kind |
| **Jarvis** | Release manager | every deploy | `docs/ops/release.md` followed; the commit read back from production |
| **Petra** | Project manager | every proposal and decision | recorded in `_docs/BACKLOG.md` (local only) with its status |

A one-line hotfix asked for by name may skip Vera; it never skips lint, tests and Jarvis's checklist.

## Standing rules

- **Production is shared.** The local `.env` points at the production database. A script that writes is a
  production write. Production writes happen only when the user asks for that write in their own words; show
  the exact statements first. Tests and journeys run on the local stack (`backend/stack/README.md`), never on
  the hosted database.
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
  What was not checked is stated.
