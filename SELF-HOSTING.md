# Self-hosting Rijeka

The hosted demo at **app.rijeka.app** is the quickest way to see Rijeka: sign up,
and a sandbox workspace is created for you (own entity, a demo counterparty, the
demo market data, trader role). Trades you confirm there anchor to the Sepolia
testnet and verify at **rijeka.app/verify**.

Running it yourself is the production path: your curves and your trades never
leave your perimeter, you connect your own Bloomberg feed, and you sign
confirmations with keys you control. It is the same code. This page is the
honest list of what that takes today.

## What you need

| Piece | What it is | Notes |
|---|---|---|
| Postgres with auth | A [Supabase](https://supabase.com) project | Auth (sign-in, JWTs), row-level security and the `authenticated` role come from Supabase. Any Postgres works for the data, but sign-in currently assumes Supabase auth. |
| Backend | FastAPI, Python 3.11 | `backend/`. One process; `render.yaml` shows a working deployment. |
| Frontend | React / Vite static build | `frontend/`. Any static host (Netlify, S3, nginx). |
| Ethereum RPC + relayer | Only for on-chain confirmation | Sepolia for testing, mainnet when you mean it. The registry contract is in `chain/`; deploy your own or use ours. |

## Steps

1. **Create a Supabase project.** In the SQL editor run [`docs/schema.sql`](docs/schema.sql)
   (26 tables, RLS policies, the sign-up trigger). Copy the connection string and
   the JWT secret from *Settings → Database / API*.
2. **Backend.** `cp backend/.env.example backend/.env`, fill in `DATABASE_URL`,
   `SUPABASE_JWT_SECRET`, `FRONTEND_URL`. Then
   ```bash
   cd backend && pip install -r requirements.txt && uvicorn main:app --port 8000
   ```
   Set `RIJEKA_DEMO_PROVISION=0` unless you want every sign-in to get a sandbox
   workspace the way the hosted demo does.
3. **Frontend.** Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`,
   then `cd frontend && npm install && npm run build` and serve `dist/`.
4. **Firms and entities.** Sign up, then insert your firm, its members and its LEI
   into `firms`, `firm_members`, `firm_leis` (there is no admin UI for this yet;
   `backend/api/routes/demo.py` shows the rows a workspace needs). Set
   `role: trader` or `admin` in the user's auth metadata so booking is allowed.
5. **Market data.** Snapshots are per user. Load curves through *Configurations →
   Market data* (manual quotes or the Bloomberg sprint importer in
   `backend/api/routes/bloomberg.py`, which runs on the machine with the terminal).
6. **On-chain confirmation (optional).** Set `RIJEKA_CHAIN_RPC`,
   `RIJEKA_CHAIN_REGISTRY`, `RIJEKA_CHAIN_RELAYER_KEY`. Each legal entity signs with
   `RIJEKA_CHAIN_KEY_<LEI>`, or registers a wallet in the app (then Rijeka can
   verify its signatures but never produce them). `RIJEKA_CHAIN_DEV_SEED` is for
   local demos only. See [`chain/README.md`](chain/README.md).

## What is not there yet

- No docker-compose; no admin screens for firms or roles; no migration runner
  (`docs/schema.sql` is the whole schema, regenerate with `backend/scripts/export_schema.sh`).
- The backend connects with the Postgres owner role and enforces tenant
  isolation in application code; the RLS policies protect direct Supabase
  client access. Review `api/routes/*` before exposing it to firms that compete.
- Market data is whatever you load. Nothing ships with a live feed.
- The registry contract has not had an external audit.

If you want help standing this up for a desk, or dedicated coverage on the
models, write to hello@rijeka.app. The hosted demo is free; the work above is
what we charge for.
