"""A digital-asset forward that fixes before it is paid, over the API: the forward is read at the fixing date and the
amount is discounted from the settlement date (0.26.0). No fixing date, or one on the settlement date, is the price
it always was."""
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.integration

ASOF = date(2026, 11, 2)               # the stack's market (backend/stack/seed.py)
SETTLE = ASOF + timedelta(days=120)


def _price(client, auth, **over):
    body = {"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY", "settlement_date": SETTLE.isoformat(), "forward_rate": 100_000, **over}
    return client.post("/api/currency/forward/price", json=body, headers=auth)


def test_a_forward_is_read_at_its_fixing_date_and_discounted_from_its_settlement_date(client, auth_a):
    plain = _price(client, auth_a)
    assert plain.status_code == 200, plain.text[:300]
    plain = plain.json()
    assert plain["fixing_date"] is None and "fixing date" not in plain["model"]
    same = _price(client, auth_a, fixing_date=SETTLE.isoformat()).json()
    assert {k: same[k] for k in ("forward", "npv", "spot01", "ir01", "theta", "fixing_date", "model")} == {k: plain[k] for k in ("forward", "npv", "spot01", "ir01", "theta", "fixing_date", "model")}

    fix = SETTLE - timedelta(days=30)
    early = _price(client, auth_a, fixing_date=fix.isoformat())
    assert early.status_code == 200, early.text[:300]
    early = early.json()
    at_fix = _price(client, auth_a, settlement_date=fix.isoformat()).json()          # the forward that fixes and settles on the fixing date
    assert early["fixing_date"] == fix.isoformat() and early["settlement_date"] == SETTLE.isoformat()
    assert f"read at the fixing date ({fix.isoformat()})" in early["model"] and SETTLE.isoformat() in early["model"]
    assert early["forward"] == pytest.approx(at_fix["forward"], rel=1e-12) and early["forward"] != pytest.approx(plain["forward"], rel=1e-5)
    # the same amount, paid thirty days later: smaller by the discounting between the two dates, and by nothing else
    ratio = early["npv"] / at_fix["npv"]
    assert ratio == pytest.approx(plain["df_quote"] / at_fix["df_quote"], rel=1e-9) and 0.99 < ratio < 1.0
    # what the answer calls df_quote is the factor its NPV is discounted with (to the settlement date): every screen
    # rebuilds N (F - K) df_quote. The factor to the fixing date is beside it, and so are the two times
    assert early["df_quote"] == plain["df_quote"] and early["df_fixing"] == at_fix["df_quote"] and plain["df_fixing"] is None
    assert early["npv"] == pytest.approx(10 * (early["forward"] - 100_000) * early["df_quote"], rel=1e-12)
    assert early["t_pay"] == plain["t"] and early["t"] == at_fix["t"] and plain["t_pay"] == plain["t"]
    # dealt at the fair forward of its fixing date it is worth nothing
    fair = _price(client, auth_a, fixing_date=fix.isoformat(), forward_rate=None).json()
    assert fair["npv"] == pytest.approx(0.0, abs=1e-6) and fair["forward_rate"] == pytest.approx(early["forward"], rel=1e-12)

    # a fixing date after the settlement date is refused; one on or before the valuation date is priced to the settlement date
    late = _price(client, auth_a, fixing_date=(SETTLE + timedelta(days=1)).isoformat())
    assert late.status_code == 422 and "cannot be after the settlement date" in late.text
    past = _price(client, auth_a, fixing_date=ASOF.isoformat()).json()
    assert past["fixing_date"] is None and past["npv"] == plain["npv"]


def test_an_xva_run_on_such_a_forward_starts_from_the_tickets_value_and_runs_to_the_payment(client, auth_a):
    fix = SETTLE - timedelta(days=30)
    ticket = _price(client, auth_a, fixing_date=fix.isoformat(), valuation_date=ASOF.isoformat()).json()
    body = {"pair": "BTCUSD", "base_notional": 10, "direction": "BUY", "settlement_date": SETTLE.isoformat(), "forward_rate": 100_000,
            "valuation_date": ASOF.isoformat(), "paths": 400}
    plain = client.post("/api/xva/currency", json=body, headers=auth_a)
    early = client.post("/api/xva/currency", json={**body, "fixing_date": fix.isoformat()}, headers=auth_a)
    assert plain.status_code == 200 and early.status_code == 200, (plain.text[:300], early.text[:300])
    plain, early = plain.json(), early.json()
    assert early["xva"]["npv"] == pytest.approx(ticket["npv"], abs=0.006)             # the run starts from the ticket's own value, to the cent
    assert abs(plain["xva"]["npv"] - ticket["npv"]) > 1.0                             # which a run without the fixing date does not
    assert early["steps"] == plain["steps"] and len(early["ee"]) == len(plain["ee"])  # exposed until it is paid: the same dates
    assert early["xva"]["cva"] == pytest.approx(plain["xva"]["cva"], rel=0.05)        # and nearly the same charge: the carry over thirty days


def test_a_package_prices_each_forward_leg_to_its_fixing_date_as_the_ticket_does(client, auth_a, ids, pairs):
    """A strip dealt at the fair forward of each leg's fixing date is worth nothing on the ticket, and nothing at the
    start of its XVA run. Until 0.30.3 the package's run carried each leg to its settlement date and reported a
    value the ticket's own footer did not: two days of carry a leg, a few tens of dollars on 10 BTC. (The larger
    figure of that release, 5 and 10 bp, was the ticket's: each leg struck at the first leg's forward.)"""
    from tests.integration import bodies as B
    btc = pairs["BTCUSD"]
    legs, fair = [], []
    for n, days in enumerate((92, 122, 153), start=1):
        settle = ASOF + timedelta(days=days)
        fix = settle - timedelta(days=2)
        q = _price(client, auth_a, settlement_date=settle.isoformat(), fixing_date=fix.isoformat(), forward_rate=None)
        assert q.status_code == 200, q.text[:300]
        q = q.json()
        assert q["npv"] == pytest.approx(0.0, abs=1e-6)
        body = B.crypto_forward(ids["a"], f"PKG-FIX-{n}", btc, q)
        body["terms"]["valuation_date"] = fix.isoformat()                 # the record's Valuation Date is the fixing date
        legs.append(body)
        fair.append(q)
    r = client.post("/api/xva/currency-package", json={"trades": legs, "paths": 300}, headers=auth_a)
    assert r.status_code == 200, r.text[:500]
    j = r.json()
    assert [x["npv"] for x in j["legs"]] == pytest.approx([0.0, 0.0, 0.0], abs=0.02)
    assert j["xva"]["npv"] == pytest.approx(0.0, abs=0.05)
    # and carried to the settlement dates the same legs are not worth nothing: the difference this test is about
    for body, q in zip(legs, fair):
        body["terms"]["valuation_date"] = q["settlement_date"]
    late = client.post("/api/xva/currency-package", json={"trades": legs, "paths": 300}, headers=auth_a).json()
    # two days of carry a leg on the stack's market: 40, 38 and 32 on 12 November 2026
    assert all(15.0 < x["npv"] < 90.0 for x in late["legs"]) and late["xva"]["npv"] == pytest.approx(sum(x["npv"] for x in late["legs"]), abs=0.05)
    # one leg of a package is the ticket's own run with that fixing date
    legs[0]["terms"]["valuation_date"] = (ASOF + timedelta(days=90)).isoformat()
    one = client.post("/api/xva/currency", json={"pair": "BTCUSD", "base_notional": 10, "settlement_date": fair[0]["settlement_date"], "forward_rate": fair[0]["forward"],
                                                  "direction": "BUY", "paths": 300, "fixing_date": (ASOF + timedelta(days=90)).isoformat()}, headers=auth_a)
    pkg = client.post("/api/xva/currency-package", json={"trades": legs[:1], "paths": 300}, headers=auth_a)
    assert one.status_code == 200 and pkg.status_code == 200, (one.text[:300], pkg.text[:300])
    assert pkg.json()["xva"] == one.json()["xva"]
