# Self-hosting Rijeka

The hosted demo at **app.rijeka.app** is the quickest way to see Rijeka: sign up,
and a sandbox workspace is created for you (own entity, a demo counterparty, the
demo market data, trader role). Trades you confirm there anchor to the Sepolia
testnet and verify at **rijeka.app/verify**.

Running it yourself is the production path: your curves and your trades never
leave your perimeter, you connect your own Bloomberg feed, and you sign
confirmations with keys you control. It is the same code. This page is the
honest list of what that takes today.

## One command: docker compose

`docker-compose.yml` at the repository root brings up five services: PostgreSQL 16 on a volume
(`db`), a one-shot `migrate` that applies the schema and a minimal seed, Supabase Auth (GoTrue,
`auth`) on the same database for sign-up and sign-in, the API (`api`) and the web app behind nginx
(`web`, with `/auth/v1` proxied to GoTrue and `/api` to the API).

```bash
git clone https://github.com/MikoDevedzic/rijeka && cd rijeka
cp .env.selfhost.example .env.selfhost
# 1. set POSTGRES_PASSWORD and GOTRUE_JWT_SECRET to long random strings
# 2. signing key: cd backend && pip install -r requirements.txt && python -m stack.keys
#    then paste the one line of backend/stack/.local/gotrue_keys.json as GOTRUE_JWT_KEYS
# 3. RIJEKA_PUBLIC_URL (the web origin) and RIJEKA_API_URL (the API's published port) as people will reach them
docker compose --env-file .env.selfhost up --build
```

Then open `RIJEKA_PUBLIC_URL` (default `http://localhost:8080`), sign up (email confirmation is
automatic with `GOTRUE_MAILER_AUTOCONFIRM=true`; set the SMTP lines to send real mail), and finish
the steps under *After first start* below. `docker compose --env-file .env.selfhost up` again is idempotent: `migrate` records
what it applied in `stack_migrations` and does nothing the second time.

What the compose file does, in order: `db` starts; `migrate` runs `backend/stack/apply.py` (the
`auth` stub for the Supabase pieces the schema references, `docs/schema.sql`, every file in
`docs/migrations/` in date order, each statement reported by file and line if it fails) and
`backend/stack/seed.py --minimal` (two test users, a firm, their entities and counterparties, no
market data); `auth` runs GoTrue's own migrations on top of the stub's `auth.users`, the same
situation as a Supabase project's pre-created table, and publishes the JWKS for the key in
`GOTRUE_JWT_KEYS`; `api` verifies tokens against `http://web/auth/v1/.well-known/jwks.json`; `web`
serves the build. The details of the stack are in [`backend/stack/README.md`](backend/stack/README.md).

**This compose stack has not been executed by its author** (no Docker on the machine it was written
on). CI runs `docker compose --env-file .env.selfhost config` and a smoke `up` of `db` + `migrate` on every pull request (the
`self-host smoke` job); the `auth`, `api` and `web` services are written from the images'
documentation and have not been brought up end to end. The GoTrue variables are the ones its
`example.env` and configuration source name (`GOTRUE_API_HOST`, `PORT`, `GOTRUE_DB_DRIVER`,
`DATABASE_URL`, `DB_NAMESPACE`, `API_EXTERNAL_URL`, `GOTRUE_SITE_URL`, `GOTRUE_URI_ALLOW_LIST`,
`GOTRUE_JWT_SECRET`, `GOTRUE_JWT_EXP`, `GOTRUE_JWT_AUD`, `GOTRUE_JWT_DEFAULT_GROUP_NAME`,
`GOTRUE_DISABLE_SIGNUP`, `GOTRUE_EXTERNAL_EMAIL_ENABLED`, `GOTRUE_MAILER_AUTOCONFIRM`,
`GOTRUE_SMTP_*`); `GOTRUE_JWT_KEYS` (the asymmetric signing keys, a JSON list of JWKs) is the
`JWT.Keys` field of its configuration and is set the same way by the Supabase CLI, but its exact
behaviour on this image tag is the one thing to verify first if sign-in fails. The image tag is
pinned to one that existed when this was written; move it forward deliberately.

What is not in the compose file:

- **PostgREST and Realtime.** The app's messenger (`chat_*` tables) and the live blotter read Supabase's
  REST and realtime endpoints through supabase-js; without them the rooms and the live refresh are
  off, everything else (booking, pricing, XVA, risk, P&L, credit, confirmation, the methodology
  workbooks) goes through the API. Adding `postgrest/postgrest` and `supabase/realtime` behind the
  same nginx is the next step; the `authenticated` role and the RLS policies they need are already in
  the schema.
- **On-chain anchoring.** Unset, confirmations are signed and stored off-chain (`NullBackend`). Set
  `RIJEKA_CHAIN_RPC`, `RIJEKA_CHAIN_REGISTRY`, `RIJEKA_CHAIN_RELAYER_KEY` in `.env.selfhost` to anchor.
- **TLS.** Put a reverse proxy with certificates in front of `web` and `api` and set the two URLs to it.

## After first start

4. **Firms and entities.** Sign up, then insert your firm, its members and its LEI
   into `firms`, `firm_members`, `firm_leis` (there is no admin UI for this yet;
   `backend/stack/seed.py` and `backend/api/routes/demo.py` show the rows a workspace needs). Set the
   user's role in `profiles.role` (`trader`, `admin`, `controller`, `risk`, `management`; the API reads
   it from the database and ignores the token's claim) so booking is allowed. On the hosted demo the
   USERS page under Configurations edits it.
5. **Market data.** Snapshots are per user. Load curves through *Configurations →
   Market data* (manual quotes or the Bloomberg sprint importer in
   `backend/api/routes/bloomberg.py`, which runs on the machine with the terminal). For a first look,
   `python -m stack.seed` (without `--minimal`) against the compose database writes the fixed demo
   market data of 2026-11-02 for the user `user_a@rijeka.test`.
6. **On-chain confirmation (optional).** Set `RIJEKA_CHAIN_RPC`,
   `RIJEKA_CHAIN_REGISTRY`, `RIJEKA_CHAIN_RELAYER_KEY`. Each legal entity signs with
   `RIJEKA_CHAIN_KEY_<LEI>`, or registers a wallet in the app (then Rijeka can
   verify its signatures but never produce them). `RIJEKA_CHAIN_DEV_SEED` is for
   local demos only. See [`chain/README.md`](chain/README.md).

## The manual path (a Supabase project)

| Piece | What it is | Notes |
|---|---|---|
| Postgres with auth | A [Supabase](https://supabase.com) project | Auth (sign-in, JWTs), row-level security and the `authenticated` role come from Supabase. Any Postgres works for the data (see the compose stack above); sign-in assumes Supabase-shaped auth. |
| Backend | FastAPI, Python 3.11 or later | `backend/`. One process with the batches in it; `render.yaml` shows a working deployment; every variable is in [`docs/ops/environment.md`](docs/ops/environment.md). |
| Frontend | React / Vite static build | `frontend/`. Any static host (Netlify, S3, nginx). |
| Ethereum RPC + relayer | Only for on-chain confirmation | Sepolia for testing, mainnet when you mean it. The registry contract is in `chain/`; deploy your own or use ours. |

1. **Create a Supabase project.** In the SQL editor run [`docs/schema.sql`](docs/schema.sql)
   (the tables, RLS policies, the sign-up trigger), then every file in
   [`docs/migrations/`](docs/migrations/) in date order (each says what it does and is safe to run
   once), or point `backend/stack/apply.py --database-url` at the project's direct connection string
   and let it do the same with a ledger. Copy the connection string from *Settings → Database* and
   the project URL from *Settings → API*. No JWT secret is needed: tokens are verified against the
   project's published ES256 keys.
2. **Backend.** `cp backend/.env.example backend/.env`, fill in `DATABASE_URL`,
   `SUPABASE_URL`, `FRONTEND_URL`. Then
   ```bash
   cd backend && pip install -r requirements.txt && uvicorn main:app --port 8000
   ```
   Set `RIJEKA_DEMO_PROVISION=0` unless you want every sign-in to get a sandbox
   workspace the way the hosted demo does. Set `RIJEKA_DEMO_MARKET_DATA=0` to run on your
   own marks: with it on (the default) and the scheduler running, the public-source curves and
   the digital-asset vols and forwards from Deribit's public API (`RIJEKA_DERIBIT`, also on by
   default) are written to the template account, which is `RIJEKA_DEMO_TEMPLATE_EMAIL` or,
   when that is empty, the earliest admin of a dealer firm, and they replace that account's
   rows of the day for the curves they build.
3. **Frontend.** Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`,
   then `cd frontend && npm install && npm run build` and serve `dist/`.
4. Steps 4 to 6 above.

## What is not there yet

- No admin screen for firms. The migration runner is `backend/stack/apply.py` (schema plus the dated
  files, with a ledger); `backend/scripts/export_schema.sh` regenerates `docs/schema.sql` from a
  database that has them applied.
- The backend connects with a role that bypasses row-level security (the Postgres owner on Supabase,
  the superuser in the compose stack) and enforces tenant isolation in application code; the RLS
  policies protect direct Supabase client access. Review `api/routes/*` before exposing it to firms
  that compete.
- Market data is whatever you load once `RIJEKA_DEMO_MARKET_DATA=0`. The feeds that ship are the demo's:
  public-source curves rebuilt daily, public spot, and Deribit's public option marks for BTC, ETH and SOL;
  using a venue's data on your own instance is under that venue's terms and your responsibility.
- The registry contract has not had an external audit.

## What the hosted demo stores

For anyone deciding between the demo and self-hosting: the hosted demo stores your email and
password hash (Supabase auth), the entities, trades, confirmations and market data you create, your
messages in the rooms you join, and the daily marks, P&L and risk runs of your sandbox. Prometheus and
the book brief send the relevant trade facts to Anthropic's API when you use them. Usage beacons carry
a daily-rotating hash, no account link; browser error reports carry the error text and route. The
full statement is the privacy notice in the app (`frontend/src/legal/privacy.js`). The demo may be
reset.

## Licence

The engine, the standard and the methodology are Apache-2.0. The platform you deploy by following
this page is Business Source License 1.1: run it for your own organisation, modify it, teach with it;
do not offer it to third parties as a hosted service or a competing product without a commercial
licence (miko@rijeka.app). Each version becomes Apache-2.0 four years after publication.

If you want help standing this up for a desk, or dedicated coverage on the
models, write to miko@rijeka.app. The hosted demo is free; the work above is
what we charge for.
