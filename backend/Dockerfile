# Rijeka API image: the FastAPI process, the schema applier and the seed (backend/stack).
# Built by docker-compose.yml at the repository root (context backend/).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# psycopg2-binary and numpy/scipy ship wheels; libpq is still needed at run time by psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .
# stack/apply.py reads docs/schema.sql and docs/migrations from the repository root, which is /app's parent
# here, so docker-compose.yml mounts ./docs at /docs read-only; the image carries no copy of its own.

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD curl -fsS http://127.0.0.1:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
