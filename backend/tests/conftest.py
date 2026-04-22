"""
Session-scoped fixtures for Sprint 12 item 4 phase 3 RLS isolation tests.

Loads credentials from `.env.test` at the repository root (which is the
parent of `backend/`). If `.env.test` is missing, RLS isolation tests are
skipped — the rest of the suite runs normally.

If the backend is not reachable, RLS isolation tests are skipped with a
clear message rather than failing.

Exposed fixtures:
  env              — dict of .env.test key/values
  backend_url      — base URL for the backend (default http://localhost:8000)
  backend_alive    — session guard; skips tests if backend is down
  user_a_auth      — {"token": <jwt>, "uuid": <sub>} for user_a@rijeka.test
  user_b_auth      — same for user_b@rijeka.test
  user_a_headers   — {"Authorization": "Bearer <jwt>"} for user A
  user_b_headers   — same for user B

All auth fixtures are session-scoped — each JWT is fetched once per pytest run.
"""

import json
import urllib.error
import urllib.request
from pathlib import Path

import httpx
import pytest


def _find_env_test() -> Path | None:
    """Walk up from this file to find .env.test at repo root."""
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        candidate = parent / ".env.test"
        if candidate.exists():
            return candidate
    return None


def _parse_env_file(path: Path) -> dict:
    """Minimal .env parser — no python-dotenv dependency."""
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _fetch_jwt(supabase_url: str, anon_key: str, email: str, password: str) -> tuple[str, str]:
    """POST to /auth/v1/token?grant_type=password → (access_token, user_id)."""
    req = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        body = json.loads(r.read())
    return body["access_token"], body["user"]["id"]


@pytest.fixture(scope="session")
def env() -> dict:
    path = _find_env_test()
    if path is None:
        pytest.skip(".env.test not found at repo root — skipping RLS isolation tests")
    data = _parse_env_file(path)
    required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "USER_A_PASSWORD", "USER_B_PASSWORD"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        pytest.skip(f".env.test missing required keys: {missing}")
    return data


@pytest.fixture(scope="session")
def backend_url(env) -> str:
    return env.get("BACKEND_URL", "http://localhost:8000")


@pytest.fixture(scope="session")
def backend_alive(backend_url) -> bool:
    """Fail fast + clearly if the backend isn't running."""
    try:
        r = httpx.get(f"{backend_url}/docs", timeout=3.0)
    except (httpx.ConnectError, httpx.ReadTimeout) as e:
        pytest.skip(
            f"Backend at {backend_url} not reachable ({type(e).__name__}). "
            f"Start it with: cd backend && python -m uvicorn main:app --reload --port 8000"
        )
    if r.status_code >= 500:
        pytest.skip(f"Backend at {backend_url} returned {r.status_code}")
    return True


@pytest.fixture(scope="session")
def user_a_auth(env, backend_alive) -> dict:
    try:
        token, uid = _fetch_jwt(
            env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"],
            "user_a@rijeka.test", env["USER_A_PASSWORD"],
        )
    except urllib.error.HTTPError as e:
        pytest.skip(f"Cannot fetch JWT for user_a: HTTP {e.code} {e.read().decode()[:200]}")
    return {"token": token, "uuid": uid}


@pytest.fixture(scope="session")
def user_b_auth(env, backend_alive) -> dict:
    try:
        token, uid = _fetch_jwt(
            env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"],
            "user_b@rijeka.test", env["USER_B_PASSWORD"],
        )
    except urllib.error.HTTPError as e:
        pytest.skip(f"Cannot fetch JWT for user_b: HTTP {e.code} {e.read().decode()[:200]}")
    return {"token": token, "uuid": uid}


@pytest.fixture
def user_a_headers(user_a_auth) -> dict:
    return {"Authorization": f"Bearer {user_a_auth['token']}"}


@pytest.fixture
def user_b_headers(user_b_auth) -> dict:
    return {"Authorization": f"Bearer {user_b_auth['token']}"}
