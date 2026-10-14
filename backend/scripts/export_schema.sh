#!/usr/bin/env bash
# Re-export docs/schema.sql from the database in backend/.env (schema only, no data).
# Needs pg_dump (brew install libpq).
set -euo pipefail
cd "$(dirname "$0")/../.."
URL=$(grep '^DATABASE_URL=' backend/.env | cut -d= -f2-)
PGDUMP=${PGDUMP:-$(command -v pg_dump || echo /opt/homebrew/opt/libpq/bin/pg_dump)}
HEADER=$(sed -n '1,/^$/p' docs/schema.sql | grep '^--')
TRIGGER=$(sed -n '/^-- Profile on sign-up/,$p' docs/schema.sql)
{ echo "$HEADER"; echo
  "$PGDUMP" "$URL" --schema-only --no-owner --no-privileges --schema=public | grep -vE '^\\(un)?restrict ' | sed '/^CREATE SCHEMA public;$/d'
  echo; echo "--"; echo "$TRIGGER"; } > docs/schema.sql
echo "docs/schema.sql: $(grep -c 'CREATE TABLE' docs/schema.sql) tables, $(grep -c 'CREATE POLICY' docs/schema.sql) policies"
