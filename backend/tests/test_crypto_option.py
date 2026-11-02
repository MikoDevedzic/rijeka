"""Digital-asset options: one engine with the FX option (the funding rate as the base rate), cash-settled; the
desk's taxonomy (CRY01, IR01 = discounting, FUND01); the route, the booked valuation, the canonical record (a
European NDO keeps its legacy bytes; other styles carry their terms), the exposure engine, stress and the ladder."""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from pricing.curve import Curve
from pricing.fx_option import price_fx_option
from pricing.fx_vol import quotes_from_grid
from tests.test_fx_option import FakeMarket, USD, VAL

EXP = date(2027, 1, 29)
SET = EXP + timedelta(days=1)
BTC_VOL = quotes_from_grid({"1M": {"ATM": 55.0, "RR25": 2.0, "BF25": 3.0}, "3M": {"ATM": 58.0, "RR25": 2.5, "BF25": 3.2}, "1Y": {"ATM": 62.0, "RR25": 3.0, "BF25": 3.5}})


def _mock_db():
    rows = {"BTCUSD_SPOT": MagicMock(valuation_date=VAL, quotes=[{"tenor": "SPOT", "rate": 65000.0}], source="Coinbase"),
            "BTC_FUNDING": MagicMock(valuation_date=VAL, quotes=[{"tenor": "FLAT", "rate": 3.0, "quote_type": "FLAT"}], source="MANUAL"),
            "BTCUSD_VOL": MagicMock(valuation_date=VAL, quotes=BTC_VOL, source="DEMO · synthetic surface")}
    db = MagicMock()
    def execute(sql, params=None):
        r = MagicMock(); r.first.return_value = rows.get((params or {}).get("c", "")); return r
    db.execute.side_effect = execute
    return db


def _client(db):
    from api.routes import currencies
    import main
    from fastapi.testclient import TestClient
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    return TestClient(main.app), currencies


def test_route_prices_a_bitcoin_option_with_the_fx_engine_and_the_desk_taxonomy():
    import main
    c, currencies = _client(_mock_db())
    try:
        with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: Curve(VAL, flat_rate=0.04)):
            r = c.post("/api/currency/option/price", json={"pair": "BTCUSD", "option_type": "CALL", "base_notional": 10, "expiry_date": EXP.isoformat(),
                                                            "valuation_date": VAL.isoformat()})
            t = c.post("/api/currency/option/price", json={"pair": "BTCUSD", "option_type": "CALL", "base_notional": 10, "expiry_date": EXP.isoformat(),
                                                            "valuation_date": VAL.isoformat(), "style": "TOUCH", "touch_type": "ONE_TOUCH", "barrier": 80000,
                                                            "payout": 100000, "payout_currency": "QUOTE", "pay_at_hit": True})
            lad = c.post("/api/currency/option/ladder", json={"pair": "BTCUSD", "option_type": "PUT", "base_notional": 10, "expiry_date": EXP.isoformat(),
                                                               "valuation_date": VAL.isoformat(), "style": "BARRIER", "barrier_type": "DOWN_OUT", "barrier": 50000})
    finally:
        main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["crypto"] is True and b["settlement_type"] == "NON_DELIVERABLE" and b["settlement_date"] == SET.isoformat()
    assert b["vol_tier"] == "SURFACE" and 0.5 < b["vol"] < 0.65 and b["quote_currency"] == "USD" and b["strike"] == pytest.approx(b["forward"])
    assert b["ir01"] == pytest.approx(b["ir01_disc"]) and b["fund01"] == pytest.approx(b["ir01_base"])      # IR01 is discounting; funding is FUND01
    assert "Black-76" in b["method"]
    # the same numbers from the engine directly: the funding rate is the base rate of the forward
    T_s = (SET - VAL).days / 365.0  # noqa: F841  launch audit: assigned, never used
    e = price_fx_option(base_currency="BTC", quote_currency="USD", base_notional=10, option_type="CALL", strike=b["strike"], spot=65000.0, forward=b["forward"],
                        df_quote=b["df_quote"], valuation_date=VAL, expiry_date=EXP, settlement_date=SET, vol=b["vol"], direction="BUY", spot_date=VAL + timedelta(days=1))
    assert b["npv"] == pytest.approx(e.npv) and b["vega"] == pytest.approx(e.vega) and b["spot01"] == pytest.approx(e.spot01)
    assert t.status_code == 200 and 0 < t.json()["npv"] < 100000 and t.json()["style"] == "TOUCH"
    assert lad.status_code == 200 and lad.json()["style"] == "BARRIER" and len(lad.json()["rows"]) == 9


def _trade(side="BUY", **terms):
    t = {"direction": side, "digital_asset": "BTC", "notional_amount": "10", "option_type": "CALL", "exercise_style": "EUROPEAN", "strike_price": "68000",
         "strike_currency": "USD", "expiration_date": EXP.isoformat(), "expiration_time": "08:00 UTC", "valuation_date": EXP.isoformat(), "valuation_time": "08:00 UTC",
         "settlement_date": SET.isoformat(), "settlement_currency": "USD", "settlement_price_source": "CME CF BRR", "premium_amount": "42000",
         "premium_currency": "USD", "premium_payment_date": "2026-10-31", "calculation_agent": None, "automatic_exercise": True, **terms}
    return SimpleNamespace(id="CRO1", trade_ref="TRD-CRO", instrument_type="CRYPTO_OPTION", status="CONFIRMED", notional=10, notional_ccy="BTC",
                           discount_curve_id="USD_SOFR", forecast_curve_id=None, terms=t, trade_date=VAL, effective_date=VAL, maturity_date=SET,
                           counterparty_id=None, user_id="u", desk="DIGITAL", book="CRYPTO", asset_class="CRYPTO", structure=None, uti="X" * 52)


def _market(as_of=VAL, spot=65000.0):
    return FakeMarket(as_of, {"USD_SOFR": USD, "BTCUSD_SPOT": [{"tenor": "SPOT", "rate": spot}], "BTC_FUNDING": [{"tenor": "FLAT", "rate": 3.0}], "BTCUSD_VOL": BTC_VOL})


def test_booked_valuation_curves_and_canonical_record():
    from chain.canonical import canonical_payload, trade_hash
    from pnl.valuation import trade_curves, value
    own = SimpleNamespace(lei="529900T8BM49AURSDO55", name="Rijeka"); cp = SimpleNamespace(lei="5493001KJTIIGC8Y1R12", name="Demo Bank")
    t = _trade()
    assert trade_curves(t) == ["USD_SOFR", "BTC_FUNDING", "BTCUSD_VOL"]
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(VAL, flat_rate=0.04)):
        v = value(None, {"sub": "u"}, t, VAL, _market())
        s = value(None, {"sub": "u"}, _trade("SELL"), VAL, _market())
        ko = value(None, {"sub": "u"}, _trade(style="BARRIER", barrier_type="UP_OUT", barrier="90000"), VAL, _market())
    assert v["ccy"] == "USD" and v["npv"] > 0 and v["vega"] > 0 and s["npv"] == pytest.approx(-v["npv"])
    assert v["ir01"] == pytest.approx(v["ir01_disc"]) and v["fund01"] == pytest.approx(v["ir01_base"]) and "Black-76" in v["model"]
    assert 0 < ko["npv"] < v["npv"] and "survival" in ko["model"]
    # the record: a European NDO is the legacy shape (no style block); a barrier carries its terms; both sides hash alike
    rec = canonical_payload(t, [], own, cp)
    assert rec["product"]["product"] == "NDO" and "style" not in rec["product"] and rec["product"]["buyer"] == own.lei
    assert rec == canonical_payload(_trade("SELL"), [], cp, own)
    kb = canonical_payload(_trade(style="BARRIER", barrier_type="UP_OUT", barrier="90000", rebate="100"), [], own, cp)
    assert kb["product"]["style"] == "BARRIER" and kb["product"]["barrier"] == "90000" and kb["product"]["barrier_monitoring"] == "CONTINUOUS" and kb["product"]["rebate"] == "100"
    assert trade_hash(kb) != trade_hash(rec)
    touch = _trade(style="TOUCH", touch_type="ONE_TOUCH", barrier="80000", payout="100000", payout_currency="QUOTE", pay_at_hit=True, strike_price=None)
    rt = canonical_payload(touch, [], own, cp)
    assert rt["product"]["touch_type"] == "ONE_TOUCH" and rt["product"]["pay_at_hit"] is True and rt["product"]["strike_price"] is None
    with pytest.raises(ValueError):
        canonical_payload(_trade(style="DOUBLE_BARRIER", barrier_type="KNOCK_OUT", lower="70000", upper="60000"), [], own, cp)
    with pytest.raises(ValueError):
        canonical_payload(_trade(style="LOOKBACK"), [], own, cp)


def test_exposure_item_stress_and_ladder_taxonomy():
    from ccr.valuation import FX_OPTIONS
    from risk import stress as ST
    from risk.sensitivities import trade_ladder
    from pnl.explain import Valuer
    assert "CRYPTO_OPTION" in FX_OPTIONS
    m = _market()
    vol_up = ST.shifted_market(m, {"vols": {"FX": 5, "CRYPTO": 20}}, ["BTCUSD_VOL"], [])
    assert {q["rate"] for q in vol_up.quotes("BTCUSD_VOL") if q["quote_type"] == "ATM"} == {75.0, 78.0, 82.0}      # the digital-asset shock
    rates_dn = ST.shifted_market(m, {"rates": {"*": -100}}, ["USD_SOFR", "BTC_FUNDING", "BTCUSD_VOL"], [])
    assert rates_dn.quotes("BTCUSD_VOL") == BTC_VOL and rates_dn.single("BTC_FUNDING", "FLAT") == 2.0
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(VAL, flat_rate=0.04)):
        row = trade_ladder(None, {"sub": "u"}, _trade(), VAL, m, Valuer(None, {"sub": "u"}))
    assert "BTC_FUNDING" in row["fund01"] and "BTC_FUNDING" not in row["kr01"] and "BTCUSD_VOL" in row["vega"]
    assert row["ir01"] == pytest.approx(sum(sum(b.values()) for b in row["kr01"].values())) and abs(row["fund01_total"]) > 0
    assert row["spot01"] == {"BTC": pytest.approx(row["spot01"]["BTC"])} and row["spot01"]["BTC"] > 0


def test_booking_structure_follows_the_style_for_digital_assets():
    from api.routes.trades import TradeCreate, display_structure
    base = dict(asset_class="CRYPTO", instrument_type="CRYPTO_OPTION", trade_date="2026-11-02", effective_date="2026-11-02", maturity_date="2027-01-30")
    assert TradeCreate(**base, terms={"style": "TOUCH"}).structure == "TOUCH"
    assert TradeCreate(**base, terms={}).structure == "EUROPEAN"
    assert display_structure(SimpleNamespace(instrument_type="CRYPTO_OPTION", structure=None, terms={"style": "DIGITAL"})) == "DIGITAL"
