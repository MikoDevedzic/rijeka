"""Market risk: VaR quantiles and simulation, limit evaluation, stress shifts, route guards."""
from datetime import date

from risk import limits as L
from risk import stress as ST
from risk import var as V


def test_var_quantiles_are_losses_and_es_exceeds_var():
    pnl = [float(x) for x in range(-100, 100)]            # -100 .. 99
    q = V.quantiles(pnl, 0.99)
    assert 97 <= q["var"] <= 100 and q["es"] >= q["var"]
    assert V.quantiles([], 0.99) == {"var": 0.0, "es": 0.0}
    assert V.quantiles([5.0, 6.0], 0.99)["var"] == 0.0        # no losses in the window


def test_simulation_applies_bucket_changes_and_spot_returns_on_common_dates():
    ladder = [{"curve": "USD_SOFR", "buckets": {"0-1Y": 0.0, "1-5Y": 1000.0, "5-10Y": 0.0, "10Y+": 0.0}}]
    spot01 = {"EUR": 500.0}
    d1, d2, d3 = date(2026, 1, 2), date(2026, 1, 3), date(2026, 1, 4)
    changes = {"USD_SOFR": [(d1, {"1-5Y": 2.0}), (d2, {"1-5Y": -1.0}), (d3, {"1-5Y": 0.5})],
               "EUR_SPOT": [(d1, {"SPOT": 1.0}), (d2, {"SPOT": -2.0})]}
    pnl, missing = V.simulate(ladder, spot01, changes)
    assert missing == [] and [d for d, _ in pnl] == [d1, d2]                 # d3 has no spot observation
    assert [round(v, 6) for _, v in pnl] == [2500.0, -2000.0]
    pnl2, missing2 = V.simulate(ladder, {"BTC": 10.0}, {"USD_SOFR": changes["USD_SOFR"]})
    assert missing2 == ["BTC_SPOT"] and len(pnl2) == 3


def test_bucket_mapping_averages_tenors():
    assert V._to_buckets({"ON": 9, "1M": 1.0, "6M": 3.0, "2Y": 5.0, "7Y": 2.0, "30Y": 4.0}) == {"0-1Y": 2.0, "1-5Y": 5.0, "5-10Y": 2.0, "10Y+": 4.0}


def _rep():
    rows = [{"desk": "RATES", "book": "G10", "npv": 1000.0, "ir01": 4000.0, "usd_rate": 1.0, "kr01": {"USD_SOFR": {"1-5Y": 3000.0, "5-10Y": 1000.0}}, "spot01": {}},
            {"desk": "FX", "book": "SPOT", "npv": -200.0, "ir01": 10.0, "usd_rate": 1.0, "kr01": {"USD_SOFR": {"0-1Y": 10.0}}, "spot01": {"EUR": 110000.0}}]
    return {"ladder_rows": rows, "var": {"var_1d": 25000.0, "var_1d_secondary": 15000.0, "es_1d": 30000.0, "var_h": 25000.0},
            "stress": [{"id": "PARALLEL_UP_100", "pnl_usd": -400000.0}, {"id": "RISK_OFF", "pnl_usd": 5000.0}]}


def test_metric_values_and_utilisation():
    rep = _rep()
    assert L.metric_value("VAR_99_1D", rep, rep["ladder_rows"]) == 25000.0
    assert L.metric_value("IR01", rep, rep["ladder_rows"]) == 4010.0
    assert L.metric_value("IR01:USD_SOFR", rep, [rep["ladder_rows"][0]]) == 4000.0
    assert L.metric_value("KR01:USD_SOFR:1-5Y", rep, rep["ladder_rows"]) == 3000.0
    assert L.metric_value("SPOT01:EUR", rep, rep["ladder_rows"]) == 110000.0
    assert L.metric_value("NPV", rep, rep["ladder_rows"]) == 800.0
    assert L.metric_value("STRESS:PARALLEL_UP_100", rep, []) == 400000.0 and L.metric_value("STRESS:RISK_OFF", rep, []) == 0.0
    assert L.metric_value("NOPE", rep, []) is None
    lims = [{"metric": "VAR_99_1D", "scope": "ALL", "scope_name": None, "limit": 20000.0, "warn_pct": 80.0},
            {"metric": "IR01", "scope": "DESK", "scope_name": "RATES", "limit": 5000.0, "warn_pct": 75.0},
            {"metric": "SPOT01:EUR", "scope": "BOOK", "scope_name": "SPOT", "limit": 200000.0, "warn_pct": 80.0},
            {"metric": "VAR_99_1D", "scope": "DESK", "scope_name": "RATES", "limit": 1.0, "warn_pct": 80.0}]
    ev = L.evaluate(lims, rep)
    assert [e["status"] for e in ev] == ["BREACH", "WARN", "OK", "NA"]
    assert round(ev[0]["utilisation_pct"], 1) == 125.0 and round(ev[1]["utilisation_pct"], 1) == 80.0 and ev[3]["note_eval"]


class _M:
    """A minimal Market for the stress shifter."""
    def __init__(self, q, s): self.q, self.s = dict(q), dict(s)
    def quotes(self, cid): return self.q.get(cid)
    def spot(self, pair): return self.s.get(pair)
    def override(self, cid, quotes): m = _M(self.q, self.s); m.q[cid] = quotes; return m
    def with_single(self, cid, tenor, rate): m = _M(self.q, self.s); m.s[cid.replace("_SPOT", "")] = rate; return m


def test_stress_shifts_rates_by_bucket_and_spots_by_quote_direction():
    m = _M({"USD_SOFR": [{"tenor": "1Y", "rate": 4.0}, {"tenor": "10Y", "rate": 4.5}]}, {"EURUSD": 1.10, "USDJPY": 150.0, "BTCUSD": 80000.0})
    up = ST.shifted_market(m, {"rates": {"*": 100}}, ["USD_SOFR"], [])
    assert [q["rate"] for q in up.quotes("USD_SOFR")] == [5.0, 5.5]
    st = ST.shifted_market(m, {"rates_by_bucket": {"0-1Y": -25, "5-10Y": 25}}, ["USD_SOFR"], [])   # 10Y sits in the 5-10Y bucket
    assert [round(q["rate"], 4) for q in st.quotes("USD_SOFR")] == [3.75, 4.75]
    fx = ST.shifted_market(m, {"spots": {"EUR": -10, "JPY": 10, "BTC": -30}}, [], ["EURUSD", "USDJPY", "BTCUSD"])
    assert round(fx.spot("EURUSD"), 4) == 0.99 and round(fx.spot("USDJPY"), 2) == 135.0 and fx.spot("BTCUSD") == 56000.0
    assert {s["id"] for s in ST.SCENARIOS} >= {"PARALLEL_UP_100", "STEEPENER_50", "USD_UP_10", "CRYPTO_DN_30", "RISK_OFF"}


def test_routes_need_auth_or_cron():
    import main
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    assert c.get("/api/risk/report").status_code == 401 and c.get("/api/risk/limits").status_code == 401
    assert c.post("/api/risk/daily/tick").status_code == 403 and c.post("/api/risk/history/backfill").status_code == 401
