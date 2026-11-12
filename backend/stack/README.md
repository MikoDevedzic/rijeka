# The local stack

A Rijeka database on a plain PostgreSQL 16, with no Docker and no Supabase: the schema as the
hosted instance has it, two users, one firm, their entities and counterparties, and enough market
data for every route to price. The API-level integration tests (`tests/integration/`) and the CI job
`integration tests` run on it; `docker-compose.yml` at the repository root uses the same scripts
with GoTrue for sign-in.

Nothing here touches the hosted database: every script takes `--database-url` or
`RIJEKA_STACK_DATABASE_URL` and defaults to `postgresql:///rijeka_test`; the test harness refuses a
Supabase host outright and neuters `load_dotenv`, so `backend/.env` is never read.

## One command

```bash
cd backend
./stack/up.sh                     # createdb rijeka_test if missing, apply, seed, keys
eval "$(./stack/up.sh --env)"     # DATABASE_URL, RIJEKA_JWKS_FILE, SUPABASE_URL, the off switches
python -m pytest -q -m integration tests/integration
```

`./stack/up.sh --reset` rebuilds the schema; `--minimal` seeds people and counterparties only.
Postgres is Homebrew's `postgresql@16` on macOS (the script adds its `bin` to `PATH`); any PostgreSQL
16 the current user can create databases on works (`RIJEKA_STACK_DATABASE_URL=postgresql://user:pw@host/db`).

## The pieces

| File | What it does |
|---|---|
| `auth_stub.sql` | The Supabase pieces the schema references: `auth.users` (the columns GoTrue has and the schema touches), `auth.uid()` / `auth.role()` / `auth.jwt()`, the `authenticated`, `anon`, `service_role` roles, the `supabase_realtime` publication, `pgcrypto` and `uuid-ossp`. Every statement is idempotent. |
| `apply.py` | Applies `auth_stub.sql`, `docs/schema.sql`, then `docs/migrations/*.sql` in filename order. Statements are split (dollar quotes, strings and comments respected) and run one at a time with autocommit, so a failure names the file and line and the rest still runs. `public.stack_migrations` records each file (name, sha256); a recorded file is skipped, so a second run is a no-op. `--reset` drops and recreates. `--auth gotrue` leaves `auth.users` to GoTrue (compose). |
| `seed.py` | The people and the market data below. Every row is an upsert. `--minimal`: people and counterparties only. |
| `keys.py` | An ES256 keypair in `.local/` (git-ignored): `signing_key.pem`, `jwks.json` (for `RIJEKA_JWKS_FILE`) and `gotrue_keys.json` (the private JWK list `GOTRUE_JWT_KEYS` takes). Idempotent; `--rotate` replaces. |
| `token.py` | `mint(user_id, email, role, expires_in=3600)`: a Supabase-shaped ES256 token (`sub`, `email`, `aud` and `role` `authenticated`, `user_metadata.role`, `exp`, header `kid`). The tests use it; the CLI prints one. |
| `up.sh` | The one command above; `--env` prints the exports. |
| `chain.py` | A chain of the stack's own, for the journeys that confirm on one (`frontend/e2e/chain`, `npm run e2e:chain`): deploys the committed registry to a local test node (Foundry's `anvil`) and prints `RIJEKA_CHAIN_RPC`, `RIJEKA_CHAIN_REGISTRY` and `RIJEKA_CHAIN_RELAYER_KEY` for the API. It refuses any node that is not on this machine with anvil's chain id (31337); the key it prints is anvil's published first account. Without it the stack has no chain. |

Run the scripts as `python -m stack.apply` (and `seed`, `keys`, `token`) from `backend/`; run as
`python stack/x.py` they put `backend/` on `sys.path` themselves because `stack/token.py` would
otherwise shadow the standard library's `token` module.

### Deliberate no-ops when applying

* `SET transaction_timeout = 0` in the `pg_dump` header of `docs/schema.sql`: a PostgreSQL 17
  setting; 16 has no such GUC. Printed as `skip`, never an error.
* `CREATE EXTENSION pgcrypto` / `"uuid-ossp"` when the server has no contrib package:
  `gen_random_uuid()` is built in and nothing else uses them.

Everything else that fails is listed at the end with its file and line and the exit code is 1.

### A thing to know about the migrations

Applied in filename order, `2026-10-30_pnl_roles.sql` runs after `2026-10-30_market_risk.sql` and
rewrites `profiles_role_check` without the `risk` role the market-risk file had added. The stack
reproduces that order faithfully (the hosted database was migrated by hand, possibly in another
order); the seed's users are traders, so nothing here depends on it, but a `risk` profile cannot be
inserted on a stack database until the two files are reconciled.

### Row-level security

The schema `FORCE`s RLS on the trade tables and every policy reads `auth.uid()`, which is `NULL` on a
plain Postgres session. The API connects as the table owner and enforces tenancy in code, so the role
it connects with must bypass RLS: a superuser (Homebrew's default user, the `postgres` user of the
`postgres:16` image) or a role with `BYPASSRLS`. `apply.py` prints a warning when it is neither.

## The seed

Users (fixed ids, so tokens and tests can name them):

| Email | `profiles.trader_id` | `profiles.role` | Firm role | Market data |
|---|---|---|---|---|
| `user_a@rijeka.test` (`0000000a-0000-4000-8000-0000000000aa`) | `USER.A` | `trader` | `ADMIN` | all of it (she is the template account) |
| `user_b@rijeka.test` (`0000000b-0000-4000-8000-0000000000bb`) | `USER.B` | `trader` | `MEMBER` | none (the tenancy tests' other side) |

One firm, `STACK TEST FIRM` (kind `DEALER`, so `demo._template_user_id` finds its ADMIN), both as
members; `firm_leis` carries each user's own LEI. Per user, the demo-bank pattern from
`api/routes/demo.py`: an own legal entity (`<TRADER> STACK`, LEI `DEMO` + 16 hex of the user id, as
`demo_lei_for` makes it, so the dev signing seed covers it), `RIJEKA DEMO BANK AG` as a legal entity
(LEI `DEMO0000RIJEKABANK01`) and as a counterparty (ISDA 2002, VM+IM CSA, threshold 0, MTA 500k,
SIMM). User A also gets a desk `RATES` and a book `G10 RATES` in `org_nodes`.

Market data for user A, valuation date **2026-11-02**, built by the demo feed's own builders from
fixed quotes written in `seed.py` (the feed's fetchers go to the internet; the builders are pure):

| Rows | Content |
|---|---|
| `market_data_snapshots` `USD_SOFR` | 33 OIS pillars: SOFR 3.88 % overnight, US Treasury par 1M…30Y (3.95 → 4.72 %) less the feed's indicative SOFR-OIS/UST spread schedule (`demo_feed.build_usd_sofr`) |
| `EUR_ESTR` | €STR 2.41 % + euro-area AAA par 3M…30Y (2.10 → 3.25 %) plus the swap-over-AAA schedule |
| `GBP_SONIA` | SONIA 3.72 %, gilts 5Y 4.05 / 10Y 4.45 / 20Y 5.10 % less the schedule |
| `USD_SWVOL_ATM` | 30 swaption ATM normal vols (expiries 1–7Y × tenors 1–9Y), the synthetic parametric surface |
| `swaption_vol_skew` + `sabr_params` | 15 skew cells (±25/50/100/200bp) and a β=0 SABR fit per cell, exactly as the daily tick writes them |
| `cap_vol_surface` | 54 rows: cap tenors 1–10Y × strike spreads −200…+200bp, flat normal vols, ATM strike from the SOFR par curve |
| `EURUSD_VOL`, `GBPUSD_VOL`, `USDJPY_VOL`, `BTCUSD_VOL`, `ETHUSD_VOL`, `SOLUSD_VOL` | ATM / RR25 / BF25 by tenor 1W…2Y (`demo_feed.build_fx_vols`) |
| `*_SPOT` | EURUSD 1.0850, GBPUSD 1.2650, USDJPY 152.40, BTCUSD 108 250, ETHUSD 3 850, SOLUSD 182 (source `IMPORT`, as the spot snap writes them) |
| `BTC_FUNDING`, `ETH_FUNDING`, `SOL_FUNDING` | flat 3.0 / 2.5 / 4.0 % p.a. (source `MANUAL`) |
| `xva_calibration` | one `HW1F` row on `USD_SWVOL_ATM`: a 0.045, σ 78 bp, θ 0.038, basket 16, RMSE 3.1 bp. Fixed parameters, not a fit (`fit_details` says so); `POST /api/xva/calibrate` refits from the surface when wanted |

Sources are stamped `DEMO · stack seed, fixed quotes · as of 2026-11-02` (the `DEMO%` form the
source checks accept after `2026-10-29_demo_market_data_source.sql`). There is one market date, so
VaR reports "not enough observations" and the day-on-day P&L has no previous day; both routes return
200 and value every trade, which is what the tests check.

## The integration tests

`tests/integration/` (pytest, marker `integration`) is skipped unless `RIJEKA_STACK_DATABASE_URL` is
set. The session fixture starts `TestClient(main.app)` once with the stack environment (scheduler,
demo provisioning and the demo market-data tick off; no chain configured, so `chain/attestation.py`
gives the `NullBackend`; `RIJEKA_CHAIN_DEV_SEED` set so both demo LEIs sign), truncates the trade
tables and the stored reports so each run values a known book, mints tokens for A and B and books
every product once through `POST /api/book/trade` with the app's own bodies
(`tests/integration/bodies.py`, copied from `booking.test.js` and `FxCryptoPanel.payload()`). Each
test is named for what it proves.

The database named in `RIJEKA_STACK_DATABASE_URL` is treated as disposable. The harness refuses a
Supabase host.

Run the integration directory on its own with the stack environment exported. Exporting it over the
whole suite (`pytest tests`) works too (the ordinary tests do not touch the database), except that the
three demo-tick tests in `tests/test_demo_market_data.py` read `RIJEKA_DEMO_MARKET_DATA` and see the
`0` the environment sets; without the environment the integration tests skip and the suite is as before.
