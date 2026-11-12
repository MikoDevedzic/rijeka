"""Currency forwards: FX and crypto on one model, the FX canonical record, the pair route."""
import math
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from pricing.curve import Curve
from pricing.currency_forward import price_currency_forward
from pricing.crypto_forward import price_crypto_forward
from chain.canonical import canonical_payload, trade_hash_hex

VAL = date(2026, 10, 28)
SET = date(2027, 1, 28)
OWN = {"lei": "5493001KJTIIGC8Y1R12", "name": "Rijeka Capital LLC"}
CP = {"lei": "549300E9PC51EN656011", "name": "Example Bank AG"}


def _c(r):
    return Curve(valuation_date=VAL, flat_rate=r)


# ── engine ─────────────────────────────────────────────────────────────────

def test_eurusd_is_interest_rate_parity():
    usd, eur = _c(0.04), _c(0.02)
    r = price_currency_forward(base_currency="EUR", quote_currency="USD", base_notional=10_000_000, forward_rate=None,
                               spot=1.1133, valuation_date=VAL, settlement_date=SET, quote_curve=usd, base_curve=eur)
    assert r.forward == pytest.approx(1.1133 * eur.df(SET) / usd.df(SET), rel=1e-12)
    assert r.forward > 1.1133                      # USD rates above EUR: EUR trades at a forward premium
    assert r.npv == pytest.approx(0.0, abs=1e-9)   # dealt at the fair forward
    assert r.forward_points == pytest.approx((r.forward - 1.1133) * 1e4)
    assert r.quote_notional == pytest.approx(10_000_000 * r.forward)


def test_usdjpy_quoting_and_signs():
    jpy, usd = _c(0.005), _c(0.04)
    buy = price_currency_forward(base_currency="USD", quote_currency="JPY", base_notional=1_000_000, forward_rate=150.0,
                                 spot=157.96, valuation_date=VAL, settlement_date=SET, quote_curve=jpy, base_curve=usd,
                                 pip=0.01)
    assert buy.forward < 157.96                    # USD rates above JPY: USD at a forward discount in JPY terms
    assert buy.npv == pytest.approx(1_000_000 * (buy.forward - 150.0) * jpy.df(SET))
    sell = price_currency_forward(base_currency="USD", quote_currency="JPY", base_notional=1_000_000, forward_rate=150.0,
                                  spot=157.96, valuation_date=VAL, settlement_date=SET, quote_curve=jpy, base_curve=usd,
                                  direction="SELL", pip=0.01)
    assert sell.npv == pytest.approx(-buy.npv) and sell.delta_quote_per_pct < 0 < buy.delta_quote_per_pct
    assert buy.forward_points == pytest.approx((buy.forward - 157.96) / 0.01)


def test_rhos_are_finite_differences_with_the_right_signs():
    usd, eur = _c(0.04), _c(0.02)
    r = price_currency_forward(base_currency="EUR", quote_currency="USD", base_notional=1_000_000, forward_rate=1.10,
                               spot=1.1133, valuation_date=VAL, settlement_date=SET, quote_curve=usd, base_curve=eur)
    # long EUR forward: higher EUR rates lower F (loses), higher USD rates raise F (gains, net of discounting)
    assert r.rho_base_per_bp < 0 < r.rho_quote_per_bp
    b = math.exp(-1e-4 * r.t)
    assert r.rho_base_per_bp == pytest.approx(1_000_000 * (r.forward * b - 1.10) * r.df_quote - r.npv)


def test_crypto_wrapper_equals_the_currency_forward():
    usd = _c(0.04)
    c = price_crypto_forward(digital_asset="BTC", notional_amount=2, forward_price=79_000.0, spot=80_604.0,
                             valuation_date=VAL, settlement_date=SET, usd_curve=usd, asset_rate=0.03)
    g = price_currency_forward(base_currency="BTC", quote_currency="USD", base_notional=2, forward_rate=79_000.0,
                               spot=80_604.0, valuation_date=VAL, settlement_date=SET, quote_curve=usd, base_rate=0.03, pip=1.0)
    assert c.forward == pytest.approx(g.forward) and c.npv == pytest.approx(g.npv)
    assert c.delta_asset_units == pytest.approx(g.delta_base_units) and c.rho_usd_per_bp == pytest.approx(g.rho_quote_per_bp)


def test_rejects_both_or_neither_base_discounting():
    with pytest.raises(ValueError):
        price_currency_forward(base_currency="EUR", quote_currency="USD", base_notional=1, forward_rate=None, spot=1.1,
                               valuation_date=VAL, settlement_date=SET, quote_curve=_c(0.04))
    with pytest.raises(ValueError):
        price_currency_forward(base_currency="EUR", quote_currency="USD", base_notional=1, forward_rate=None, spot=1.1,
                               valuation_date=VAL, settlement_date=SET, quote_curve=_c(0.04), base_curve=_c(0.02), base_rate=0.0)


# ── canonical record ───────────────────────────────────────────────────────

def _fx(itype="FX_FORWARD", **over):
    terms = dict(direction="BUY", currency_pair="EURUSD", base_currency="EUR", quote_currency="USD",
                 base_notional="10000000", forward_rate="1.1254", value_date="2027-01-28",
                 settlement_type="DELIVERABLE", calculation_agent=None)
    terms.update(over.pop("terms", {}))
    t = dict(uti="254900OPPU84GM83MG36" + "D" * 32, asset_class="FX", instrument_type=itype, structure="VANILLA",
             notional=Decimal("10000000"), notional_ccy="EUR", trade_date=VAL, effective_date=VAL, maturity_date=SET,
             terms=terms, trade_ref="TRD-FX-1", id=uuid4(), user_id=uuid4())
    t.update(over)
    return t


def test_fx_forward_record_shape_and_both_sides_hash_identically():
    p = canonical_payload(_fx(), [], OWN, CP, version=2)
    assert set(p) == {"schema", "schema_version", "uti", "parties", "trade", "product"}
    pr = p["product"]
    assert pr["product"] == "FX_FORWARD" and (pr["buyer"], pr["seller"]) == (OWN["lei"], CP["lei"])
    assert pr["currency_pair"] == "EURUSD" and pr["forward_rate"] == "1.1254"
    assert pr["quote_notional"] == "11254000"            # derived, so both sides agree the cash
    theirs = dict(_fx(), trade_ref="CB-FX-9", id=uuid4(), user_id=uuid4(),
                  terms=dict(_fx()["terms"], direction="SELL", forward_rate="1.12540"))
    assert trade_hash_hex(canonical_payload(theirs, [], CP, OWN, version=2)) == trade_hash_hex(p)


def test_ndf_needs_fixing_fields_and_spot_is_its_own_product():
    with pytest.raises(ValueError, match="fixing_source"):
        canonical_payload(_fx("NDF", terms={"settlement_type": "NON_DELIVERABLE"}), [], OWN, CP, version=2)
    ok = canonical_payload(_fx("NDF", terms={"currency_pair": "USDBRL", "base_currency": "USD", "quote_currency": "BRL",
                                            "settlement_type": "NON_DELIVERABLE", "settlement_currency": "USD",
                                            "fixing_source": "BCB PTAX", "fixing_date": "2027-01-26", "forward_rate": "5.4321"}),
                           [], OWN, CP, version=2)
    assert ok["product"]["product"] == "FX_NDF" and ok["product"]["fixing_source"] == "BCB PTAX"
    spot = canonical_payload(_fx("FX_SPOT", terms={"value_date": "2026-10-30"}), [], OWN, CP, version=2)
    assert spot["product"]["product"] == "FX_SPOT"
    with pytest.raises(ValueError, match="NON_DELIVERABLE"):
        canonical_payload(_fx("NDF", terms={"settlement_currency": "USD", "fixing_source": "x", "fixing_date": "2027-01-26"}),
                          [], OWN, CP, version=2)
    with pytest.raises(ValueError, match="currency_pair"):
        canonical_payload(_fx(terms={"currency_pair": "USDEUR"}), [], OWN, CP, version=2)


# ── route ──────────────────────────────────────────────────────────────────

def test_pair_route_prices_eurusd_from_snapshots():
    from api.routes import currencies
    import main
    spot_row = MagicMock(valuation_date=VAL, quotes=[{"tenor": "SPOT", "rate": 1.1133}], source="IMPORT")
    db = MagicMock()
    curve_row = MagicMock(valuation_date=VAL, quotes=[{"tenor": "1Y", "rate": 2.0}, {"tenor": "5Y", "rate": 2.2}], source="MANUAL")
    def execute(sql, params=None):
        r = MagicMock(); c = (params or {}).get("c", "")
        r.first.return_value = spot_row if c.endswith("_SPOT") else curve_row if c == "EUR_ESTR" else None
        return r
    db.execute.side_effect = execute
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    from fastapi.testclient import TestClient
    curves = {"USD_SOFR": _c(0.04), "EUR_ESTR": _c(0.02)}
    with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: curves[cid]):
        r = TestClient(main.app).post("/api/currency/forward/price", json={
            "pair": "eurusd", "base_notional": 1_000_000, "settlement_date": SET.isoformat(),
            "valuation_date": VAL.isoformat()})
        s = TestClient(main.app).post("/api/currency/forward/price", json={
            "pair": "EURUSD", "shape": "SPOT", "base_notional": 1_000_000, "valuation_date": VAL.isoformat()})
    main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["pair"] == "EURUSD" and b["base_discounting"] == "EUR_ESTR" and b["spot_source"] == "snapshot 2026-10-28"
    # a quoted FX spot settles on the spot date (Wed 28 Oct -> Fri 30 Oct); the forward carries from there
    sd = date(2026, 10, 30)
    e, u = curves["EUR_ESTR"], curves["USD_SOFR"]
    assert b["forward"] == pytest.approx(1.1133 * (e.df(SET) / e.df(sd)) / (u.df(SET) / u.df(sd)))
    assert s.status_code == 200 and s.json()["settlement_date"] == "2026-10-30"      # Wed 28 Oct → T+2 = Fri 30 Oct


def test_fx_feed_parsing_inverts_usd_based_rates():
    from api.routes import currencies
    class R:
        def raise_for_status(self): pass
        def json(self): return {"base": "USD", "rates": {"EUR": 0.89823, "GBP": 0.75258, "JPY": 157.96, "CHF": 0.83059, "AUD": 1.4219, "CAD": 1.4047}}
    client = MagicMock(); client.__enter__.return_value = client; client.get.return_value = R()
    with patch.object(currencies.httpx, "Client", return_value=client):
        out = currencies.fetch_fx_spot()
    assert out["EURUSD"] == pytest.approx(1 / 0.89823) and out["USDJPY"] == 157.96 and out["AUDUSD"] == pytest.approx(1 / 1.4219)


def test_pair_route_falls_back_to_a_flat_rate_when_the_base_curve_is_missing():
    from api.routes import currencies
    import main
    spot_row = MagicMock(valuation_date=VAL, quotes=[{"tenor": "SPOT", "rate": 1.1133}], source="IMPORT")
    db = MagicMock()
    def execute(sql, params=None):
        r = MagicMock(); c = (params or {}).get("c", "")
        r.first.return_value = spot_row if c.endswith("_SPOT") else None      # no EUR_ESTR, no EUR_FLAT
        return r
    db.execute.side_effect = execute
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    from fastapi.testclient import TestClient
    with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: _c(0.04)):
        r = TestClient(main.app).post("/api/currency/forward/price", json={
            "pair": "EURUSD", "base_notional": 1_000_000, "settlement_date": SET.isoformat(), "valuation_date": VAL.isoformat()})
    main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["base_discounting"].startswith("flat 2.5% (central-bank policy rate")
    assert b["df_base"] == pytest.approx(math.exp(-0.025 * b["t"]))


def test_forward_points_interpolation_and_market_mode():
    from api.routes import currencies
    pts = {"1M": 10.0, "3M": 30.0, "1Y": 120.0}
    assert currencies.interp_points(pts, 0) == 0.0
    assert currencies.interp_points(pts, 15) == pytest.approx(5.0)          # between spot (0) and 1M
    assert currencies.interp_points(pts, 61) == pytest.approx(10 + 20 * (61 - 30) / (91 - 30))   # linear in days 1M→3M
    assert currencies.interp_points(pts, 900) == 120.0                      # flat beyond the last tenor
    # market mode: the outright is spot + points and the basis is reported against parity
    import main
    spot_row = MagicMock(valuation_date=VAL, quotes=[{"tenor": "SPOT", "rate": 1.1133}], source="IMPORT")
    fwd_row  = MagicMock(valuation_date=VAL, quotes=[{"tenor": "1M", "rate": 10.0}, {"tenor": "3M", "rate": 50.0}, {"tenor": "6M", "rate": 90.0}], source="MANUAL")
    curve_row = MagicMock(valuation_date=VAL, quotes=[{"tenor": "1Y", "rate": 2.0}, {"tenor": "5Y", "rate": 2.2}], source="MANUAL")
    db = MagicMock()
    def execute(sql, params=None):
        r = MagicMock(); c = (params or {}).get("c", "")
        r.first.return_value = (spot_row if c.endswith("_SPOT") else fwd_row if c.endswith("_FWD") else
                                curve_row if c == "EUR_ESTR" else None)   # no FX_FORWARD_MODE row → MARKET
        return r
    db.execute.side_effect = execute
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    from fastapi.testclient import TestClient
    curves = {"USD_SOFR": _c(0.04), "EUR_ESTR": _c(0.02)}
    with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: curves[cid]):
        r = TestClient(main.app).post("/api/currency/forward/price", json={
            "pair": "EURUSD", "base_notional": 1_000_000, "settlement_date": SET.isoformat(), "valuation_date": VAL.isoformat()})
    main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    b = r.json()
    days = (SET - date(2026, 10, 30)).days          # forward points are quoted from the spot date (T+2)
    expect_pts = currencies.interp_points({"1M": 10.0, "3M": 50.0, "6M": 90.0}, days)
    assert b["forward_mode"] == "MARKET" and b["market_points"] == pytest.approx(expect_pts)
    assert b["forward"] == pytest.approx(1.1133 + expect_pts * 1e-4)
    assert b["basis_points"] == pytest.approx(expect_pts - b["implied_points"])
    assert b["forward_source"].startswith("market points (EURUSD_FWD")


# ── a forward that fixes before it is paid ─────────────────────────────────

def _fwd(settle, pay=None, k=None, **over):
    kw = dict(base_currency="BTC", quote_currency="USD", base_notional=25, forward_rate=k, spot=104_000.0, valuation_date=VAL,
              settlement_date=settle, quote_curve=_c(0.04), base_curve=_c(0.01), direction="BUY")
    return price_currency_forward(**{**kw, **over}, **({"payment_date": pay} if pay is not None else {}))


def test_no_payment_date_or_the_same_date_changes_nothing():
    plain, same = _fwd(SET, k=100_000.0), _fwd(SET, SET, k=100_000.0)
    for f in ("forward", "npv", "spot01", "ir01", "ir01_disc", "ir01_base", "theta", "df_quote", "df_base", "quote_rate", "forward_points", "delta_base_units"):
        assert getattr(same, f) == getattr(plain, f), f
    assert plain.df_pay == plain.df_quote and plain.t_pay == plain.t


def test_fixed_before_it_is_paid_reads_the_forward_at_the_fixing_and_discounts_from_the_payment():
    fix, pay = date(2026, 12, 29), SET                      # fixes a month before it is paid
    usd, btc = _c(0.04), _c(0.01)
    r = _fwd(fix, pay, k=100_000.0)
    f_fix = 104_000.0 * btc.df(fix) / usd.df(fix)
    assert r.forward == pytest.approx(f_fix, rel=1e-12)                              # the forward of the fixing date, not of the payment date
    assert r.forward != pytest.approx(_fwd(pay, k=100_000.0).forward, rel=1e-6)
    assert r.npv == pytest.approx(25 * (f_fix - 100_000.0) * usd.df(pay), rel=1e-12)  # an amount known at the fixing, paid at the settlement
    assert r.df_quote == pytest.approx(usd.df(fix), rel=1e-12) and r.df_pay == pytest.approx(usd.df(pay), rel=1e-12)
    assert r.t_pay > r.t > 0
    assert r.npv / _fwd(fix, k=100_000.0).npv == pytest.approx(usd.df(pay) / usd.df(fix), rel=1e-12)   # against one paid on its fixing date
    assert _fwd(fix, pay).npv == pytest.approx(0.0, abs=1e-9)                        # dealt at the fair forward of its fixing date
    assert _fwd(fix, pay, k=100_000.0, direction="SELL").npv == pytest.approx(-r.npv, rel=1e-12)
    # the rate sensitivity is the bump of both curves: the forward moves over the time to the fixing, the discount over the time to the payment
    up = price_currency_forward(base_currency="BTC", quote_currency="USD", base_notional=25, forward_rate=100_000.0, spot=104_000.0, valuation_date=VAL,
                                settlement_date=fix, payment_date=pay, quote_curve=_c(0.0401), base_curve=btc, direction="BUY")
    assert r.ir01_disc == pytest.approx(up.npv - r.npv, rel=2e-3)
    # the day before the fixing, tomorrow's value is the amount at today's spot, still to be paid: not nothing
    eve = _fwd(fix, pay, k=100_000.0, valuation_date=date(2026, 12, 28))
    c = Curve(valuation_date=date(2026, 12, 28), flat_rate=0.04)
    eve = _fwd(fix, pay, k=100_000.0, valuation_date=date(2026, 12, 28), quote_curve=c, base_curve=Curve(valuation_date=date(2026, 12, 28), flat_rate=0.01))
    assert eve.npv + eve.theta == pytest.approx(25 * (104_000.0 - 100_000.0) * c.df(pay) / c.df(fix), rel=1e-12)
    assert abs(eve.theta) < 0.01 * abs(eve.npv)


def test_a_payment_before_the_fixing_is_refused():
    with pytest.raises(ValueError):
        _fwd(SET, date(2027, 1, 27), k=100_000.0)
