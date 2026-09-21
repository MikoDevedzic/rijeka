#!/usr/bin/env bash
# Rijeka backend — FastAPI on :8000
set -euo pipefail
cd "$(dirname "$0")/backend"
source .venv/bin/activate
exec python -m uvicorn main:app --reload --port 8000
