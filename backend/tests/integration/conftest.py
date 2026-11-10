"""API-level integration tests against the local stack (backend/stack: Postgres schema, seed, keys).

Run:  cd backend && ./stack/up.sh && eval "$(./stack/up.sh --env)" && python -m pytest -q -m integration tests/integration

Every test here is skipped unless RIJEKA_STACK_DATABASE_URL is set, so the ordinary suite (no database)
is unaffected. The database named is treated as disposable: at session start the trade tables and the
stored reports are truncated so each run values a known book (the seed's people and market data stay).

The app is started once per session (TestClient with the startup events, scheduler off, demo
provisioning off, no chain configured so chain/attestation.py gives the NullBackend). Tokens are
minted by stack/token.py against the key set in RIJEKA_JWKS_FILE (generated if missing), which
middleware/auth.py reads because RIJEKA_JWKS_FILE is set before it is imported, or is pointed at the
file here when the module was imported earlier in the same pytest process (a full-suite run).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

STACK_URL = os.environ.get("RIJEKA_STACK_DATABASE_URL", "").strip()
INTEGRATION_DIR = Path(__file__).resolve().parent

USER_A = "0000000a-0000-4000-8000-0000000000aa"
USER_B = "0000000b-0000-4000-8000-0000000000bb"
EMAIL_A, EMAIL_B = "user_a@rijeka.test", "user_b@rijeka.test"

TRUNCATE = ("cashflows", "trade_legs", "trade_events", "trades", "idempotency_keys", "eod_marks", "pnl_daily",
            "pnl_signoffs", "risk_daily", "ccr_daily", "chain_attempts")


def pytest_collection_modifyitems(config, items):
    """Everything in this directory is an integration test; without the stack it is skipped, not failed."""
    skip = pytest.mark.skip(reason="RIJEKA_STACK_DATABASE_URL is not set: run backend/stack/up.sh and export its env")
    for item in items:
        if INTEGRATION_DIR in Path(str(item.fspath)).resolve().parents or Path(str(item.fspath)).resolve().parent == INTEGRATION_DIR:
            item.add_marker(pytest.mark.integration)
            if not STACK_URL:
                item.add_marker(skip)


def _stack_env() -> dict:
    if STACK_URL.startswith(("postgresql://", "postgres://")) and ("supabase.co" in STACK_URL or "pooler.supabase" in STACK_URL):
        raise RuntimeError("RIJEKA_STACK_DATABASE_URL points at a Supabase host; the integration tests truncate tables and only run on a local stack")
    from stack import keys as stack_keys
    jwks = os.environ.get("RIJEKA_JWKS_FILE", "").strip() or str(stack_keys.JWKS)
    if not Path(jwks).exists():
        stack_keys.generate()
    env = {
        "DATABASE_URL": STACK_URL,
        "RIJEKA_JWKS_FILE": jwks,
        "SUPABASE_URL": os.environ.get("SUPABASE_URL") or "http://stack.local",
        "RIJEKA_DEMO_PROVISION": "0",
        "RIJEKA_SCHEDULER": "0",
        "RIJEKA_DEMO_MARKET_DATA": "0",
        "RIJEKA_CHAIN_DEV_SEED": os.environ.get("RIJEKA_CHAIN_DEV_SEED") or "stack-local",
        "RIJEKA_DEMO_TEMPLATE_EMAIL": EMAIL_A,
    }
    os.environ.update(env)
    # db/session.py calls load_dotenv() at import, which would pull backend/.env (a developer's hosted
    # settings: chain RPC, relayer key, assistants) into this process. Neuter it before anything imports
    # it, and pin the variables that select a backend to empty (dotenv never overrides a set variable).
    import dotenv
    dotenv.load_dotenv = lambda *a, **k: False
    for k in ("RIJEKA_CHAIN_RPC", "RIJEKA_CHAIN_REGISTRY", "RIJEKA_CHAIN_RELAYER_KEY", "RIJEKA_CHAIN_DEV_LEI_PREFIX",
              "RIJEKA_CHAIN_DAILY_LIMIT", "RIJEKA_CHAIN_FIRM_DAILY_LIMIT", "RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT",
              "RIJEKA_CRON_SECRET", "RIJEKA_GITHUB_TOKEN", "TELEGRAM_BOT_TOKEN", "ANTHROPIC_API_KEY"):
        os.environ[k] = ""                # NullBackend, every LEI signable from the dev seed, no relayer budget
    return env


def _rebind_modules(env: dict) -> None:
    """Modules that read the environment at import time, when the full suite imported them earlier."""
    if "db.session" in sys.modules:
        import db.session as s
        if s.DATABASE_URL != env["DATABASE_URL"]:
            from sqlalchemy import create_engine
            s.DATABASE_URL = env["DATABASE_URL"]
            s.engine = create_engine(env["DATABASE_URL"], pool_pre_ping=True, pool_size=5, max_overflow=10)
            s.SessionLocal.configure(bind=s.engine)
    if "middleware.auth" in sys.modules:
        import middleware.auth as a
        a.JWKS_FILE = env["RIJEKA_JWKS_FILE"]
        a._jwks.update(at=0.0, keys=None)
        a._roles.clear()
    import chain.attestation as att
    att._backend = None


def _clean_book(url: str) -> None:
    import psycopg2
    conn = psycopg2.connect(url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            present = {r[0] for r in cur.fetchall()}
            tables = [t for t in TRUNCATE if t in present]
            cur.execute("TRUNCATE " + ", ".join(tables) + " CASCADE")
    finally:
        conn.close()


@pytest.fixture(scope="session")
def stack():
    """The environment, a clean book, the app started once. Yields the TestClient."""
    env = _stack_env()
    _rebind_modules(env)
    _clean_book(STACK_URL)
    from fastapi.testclient import TestClient
    import main
    from api.routes import pricer
    pricer.invalidate_trade_cache() if hasattr(pricer, "invalidate_trade_cache") else None
    with TestClient(main.app) as c:
        yield c


@pytest.fixture(scope="session")
def client(stack):
    return stack


def _bearer(uid: str, email: str, role: str = "trader", **kw) -> dict:
    from stack.token import mint
    return {"Authorization": f"Bearer {mint(uid, email, role, **kw)}"}


def set_role(uid: str, role: str) -> None:
    """profiles.role for a stack user, and the API's copy of it dropped in the same step.

    The auth layer keeps each user's role for 30 s. A test that changed the row alone left the cache to the clock:
    test_ipv holds user A as a controller for most of a minute, the cache re-read "controller" inside that window,
    and the first trader-only request within 30 s of it (a later test's POST /price) was refused with 403. Whether
    that happened depended on how fast the machine ran the suite (CI, 10 November 2026)."""
    import sqlalchemy as sa
    from middleware.auth import forget_role
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.begin() as c:
            c.execute(sa.text("UPDATE profiles SET role = :r WHERE id = :id"), {"r": role, "id": uid})
    finally:
        eng.dispose()
        forget_role(uid)


@pytest.fixture(scope="session")
def auth_a(stack) -> dict:
    return _bearer(USER_A, EMAIL_A)


@pytest.fixture(scope="session")
def auth_b(stack) -> dict:
    return _bearer(USER_B, EMAIL_B)


@pytest.fixture(scope="session")
def expired_auth(stack) -> dict:
    return _bearer(USER_A, EMAIL_A, expires_in=-120)


@pytest.fixture(scope="session")
def ids(stack) -> dict:
    """The seed's entity and counterparty ids per user, read from the database."""
    import psycopg2
    out = {}
    conn = psycopg2.connect(STACK_URL)
    try:
        with conn.cursor() as cur:
            for key, uid in (("a", USER_A), ("b", USER_B)):
                cur.execute("SELECT id, lei FROM legal_entities WHERE user_id = %s AND is_own_entity", (uid,))
                own_id, own_lei = cur.fetchone()
                cur.execute("SELECT id FROM counterparties WHERE user_id = %s AND is_active ORDER BY created_at LIMIT 1", (uid,))
                cp_id = cur.fetchone()[0]
                out[key] = {"user_id": uid, "own_entity_id": str(own_id), "own_lei": own_lei, "counterparty_id": str(cp_id)}
    finally:
        conn.close()
    return out


@pytest.fixture(autouse=True)
def _no_rate_limit(request):
    """The per-user sliding-minute limits (api/routes/_limits.py) would trip inside one test run."""
    if not STACK_URL:
        yield
        return
    from api.routes import _limits
    _limits._buckets.clear()
    yield
    _limits._buckets.clear()


# ── the book: every product once, shared by the modules ──────────────────────────────────────────

def _expiry_3m() -> str:
    from datetime import date, timedelta
    return (date.today() + timedelta(days=91)).isoformat()


def _run_tag() -> str:
    import time
    return str(int(time.time()))[-6:]


@pytest.fixture(scope="session")
def pairs(client, auth_a) -> dict:
    r = client.get("/api/currency/pairs", headers=auth_a)
    assert r.status_code == 200, r.text
    return {p["pair"]: p for p in r.json()["pairs"]}


@pytest.fixture(scope="session")
def booked(client, auth_a, ids, pairs) -> dict:
    """{product: {"id", "ref", "body", "trade", "legs"}} for every product the app books, through
    POST /api/book/trade with the frontend's bodies (tests/integration/bodies.py)."""
    from tests.integration import bodies as B
    tag = _run_tag()
    a = ids["a"]
    out: dict = {}

    def book(key: str, body: dict, expect_structure):
        r = client.post("/api/book/trade", json=body, headers=auth_a)
        assert r.status_code == 201, f"{key}: {r.status_code} {r.text[:400]}"
        j = r.json()
        out[key] = {"id": j["trade"]["id"], "ref": body["trade_ref"], "body": body, "trade": j["trade"], "legs": j["legs"],
                    "structure": expect_structure}

    book("IR_SWAP", B.swap(a, f"IT-SWAP-{tag}"), "VANILLA")
    book("IR_SWAPTION", B.swaption(a, f"IT-SWPT-{tag}"), "EUROPEAN")
    book("IR_CAP", B.cap(a, f"IT-CAP-{tag}"), None)
    book("IR_FLOOR", B.floor(a, f"IT-FLOOR-{tag}"), None)
    book("IR_COLLAR", B.collar(a, f"IT-COLLAR-{tag}"), None)

    eur, btc = pairs["EURUSD"], pairs["BTCUSD"]
    settle = _expiry_3m()
    q = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": 10_000_000,
                                                          "direction": "BUY", "settlement_date": settle}, headers=auth_a)
    assert q.status_code == 200, q.text
    fwd_quote = q.json()
    book("FX_FORWARD", B.fx_forward(a, f"IT-FXF-{tag}", eur, fwd_quote, "FX_FORWARD"), "VANILLA")
    book("NDF", B.fx_forward(a, f"IT-NDF-{tag}", eur, fwd_quote, "NDF"), "VANILLA")
    qs = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "SPOT", "base_notional": 10_000_000, "direction": "BUY"}, headers=auth_a)
    assert qs.status_code == 200, qs.text
    book("FX_SPOT", B.fx_forward(a, f"IT-FXS-{tag}", eur, qs.json(), "FX_SPOT"), "VANILLA")

    qo = client.post("/api/currency/option/price", json=B.option_price_request("EURUSD", "EUROPEAN", eur["spot"], settle, False, 10_000_000), headers=auth_a)
    assert qo.status_code == 200, qo.text
    book("FX_OPTION", B.fx_option(a, f"IT-FXO-{tag}", eur, qo.json(), "EUROPEAN"), "EUROPEAN")
    qb = client.post("/api/currency/option/price", json=B.option_price_request("EURUSD", "BARRIER", eur["spot"], settle, False, 10_000_000), headers=auth_a)
    assert qb.status_code == 200, qb.text
    book("FX_OPTION_BARRIER", B.fx_option(a, f"IT-FXOB-{tag}", eur, qb.json(), "BARRIER"), "BARRIER")

    qc = client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY",
                                                           "settlement_date": settle}, headers=auth_a)
    assert qc.status_code == 200, qc.text
    book("CRYPTO_FORWARD", B.crypto_forward(a, f"IT-CRF-{tag}", btc, qc.json()), "VANILLA")
    qco = client.post("/api/currency/option/price", json=B.option_price_request("BTCUSD", "EUROPEAN", btc["spot"], settle, True, 10), headers=auth_a)
    assert qco.status_code == 200, qco.text
    book("CRYPTO_OPTION", B.crypto_option(a, f"IT-CRO-{tag}", btc, qco.json(), "EUROPEAN"), "EUROPEAN")
    return out
