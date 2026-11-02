"""FX options through every framework: the pricer's identities, the smile, the route, the booked valuation,
the P&L explain's VOL step, the ladder's vega, the exposure paths and the canonical record."""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import numpy as np
import pytest

from pricing.curve import Curve
from pricing.fx_option import gk_value, price_fx_option
from pricing.fx_vol import lookup_vol, parse_surface, quotes_from_grid, vol_at

VAL = date(2026, 10, 30)
EXP = date(2027, 1, 29)
SET = date(2027, 2, 2)


def _opt(**kw):
    base = dict(base_currency="EUR", quote_currency="USD", base_notional=1e7, option_type="CALL", strike=1.18, spot=1.165, forward=1.1715,
                df_quote=0.9905, valuation_date=VAL, expiry_date=EXP, settlement_date=SET, vol=0.075, direction="BUY", spot_date=date(2026, 11, 3))
    base.update(kw)
    return price_fx_option(**base)


def test_put_call_parity_and_signs():
    c, p = _opt(), _opt(option_type="PUT")
    fwd = 1e7 * (1.1715 - 1.18) * 0.9905
    assert c.npv - p.npv == pytest.approx(fwd, abs=1e-6)                     # C − P = DF·(F − K)·N
    s = _opt(direction="SELL")
    assert s.npv == pytest.approx(-c.npv) and s.vega == pytest.approx(-c.vega) and s.spot01 == pytest.approx(-c.spot01)
    assert c.vega > 0 and p.vega > 0 and c.spot01 > 0 and p.spot01 < 0 and c.theta < 0
    assert c.ir01 == pytest.approx(c.ir01_disc + c.ir01_base)
    assert gk_value(1.1715, 1.18, 0.0, 0.075, True) == 0.0 and gk_value(1.1715, 1.10, 0.0, 0.075, True) == pytest.approx(0.0715)


def test_greeks_agree_with_finite_differences():
    c = _opt()
    up, dn = _opt(forward=1.1715 * 1.01), _opt(forward=1.1715 * 0.99)
    assert c.spot01 == pytest.approx(up.npv - c.npv) and c.gamma_1pct == pytest.approx(up.npv - 2 * c.npv + dn.npv)
    assert c.vega == pytest.approx(_opt(vol=0.085).npv - c.npv)
    assert c.delta_base_units == pytest.approx(c.forward_delta * 1e7 * 0.9905 * 1.1715 / 1.165)
    assert 0.0 < c.forward_delta < 0.5                                       # an out-of-the-money call


def test_validation():
    with pytest.raises(ValueError):
        _opt(option_type="STRADDLE")
    with pytest.raises(ValueError):
        _opt(expiry_date=VAL)
    with pytest.raises(ValueError):
        _opt(settlement_date=EXP - timedelta(days=1))
    with pytest.raises(ValueError):
        _opt(vol=0.0)


def test_surface_parse_lookup_and_tiers():
    grid = {"1M": {"ATM": 7.0, "RR25": -0.4, "BF25": 0.2}, "1Y": {"ATM": 7.8, "RR25": -0.6, "BF25": 0.3}, "9M": {"ATM": 7.6}}
    q = quotes_from_grid(grid)
    P = parse_surface(q)
    assert [round(p.t, 3) for p in P] == [0.083, 0.75, 1.0] and P[1].smile is False
    F = 1.17
    assert vol_at(P, 0.5, F, F * 0.98) > vol_at(P, 0.5, F, F * 1.02)                              # puts dearer: negative RR
    assert vol_at(P, 0.5, F, F * 0.90) > vol_at(P, 0.5, F, F) and vol_at(P, 0.5, F, F * 1.10) > vol_at(P, 0.5, F, F)   # both wings above ATM: BF
    v, tier, note = lookup_vol(q, "EURUSD", 0.5, F, F)
    assert tier == "SURFACE" and 0.07 < v < 0.08 and "Malz" in note
    v2, tier2, _ = lookup_vol([{"tenor": "1M", "quote_type": "ATM", "rate": 9.0}, {"tenor": "1Y", "quote_type": "ATM", "rate": 9.5}], "EURUSD", 2.0, F, F)
    assert tier2 == "ATM" and v2 == pytest.approx(0.095)                   # flat beyond the last tenor
    assert lookup_vol(None, "USDJPY", 0.5, 150, 150)[1] == "DEFAULT" and lookup_vol(None, "USDJPY", 0.5, 150, 150, 11.0)[1] == "OVERRIDE"


# ── route and booked valuation, on a mocked database ─────────────────────────
def _c(rate):
    return Curve(VAL, flat_rate=rate)


def _mock_db(vol_quotes=None):
    spot_row = MagicMock(valuation_date=VAL, quotes=[{"tenor": "SPOT", "rate": 1.1650}], source="IMPORT")
    curve_row = MagicMock(valuation_date=VAL, quotes=[{"tenor": "1Y", "rate": 2.0}, {"tenor": "5Y", "rate": 2.2}], source="MANUAL")
    vol_row = MagicMock(valuation_date=VAL, quotes=vol_quotes, source="MANUAL") if vol_quotes else None
    db = MagicMock()
    def execute(sql, params=None):
        r = MagicMock(); c = (params or {}).get("c", "")
        r.first.return_value = spot_row if c.endswith("_SPOT") else curve_row if c == "EUR_ESTR" else vol_row if c.endswith("_VOL") else None
        return r
    db.execute.side_effect = execute
    return db


def test_option_route_prices_from_snapshots_and_names_the_vol_tier():
    from api.routes import currencies
    import main
    from fastapi.testclient import TestClient
    vol_q = quotes_from_grid({"1M": {"ATM": 7.0, "RR25": -0.4, "BF25": 0.2}, "1Y": {"ATM": 7.8, "RR25": -0.6, "BF25": 0.3}})
    db = _mock_db(vol_q)
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    curves = {"USD_SOFR": _c(0.04), "EUR_ESTR": _c(0.02)}
    try:
        with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: curves[cid]):
            r = TestClient(main.app).post("/api/currency/option/price", json={
                "pair": "eurusd", "option_type": "CALL", "base_notional": 10_000_000, "expiry_date": EXP.isoformat(), "valuation_date": VAL.isoformat()})
            o = TestClient(main.app).post("/api/currency/option/price", json={
                "pair": "EURUSD", "option_type": "PUT", "base_notional": 10_000_000, "expiry_date": EXP.isoformat(), "valuation_date": VAL.isoformat(),
                "strike": 1.15, "vol_pct": 9.0, "direction": "SELL"})
    finally:
        main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["shape"] == "OPTION" and b["vol_tier"] == "SURFACE" and b["strike"] == pytest.approx(b["forward"])      # at the forward
    assert b["settlement_date"] == "2027-02-02" and b["npv"] > 0 and b["vega"] > 0 and b["quote_currency"] == "USD"
    assert o.status_code == 200 and o.json()["vol_tier"] == "OVERRIDE" and o.json()["npv"] < 0 and o.json()["vol_pct"] == 9.0


def _trade(side="BUY", **terms):
    t = {"direction": side, "currency_pair": "EURUSD", "base_currency": "EUR", "quote_currency": "USD", "base_notional": "10000000",
         "option_type": "CALL", "strike": "1.18", "expiry_date": EXP.isoformat(), "settlement_date": SET.isoformat(), "settlement_type": "DELIVERABLE",
         "premium_amount": "95000", "premium_currency": "USD", "premium_payment_date": "2026-11-03", **terms}
    return SimpleNamespace(id="FXO1", trade_ref="TRD-FXO", instrument_type="FX_OPTION", status="CONFIRMED", notional=1e7, notional_ccy="EUR",
                           discount_curve_id="USD_SOFR", forecast_curve_id=None, terms=t, trade_date=VAL, effective_date=VAL, maturity_date=SET,
                           counterparty_id=None, user_id="u", desk="FX", book="G10", asset_class="FX", structure="VANILLA")


class FakeMarket:
    def __init__(self, as_of, curves):
        self.as_of, self.curves = as_of, curves
    def quotes(self, cid): return self.curves.get(cid)
    def single(self, cid, tenor):
        for q in self.quotes(cid) or []:
            if q["tenor"] == tenor: return float(q["rate"])
        return None
    def spot(self, pair): return self.single(f"{pair}_SPOT", "SPOT")
    def snapshot_date(self, cid): return self.as_of
    def override(self, cid, quotes): return FakeMarket(self.as_of, {**self.curves, cid: quotes})
    def with_single(self, cid, tenor, rate): return self.override(cid, [{"tenor": tenor, "rate": rate}])
    def signature(self): return f"{self.as_of}|" + "|".join(f"{k}={v}" for k, v in sorted(self.curves.items()))


USD = [{"tenor": "ON", "rate": 4.0}, {"tenor": "1Y", "rate": 3.9}, {"tenor": "5Y", "rate": 3.8}]
VOL = quotes_from_grid({"1M": {"ATM": 7.0, "RR25": -0.4, "BF25": 0.2}, "1Y": {"ATM": 7.8, "RR25": -0.6, "BF25": 0.3}})


def _market(as_of, spot=1.165, vol=VOL, usd=USD):
    return FakeMarket(as_of, {"USD_SOFR": usd, "EURUSD_SPOT": [{"tenor": "SPOT", "rate": spot}], "EURUSD_VOL": vol, "EUR_FLAT": [{"tenor": "FLAT", "rate": 2.0}]})


@pytest.fixture
def curves(monkeypatch):
    from api.routes import pricer
    monkeypatch.setattr(pricer, "_build_curve", lambda ci, vd, db, uid: Curve(vd, flat_rate=0.04 if ci.curve_id == "USD_SOFR" else 0.02))
    from api.routes import currencies
    monkeypatch.setattr(currencies, "forward_mode", lambda db, uid: "IMPLIED")


def test_booked_option_is_valued_with_vega_and_the_vol_curve_is_a_risk_factor(curves):
    from pnl.valuation import trade_curves, value
    t = _trade()
    assert trade_curves(t)[-1] == "EURUSD_VOL"
    v = value(None, {"sub": "u"}, t, VAL, _market(VAL))
    assert v["ccy"] == "USD" and v["npv"] > 0 and v["vega"] > 0 and "Garman" in v["model"]
    sold = value(None, {"sub": "u"}, _trade("SELL"), VAL, _market(VAL))
    assert sold["npv"] == pytest.approx(-v["npv"])
    nodata = value(None, {"sub": "u"}, t, VAL, _market(VAL, vol=None))
    assert "EURUSD_VOL" in nodata["fallback"] and "default" in nodata["model"]
    # after expiry, before settlement: the fixed payoff discounted, no Greeks
    after = value(None, {"sub": "u"}, t, EXP + timedelta(days=1), _market(EXP + timedelta(days=1), spot=1.20))
    assert after["vega"] == 0.0 and after["npv"] == pytest.approx(1e7 * (1.20 - 1.18) * after["npv"] / (1e7 * (1.20 - 1.18)))
    assert after["npv"] > 0.99 * 1e7 * 0.02


def test_explain_has_a_vol_step_and_the_ladder_a_vega_bucket(curves, monkeypatch):
    from pnl import explain as E
    from risk import sensitivities as S
    monkeypatch.setattr(E, "cash_settled", lambda db, trade, d0, d1: {})
    t = _trade()
    d0, d1 = VAL, VAL + timedelta(days=1)
    m0 = _market(d0)
    vol_up = quotes_from_grid({"1M": {"ATM": 8.0, "RR25": -0.4, "BF25": 0.2}, "1Y": {"ATM": 8.8, "RR25": -0.6, "BF25": 0.3}})
    m1 = _market(d1, spot=1.17, vol=vol_up)
    r = E.explain_trade(None, {"sub": "u"}, t, d0, d1, m0, m1)
    buckets = [x["bucket"] for x in r["rows"]]
    assert "FX" in buckets and "VOL" in buckets and buckets.index("FX") < buckets.index("VOL")
    vol_rows = [x for x in r["rows"] if x["bucket"] == "VOL"]
    assert sum(x["pnl"] for x in vol_rows) > 0 and all(x["curve"] == "EURUSD_VOL" for x in vol_rows)
    assert sum(x["pnl"] for x in r["rows"]) == pytest.approx(r["mark"] - r["mark_prev"], abs=1e-6)
    lad = S.trade_ladder(None, {"sub": "u"}, t, VAL, m0, E.Valuer(None, {"sub": "u"}))
    assert "EURUSD_VOL" in lad["vega"] and lad["vega_total"] > 0 and "EURUSD_VOL" not in lad["kr01"]
    assert lad["vega_total"] == pytest.approx(sum(lad["vega"]["EURUSD_VOL"].values()))


def test_exposure_paths_value_the_option_and_fix_the_payoff_at_expiry():
    from ccr import calibration as C
    from ccr.options import value_fx_option
    from ccr.simulate import simulate
    key, skey = "RATES:USD_SOFR", "SPOT:EURUSD"
    f = {key: C.Factor(key, "RATES", a=0.03, sigma=0.008), skey: C.Factor(skey, "SPOT", sigma=0.08)}
    cal = C.Calibration("RISK_NEUTRAL", f, np.eye(2), [key, skey], drift_mode="forward")
    p = simulate(cal, {key: Curve(VAL, flat_rate=0.04)}, {skey: 1.165}, {skey: (0.04, 0.02)}, VAL, 12, n_paths=20000, seed=5)
    expiry, settle = date(2027, 4, 30), date(2027, 5, 4)
    item = {"pair": "EURUSD", "base": "EUR", "quote": "USD", "K": 1.17, "option_type": "CALL", "expiry": expiry, "settle": settle, "N": 1e7,
            "vol": 0.08, "sign": 1.0}
    fx, flat = {"USD": 1.0}, {"EURUSD": 0.02}
    v0 = value_fx_option(item, p, 0, fx, flat)
    T_s = (settle - VAL).days / 365.0
    F0 = 1.165 * np.exp((0.04 - 0.02) * T_s)
    analytic = 1e7 * gk_value(F0, 1.17, (expiry - VAL).days / 365.0, 0.08, True, np.exp(-0.04 * T_s))
    assert float(v0[0]) == pytest.approx(analytic, rel=1e-3)                 # today: the closed form on today's forward (the paths read the curve at day granularity)
    i_exp = p.grid.index(expiry)
    at = value_fx_option(item, p, i_exp, fx, flat)
    assert np.all(at >= 0) and (at == 0).mean() > 0.2                        # fixed payoff, zero where out of the money
    r = p.r[key]; dts = np.diff(p.t)
    D = np.exp(-np.cumsum(0.5 * (r[:, 1:] + r[:, :-1]) * dts[None, :], axis=1))[:, i_exp - 1]
    mc = float((D * at).mean()); se = float((D * at).std() / np.sqrt(len(at)))
    assert abs(mc - analytic) < 4 * se + 0.002 * analytic                   # discounted payoff averages to the price
    sold = {**item, "sign": -1.0}
    assert np.allclose(value_fx_option(sold, p, 0, fx, flat), -v0)
    assert np.all(value_fx_option(item, p, p.grid.index(date(2027, 6, 30)), fx, flat) == 0.0)   # settled


def test_canonical_record_names_buyer_and_seller_and_hashes_the_same_both_ways():
    from chain.canonical import canonical_payload as canonical_record
    own = SimpleNamespace(lei="529900T8BM49AURSDO55", name="Rijeka")
    cp = SimpleNamespace(lei="5493001KJTIIGC8Y1R12", name="Demo Bank")
    mine = _trade("BUY")
    theirs = _trade("SELL")
    a = canonical_record(mine, [], own, cp)
    b = canonical_record(theirs, [], cp, own)
    assert a == b
    prod = a["product"]
    assert prod["product"] == "FX_OPTION" and prod["buyer"] == own.lei and prod["seller"] == cp.lei and prod["option_type"] == "CALL"
    assert prod["quote_notional"] == "11800000" and prod["exercise_style"] == "EUROPEAN" and prod["automatic_exercise"] is True
    with pytest.raises(ValueError):
        canonical_record(_trade(settlement_type="NON_DELIVERABLE"), [], own, cp)     # an NDO names its fixing
    ndo = canonical_record(_trade(settlement_type="NON_DELIVERABLE", settlement_currency="USD", fixing_source="WM/Reuters 4pm London"), [], own, cp)
    assert ndo["product"]["product"] == "FX_NDO"
