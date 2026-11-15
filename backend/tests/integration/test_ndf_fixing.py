"""A currency NDF's fixing, over the API (0.39.0): the ticket reads the forward at the fixing date and pays in the
currency it names; from the fixing date the booked trade is one amount in that currency, on the desk's stored fixing
or, until one is stored, on the stored spot and marked provisional. Amounts are worked here from the terms."""
from datetime import date, timedelta

import pytest

from tests.integration import bodies as B
from tests.integration.conftest import _run_tag

pytestmark = pytest.mark.integration
SOURCE = "WM/Reuters 4pm London"
N = 10_000_000          # the notional of bodies.fx_forward


def _quote(client, auth, **over):
    body = {"pair": "EURUSD", "shape": "NDF", "base_notional": N, "direction": "BUY", **over}
    return client.post("/api/currency/forward/price", json=body, headers=auth)


def _dates():
    """(fixing date, settlement date): the latest business day before today, and its spot date, so the fixing can be
    entered (never a future date) while the settlement date is still ahead."""
    from api.routes.currencies import spot_date
    from pricing.calendars import ccy_to_calendar, is_business_day, joint
    both = joint(ccy_to_calendar("EUR"), ccy_to_calendar("USD"))
    fix = date.today() - timedelta(days=1)
    while not is_business_day(fix, both):
        fix -= timedelta(days=1)
    return fix, spot_date(fix, False, "EUR", "USD")


def test_the_ticket_reads_an_ndf_at_its_fixing_date_and_in_its_settlement_currency(client, auth_a, pairs):
    from api.routes.currencies import ndf_fixing_date
    spot = pairs["EURUSD"]["spot"]
    settle = date.today() + timedelta(days=92)
    K = round(spot * 0.98, 4)
    base_paid = _quote(client, auth_a, settlement_date=settle.isoformat(), forward_rate=K, settlement_currency="EUR")       # paid in the base currency
    assert base_paid.status_code == 200, base_paid.text[:300]
    base_paid = base_paid.json()
    fix = ndf_fixing_date(settle, "EUR", "USD")
    assert fix < settle and base_paid["fixing_date"] == fix.isoformat() and base_paid["settlement_currency"] == "EUR"
    quote_paid = _quote(client, auth_a, settlement_date=settle.isoformat(), forward_rate=K).json()                # no currency named: the quote currency
    assert quote_paid["settlement_currency"] == "USD" and quote_paid["fixing_date"] == fix.isoformat() and quote_paid["forward"] == base_paid["forward"]
    # the two differ only by the carry of the amount from the fixing date to the settlement date, on one curve or the other
    assert base_paid["npv"] != quote_paid["npv"] and abs(base_paid["npv"] / quote_paid["npv"] - 1.0) < 5e-4
    for q in (base_paid, quote_paid):                                             # the one line every reader rebuilds
        assert q["npv"] == pytest.approx(N * (q["forward"] - K) * q["df_quote"], rel=1e-9)
    named = _quote(client, auth_a, settlement_date=settle.isoformat(), forward_rate=K, fixing_date=settle.isoformat()).json()
    assert named["fixing_date"] is None                              # a fixing date on the settlement date: read and paid on one date
    deliverable = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": N, "direction": "BUY",
                                                                   "settlement_date": settle.isoformat(), "forward_rate": K}, headers=auth_a).json()
    assert deliverable["fixing_date"] is None and "settlement_currency" not in deliverable and deliverable["npv"] == named["npv"]
    bad = _quote(client, auth_a, settlement_date=settle.isoformat(), settlement_currency="GBP")
    assert bad.status_code == 422 and "EUR or USD" in bad.text


def test_a_booked_ndf_becomes_one_amount_in_its_settlement_currency_from_its_fixing_date(client, auth_a, ids, pairs):
    today = date.today()
    fix, settle = _dates()
    assert fix < today < settle
    spot = pairs["EURUSD"]["spot"]
    K = round(spot * 0.98, 4)
    booked = {}
    for ccy in ("EUR", "USD"):                # the base currency, the quote currency
        body = B.fx_forward(ids["a"], f"IT-NDFFIX-{ccy}-{_run_tag()}", pairs["EURUSD"], {"forward": K, "settlement_date": settle.isoformat()}, "NDF")
        body["trade_date"] = body["effective_date"] = (fix - timedelta(days=7)).isoformat()
        body["terms"].update(fixing_date=fix.isoformat(), settlement_currency=ccy, fixing_source=SOURCE)
        r = client.post("/api/book/trade", json=body, headers=auth_a)
        assert r.status_code == 201, r.text[:400]
        booked[ccy] = r.json()["trade"]["id"]

    def price(tid):
        r = client.post("/price", json={"trade_id": tid, "valuation_date": today.isoformat(), "curves": [{"curve_id": "USD_SOFR"}], "states": True}, headers=auth_a)
        assert r.status_code == 200, r.text[:400]
        return r.json()

    # no fixing stored: the stored spot of the fixing date, and the answer says it is provisional
    for ccy, tid in booked.items():
        p = price(tid)
        assert p["state"] == "FIXED" and p["provisional"] is True and p["fixing"] is None and p["fixing_source"] == SOURCE
        assert p["fixing_date"] == fix.isoformat() and p["settlement_currency"] == ccy and p["crypto"] is False
        px = p["settlement_price"]
        assert px == pytest.approx(spot, rel=0.05)
        assert p["settlement_amount"] == pytest.approx(N * (px - K) / (px if ccy == "EUR" else 1.0), rel=1e-9)

    # the desk enters the fixing of the source the record names: the amount is that fixing's, and final
    V = round(spot * 1.01, 4)
    saved = client.post("/api/currency/fixings", json={"pair": "EURUSD", "fixing_date": fix.isoformat(), "source": SOURCE, "value": V}, headers=auth_a)
    assert saved.status_code == 200, saved.text[:300]
    assert any(x["date"] == fix.isoformat() and x["source"] == SOURCE and x["value"] == V and x["own"] for x in saved.json()["fixings"])
    in_base, in_quote = price(booked["EUR"]), price(booked["USD"])            # named for the pattern: the base-currency one, the quote-currency one
    for p in (in_base, in_quote):
        assert p["state"] == "FIXED" and p["provisional"] is False and p["fixing"]["value"] == V and p["settlement_price"] == V
    assert in_base["settlement_amount"] == pytest.approx(N * (V - K) / V, rel=1e-12)          # base currency: converted at the fixing
    assert in_quote["settlement_amount"] == pytest.approx(N * (V - K), rel=1e-12)                  # quote currency
    # the quote-currency amount is discounted a few days on its curve; the base-currency amount is still base currency, worth spot each
    assert in_quote["npv"] == pytest.approx(in_quote["settlement_amount"], rel=2e-3)
    assert in_base["npv"] == pytest.approx(in_base["settlement_amount"] * spot, rel=1e-2)
    assert "delivered" in in_base["model"] and "paid" in in_quote["model"]
    # the pair lists the benchmark a desk enters itself, and no feed source
    assert client.get("/api/currency/fixings/EURUSD", headers=auth_a).json()["sources"] == [{"source": SOURCE, "time": "16:00 London", "auto": False}]
