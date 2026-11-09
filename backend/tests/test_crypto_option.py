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
SET = EXP + timedelta(days=1)                   # a booked record's Saturday settlement: still valued
SET_DEFAULT = date(2027, 2, 1)                  # the route's default: the first New York business day after the expiry
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
    assert b["crypto"] is True and b["settlement_type"] == "NON_DELIVERABLE" and b["settlement_date"] == SET_DEFAULT.isoformat()
    assert b["vol_tier"] == "SURFACE" and 0.5 < b["vol"] < 0.65 and b["quote_currency"] == "USD" and b["strike"] == pytest.approx(b["forward"])
    assert b["ir01"] == pytest.approx(b["ir01_disc"]) and b["fund01"] == pytest.approx(b["ir01_base"])      # IR01 is discounting; funding is FUND01
    assert "Black-76" in b["method"]
    # the same numbers from the engine directly: the funding rate is the base rate of the forward
    T_s = (SET - VAL).days / 365.0  # noqa: F841  launch audit: assigned, never used
    e = price_fx_option(base_currency="BTC", quote_currency="USD", base_notional=10, option_type="CALL", strike=b["strike"], spot=65000.0, forward=b["forward"],
                        df_quote=b["df_quote"], valuation_date=VAL, expiry_date=EXP, settlement_date=SET_DEFAULT, vol=b["vol"], direction="BUY", spot_date=VAL)
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


# ── the venue's marks (market_data/deribit.py): forwards by expiry and the surface, with their time on the ticket ──

MARKS = "DEMO · Deribit option marks · 2026-11-09 12:57 UTC · listed to 24SEP27, flat beyond"
FWDS = "DEMO · Deribit forwards · 2026-11-09 12:57 UTC · listed to 24SEP27, flat beyond"


def test_quoted_forwards_replace_the_flat_funding_rate_and_a_funding_rate_on_the_ticket_still_wins():
    import main
    db = _mock_db()
    rows = {"BTCUSD_FWD": MagicMock(valuation_date=VAL, source=FWDS, quotes=[{"tenor": "1M", "rate": 300.0}, {"tenor": "3M", "rate": 900.0}, {"tenor": "1Y", "rate": 3700.0}]),
            "BTCUSD_VOL": MagicMock(valuation_date=VAL, quotes=BTC_VOL, source=MARKS)}
    inner = db.execute.side_effect
    def execute(sql, params=None):
        hit = rows.get((params or {}).get("c", ""))
        if hit is None:
            return inner(sql, params)
        r = MagicMock(); r.first.return_value = hit; return r
    db.execute.side_effect = execute
    c, currencies = _client(db)
    body = {"pair": "BTCUSD", "base_notional": 10, "settlement_date": SET.isoformat(), "valuation_date": VAL.isoformat()}
    try:
        with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: Curve(VAL, flat_rate=0.04)):
            mkt = c.post("/api/currency/forward/price", json=body).json()
            own = c.post("/api/currency/forward/price", json={**body, "base_rate_pct": 1.0}).json()
            opt = c.post("/api/currency/option/price", json={"pair": "BTCUSD", "option_type": "PUT", "base_notional": 10, "expiry_date": EXP.isoformat(),
                                                              "settlement_date": SET.isoformat(), "valuation_date": VAL.isoformat()}).json()
            flat = c.post("/api/currency/option/price", json={"pair": "BTCUSD", "option_type": "PUT", "base_notional": 10, "expiry_date": EXP.isoformat(),
                                                               "settlement_date": SET.isoformat(), "valuation_date": VAL.isoformat(), "vol_pct": 40}).json()
            state = currencies.pair_state(db, "u", "BTCUSD")
    finally:
        main.app.dependency_overrides.clear()
    days = (SET - VAL).days
    pts = currencies.interp_points({"1M": 300.0, "3M": 900.0, "1Y": 3700.0}, days)
    # the forward is spot plus the venue's points, and the ticket names the venue and the time of the marks
    assert mkt["forward_mode"] == "MARKET" and mkt["forward"] == pytest.approx(65000.0 + pts) and mkt["market_points"] == pytest.approx(pts)
    assert mkt["forward_source"].startswith("market points (BTCUSD_FWD") and "Deribit forwards · 2026-11-09 12:57 UTC" in mkt["forward_source"] and "DEMO" not in mkt["forward_source"]
    # a funding rate typed on the ticket is the desk's own carry: parity at that rate, and the response says which applied
    T = days / 365.0
    import math
    assert own["forward_mode"] == "IMPLIED" and own["base_discounting"] == "request" and own["forward_source"] == "spot carried at the funding rate (request)"
    assert own["forward"] == pytest.approx(65000.0 * math.exp(-0.01 * T) / Curve(VAL, flat_rate=0.04).df(SET), rel=1e-9)
    assert own["market_points"] == pytest.approx(pts)                     # still reported, as the basis against the desk's rate
    # the option sits on the quoted forward and prints where its vol came from
    assert opt["forward"] == pytest.approx(mkt["forward"]) and opt["vol_marks"] == "Deribit option marks · 2026-11-09 12:57 UTC · listed to 24SEP27, flat beyond"
    assert flat["vol_tier"] == "OVERRIDE" and flat["vol_marks"] is None
    assert not currencies.is_venue("DEMO · synthetic surface") and not currencies.is_venue("MANUAL") and currencies.is_venue(MARKS)     # only a venue's row prints its marks
    # the field captions on the ticket
    assert state["vol_surface"]["label"] == "Deribit 9 Nov 12:57 UTC" and state["forward_curve"]["label"] == "Deribit 9 Nov 12:57 UTC"
    assert currencies.short_label("DEMO · Deribit option marks · not a time UTC · x", "2026-11-09", "surface").endswith("surface 2026-11-09")
    assert currencies.short_label("DEMO ·  · 2026-11-09 12:46 UTC", "2026-11-09", "surface").endswith("surface 2026-11-09")              # a label that only looks like one
    assert currencies.short_label("MANUAL", "2026-11-02", "surface") == "MANUAL surface 2026-11-02"
    assert currencies.short_label("DEMO · synthetic surface", "2026-11-02", "surface") == "DEMO · synthetic surface surface 2026-11-02"
    assert currencies.marks_label("DEMO · synthetic surface") == "synthetic surface" and currencies.marks_label(None) is None


def test_a_built_history_row_never_replaces_a_venue_row():
    from risk import history as H
    db = MagicMock()
    db.execute.return_value.rowcount = 0
    H.store(db, "tmpl", {"BTCUSD_VOL": {date(2026, 11, 9): BTC_VOL}}, overwrite=True, source="DEMO · synthetic surface, level scaled")
    sql, params = str(db.execute.call_args.args[0]), db.execute.call_args.args[1]
    assert "DO UPDATE SET quotes = EXCLUDED.quotes, source = EXCLUDED.source WHERE market_data_snapshots.source NOT LIKE :keep" in sql
    assert params["keep"] == "DEMO · Deribit%"
    from market_data import deribit
    assert H.MARKET_LIKE == deribit.SOURCE_PREFIX + "%"
    db.reset_mock()
    H.store(db, "tmpl", {"BTCUSD_VOL": {date(2026, 11, 9): BTC_VOL}})
    assert "DO NOTHING" in str(db.execute.call_args.args[0]) and "keep" not in db.execute.call_args.args[1]


def test_the_vol_history_before_the_venue_is_the_venue_surface_carried_back_so_the_series_has_no_step():
    import math
    import random
    from unittest.mock import patch as _patch
    from risk import vols
    rng = random.Random(11)
    px = [60_000.0]
    for i in range(330):
        px.append(px[-1] * math.exp(rng.gauss(0, (0.35 if i < 300 else 0.80) / math.sqrt(252))))     # a calm year, then a wild month
    days = [date(2025, 12, 1) + timedelta(days=i) for i in range(len(px))]
    on = days[-1]
    venue = quotes_from_grid({"1M": {"ATM": 38.5, "RR25": -4.2, "BF25": 1.4}, "1Y": {"ATM": 40.3, "RR25": -2.0, "BF25": 1.1}})
    # on the anchor's own date the rebuilt surface is the venue's, quote for quote
    assert vols.fx_surface("BTCUSD", px, (venue, px)) == [{**q, "rate": round(q["rate"], 3)} for q in venue]
    # a month earlier the level follows realised vol from there: the wild month had lifted the 1M point, so before it the point is lower
    before = {(q["tenor"], q["quote_type"]): q["rate"] for q in vols.fx_surface("BTCUSD", px[:300], (venue, px))}
    assert before[("1M", "ATM")] == pytest.approx(38.5 * vols.scale(px[:300], 21) / vols.scale(px, 21), abs=1e-3) and before[("1M", "ATM")] < 38.5
    assert before[("1M", "RR25")] == -4.2 and before[("1Y", "BF25")] == 1.1                      # the smile is the venue's throughout
    # the builder: an anchored pair is carried back, a pair without one keeps the parametric level
    series = {"BTCUSD_SPOT": [(d, {"SPOT": p}) for d, p in zip(days, px)], "ETHUSD_SPOT": [(d, {"SPOT": p / 30}) for d, p in zip(days, px)]}
    with _patch.object(vols.H, "series", side_effect=lambda db, uid, cid, a, b, **kw: [(d, q) for d, q in series.get(cid, []) if a <= d <= b]), \
         _patch.object(vols, "venue_anchors", return_value={"BTCUSD_VOL": (on, venue)}):
        out = vols.history_days(None, "tmpl", days[-3], on)
    btc = {d: {(q["tenor"], q["quote_type"]): q["rate"] for q in qs} for d, qs in out["BTCUSD_VOL"].items()}
    assert btc[on][("1M", "ATM")] == 38.5 and abs(btc[days[-2]][("1M", "ATM")] - 38.5) < 2.5       # a day's move, not the 14 points between the two sources
    eth = {(q["tenor"], q["quote_type"]): q["rate"] for q in out["ETHUSD_VOL"][on]}
    from market_data import demo_feed
    assert eth[("1M", "RR25")] == next(q["rate"] for q in demo_feed.build_fx_vols("ETHUSD") if q["tenor"] == "1M" and q["quote_type"] == "RR25")


def test_fund01_on_the_ladder_is_the_same_whether_the_forward_is_carried_or_quoted():
    """Vera, 2026-11-09: on quoted points the stored funding rate does not enter the value, so bumping it alone
    read FUND01 = 0 on the ladder while the ticket still showed one. The bump now moves the points it implies."""
    import math
    from pnl.explain import Valuer
    from risk.sensitivities import trade_ladder
    flat = _market()
    # points that say exactly what the flat 3 % funding says: the two markets value the trade alike
    carry = lambda days: 65000.0 * (math.exp((0.04 - 0.03) * days / 365) - 1)
    pts = [{"tenor": t, "rate": carry(d)} for t, d in (("1M", 30), ("3M", 91), ("6M", 182), ("1Y", 365))]
    quoted = flat.override("BTCUSD_FWD", pts)
    fwd = SimpleNamespace(id=uuid4(), trade_ref="TRD-FWD", instrument_type="CRYPTO_FORWARD", status="LIVE", notional=10, notional_ccy="BTC",
                          discount_curve_id="USD_SOFR", forecast_curve_id=None, trade_date=VAL, effective_date=VAL, maturity_date=SET, counterparty_id=None,
                          user_id="u", desk="DIGITAL", book="CRYPTO", asset_class="CRYPTO", structure=None, uti="Y" * 52,
                          terms={"digital_asset": "BTC", "notional_amount": 10, "forward_price": 65000.0, "settlement_date": SET.isoformat(), "direction": "BUY"})
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(VAL, flat_rate=0.04)):
        for trade in (fwd, _trade()):
            a = trade_ladder(None, {"sub": "u"}, trade, VAL, flat, Valuer(None, {"sub": "u"}))
            b = trade_ladder(None, {"sub": "u"}, trade, VAL, quoted, Valuer(None, {"sub": "u"}))
            assert a["npv"] == pytest.approx(b["npv"], rel=2e-3, abs=5.0)
            assert a["fund01_total"] != 0 and b["fund01_total"] == pytest.approx(a["fund01_total"], rel=0.03), trade.instrument_type
            assert b["ir01"] == pytest.approx(a["ir01"], rel=0.03, abs=0.5)                    # the discounting ladder is untouched
    assert b["fund01"].keys() == {"BTC_FUNDING"}
