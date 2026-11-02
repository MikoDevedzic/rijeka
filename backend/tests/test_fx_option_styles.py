"""FX option styles through the frameworks: the pricer's identities, the route, booked valuation, the exposure
paths (knock monitoring, dispatch) and the canonical record."""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import numpy as np
import pytest

from pricing.curve import Curve
from pricing.fx_exotic import ExoticSpec, knocked_so_far, price_exotic, value, value_on_paths
from pricing.fx_vol import quotes_from_grid
from tests.test_fx_option import FakeMarket, USD, VOL, _mock_db, _market, _trade, curves  # noqa: F401  (fixture)

VAL = date(2026, 10, 30)
EXP = date(2027, 4, 30)
SET = date(2027, 5, 4)
S0, R, RB, VOLA, T = 1.165, 0.0385, 0.02, 0.085, 0.5


def _px(spec, **kw):
    args = dict(base_notional=1e7, spot=S0, forward=S0 * np.exp((R - RB) * T), df_quote=np.exp(-R * T), t_expiry=T, vol=VOLA, direction="BUY")
    args.update(kw)
    return price_exotic(spec, **args)


def test_identities_across_styles():
    van = value(ExoticSpec("EUROPEAN", "CALL", strike=1.17), S0, R, RB, VOLA, T)
    ki = value(ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_IN", barrier=1.24), S0, R, RB, VOLA, T)
    ko = value(ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=1.24), S0, R, RB, VOLA, T)
    assert ki + ko == pytest.approx(van, rel=1e-5)                                   # in + out = vanilla (integration accuracy)
    dki = value(ExoticSpec("DOUBLE_BARRIER", "PUT", strike=1.16, barrier_type="KNOCK_IN", lower=1.08, upper=1.26), S0, R, RB, VOLA, T)
    dko = value(ExoticSpec("DOUBLE_BARRIER", "PUT", strike=1.16, barrier_type="KNOCK_OUT", lower=1.08, upper=1.26), S0, R, RB, VOLA, T)
    assert dki + dko == pytest.approx(value(ExoticSpec("EUROPEAN", "PUT", strike=1.16), S0, R, RB, VOLA, T), rel=1e-5)
    am = value(ExoticSpec("AMERICAN", "PUT", strike=1.20), S0, R, RB, VOLA, T)
    assert am > value(ExoticSpec("EUROPEAN", "PUT", strike=1.20), S0, R, RB, VOLA, T)  # an in-the-money American put is worth more
    dc = value(ExoticSpec("DIGITAL", "CALL", strike=1.17, payout=1.0), S0, R, RB, VOLA, T)
    dp = value(ExoticSpec("DIGITAL", "PUT", strike=1.17, payout=1.0), S0, R, RB, VOLA, T)
    assert dc + dp == pytest.approx(np.exp(-R * T), rel=1e-12)                        # cash digitals sum to the discount factor
    far_ko = value(ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=3.0), S0, R, RB, VOLA, T)
    assert far_ko == pytest.approx(van, rel=1e-5)                                     # a barrier that cannot be hit is no barrier (integration accuracy)
    with pytest.raises(ValueError):
        price_exotic(ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=1.10), base_notional=1, spot=S0, forward=S0, df_quote=0.98,
                     t_expiry=T, vol=VOLA)


def test_risk_signs_and_settlement_discount():
    ko = _px(ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=1.24))
    assert ko.npv > 0 and ko.vega < 0                                                 # a near-barrier knock-out call is short vega
    nt = _px(ExoticSpec("TOUCH", payout=1e6, touch_type="NO_TOUCH", barrier=1.24))
    assert 0 < nt.npv < 1e6 and nt.spot01 < 0                                         # up barrier: higher spot, more likely touched
    sold = _px(ExoticSpec("TOUCH", payout=1e6, touch_type="NO_TOUCH", barrier=1.24), direction="SELL")
    assert sold.npv == pytest.approx(-nt.npv) and sold.vega == pytest.approx(-nt.vega)
    # settlement later than expiry: the quote discount factor to settlement is smaller and the forward to settlement
    # higher; a digital paid at settlement is worth its payout × that DF × P(in the money)
    at_exp = _px(ExoticSpec("DIGITAL", "CALL", strike=1.17, payout=1e6))
    later = _px(ExoticSpec("DIGITAL", "CALL", strike=1.17, payout=1e6), df_quote=np.exp(-R * (T + 10 / 365)))
    assert later.npv == pytest.approx(at_exp.npv * np.exp(-R * 10 / 365), rel=1e-9)   # a cash digital: payout × DF to settlement × P(in the money)


def test_knock_monitoring_on_paths_and_knocked_paths_are_valued_right():
    S_hist = np.array([[1.16, 1.20, 1.26, 1.22], [1.16, 1.15, 1.17, 1.18], [1.16, 1.05, 1.10, 1.12]])
    up_out = ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=1.25)
    assert knocked_so_far(up_out, S_hist).tolist() == [True, False, False]
    dnt = ExoticSpec("TOUCH", payout=1e6, touch_type="DOUBLE_NO_TOUCH", lower=1.07, upper=1.25)
    assert knocked_so_far(dnt, S_hist).tolist() == [True, False, True]
    assert knocked_so_far(dnt, S_hist[:, :2]).tolist() == [False, False, True]
    S = S_hist[:, -1]
    knocked = knocked_so_far(up_out, S_hist)
    v = value_on_paths(up_out, S, R, RB, VOLA, 0.25, knocked)
    assert v[0] == 0.0 and v[1] > 0 and v[2] > 0                                      # knocked out: worthless
    ki = ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_IN", barrier=1.25)
    vki = value_on_paths(ki, S, R, RB, VOLA, 0.25, knocked)
    van = value_on_paths(ExoticSpec("EUROPEAN", "CALL", strike=1.17), S, R, RB, VOLA, 0.25, knocked)
    assert vki[0] == pytest.approx(van[0]) and vki[1] < van[1]                        # knocked in: the vanilla
    ot = ExoticSpec("TOUCH", payout=1e6, touch_type="ONE_TOUCH", barrier=1.25)
    vot = value_on_paths(ot, S, R, RB, VOLA, 0.25, knocked)
    assert vot[0] == pytest.approx(1e6 * np.exp(-R * 0.25)) and 0 < vot[1] < 1e6     # hit: the payout is certain at expiry


def test_exposure_engine_dispatches_styles_and_fixes_the_payoff_at_expiry():
    from ccr import calibration as C
    from ccr.options import value_fx_option
    from ccr.simulate import simulate
    key, skey = "RATES:USD_SOFR", "SPOT:EURUSD"
    f = {key: C.Factor(key, "RATES", a=0.03, sigma=0.008), skey: C.Factor(skey, "SPOT", sigma=0.09)}
    cal = C.Calibration("RISK_NEUTRAL", f, np.eye(2), [key, skey], drift_mode="forward")
    p = simulate(cal, {key: Curve(VAL, flat_rate=0.04)}, {skey: 1.165}, {skey: (0.04, 0.02)}, VAL, 12, n_paths=3000, seed=9)
    fx, flat = {"USD": 1.0}, {"EURUSD": 0.02}
    i_exp = p.grid.index(EXP)
    for spec in (ExoticSpec("BARRIER", "CALL", strike=1.17, barrier_type="UP_OUT", barrier=1.24),
                 ExoticSpec("TOUCH", payout=1e6, touch_type="NO_TOUCH", barrier=1.24),
                 ExoticSpec("DIGITAL", "PUT", strike=1.16, payout=1e6),
                 ExoticSpec("AMERICAN", "PUT", strike=1.19)):
        item = {"pair": "EURUSD", "base": "EUR", "quote": "USD", "K": spec.strike, "option_type": spec.option_type, "expiry": EXP, "settle": SET,
                "N": 1e7, "vol": 0.09, "sign": 1.0, "spec": spec}
        v0 = value_fx_option(item, p, 0, fx, flat)
        assert np.all(np.isfinite(v0)) and float(v0[0]) > 0
        at = value_fx_option(item, p, i_exp, fx, flat)
        assert np.all(at >= 0)
        if spec.style in ("BARRIER", "TOUCH"):
            touched = p.s[skey][:, :i_exp + 1].max(axis=1) >= 1.24
            assert np.all(at[touched] == 0.0)                                         # knocked out / touched: nothing left
        assert np.all(value_fx_option(item, p, p.grid.index(date(2027, 6, 30)), fx, flat) == 0.0)


def test_route_prices_styles_and_the_ladder(curves):
    from api.routes import currencies
    import main
    from fastapi.testclient import TestClient
    db = _mock_db(VOL)
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    cv = {"USD_SOFR": Curve(VAL, flat_rate=0.04), "EUR_ESTR": Curve(VAL, flat_rate=0.02)}
    try:
        with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: cv[cid]):
            c = TestClient(main.app)
            base = {"pair": "EURUSD", "option_type": "CALL", "base_notional": 10_000_000, "expiry_date": EXP.isoformat(), "valuation_date": VAL.isoformat()}
            r = c.post("/api/currency/option/price", json={**base, "style": "BARRIER", "barrier_type": "UP_OUT", "barrier": 1.25, "strike": 1.17})
            assert r.status_code == 200, r.text
            b = r.json()
            assert b["style"] == "BARRIER" and b["barrier"] == 1.25 and "survival" in b["method"] and b["npv"] > 0
            t = c.post("/api/currency/option/price", json={**base, "style": "TOUCH", "touch_type": "DOUBLE_NO_TOUCH", "lower": 1.08, "upper": 1.26, "payout": 1_000_000})
            assert t.status_code == 200 and 0 < t.json()["npv"] < 1_000_000 and t.json()["strike"] == pytest.approx(t.json()["forward"])
            bad = c.post("/api/currency/option/price", json={**base, "style": "BARRIER", "barrier_type": "UP_OUT", "barrier": 1.10, "strike": 1.17})
            assert bad.status_code == 422 and "above spot" in bad.text
            lad = c.post("/api/currency/option/ladder", json={**base, "style": "AMERICAN", "strike": 1.19, "spot_shocks_pct": [-5, 0, 5], "vol_shocks_pts": [0, 1]})
            assert lad.status_code == 200, lad.text
            rows = lad.json()["rows"]
            assert [x["spot_pct"] for x in rows] == [-5.0, 0.0, 5.0] and rows[1]["npv"]["0"] == pytest.approx(lad.json()["base_npv"], rel=1e-4)
            assert rows[2]["npv"]["0"] > rows[0]["npv"]["0"] and rows[1]["npv"]["1"] > rows[1]["npv"]["0"]     # a call rises with spot and vol
    finally:
        main.app.dependency_overrides.clear()


def test_booked_styles_are_valued_and_recorded(curves, monkeypatch):
    from chain.canonical import canonical_payload
    from pnl.valuation import value
    own = SimpleNamespace(lei="529900T8BM49AURSDO55", name="Rijeka")
    cp = SimpleNamespace(lei="5493001KJTIIGC8Y1R12", name="Demo Bank")
    ko = _trade("BUY", style="BARRIER", barrier_type="UP_OUT", barrier="1.25", strike="1.17")
    v = value(None, {"sub": "u"}, ko, VAL, _market(VAL))
    van = value(None, {"sub": "u"}, _trade("BUY", strike="1.17"), VAL, _market(VAL))
    assert 0 < v["npv"] < van["npv"] and "survival" in v["model"]
    rec = canonical_payload(ko, [], own, cp)
    assert rec == canonical_payload(_trade("SELL", style="BARRIER", barrier_type="UP_OUT", barrier="1.25", strike="1.17"), [], cp, own)
    assert rec["product"]["style"] == "BARRIER" and rec["product"]["barrier"] == "1.25" and rec["product"]["barrier_monitoring"] == "CONTINUOUS"
    touch = _trade("BUY", style="TOUCH", touch_type="ONE_TOUCH", barrier="1.24", payout="1000000", payout_currency="QUOTE", pay_at_hit=True, strike=None)
    vt = value(None, {"sub": "u"}, touch, VAL, _market(VAL))
    assert 0 < vt["npv"] < 1_000_000 and vt["vega"] > 0
    rt = canonical_payload(touch, [], own, cp)
    assert rt["product"]["touch_type"] == "ONE_TOUCH" and rt["product"]["pay_at_hit"] is True and rt["product"]["strike"] is None
    with pytest.raises(ValueError):
        canonical_payload(_trade("BUY", style="TOUCH", payout="1000000", payout_currency="QUOTE"), [], own, cp)     # a touch names its type
    with pytest.raises(ValueError):
        canonical_payload(_trade("BUY", style="AMERICAN", exercise_style="EUROPEAN"), [], own, cp)
    # expired, unsettled: knock status from the record when the desk has it
    dates = {"expiry_date": EXP.isoformat(), "settlement_date": SET.isoformat()}
    after = EXP + timedelta(days=1)                                                   # expired, not yet settled
    knocked = _trade("BUY", style="BARRIER", barrier_type="UP_OUT", barrier="1.25", strike="1.17", knocked=True, **dates)
    kv = value(None, {"sub": "u"}, knocked, after, _market(after, spot=1.20))
    assert kv["npv"] == 0.0 and "expired" in kv["model"]
    alive = _trade("BUY", style="BARRIER", barrier_type="UP_OUT", barrier="1.25", strike="1.17", knocked=False, **dates)
    av = value(None, {"sub": "u"}, alive, after, _market(after, spot=1.20))
    assert 0.99 * 1e7 * 0.03 < av["npv"] <= 1e7 * 0.03 and av["vega"] == 0.0            # (1.20 − 1.17) × N, discounted three days
    unknown = value(None, {"sub": "u"}, _trade("BUY", style="BARRIER", barrier_type="UP_OUT", barrier="1.25", strike="1.17", **dates), after, _market(after, spot=1.20))
    assert "knock status not recorded" in unknown["model"] and unknown["npv"] == pytest.approx(av["npv"])


def test_trade_structure_follows_the_style():
    from api.routes.trades import TradeCreate, display_structure
    base = dict(asset_class="FX", instrument_type="FX_OPTION", trade_date="2026-11-02", effective_date="2026-11-02", maturity_date="2027-02-04")
    assert TradeCreate(**base, terms={"style": "DIGITAL"}).structure == "DIGITAL"                       # blank: from the terms
    assert TradeCreate(**base, structure="VANILLA", terms={"style": "BARRIER"}).structure == "BARRIER"   # the old default is overridden
    assert TradeCreate(**base, structure="touch", terms={"style": "TOUCH"}).structure == "TOUCH"
    assert TradeCreate(**base, terms={"exercise_style": "AMERICAN"}).structure == "AMERICAN"             # legacy ticket
    assert TradeCreate(**base, terms={}).structure == "EUROPEAN"
    with pytest.raises(ValueError):
        TradeCreate(**base, structure="DIGITAL", terms={"style": "BARRIER"})
    with pytest.raises(ValueError):
        TradeCreate(**base, terms={"style": "LOOKBACK"})
    # the table's CHECK (trades_structure_check) still knows only the swap structures: a style it would reject is stored as
    # VANILLA until docs/migrations/2026-11-02_trades_structure.sql has run, and the blotter reads the style from the terms
    from api.routes.trades import stored_structure
    assert stored_structure("BARRIER") == "VANILLA" and stored_structure("VANILLA") == "VANILLA" and stored_structure("OIS") == "OIS" and stored_structure(None) is None
    # rows booked before the rule: shown from their terms, the row itself untouched
    old = SimpleNamespace(instrument_type="FX_OPTION", structure="VANILLA", terms={"style": "DIGITAL"})
    assert display_structure(old) == "DIGITAL" and old.structure == "VANILLA"
    assert display_structure(SimpleNamespace(instrument_type="FX_OPTION", structure=None, terms={})) == "EUROPEAN"
    assert display_structure(SimpleNamespace(instrument_type="IR_SWAP", structure="VANILLA", terms={"style": "DIGITAL"})) == "VANILLA"
