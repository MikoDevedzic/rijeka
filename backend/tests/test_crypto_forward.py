"""CRYPTO_FORWARD: parity with the methodology workbook, signs, the preview route."""
import math
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from pricing.curve import Curve
from pricing.crypto_forward import price_crypto_forward, fair_forward, year_fraction

VAL = date(2026, 10, 28)
SET = date(2027, 1, 28)


def _curve(r=0.04):
    return Curve(valuation_date=VAL, flat_rate=r)


def test_forward_matches_methodology_formula():
    # methodology/replicate._ref_forward: F = S * exp(-r_btc * t) / DF_USD(T), t = days/365 (cash-and-carry)
    c = _curve(0.04)
    res = price_crypto_forward(digital_asset="BTC", notional_amount=10, forward_price=None, spot=65_000.0,
                               valuation_date=VAL, settlement_date=SET, usd_curve=c, asset_rate=0.03)
    t = (SET - VAL).days / 365
    expected = 65_000.0 * math.exp(-0.03 * t) / c.df(SET)
    assert res.forward == pytest.approx(expected, rel=1e-12)
    assert res.t == pytest.approx(t)
    assert res.forward_price == res.forward                     # omitted K = at the fair forward
    assert res.npv == pytest.approx(0.0, abs=1e-9)             # ... so the day-one NPV is zero


def test_signs_and_discounting():
    c = _curve(0.04)
    K = 60_000.0
    buy = price_crypto_forward(digital_asset="ETH", notional_amount=100, forward_price=K, spot=65_000.0,
                               valuation_date=VAL, settlement_date=SET, usd_curve=c, direction="BUY")
    sell = price_crypto_forward(digital_asset="ETH", notional_amount=100, forward_price=K, spot=65_000.0,
                                valuation_date=VAL, settlement_date=SET, usd_curve=c, direction="SELL")
    assert buy.npv == pytest.approx(100 * (buy.forward - K) * c.df(SET))
    assert buy.npv > 0 and sell.npv == pytest.approx(-buy.npv)
    assert buy.delta_usd_per_pct > 0 and sell.delta_usd_per_pct < 0
    assert buy.delta_asset_units == pytest.approx(100 * c.df(SET) * buy.forward / 65_000.0)
    # a higher asset funding rate lowers the forward (holding the asset earns more)
    hi = price_crypto_forward(digital_asset="ETH", notional_amount=100, forward_price=K, spot=65_000.0,
                              valuation_date=VAL, settlement_date=SET, usd_curve=c, asset_rate=0.10)
    assert hi.forward < buy.forward
    assert buy.implied_basis == pytest.approx((buy.forward / 65_000.0 - 1) / buy.t)


def test_rho_is_a_finite_difference_of_the_same_formula():
    c = _curve(0.04)
    res = price_crypto_forward(digital_asset="BTC", notional_amount=1, forward_price=50_000.0, spot=65_000.0,
                               valuation_date=VAL, settlement_date=SET, usd_curve=c)
    b = math.exp(-1e-4 * res.t)
    assert res.rho_usd_per_bp == pytest.approx((res.forward / b - 50_000.0) * res.df_usd * b - res.npv)


@pytest.mark.parametrize("bad", [dict(notional_amount=0), dict(spot=0), dict(direction="LONG"),
                                 dict(settlement_date=VAL)])
def test_rejects_bad_inputs(bad):
    kw = dict(digital_asset="BTC", notional_amount=1, forward_price=None, spot=65_000.0, valuation_date=VAL,
              settlement_date=SET, usd_curve=_curve())
    kw.update(bad)
    with pytest.raises(ValueError):
        price_crypto_forward(**kw)


def _db_with(spot_row=None, fund_row=None):
    db = MagicMock()
    def execute(sql, params=None):
        r = MagicMock()
        cid = (params or {}).get("c", "")
        r.first.return_value = spot_row if cid.endswith("_SPOT") else fund_row if cid.endswith("_FUNDING") else None
        return r
    db.execute.side_effect = execute
    return db


def test_preview_route_reports_input_sources():
    from api.routes import crypto
    import main
    spot_row = MagicMock(valuation_date=date(2026, 10, 28), quotes=[{"tenor": "SPOT", "rate": 80_000.0}], source="IMPORT")
    db = _db_with(spot_row=spot_row, fund_row=None)
    main.app.dependency_overrides[crypto.get_db] = lambda: db
    main.app.dependency_overrides[crypto.verify_token] = lambda: {"sub": "11111111-1111-1111-1111-111111111111",
                                                                  "user_metadata": {"role": "trader"}}
    from fastapi.testclient import TestClient
    with patch.object(crypto, "_usd_curve", return_value=_curve(0.04)):
        r = TestClient(main.app).post("/api/crypto/forward/price", json={
            "digital_asset": "btc", "notional_amount": 2, "settlement_date": SET.isoformat(),
            "valuation_date": VAL.isoformat(), "direction": "SELL"})
    main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["digital_asset"] == "BTC" and b["spot"] == 80_000.0
    assert b["spot_source"].startswith("snapshot 2026-10-28") and b["asset_rate_source"] == "default 0%"
    assert b["npv"] == pytest.approx(0.0, abs=1e-6) and b["forward"] > 80_000.0   # positive USD carry, zero funding


def test_preview_route_needs_a_spot():
    from api.routes import crypto
    import main
    db = _db_with(spot_row=None)
    main.app.dependency_overrides[crypto.get_db] = lambda: db
    main.app.dependency_overrides[crypto.verify_token] = lambda: {"sub": "11111111-1111-1111-1111-111111111111",
                                                                  "user_metadata": {"role": "trader"}}
    from fastapi.testclient import TestClient
    r = TestClient(main.app).post("/api/crypto/forward/price", json={
        "digital_asset": "ETH", "notional_amount": 2, "settlement_date": SET.isoformat()})
    main.app.dependency_overrides.clear()
    assert r.status_code == 422 and "spot" in r.json()["detail"].lower()


def test_spot_fetch_parses_coinbase_payload():
    from api.routes import crypto
    class R:
        def __init__(self, amt): self._a = amt
        def raise_for_status(self): pass
        def json(self): return {"data": {"amount": self._a, "currency": "USD"}}
    client = MagicMock()
    client.__enter__.return_value = client
    client.get.side_effect = [R("80592.975"), R("2333.5"), Exception("boom")]
    with patch.object(crypto.httpx, "Client", return_value=client):
        out = crypto.fetch_spot()
    assert out == {"BTC": 80592.975, "ETH": 2333.5}                 # SOL failed, the others survive
