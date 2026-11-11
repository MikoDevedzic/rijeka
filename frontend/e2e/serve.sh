#!/usr/bin/env bash
# e2e/serve.sh — the whole app on the local stack, for the browser journeys. Nothing here touches production:
# the database is the stack's (backend/stack/up.sh, default postgresql:///rijeka_test), the API reads only the
# stack's environment, sign-in is a token minted by backend/stack/token.py, and the reads the app makes through
# supabase-js are served by a local PostgREST on the same database.
#
#   REST  http://127.0.0.1:3010   PostgREST on the stack database (row-level security applies as on Supabase)
#   API   http://127.0.0.1:8010   uvicorn main:app with the stack's environment
#   WEB   http://127.0.0.1:4174   vite build + vite preview, built against the two above
#   CHAIN http://127.0.0.1:8546   only with RIJEKA_E2E_CHAIN=1: Foundry's anvil with the registry deployed to it, so a
#                                 confirmation is anchored for real (e2e/chain, `npm run e2e:chain`). Without it the
#                                 stack has no chain, as a self-hosted instance may not: a record is signed, not anchored.
#
# Playwright starts this (playwright.config.js) and waits for WEB. Ctrl-C stops them all.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$(dirname "$HERE")"
BACKEND="$(cd "$FRONTEND/../backend" && pwd)"
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/lib/postgresql/16/bin:$PATH"
REST_PORT=3010; API_PORT=8010; WEB_PORT=4174; CHAIN_PORT=8546
CHAIN="${RIJEKA_E2E_CHAIN:-}"
if [ "$CHAIN" = "1" ]; then
  export PATH="$HOME/.foundry/bin:$PATH"
  command -v anvil >/dev/null || { echo "RIJEKA_E2E_CHAIN=1 needs Foundry's anvil on PATH (https://getfoundry.sh)" >&2; exit 1; }
fi
OUT="$HERE/.out"; mkdir -p "$OUT"

cd "$BACKEND"
PY="${PYTHON:-}"; if [ -z "$PY" ]; then if [ -x .venv/bin/python ]; then PY="$BACKEND/.venv/bin/python"; else PY=python3; fi; fi
export PYTHON="$PY"

# 0. only a local database, decided before anything is applied to it: a socket, localhost or 127.0.0.1
TARGET="${RIJEKA_STACK_DATABASE_URL:-postgresql:///rijeka_test}"
HOSTPART="$(printf '%s' "$TARGET" | sed -E 's#^[a-z]+://##; s#/.*$##; s#^.*@##; s#:[0-9]+$##')"
case "$HOSTPART" in ""|localhost|127.0.0.1) ;; *) echo "refusing a database that is not local (host '$HOSTPART'): the journeys never run on a hosted database" >&2; exit 1 ;; esac

# nothing stale: a server left on these ports from another run would be tested in place of this build
# (a run that has just ended is given five seconds to let go of its ports: `npm run e2e:chain` follows `npm run e2e`)
in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
PORTS="$REST_PORT $API_PORT $WEB_PORT"; if [ "$CHAIN" = "1" ]; then PORTS="$PORTS $CHAIN_PORT"; fi
for port in $PORTS; do
  for _ in 1 2 3 4 5 6 7 8 9 10; do in_use "$port" || break; sleep 0.5; done
  if in_use "$port"; then echo "port $port is already in use: stop the earlier stack (a stale server would be tested instead of this build)" >&2; exit 1; fi
done

# 1. database: schema, migrations, seed, keys (a no-op when current), then the PostgREST grants
bash ./stack/up.sh > "$OUT/stack-up.log" 2>&1 || { cat "$OUT/stack-up.log"; exit 1; }
eval "$(bash ./stack/up.sh --env)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f stack/rest.sql > "$OUT/rest-sql.log" 2>&1 || { cat "$OUT/rest-sql.log"; exit 1; }

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# 2. PostgREST: the stack's JWKS verifies the same tokens the API accepts
PGRST_DB_URI="$DATABASE_URL" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=$REST_PORT \
PGRST_JWT_SECRET="@$RIJEKA_JWKS_FILE" PGRST_JWT_AUD=authenticated PGRST_LOG_LEVEL=warn \
  postgrest > "$OUT/postgrest.log" 2>&1 &
pids+=($!)

# 2a. a chain, when the run asks for one: anvil, the registry deployed to it, and the API told where it is. The key
#     is anvil's published first account (backend/stack/chain.py, which refuses any node that is not local)
if [ "$CHAIN" = "1" ]; then
  anvil --port $CHAIN_PORT --silent > "$OUT/anvil.log" 2>&1 &
  pids+=($!)
  CHAIN_ENV="$("$PY" -m stack.chain --rpc "http://127.0.0.1:$CHAIN_PORT" 2> "$OUT/chain-deploy.log")" || { cat "$OUT/chain-deploy.log" >&2; exit 1; }
  eval "$CHAIN_ENV"
fi

# 3. the API on the stack's environment
RIJEKA_NO_DOTENV=1 CORS_ORIGINS="http://127.0.0.1:$WEB_PORT,http://localhost:$WEB_PORT" RIJEKA_RATE_LIMITS=0 \
  "$PY" -m uvicorn main:app --host 127.0.0.1 --port $API_PORT --log-level warning > "$OUT/api.log" 2>&1 &
pids+=($!)

wait_for() { for _ in $(seq 1 120); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done; echo "timed out waiting for $1" >&2; tail -20 "$2" >&2; return 1; }
wait_for "http://127.0.0.1:$REST_PORT/" "$OUT/postgrest.log"
wait_for "http://127.0.0.1:$API_PORT/api/ops/health" "$OUT/api.log"

# 4. a session for the journeys (four hours), minted with the stack's key
"$PY" - > "$OUT/session.json" <<PYEOF
import json, time, sys
sys.path.insert(0, "$BACKEND")
from stack.token import mint
from stack.seed import USERS
out = {}
for uid, email, trader, role, member in USERS:
    tok = mint(str(uid), email, role, expires_in=4 * 3600)
    out[trader] = {"access_token": tok, "token_type": "bearer", "expires_in": 4 * 3600, "expires_at": int(time.time()) + 4 * 3600, "refresh_token": "e2e-stack",
                   "user": {"id": str(uid), "aud": "authenticated", "role": "authenticated", "email": email, "app_metadata": {"provider": "email"},
                            "user_metadata": {"role": role, "email": email}, "created_at": "2026-01-01T00:00:00Z"}}
print(json.dumps(out))
PYEOF

# 5. the frontend, built against the stack and served as production serves it
cd "$FRONTEND"
VITE_API_URL="http://127.0.0.1:$API_PORT" VITE_SUPABASE_URL="http://stack.local" VITE_SUPABASE_ANON_KEY="stack-anon" \
  npx vite build --outDir "$OUT/dist" --emptyOutDir ${RIJEKA_E2E_BUILD_FLAGS:-} > "$OUT/build.log" 2>&1 || { tail -30 "$OUT/build.log"; exit 1; }
npx vite preview --outDir "$OUT/dist" --host 127.0.0.1 --port $WEB_PORT --strictPort &
WEB_PID=$!; pids+=($WEB_PID)
wait "$WEB_PID"            # the web server; when it stops (or this script is told to), the trap stops the others
