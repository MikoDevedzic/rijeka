# Environment variables

Every variable the API and the app read, where it is read, and what happens when it is unset.
`backend/.env.example` is the local template; `render.yaml` is the hosted set. Secrets never go in
the repository.

## API (backend)

### Required

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `db/session.py` | none (the process refuses to start) | Postgres connection string. On Render use Supabase's transaction pooler (port 6543, IPv4). |
| `SUPABASE_URL` | `middleware/auth.py` | the hosted project | Where the ES256 public keys are fetched to verify tokens. |
| `FRONTEND_URL` | `main.py` | empty | Allowed CORS origin for the app. |

### Local stack and tests

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `RIJEKA_JWKS_FILE` | `middleware/auth.py` | empty (fetch from `SUPABASE_URL`) | Opt-in: verify tokens against the ES256 key set in this JSON file instead of the project's published keys. `backend/stack/keys.py` writes it; `stack/token.py` signs with its private half. Logged once at first use. The local stack and CI only; never in `render.yaml`. |
| `RIJEKA_STACK_DATABASE_URL` | `backend/stack/*.py`, `tests/integration/conftest.py` | empty (the integration tests skip) | The disposable Postgres the stack scripts build and the integration tests truncate and run against. The harness refuses a Supabase host. |

### Hosted demo

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `CORS_ORIGINS` | `main.py` | empty | Extra allowed origins, comma-separated (the landing site). |
| `RIJEKA_DEMO_PROVISION` | `api/routes/demo.py`, `public.py`, `modules.py` (who may switch modules), `api/routes/currencies.py` | `1` | Every sign-in gets a sandbox workspace (own entity, demo counterparty, market data, trader role). `0` on a self-hosted desk. |
| `RIJEKA_SIGNUP_PRESET` | `modules.py`, `api/routes/demo.py` | `LAUNCH` | The module preset a newly provisioned workspace starts on (LAUNCH, DEALER, CORPORATE, FUND, CLASSROOM). Empty, `NONE` or a name that is not a preset: nothing chosen, every module on, as before 9 November 2026 (a mistyped name is not an error). Existing firms are never changed by it. |
| `RIJEKA_DEMO_TEMPLATE_EMAIL` | `api/routes/demo.py` | empty | The account whose market data new visitors get a copy of, and the one the feeds write to. Empty: the earliest admin of a dealer firm. |
| `RIJEKA_DEMO_MARKET_DATA` | `api/routes/demo_market_data.py`, `api/routes/ops.py` | `1` | The daily rebuild from public sources, the digital-asset marks tick and its health check. `0` to run on your own marks. (The spot tick is not gated by it.) |
| `RIJEKA_DERIBIT` | `market_data/deribit.py` | `1` | Digital-asset vols and forwards from Deribit's public marks. `0` stops the requests and drops the `crypto_marks` health check. A process that runs the batches (the scheduler is on) then removes the venue's rows from the template and demo accounts at the next daily rebuild, and the parametric surfaces and the flat funding rate return; where the rows are not removed they keep being priced on. Run the risk history backfill afterwards to rebuild the vol series; it is not automatic. |
| `RIJEKA_DERIBIT_PURGE` | `api/routes/demo_market_data.py` | unset | `1` lets a process whose scheduler is off do that removal (an instance driven only by an outside cron). Never set it in a shell that points at a shared database, which is why it is not in `.env.example`. |
| `RIJEKA_USAGE_SALT` | `api/routes/usage.py` | empty (a process-local secret) | Salt for the daily-rotating visitor id of the usage beacon. |
| `RIJEKA_LOG_LEVEL` | `main.py` | `INFO` | Root log level. |

### Batches and the release move

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `RIJEKA_CRON_SECRET` | `scheduler.py`, the tick routes | empty (the ticks cannot be called) | Shared secret in the `X-Rijeka-Cron` header; the same value in the GitHub secret for the workflows. |
| `RIJEKA_SCHEDULER` | `scheduler.py` | `auto` (on when `RENDER` is set) | `1` / `0` to force the in-process scheduler on or off. |
| `RIJEKA_SCHEDULER_MINUTES` | `scheduler.py` | `30` | Period of the half-hourly group (news, summaries, spots). |
| `RIJEKA_SCHEDULER_MARKS_MINUTES` | `scheduler.py` | `10` | Period of the digital-asset marks (three requests to the venue and three for the spot per run). |
| `RIJEKA_SCHEDULER_DAILY_HOURS` | `scheduler.py` | `2` | Period of the daily group (demo market data, P&L, risk, counterparty credit); accounts already stored for the latest market date are skipped. |
| `RIJEKA_GITHUB_TOKEN` | `scheduler.py` | empty (the release move is left to the workflow) | Fine-grained PAT, Contents read/write on the repository only; moves `release` after a deploy. |
| `RIJEKA_GITHUB_REPO` | `scheduler.py` | `MikoDevedzic/rijeka` | Repository the release move targets. |
| `RIJEKA_PUBLIC_API_URL` | `scheduler.py` | `RENDER_EXTERNAL_URL` | The public URL the API checks before moving `release`. |
| `RENDER`, `RENDER_GIT_COMMIT`, `RENDER_EXTERNAL_URL` | `scheduler.py` (and through it `api/routes/demo_market_data.py`), `jobs/queue.py`, `api/routes/ops.py`, `prometheus/agent.py` | set by Render | Platform facts: the scheduler switch, the commit reported on `/api/ops/health`, the source links Prometheus cites. `GIT_COMMIT` is the fallback elsewhere. |

### On-chain confirmation

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `RIJEKA_CHAIN_RPC` | `chain/attestation.py`, `api/routes/demo.py` | empty (sign off-chain only) | JSON-RPC endpoint of the chain. |
| `RIJEKA_CHAIN_RPC_FALLBACK` | `chain/attestation.py` | empty | Second node; the relayer switches after two failed calls. |
| `RIJEKA_CHAIN_REGISTRY` | `chain/attestation.py` | empty | Address of `TradeConfirmationRegistry`. |
| `RIJEKA_CHAIN_RELAYER_KEY` | `chain/attestation.py` | empty | Funded wallet that pays gas. Rotate if it ever appears in a log. |
| `RIJEKA_CHAIN_EXPLORER` | `chain/attestation.py`, `api/routes/demo.py` | empty | Explorer base URL for proof links. |
| `RIJEKA_CHAIN_MAX_FEE_GWEI` | `chain/attestation.py` | `100` | Ceiling on the fee the relayer will pay; above it nothing is sent. |
| `RIJEKA_CHAIN_DEV_SEED` | `chain/keys.py` | empty | Seed the demo entities' signing keys derive from. Local demos and the hosted demo's `DEMO*` entities only. |
| `RIJEKA_CHAIN_DEV_LEI_PREFIX` | `chain/keys.py` | empty | Only LEIs with this prefix may be signed from the seed (`DEMO` on the hosted demo). |
| `RIJEKA_CHAIN_KEY_<LEI>` | `chain/keys.py` | none | A legal entity's own signing key, by LEI, for entities the operator signs for. |
| `RIJEKA_CHAIN_DAILY_LIMIT`, `RIJEKA_CHAIN_FIRM_DAILY_LIMIT`, `RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT` | `chain/budget.py` | unset = budget off; firm 3× user; global 200 once a user cap is set | Anchoring attempts per rolling 24 h per user, firm and platform. |

### Assistants (optional)

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `api/routes/analyse.py`, `chat.py`, `news/summarize.py`, `prometheus/book_brief.py` | empty (the features say they are not configured) | Prometheus, news summaries, the book brief. |
| `PROMETHEUS_MODEL` | `prometheus/agent.py` | `claude-opus-5` | Model for the read-only assistant. |
| `RIJEKA_PROMETHEUS_DAILY_TOKENS` | `prometheus/agent.py` | `400000` | Per-account daily token allowance (input + output); 429 beyond it. |
| `RIJEKA_BOOK_BRIEF` | `prometheus/book_brief.py` | `1` | The home-page brief on or off. |
| `RIJEKA_BRIEF_MODEL` | `prometheus/book_brief.py` | `claude-opus-5-5` | Model for the brief. |
| `RIJEKA_NEWS_SUMMARIES` | `news/summarize.py` | `1` | In-app news summaries on or off. |
| `RIJEKA_NEWS_MODEL` | `news/summarize.py` | `claude-haiku-5-5` | Model for the summaries. |
| `RIJEKA_SOURCE_URL` | `prometheus/agent.py` | the public repository | Base URL for the source links Prometheus cites. |

### Telegram mirror (optional)

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `chain/telegram.py` | empty (mirror off) | The bot from BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | `chain/telegram.py` | empty | Secret the webhook must carry. |
| `RIJEKA_PUBLIC_URL` | `chain/telegram.py` | empty | Where deep links in mirrored cards point. |

`TZ` is set to `America/New_York` by `main.py` itself: the desk's clock.

## App (frontend)

Read at build time by Vite; set them in Netlify's build environment or a local `.env`.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | The Supabase project (sign-in, realtime). |
| `VITE_SUPABASE_ANON_KEY` | Its anon key (public by design; row-level security does the protecting). |
| `VITE_API_URL` | The API base URL (`http://localhost:8000` when unset). |
| `VITE_COMMIT` | Set by `netlify.toml` from `COMMIT_REF`; the release the app reports on client errors. |

## Workflows (GitHub secrets)

| Secret | Used by |
|---|---|
| `RIJEKA_CRON_SECRET` | `news-tick.yml`, `risk-backfill.yml` (the same value as the API's). |
| `RIJEKA_API_URL` (optional) | `release-sync.yml`; defaults to the hosted API. |

## Worker tier and asynchronous confirm (added 3 November 2026)

| Variable | Read in | Default | Purpose |
|---|---|---|---|
| `RIJEKA_WORKER` | `jobs/queue.py` (`worker_expected`) | `auto` (on when `RENDER` is set and the `jobs` table exists) | `1` / `0`: send RUN NOW and the risk backfill to the worker service as job rows, or run them in a thread of the API process. With `1` the table must exist; without a worker running, jobs queue. |
| `RIJEKA_WORKER_KINDS` | `worker.py` | every handler (`ccr_run,risk_backfill`) | Comma-separated kinds this worker process claims. |
| `RIJEKA_WORKER_NAME` | `worker.py` | host:pid (Render's instance id) | The name in `worker_heartbeat`, shown on `/api/ops/health` under `worker`. |
| `RIJEKA_CHAIN_SYNC_WAIT_S` | `chain/pending.py` | `25` (the backend's full timeout when the `pending_anchors` table is missing or the value is `0`) | Seconds `POST /api/chain/confirm` waits for the receipt before answering 202 and leaving the anchor to reconciliation. |

