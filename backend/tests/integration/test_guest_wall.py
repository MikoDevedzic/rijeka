"""Every route of the running API, called with a guest's pass (middleware/guest.py).

A guest is let through to the routes on `guest.ALLOWED` and to nothing else that takes a sign-in. The walk is over
the API's own list of routes, so a route added tomorrow is in it: it refuses a guest, or it is put on the list on
purpose, or (taking no sign-in at all) it is named in PUBLIC below. Then the three things a guest is for: a price,
an XVA run, and a refusal to book."""
from __future__ import annotations

import re

import pytest

from tests.integration.conftest import EMAIL_A

pytestmark = pytest.mark.integration

SECRET = "an-integration-test-secret-of-more-than-32-bytes"

# Routes that take no sign-in: what they answer does not depend on who asks. A new one is added here on purpose.
PUBLIC_PREFIXES = ("/api/public/", "/health", "/api/ops/health", "/api/ops/client-error", "/api/ops/csp-report", "/api/csp/",
                   "/api/telegram/webhook", "/api/news/", "/api/usage/")
# Routes the scheduler calls with the cron secret, and one list of names that is the same for everybody. None reads a
# sign-in before it answers, so a pass changes nothing about them; each is here by name so that a new one is a decision.
NO_SIGN_IN = frozenset({
    ("POST", "/api/ccr/daily/tick"), ("POST", "/api/crypto/spot/tick"), ("POST", "/api/currency/spot/tick"),
    ("POST", "/api/market-data/demo/crypto/tick"), ("POST", "/api/market-data/demo/fixings/tick"), ("POST", "/api/market-data/demo/tick"),
    ("POST", "/api/pnl/eod/tick"), ("POST", "/api/risk/daily/tick"), ("POST", "/api/risk/history/ingest"),
    ("GET", "/api/bloomberg/cap-vol/tickers"),
})


@pytest.fixture
def guest(stack, monkeypatch):
    from middleware import guest as g
    monkeypatch.setenv("RIJEKA_GUEST_SECRET", SECRET)
    monkeypatch.setenv("RIJEKA_GUEST_EMAIL", EMAIL_A)            # the stack's template account stands in for the guest desk
    g.forget_account()
    yield g
    g.forget_account()


@pytest.fixture
def pass_(guest) -> dict:
    return {"Authorization": f"Bearer {guest.mint()[0]}"}


def _routes(client) -> list[tuple[str, str]]:
    paths = client.app.openapi()["paths"]
    return sorted((m.upper(), p) for p, ms in paths.items() for m in ms if m in ("get", "post", "put", "patch", "delete"))


def _url(template: str) -> str:
    return re.sub(r"\{[^}]+\}", "00000000-0000-4000-8000-000000000000", template)


def test_the_door_gives_a_pass_and_says_whether_guests_are_taken(client, guest, monkeypatch):
    assert client.get("/api/public/guest").json() == {"enabled": True}
    r = client.post("/api/public/guest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert guest.is_pass("Bearer " + body["token"]) and body["expires_at"] > 0
    monkeypatch.delenv("RIJEKA_GUEST_EMAIL"); guest.forget_account()           # the guest desk is not named: guests are off
    assert client.get("/api/public/guest").json() == {"enabled": False}
    assert client.post("/api/public/guest").status_code == 404
    monkeypatch.setenv("RIJEKA_GUEST_EMAIL", EMAIL_A); monkeypatch.delenv("RIJEKA_GUEST_SECRET"); guest.forget_account()
    own = client.post("/api/public/guest")                                      # no secret set: the process's own signs the pass
    assert own.status_code == 200 and client.get("/api/modules", headers={"Authorization": "Bearer " + own.json()["token"]}).status_code == 200
    monkeypatch.setenv("RIJEKA_GUEST_EMAIL", "nobody-of-this-name@rijeka.test"); guest.forget_account()
    assert client.post("/api/public/guest").status_code == 503       # the settings are there, the desk's account is not
    assert client.get("/api/public/guest").json() == {"enabled": False}      # and the door is not told to offer a way in that fails


def test_every_route_refuses_a_guest_unless_it_is_on_the_list(client, guest, pass_):
    routes = _routes(client)
    assert len(routes) > 200
    missing = [r for r in guest.ALLOWED if r not in routes]
    assert not missing, f"on the guest's list and not a route of the API: {missing}"
    let_through, unprotected = [], []
    for method, template in routes:
        url = _url(template)
        if (method, template) in guest.ALLOWED:
            r = client.request(method, url, headers=pass_, json={} if method != "GET" else None)
            assert not (r.status_code == 403 and guest.ASK in r.text), f"allowed and refused: {method} {template}"
            continue
        r = client.request(method, url, headers=pass_, json={} if method != "GET" else None)
        if r.status_code == 403 and guest.ASK in r.text:
            continue
        if template.startswith(PUBLIC_PREFIXES):
            continue
        if (method, template) in NO_SIGN_IN:
            assert r.status_code in (200, 401, 403), f"{method} {template} -> {r.status_code}"
            continue
        bare = client.request(method, url, json={} if method != "GET" else None)
        (unprotected if bare.status_code == r.status_code else let_through).append(f"{method} {template} -> {r.status_code} (no sign-in: {bare.status_code})")
    assert not let_through, "a guest got further than the wall on:\n" + "\n".join(let_through)
    assert not unprotected, "takes no sign-in and is not named as public:\n" + "\n".join(unprotected)


def test_the_named_routes_are_refused_by_name(client, guest, pass_):
    routes = _routes(client)
    for method, template in sorted(guest.NEVER):
        assert (method, template) in routes, f"NEVER names a route the API does not have: {method} {template}"
        r = client.request(method, _url(template), headers=pass_, json={} if method != "GET" else None)
        assert r.status_code == 403 and guest.ASK in r.text, f"{method} {template} -> {r.status_code}"


def test_a_guest_prices_a_swap_runs_its_xva_and_cannot_book_it(client, guest, pass_, auth_a):
    from tests.integration.test_scenario_shifts import ASOF, _legs
    body = {"legs": _legs(0.0375), "valuation_date": ASOF, "curves": [{"curve_id": "USD_SOFR", "quotes": []}]}
    mine = client.post("/price/preview", headers=auth_a, json=body)
    theirs = client.post("/price/preview", headers=pass_, json=body)
    assert mine.status_code == 200 and theirs.status_code == 200, (mine.text[:200], theirs.text[:200])
    assert theirs.json()["npv"] == mine.json()["npv"]                 # the guest desk's market data is the account's own
    x = client.post("/api/xva/simulate", headers=pass_, json={"notional": 10_000_000, "maturity_y": 5, "fixed_rate": 0.04, "paths": 500})
    assert x.status_code == 200, x.text[:300]
    big = client.post("/api/xva/simulate", headers=pass_, json={"notional": 10_000_000, "maturity_y": 5, "fixed_rate": 0.04, "paths": 5000})
    assert big.status_code == 403 and "2,000 paths" in big.text
    health = client.get("/api/ops/health").json()["guest"]
    assert health["named"] is True and health["desk"] is True and health["address_from"] in ("proxy", "cf-connecting-ip")
    for method, url in (("POST", "/api/book/trade"), ("POST", "/api/trades/"), ("PUT", "/api/me/role"), ("POST", "/api/analyse/"),
                        ("POST", "/api/xva/calibrate"), ("GET", "/api/trades/"), ("POST", "/api/demo/provision")):
        r = client.request(method, url, headers=pass_, json={} if method != "GET" else None)
        assert r.status_code == 403 and guest.ASK in r.text, (method, url, r.status_code)


def test_guests_are_counted_for_the_operator_as_people_who_came_and_people_who_pressed_price(client, guest, auth_a):
    """The usage panel's two columns: recorded by the API when it gives a pass, and when the app says with that pass
    that its guest pressed PRICE. A pricing request alone is not a count: the ticket prices as it is typed."""
    import sqlalchemy as sa
    from tests.integration.conftest import STACK_URL, USER_A, set_role
    from tests.integration.test_scenario_shifts import ASOF, _legs
    eng = sa.create_engine(STACK_URL)
    body = {"legs": _legs(0.0375), "valuation_date": ASOF, "curves": [{"curve_id": "USD_SOFR", "quotes": []}]}
    def rows():
        with eng.connect() as c:
            return dict(c.execute(sa.text("SELECT event, count(*) FROM usage_hits WHERE event LIKE 'guest_%' AND at >= now() - interval '5 minutes' GROUP BY 1")).all())
    def activity():
        with eng.connect() as c:
            return c.execute(sa.text("SELECT count(*) FROM activity_daily")).scalar()
    try:
        with eng.begin() as c:
            c.execute(sa.text("DELETE FROM usage_hits WHERE event LIKE 'guest_%'"))
        ua = {"User-Agent": "one browser"}
        first = {**ua, "Authorization": "Bearer " + client.post("/api/public/guest", headers=ua).json()["token"]}
        again = {**ua, "Authorization": "Bearer " + client.post("/api/public/guest", headers=ua).json()["token"]}      # the same person, a new pass
        assert rows() == {"guest_entered": 2}
        for h in (first, first, again):
            assert client.post("/price/preview", headers=h, json=body).status_code == 200
        assert rows() == {"guest_entered": 2}                                              # pricing is not PRICE pressed
        kept = activity()
        said = {"event": "priced", "detail": "rates"}
        for h in (first, first, again):
            r = client.post("/api/me/activity", headers=h, json=said)
            assert r.status_code == 202 and r.json() == {"accepted": True}
        assert rows() == {"guest_entered": 2, "guest_priced": 2}                           # once for each pass, not for each press
        for other in ({"event": "view", "route": "/blotter"}, {"event": "priced", "detail": "not-an-asset"}, {"event": "booked"}):
            assert client.post("/api/me/activity", headers=first, json=other).json() == {"accepted": False}
        assert rows() == {"guest_entered": 2, "guest_priced": 2}
        from activity import store
        store.flush() if hasattr(store, "flush") else None
        assert activity() == kept                                                          # nothing of a guest's on the guest desk's record
        refused = client.post("/api/public/hit", json={"event": "guest_entered", "route": "/guest"})
        assert refused.json() == {"accepted": False}                                       # the beacon cannot say a guest came
        set_role(USER_A, "admin")
        out = client.get("/api/ops/usage", headers=auth_a).json()
        today = out["series"][-1]
        assert today["guests"] == 1 and today["guests_priced"] == 1                        # one person, however many passes
        assert out["totals"]["guests"] >= 1 and "pressed PRICE" in out["note"]
    finally:
        set_role(USER_A, "trader"); guest.forget_account()
        with eng.begin() as c:
            c.execute(sa.text("DELETE FROM usage_hits WHERE event LIKE 'guest_%'"))
        eng.dispose()


def test_a_guest_leaves_no_row_and_is_no_account(client, guest, pass_):
    import sqlalchemy as sa
    from tests.integration.conftest import STACK_URL
    eng = sa.create_engine(STACK_URL)
    counted = ("xva_calibration", "market_data_snapshots", "cashflows", "trades", "profiles", "idempotency_keys")
    def counts():
        with eng.connect() as c:
            return {t: c.execute(sa.text(f"SELECT count(*) FROM {t}")).scalar() for t in counted}
    try:
        before = counts()
        for method, template in sorted(guest.ALLOWED):
            if method == "GET":
                client.get(_url(template), headers=pass_)
        client.post("/api/xva/simulate", headers=pass_, json={"notional": 10_000_000, "maturity_y": 3, "fixed_rate": 0.04, "paths": 300})
        assert counts() == before
        role = client.get("/api/me/role", headers=pass_).json()
        assert role["role"] == "viewer" and role["self_service"] is False and role["roles"] == []         # the desk's owner is a trader: a guest is not
        assert client.get("/api/me/booking-defaults", headers=pass_).json()["role"] == "viewer"
        mods = client.get("/api/modules", headers=pass_).json()
        assert mods["guest"] is True and mods["can_edit"] is False and mods["firm_id"] is None and mods["events"] == []
        assert {k for k, on in mods["modules"].items() if on} == {"XVA", "CHAIN_CONFIRM"}
    finally:
        eng.dispose()


def test_an_administrator_is_never_the_guest_desk(client, guest):
    from tests.integration.conftest import USER_A, set_role
    try:
        set_role(USER_A, "admin"); guest.forget_account()
        assert guest.account_id() is None
        assert client.post("/api/public/guest").status_code == 503
        assert client.get("/api/public/guest").json() == {"enabled": False}
    finally:
        set_role(USER_A, "trader"); guest.forget_account()
    assert guest.account_id() == USER_A
