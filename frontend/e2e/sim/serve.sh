#!/usr/bin/env bash
# e2e/sim/serve.sh — the app on the local stack for a browser Playwright does not drive: Safari in the iPhone simulator
# (which reaches this machine at 127.0.0.1). The same stack the journeys use (e2e/serve.sh), with a local server in
# place of the auth host Playwright answers for (e2e/sim/auth_host.py):
#
#   AUTH  http://127.0.0.1:3020   sign-in as a seeded user (any password), REST passed to the stack's PostgREST
#   WEB   http://127.0.0.1:4174   open this in the simulator; sign in with a seeded user's email (backend/stack/seed.py)
#
# Nothing here touches production. Ctrl-C stops everything.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
E2E="$(dirname "$HERE")"
BACKEND="$(cd "$E2E/../../backend" && pwd)"
PY="${PYTHON:-}"; if [ -z "$PY" ]; then if [ -x "$BACKEND/.venv/bin/python" ]; then PY="$BACKEND/.venv/bin/python"; else PY=python3; fi; fi
AUTH_PORT=3020
if (exec 3<>"/dev/tcp/127.0.0.1/$AUTH_PORT") 2>/dev/null; then echo "port $AUTH_PORT is already in use" >&2; exit 1; fi
mkdir -p "$E2E/.out"
"$PY" -m uvicorn --app-dir "$HERE" auth_host:app --host 127.0.0.1 --port $AUTH_PORT --log-level warning > "$E2E/.out/auth-host.log" 2>&1 &
AUTH_PID=$!
trap 'kill "$AUTH_PID" 2>/dev/null || true' EXIT INT TERM
PYTHON="$PY" RIJEKA_E2E_AUTH_HOST="http://127.0.0.1:$AUTH_PORT" bash "$E2E/serve.sh"
