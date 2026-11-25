"""A guest's pass (middleware/guest.py): what makes one, what does not, and what a guest is let through to.

No database and no app here: the pass, the wall's decision, the limits by address. The walk of every route of
the running API with a pass is tests/integration/test_guest_wall.py."""
import asyncio
import time
from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException

SECRET = "s" * 40
DESK = "0000000a-0000-4000-8000-0000000000aa"


@pytest.fixture
def guest(monkeypatch):
    from middleware import guest as g
    monkeypatch.setenv("RIJEKA_GUEST_SECRET", SECRET)
    monkeypatch.setenv("RIJEKA_GUEST_EMAIL", "desk@rijeka.test")
    monkeypatch.setenv("RIJEKA_RATE_LIMITS", "1")
    monkeypatch.setattr(g, "account_id", lambda: DESK)
    for b in (g._requests, g._pricings, g._passes):
        b.clear()
    return g


def _request(method: str, route: str, host: str = "203.0.113.7"):
    # the matched route's own name is the short one a prefixed router knows it by: the wall must not read it
    return SimpleNamespace(method=method, scope={"path": route, "route": SimpleNamespace(path="/")}, client=SimpleNamespace(host=host),
                           state=SimpleNamespace(), url=SimpleNamespace(path=route))


def _bearer(token: str) -> str:
    return f"Bearer {token}"


# ── on and off ───────────────────────────────────────────────────────────────

def test_guests_are_off_until_the_guest_desk_is_named(monkeypatch):
    from middleware import guest as g
    monkeypatch.delenv("RIJEKA_GUEST_SECRET", raising=False)
    monkeypatch.delenv("RIJEKA_GUEST_EMAIL", raising=False)
    assert not g.enabled()
    with pytest.raises(LookupError):
        g.mint()
    monkeypatch.setenv("RIJEKA_GUEST_EMAIL", "desk@rijeka.test")
    assert g.enabled()                                             # the secret is the process's own: nothing else to set


def test_the_process_makes_its_own_secret_and_another_process_refuses_its_passes(monkeypatch):
    """No setting: a pass is signed with a secret made when the process starts. It verifies here, and nowhere else."""
    from middleware import guest as g
    monkeypatch.delenv("RIJEKA_GUEST_SECRET", raising=False)
    monkeypatch.setenv("RIJEKA_GUEST_EMAIL", "desk@rijeka.test")
    monkeypatch.setattr(g, "account_id", lambda: DESK)
    assert len(g._PROCESS_SECRET) >= 32
    token, _ = g.mint()
    assert g.user(_bearer(token), _request("POST", "/price/preview"))["is_guest"] is True
    import secrets as _s
    monkeypatch.setattr(g, "_PROCESS_SECRET", _s.token_bytes(48))             # the process restarted, or it is another one
    with pytest.raises(HTTPException) as e:
        g.user(_bearer(token), _request("POST", "/price/preview"))
    assert e.value.status_code == 401
    # a secret that is set is the one used, by every process that has it
    monkeypatch.setenv("RIJEKA_GUEST_SECRET", SECRET)
    shared, _ = g.mint()
    monkeypatch.setattr(g, "_PROCESS_SECRET", _s.token_bytes(48))
    assert g.user(_bearer(shared), _request("POST", "/price/preview"))["is_guest"] is True


def test_a_short_secret_is_no_secret(monkeypatch):
    """A secret set to nothing, or to something short, would make passes anyone can sign: guests are off, and a pass
    signed with it is refused. The process's own secret is not fallen back to: a setting that is wrong is said, not mended."""
    from middleware import guest as g
    monkeypatch.setenv("RIJEKA_GUEST_EMAIL", "desk@rijeka.test")
    for short in ("", "x" * 31):
        monkeypatch.setenv("RIJEKA_GUEST_SECRET", short)
        assert not g.enabled()
        forged = jwt.encode({"iss": g.ISSUER, "aud": g.AUDIENCE, "kind": "guest", "jti": "j", "iat": int(time.time()), "exp": int(time.time()) + 60},
                            short or "x", algorithm="HS256", headers={"kid": "guest"})
        with pytest.raises(HTTPException) as e:
            g.user(_bearer(forged), _request("POST", "/price/preview"))
        assert e.value.status_code == 401


# ── the pass ─────────────────────────────────────────────────────────────────

def test_a_pass_is_a_viewer_on_the_guest_desk(guest):
    token, exp = guest.mint()
    assert guest.is_pass(_bearer(token)) and exp - int(time.time()) in range(guest.TTL - 5, guest.TTL + 1)
    req = _request("POST", "/price/preview")
    u = guest.user(_bearer(token), req)
    assert u["sub"] == DESK and u["role"] == "viewer" and u["user_metadata"]["role"] == "viewer" and u["is_guest"] is True
    assert u["guest_address"] == "203.0.113.7" and u["email"] is None
    assert req.state.rijeka_guest is True and not hasattr(req.state, "rijeka_account")      # a guest is not an account in the activity record


def _forge(guest, key=SECRET, alg="HS256", kid="guest", **claims):
    now = int(time.time())
    body = {"iss": guest.ISSUER, "aud": guest.AUDIENCE, "kind": "guest", "jti": "j", "iat": now, "exp": now + 600}
    body.update(claims)
    body = {k: v for k, v in body.items() if v is not None}
    return jwt.encode(body, key, algorithm=alg, headers={"kid": kid} if kid else {})


@pytest.mark.parametrize("change", [
    {"key": "another-secret-of-more-than-32-bytes!!"},
    {"exp": int(time.time()) - 30},
    {"iss": "somebody-else"},
    {"aud": "authenticated"},
    {"kind": "account"},
    {"kind": None},
    {"jti": None},
    {"iat": None},
    {"exp": None},
])
def test_a_pass_that_is_not_ours_is_refused(guest, change):
    with pytest.raises(HTTPException) as e:
        guest.user(_bearer(_forge(guest, **change)), _request("POST", "/price/preview"))
    assert e.value.status_code == 401


def test_only_the_exact_header_makes_a_pass(guest):
    """HS256 with another key id, or none, is not a pass: it goes to the account path, which refuses HS256."""
    from middleware.auth import verified_claims, verify_token
    assert not guest.is_pass(None) and not guest.is_pass("Bearer") and not guest.is_pass("Bearer not-a-token")
    for kid in (None, "Guest", "guest2", ""):
        token = _forge(guest, kid=kid)
        assert not guest.is_pass(_bearer(token))
        for check in (verified_claims(_bearer(token)), verify_token(_bearer(token), _request("POST", "/price/preview"))):
            with pytest.raises(HTTPException) as e:
                asyncio.run(check)
            assert e.value.status_code == 401
    longer = jwt.encode({"sub": DESK, "exp": int(time.time()) + 600}, SECRET, algorithm="HS512", headers={"kid": "guest"})
    assert not guest.is_pass(_bearer(longer))


def test_a_pass_never_reaches_the_account_path(guest, monkeypatch):
    """A good pass and a bad one are both settled by the guest's check: the key set is not asked."""
    from middleware import auth

    async def no_keys(force: bool = False):
        raise AssertionError("the key set was asked about a guest's pass")
    monkeypatch.setattr(auth, "_get_jwks", no_keys)
    token, _ = guest.mint()
    assert asyncio.run(auth.verify_token(_bearer(token), _request("POST", "/price/preview")))["is_guest"] is True
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.verify_token(_bearer(_forge(guest, key="another-secret-of-more-than-32-bytes!!")), _request("POST", "/price/preview")))
    assert e.value.status_code == 401
    assert asyncio.run(auth.optional_token(_bearer(token), _request("POST", "/price/preview")))["is_guest"] is True


# ── the wall ─────────────────────────────────────────────────────────────────

def test_a_guest_is_refused_everything_not_on_the_list(guest):
    token, _ = guest.mint()
    for method, route in [("POST", "/api/book/trade"), ("POST", "/api/trades/"), ("PUT", "/api/me/role"), ("POST", "/api/analyse/"),
                          ("GET", "/api/trades/"), ("POST", "/api/chat/rooms/{room_id}/messages"), ("GET", "/price/preview"),
                          ("POST", "/price/preview/"), ("POST", "/api/a-route-added-tomorrow"), ("POST", None)]:
        with pytest.raises(HTTPException) as e:
            guest.user(_bearer(token), _request(method, route))
        assert e.value.status_code == 403 and e.value.detail == guest.ASK, (method, route)


def test_a_route_with_a_name_in_it_is_matched_segment_by_segment(guest):
    assert guest.allowed("GET", "/api/market-data/snapshots/USD_SOFR/latest") and guest.allowed("get", "/api/collateral/schedule/0000-aa")
    for path in ("/api/market-data/snapshots/USD_SOFR/latest/more", "/api/market-data/snapshots/a/b/latest", "/api/market-data/snapshots//latest",
                 "/api/market-data/snapshots/USD_SOFR", "/api/collateral/schedule/", "/api/modules/", "/api/modulesX", "/x/api/modules", "/", "", None):
        assert not guest.allowed("GET", path), path
    assert not guest.allowed("PUT", "/api/modules") and not guest.allowed("POST", "/api/collateral/schedule/0000-aa")


def test_no_request_to_look_at_is_a_refusal(guest):
    from middleware.auth import optional_token, verify_token
    token, _ = guest.mint()
    for check in (verify_token(_bearer(token)), optional_token(_bearer(token)), verify_token(_bearer(token), None)):
        with pytest.raises(HTTPException) as e:
            asyncio.run(check)
        assert e.value.status_code == 403


def test_nothing_that_writes_for_its_caller_is_on_the_list(guest):
    """All guests are one account: a route that stores for 'the caller' would let one guest move another's prices."""
    assert not (guest.ALLOWED & guest.NEVER)
    for method, route in guest.ALLOWED:
        assert method in ("GET", "POST"), (method, route)
        parts = set(route.strip("/").split("/"))
        assert not parts & {"calibrate", "snap", "tick", "fixings", "provision", "book", "trades", "chain", "chat", "analyse", "rooms"}, route
        assert not route.endswith(".xlsx"), route
    assert ("POST", "/api/xva/calibrate") in guest.NEVER and ("PUT", "/api/me/role") in guest.NEVER and ("POST", "/api/demo/provision") in guest.NEVER


def test_the_guest_desk_missing_is_a_503_and_is_asked_again(guest, monkeypatch):
    answers = iter([None, DESK])
    monkeypatch.setattr(guest, "account_id", lambda: next(answers))
    token, _ = guest.mint()
    with pytest.raises(HTTPException) as e:
        guest.user(_bearer(token), _request("GET", "/api/modules"))
    assert e.value.status_code == 503
    assert guest.user(_bearer(token), _request("GET", "/api/modules"))["sub"] == DESK


# ── volume ───────────────────────────────────────────────────────────────────

def test_requests_are_counted_by_address(guest, monkeypatch):
    monkeypatch.setattr(guest, "_limits_off", lambda: False)
    monkeypatch.setattr(guest, "PER_MINUTE", 5)
    token, _ = guest.mint()
    for _ in range(5):
        guest.user(_bearer(token), _request("GET", "/api/modules", host="198.51.100.1"))
    with pytest.raises(HTTPException) as e:
        guest.user(_bearer(guest.mint()[0]), _request("GET", "/api/modules", host="198.51.100.1"))      # a new pass is the same address
    assert e.value.status_code == 429 and int(e.value.headers["Retry-After"]) >= 1
    assert guest.user(_bearer(token), _request("GET", "/api/modules", host="198.51.100.2"))["is_guest"]


def test_pricing_is_counted_by_address_and_for_all_guests(guest, monkeypatch):
    monkeypatch.setattr(guest, "_limits_off", lambda: False)
    monkeypatch.setattr(guest, "PRICINGS_PER_MINUTE", 3)
    monkeypatch.setattr(guest, "ALL_PRICINGS_PER_MINUTE", 5)
    token, _ = guest.mint()
    for _ in range(3):
        guest.user(_bearer(token), _request("POST", "/price/preview", host="198.51.100.1"))
    with pytest.raises(HTTPException) as e:
        guest.user(_bearer(token), _request("POST", "/price/preview", host="198.51.100.1"))
    assert e.value.status_code == 429
    guest.user(_bearer(token), _request("GET", "/api/modules", host="198.51.100.1"))                    # reading is not pricing
    for host in ("198.51.100.2", "198.51.100.3"):
        guest.user(_bearer(token), _request("POST", "/price/preview", host=host))
    with pytest.raises(HTTPException) as e:
        guest.user(_bearer(token), _request("POST", "/price/preview", host="198.51.100.4"))             # the ceiling for all guests
    assert e.value.status_code == 429


def test_passes_are_counted_by_address(guest, monkeypatch):
    monkeypatch.setattr(guest, "_limits_off", lambda: False)
    monkeypatch.setattr(guest, "PASSES_PER_HOUR", 2)
    req = _request("POST", "/api/public/guest", host="198.51.100.9")
    guest.take_pass(req); guest.take_pass(req)
    with pytest.raises(HTTPException) as e:
        guest.take_pass(req)
    assert e.value.status_code == 429


def test_the_address_is_the_proxys_not_a_header(guest):
    req = _request("GET", "/api/modules", host="198.51.100.1")
    req.headers = {"x-forwarded-for": "10.0.0.1"}
    assert guest.address(req) == "198.51.100.1" and guest.address(None) == "unknown"


def test_heavy_counts_a_guest_by_address_and_all_guests_together(guest, monkeypatch):
    from api.routes import _limits
    monkeypatch.setattr(_limits, "_off", lambda: False)
    _limits._buckets.clear()
    a = {"sub": DESK, "is_guest": True, "guest_address": "198.51.100.1"}
    for _ in range(3):                                                      # half of six
        _limits.heavy(a, "XVA simulation", 6)
    with pytest.raises(HTTPException) as e:
        _limits.heavy(a, "XVA simulation", 6)
    assert e.value.status_code == 429 and "This address" in e.value.detail
    for i in range(2, 5):                                                   # nine more from three other addresses: twelve in all
        for _ in range(3):
            _limits.heavy({"sub": DESK, "is_guest": True, "guest_address": f"198.51.100.{i}"}, "XVA simulation", 6)
    with pytest.raises(HTTPException) as e:
        _limits.heavy({"sub": DESK, "is_guest": True, "guest_address": "198.51.100.9"}, "XVA simulation", 6)
    assert e.value.status_code == 429 and "Guests together" in e.value.detail
    _limits.heavy({"sub": DESK}, "XVA simulation", 6)                       # the desk's owner, signed in, has the account's own count
    _limits._buckets.clear()


def test_a_guests_simulation_is_no_larger_than_the_tickets_default(guest):
    g = {"is_guest": True}
    guest.size(g, SimpleNamespace(paths=guest.MAX_PATHS)); guest.size(g, SimpleNamespace(n_paths=None)); guest.size(g, SimpleNamespace())
    for body in (SimpleNamespace(paths=guest.MAX_PATHS + 1), SimpleNamespace(n_paths=5000)):
        with pytest.raises(HTTPException) as e:
            guest.size(g, body)
        assert e.value.status_code == 403
    guest.size({"sub": DESK}, SimpleNamespace(paths=10_000))                # an account's cap is the route's own


def test_the_pricing_routes_admit_a_guest_and_no_other_viewer():
    from api.routes.pricer import _may_price, _require_trader
    _may_price({"is_guest": True, "user_metadata": {"role": "viewer"}})
    _may_price({"user_metadata": {"role": "trader"}})
    with pytest.raises(HTTPException):
        _may_price({"user_metadata": {"role": "viewer"}})
    with pytest.raises(HTTPException):
        _require_trader({"is_guest": True, "user_metadata": {"role": "viewer"}})         # the shared helper admits no guest
