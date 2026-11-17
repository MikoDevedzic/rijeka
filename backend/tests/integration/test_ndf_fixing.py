"""A currency NDF's fixing, over the API (0.39.0): the ticket reads the forward at the fixing date and pays in the
currency it names; from the fixing date the booked trade is one amount in that currency, on the desk's stored fixing
or, until one is stored, on the stored spot and marked provisional. Amounts are worked here from the terms."""
from datetime import date, timedelta

import pytest

from tests.integration import bodies as B
from tests.integration.conftest import USER_A, _run_tag

pytestmark = pytest.mark.integration
SOURCE = "WM/Reuters 4pm London"
N = 10_000_000          # the notional of bodies.fx_forward


def _quote(client, auth, **over):
    body = {"pair": "EURUSD", "shape": "NDF", "base_notional": N, "direction": "BUY", **over}
    return client.post("/api/currency/forward/price", json=body, headers=auth)


def _forget_fixings():
    """The local test database keeps what an earlier run (or a browser journey) stored: this test starts from a pair
    with no fixing. conftest refuses a hosted database before any test runs."""
    import psycopg2
    from tests.integration.conftest import STACK_URL
    conn = psycopg2.connect(STACK_URL)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("DELETE FROM fixings WHERE pair = 'EURUSD'")
    finally:
        conn.close()


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


def test_an_ndf_fixed_two_days_before_it_settles_is_worth_the_deliverable_forward_in_either_currency(client, auth_a, pairs):
    from api.routes.currencies import ndf_fixing_date, spot_date
    from pricing.calendars import ccy_to_calendar, joint, next_business_day
    spot = pairs["EURUSD"]["spot"]
    settle = next_business_day(date.today() + timedelta(days=92), joint(ccy_to_calendar("EUR"), ccy_to_calendar("USD")))     # a ticket settles on a business day
    # the premise of this test is a settlement date that IS the spot date of its fixing date. After a holiday in one
    # centre it is not (17 November 2026: 17 February 2027 follows Presidents' Day, the fixing's spot date is the
    # 16th, and the fixed rate is the forward to the 16th, not the deliverable forward to the 17th): step past such a day
    while spot_date(ndf_fixing_date(settle, "EUR", "USD"), False, "EUR", "USD") != settle:
        settle = next_business_day(settle + timedelta(days=1), joint(ccy_to_calendar("EUR"), ccy_to_calendar("USD")))
    K = round(spot * 0.98, 4)
    q = lambda **over: _quote(client, auth_a, settlement_date=settle.isoformat(), forward_rate=K, **over)
    base_paid = q(settlement_currency="EUR")
    assert base_paid.status_code == 200, base_paid.text[:300]
    base_paid, quote_paid, unnamed = base_paid.json(), q(settlement_currency="USD").json(), q().json()
    deliverable = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": N, "direction": "BUY",
                                                                   "settlement_date": settle.isoformat(), "forward_rate": K}, headers=auth_a).json()
    fix = ndf_fixing_date(settle, "EUR", "USD")
    assert fix < settle and spot_date(fix, False, "EUR", "USD") <= settle
    assert deliverable["fixing_date"] is None and "settlement_currency" not in deliverable
    # the rate fixed on the fixing date is the spot rate for delivery on the settlement date: the same forward, the
    # same value, whichever of the two currencies the amount is paid in
    for ndf, ccy in ((base_paid, "EUR"), (quote_paid, "USD"), (unnamed, "USD")):
        assert ndf["fixing_date"] == fix.isoformat() and ndf["settlement_currency"] == ccy
        assert ndf["forward"] == deliverable["forward"] and ndf["npv"] == pytest.approx(deliverable["npv"], rel=1e-12)
        assert ndf["npv"] == pytest.approx(N * (ndf["forward"] - K) * ndf["df_quote"], rel=1e-9)        # the one line every reader rebuilds
        assert "deliverable forward" in ndf["model"]

    # a record that fixes a month earlier: the forward is the one for delivery on that fixing's spot date, and the
    # amount is carried from there to the settlement date on the curve of the currency it is paid in
    early = fix - timedelta(days=28)
    lands = spot_date(early, False, "EUR", "USD")
    at_fixing = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": N, "direction": "BUY",
                                                                 "settlement_date": lands.isoformat(), "forward_rate": K}, headers=auth_a).json()
    eur, usd = q(settlement_currency="EUR", fixing_date=early.isoformat()).json(), q(settlement_currency="USD", fixing_date=early.isoformat()).json()
    assert eur["fixing_date"] == usd["fixing_date"] == early.isoformat() and lands.isoformat() in eur["model"]
    assert eur["forward"] == usd["forward"] == at_fixing["forward"] != deliverable["forward"]
    assert eur["npv"] != usd["npv"] and abs(eur["npv"] / usd["npv"] - 1.0) < 5e-3                    # a month of the rate difference
    for ndf in (eur, usd):
        assert ndf["npv"] == pytest.approx(N * (ndf["forward"] - K) * ndf["df_quote"], rel=1e-9)
    assert usd["df_quote"] == pytest.approx(deliverable["df_quote"], rel=1e-12)                       # paid in dollars: discounted from the settlement date
    on_settle = q(fixing_date=settle.isoformat()).json()
    assert on_settle["fixing_date"] is None and on_settle["npv"] == pytest.approx(deliverable["npv"], rel=1e-12)
    bad = q(settlement_currency="GBP")
    assert bad.status_code == 422 and "EUR or USD" in bad.text


def test_a_booked_ndf_becomes_one_amount_in_its_settlement_currency_from_its_fixing_date(client, auth_a, ids, pairs):
    _forget_fixings()
    today = date.today()
    fix, settle = _dates()
    assert fix < today < settle
    spot = pairs["EURUSD"]["spot"]
    K = round(spot * 0.98, 4)
    K_high = round(spot * 1.03, 4)            # a contract rate above the fixing: we pay
    booked = {}
    for ccy, k in (("EUR", K), ("USD", K), ("EUR-pays", K_high)):                # the base currency, the quote currency, and a base amount we owe
        body = B.fx_forward(ids["a"], f"IT-NDFFIX-{ccy}-{_run_tag()}", pairs["EURUSD"], {"forward": k, "settlement_date": settle.isoformat()}, "NDF")
        body["trade_date"] = body["effective_date"] = (fix - timedelta(days=7)).isoformat()
        body["terms"].update(fixing_date=fix.isoformat(), settlement_currency=ccy[:3], fixing_source=SOURCE)
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
        k = K_high if ccy == "EUR-pays" else K
        assert p["state"] == "FIXED" and p["provisional"] is True and p["fixing"] is None and p["fixing_source"] == SOURCE
        assert p["fixing_date"] == fix.isoformat() and p["settlement_currency"] == ccy[:3] and p["crypto"] is False
        px = p["settlement_price"]
        assert px == pytest.approx(spot, rel=0.05)
        assert p["settlement_amount"] == pytest.approx(N * (px - k) / (px if ccy != "USD" else 1.0), rel=1e-9)

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
    # exactly: that many euros delivered on the settlement date, which is a deliverable forward on them at a rate of zero
    owed = price(booked["EUR-pays"])
    assert owed["settlement_amount"] == pytest.approx(N * (V - K_high) / V, rel=1e-12) and owed["settlement_amount"] < 0 and owed["npv"] < 0
    for p in (in_base, owed):
        euros = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": abs(p["settlement_amount"]),
                                                                 "direction": "BUY" if p["settlement_amount"] > 0 else "SELL", "forward_rate": 0.0,
                                                                 "settlement_date": settle.isoformat(), "valuation_date": today.isoformat()}, headers=auth_a).json()
        assert p["npv"] == pytest.approx(euros["npv"], rel=1e-9)
        assert p["npv"] == pytest.approx(p["settlement_amount"] * euros["forward"] * euros["df_quote"], rel=1e-9)
    assert "delivered" in in_base["model"] and "paid" in in_quote["model"]
    # the pair lists the benchmark a desk enters itself, and no feed source
    assert client.get("/api/currency/fixings/EURUSD", headers=auth_a).json()["sources"] == [{"source": SOURCE, "time": "16:00 London", "auto": False}]


def test_the_valuation_pnl_and_risk_run_agrees_with_the_ticket_before_and_after_the_fixing(client, auth_a, ids, pairs):
    """pnl/valuation.value is what P&L, the ladders and VaR price a booked trade with; the ticket goes through
    currencies._price. One NDF that fixes a month early and is paid in euros (the read date before the settlement
    date, the carry on the base curve), and the three fixed ones of the test above."""
    from api.routes.currencies import ndf_fixing_date
    from db.models import Trade
    from db.session import SessionLocal
    from pnl.market import Market
    from pnl.valuation import value
    from pricing.calendars import ccy_to_calendar, joint, next_business_day
    today = date.today()
    spot = pairs["EURUSD"]["spot"]
    K = round(spot * 0.98, 4)
    settle = next_business_day(today + timedelta(days=92), joint(ccy_to_calendar("EUR"), ccy_to_calendar("USD")))
    early = ndf_fixing_date(settle, "EUR", "USD") - timedelta(days=28)
    body = B.fx_forward(ids["a"], f"IT-NDFEARLY-{_run_tag()}", pairs["EURUSD"], {"forward": K, "settlement_date": settle.isoformat()}, "NDF")
    body["terms"].update(fixing_date=early.isoformat(), settlement_currency="EUR", fixing_source=SOURCE)
    r = client.post("/api/book/trade", json=body, headers=auth_a)
    assert r.status_code == 201, r.text[:400]
    tid = r.json()["trade"]["id"]
    quote = _quote(client, auth_a, settlement_date=settle.isoformat(), forward_rate=K, settlement_currency="EUR", fixing_date=early.isoformat(),
                   valuation_date=today.isoformat()).json()
    plain = _quote(client, auth_a, settlement_date=settle.isoformat(), forward_rate=K, settlement_currency="EUR", valuation_date=today.isoformat()).json()
    ticket = client.post("/price", json={"trade_id": tid, "valuation_date": today.isoformat(), "curves": [{"curve_id": "USD_SOFR"}], "states": True}, headers=auth_a).json()
    assert ticket["fixing_date"] == early.isoformat() and ticket["npv"] == pytest.approx(quote["npv"], rel=1e-9) and quote["npv"] != plain["npv"]
    db = SessionLocal()
    try:
        v = value(db, {"sub": USER_A}, db.query(Trade).filter(Trade.id == tid).first(), today, Market(db, USER_A, today))
        assert v["npv"] == pytest.approx(quote["npv"], rel=1e-9) and v["spot01"] == pytest.approx(quote["spot01"], rel=1e-9)
        assert v["ir01"] == pytest.approx(quote["ir01"], rel=1e-9) and not v.get("settled") and "settlement_amount" not in v
        # the fixed ones: the same amount and value the ticket shows; a euro amount still moves 1 % for 1 % of spot, a dollar amount does not
        fixed = db.query(Trade).filter(Trade.user_id == USER_A, Trade.trade_ref.like("IT-NDFFIX-%")).order_by(Trade.created_at.desc()).limit(3).all()
        assert len(fixed) == 3
        for t in fixed:
            shown = client.post("/price", json={"trade_id": str(t.id), "valuation_date": today.isoformat(), "curves": [{"curve_id": "USD_SOFR"}], "states": True}, headers=auth_a).json()
            v = value(db, {"sub": USER_A}, t, today, Market(db, USER_A, today))
            assert v["npv"] == pytest.approx(shown["npv"], rel=1e-9) and v["settlement_amount"] == pytest.approx(shown["settlement_amount"], rel=1e-12)
            assert v["settlement_currency"] == shown["settlement_currency"] and v["provisional"] is False
            if shown["settlement_currency"] == "EUR":
                assert v["spot01"] == pytest.approx(0.01 * v["npv"], rel=1e-9) and v["npv"] * shown["settlement_amount"] > 0
            else:
                assert v["spot01"] == 0.0
    finally:
        db.close()
