#!/usr/bin/env bash
# Rijeka frontend — Vite on :5173
set -euo pipefail
cd "$(dirname "$0")/frontend"
exec npm run dev
