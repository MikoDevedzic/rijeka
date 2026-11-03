"""No token, a bad token and an expired token are 401; the admin-only views are 403 for a trader."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration

PROTECTED = [("get", "/api/trades/"), ("get", "/api/risk/report"), ("post", "/api/xva/simulate"), ("get", "/api/methodology/products"),
             ("get", "/api/chain/status"), ("post", "/api/book/trade")]
ADMIN_ONLY = ["/api/ops/usage", "/api/ops/csp-reports"]


@pytest.mark.parametrize("method,path", PROTECTED)
def _call(client, method, path, headers=None):
    kw = {"headers": headers or {}}
    if method == "post":
        kw["json"] = {}
    return getattr(client, method)(path, **kw)


@pytest.mark.parametrize("method,path", PROTECTED)
def test_no_token_is_401(client, method, path):
    r = _call(client, method, path)
    assert r.status_code == 401, (path, r.status_code)


@pytest.mark.parametrize("method,path", PROTECTED)
def test_expired_token_is_401(client, expired_auth, method, path):
    r = _call(client, method, path, expired_auth)
    assert r.status_code == 401, (path, r.status_code, r.text[:200])


def test_garbage_and_wrong_algorithm_tokens_are_401(client):
    import jwt
    assert client.get("/api/trades/", headers={"Authorization": "Bearer not.a.token"}).status_code == 401
    hs = jwt.encode({"sub": "0000000a-0000-4000-8000-0000000000aa", "exp": 9999999999}, "secret", algorithm="HS256")
    assert client.get("/api/trades/", headers={"Authorization": f"Bearer {hs}"}).status_code == 401


def test_a_trader_is_refused_the_admin_views(client, auth_a):
    for path in ADMIN_ONLY:
        r = client.get(path, headers=auth_a)
        assert r.status_code == 403, (path, r.status_code, r.text[:200])


def test_the_role_comes_from_the_database_not_the_token(client, stack):
    """A token claiming admin for a user whose profiles.role is trader is still a trader."""
    from stack.token import mint
    hdr = {"Authorization": f"Bearer {mint('0000000a-0000-4000-8000-0000000000aa', 'user_a@rijeka.test', 'admin')}"}
    assert client.get("/api/ops/usage", headers=hdr).status_code == 403
    me = client.get("/api/me", headers=hdr)
    if me.status_code == 200:
        assert (me.json().get("role") or "").lower() == "trader"
