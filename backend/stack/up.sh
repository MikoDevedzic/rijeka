#!/usr/bin/env bash
# up.sh — the local stack in one command: Postgres database, schema, seed, keys. No Docker, no Supabase.
#
#   cd backend && ./stack/up.sh            # create rijeka_test if missing, apply, seed, keys
#   ./stack/up.sh --reset                  # drop and rebuild the schema first
#   ./stack/up.sh --minimal                # people and counterparties only, no market data
#
# Then export what it prints (or `eval "$(./stack/up.sh --env)"`), run the API or the integration tests:
#   python -m pytest -q -m integration tests/integration
#
# Postgres: Homebrew's postgresql@16 on macOS (the PATH line below), or any PostgreSQL 16 whose default
# socket the current user may create databases on. RIJEKA_STACK_DATABASE_URL overrides the target.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/postgresql@16/bin:/usr/lib/postgresql/16/bin:$PATH"

DB_URL="${RIJEKA_STACK_DATABASE_URL:-postgresql:///rijeka_test}"
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
fi
RESET=""; MINIMAL=""; ENV_ONLY=""
for a in "$@"; do
  case "$a" in
    --reset) RESET="--reset" ;;
    --minimal) MINIMAL="--minimal" ;;
    --env) ENV_ONLY=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

JWKS="$PWD/stack/.local/jwks.json"
print_env() {
  cat <<ENV
export DATABASE_URL='$DB_URL'
export RIJEKA_STACK_DATABASE_URL='$DB_URL'
export RIJEKA_JWKS_FILE='$JWKS'
export SUPABASE_URL='http://stack.local'
export RIJEKA_DEMO_PROVISION=0
export RIJEKA_SCHEDULER=0
export RIJEKA_DEMO_MARKET_DATA=0
export RIJEKA_CHAIN_DEV_SEED=stack-local
# empty on purpose: db/session.py loads backend/.env, and a set variable (even empty) is never overridden,
# so a developer's hosted chain, relayer and assistant settings cannot leak into the stack
export RIJEKA_CHAIN_RPC= RIJEKA_CHAIN_REGISTRY= RIJEKA_CHAIN_RELAYER_KEY= RIJEKA_CHAIN_DEV_LEI_PREFIX= RIJEKA_CHAIN_DAILY_LIMIT=
export RIJEKA_CRON_SECRET= RIJEKA_GITHUB_TOKEN= TELEGRAM_BOT_TOKEN= ANTHROPIC_API_KEY=
ENV
}
if [ -n "$ENV_ONLY" ]; then print_env; exit 0; fi

# the database name is the last path segment of a postgresql:///name or postgresql://host/name URL
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's#^[a-z]+://[^/]*/##; s#\?.*$##')"
if [[ "$DB_URL" == postgresql:///* ]] || [[ "$DB_URL" == postgres:///* ]]; then
  if ! psql -lqtA 2>/dev/null | cut -d'|' -f1 | grep -qx "$DB_NAME"; then
    echo "createdb $DB_NAME"; createdb "$DB_NAME"
  fi
fi

export DATABASE_URL="$DB_URL"          # db/session.py reads it at import and must never fall back to backend/.env
"$PY" -m stack.apply --database-url "$DB_URL" $RESET
"$PY" -m stack.seed --database-url "$DB_URL" $MINIMAL
"$PY" -m stack.keys

echo
echo "# stack ready. Export this (or: eval \"\$(./stack/up.sh --env)\"):"
print_env
