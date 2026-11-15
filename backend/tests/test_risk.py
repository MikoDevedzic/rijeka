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


def test_rate_scenarios_leave_vol_surfaces_alone_and_vol_scenarios_move_the_level():
    surf = [{"tenor": "3M", "quote_type": "ATM", "rate": 7.0}, {"tenor": "3M", "quote_type": "RR25", "rate": -0.3}, {"tenor": "3M", "quote_type": "BF25", "rate": 0.2}]
    grid = [{"tenor": "1Yx5Y", "quote_type": "SWVOL", "rate": 85.0}]
    m = _M({"USD_SOFR": [{"tenor": "1Y", "rate": 4.0}], "EURUSD_VOL": surf, "USD_SWVOL_ATM": grid}, {})
    dn = ST.shifted_market(m, {"rates": {"*": -100}}, ["USD_SOFR", "EURUSD_VOL", "USD_SWVOL_ATM"], [])
    assert dn.quotes("EURUSD_VOL") == surf and dn.quotes("USD_SWVOL_ATM") == grid and dn.quotes("USD_SOFR")[0]["rate"] == 3.0
    up = ST.shifted_market(m, {"vols": {"FX": 5, "SWVOL": 50}}, ["USD_SOFR", "EURUSD_VOL", "USD_SWVOL_ATM"], [])
    assert [q["rate"] for q in up.quotes("EURUSD_VOL")] == [12.0, -0.3, 0.2] and up.quotes("USD_SWVOL_ATM")[0]["rate"] == 135.0
    assert up.quotes("USD_SOFR")[0]["rate"] == 4.0
    assert {s["id"] for s in ST.SCENARIOS} >= {"VOL_UP", "VOL_DN"}


def test_stored_report_carries_no_nan():
    from risk.report import finite
    nan = float("nan")
    assert finite({"a": nan, "b": [1.0, float("inf"), {"c": nan}], "d": "x", "e": 2.5}) == {"a": None, "b": [1.0, None, {"c": None}], "d": "x", "e": 2.5}
    assert finite(nan) is None and finite(3.0) == 3.0


def test_typical_moves_are_the_sample_standard_deviation_of_each_buckets_daily_changes():
    """Worked by hand: 1, 3, 5, 7 has mean 4 and squared deviations 9 + 1 + 1 + 9 = 20; over n − 1 = 3 that is 6.6667,
    whose root is 2.58199. A spot's 2, −2 has mean 0 and 8 / 1 = 8, root 2.82843. One change alone gives no figure."""
    days = [date(2026, 1, d) for d in (5, 6, 7, 8)]
    ch = {"USD_SOFR": [(d, {"0-1Y": v, "1-5Y": 2 * v}) for d, v in zip(days, (1.0, 3.0, 5.0, 7.0))],
          "BTC_SPOT": [(days[0], {"SPOT": 2.0}), (days[1], {"SPOT": -2.0})],
          "EUR_ESTR": [(days[0], {"0-1Y": 4.0})],
          "EMPTY": []}
    m = V.typical_moves(ch)
    assert abs(m["stdev"]["USD_SOFR"]["0-1Y"] - 2.581988897) < 1e-9
    assert abs(m["stdev"]["USD_SOFR"]["1-5Y"] - 2 * 2.581988897) < 1e-9          # twice the changes, twice the move
    assert abs(m["stdev"]["BTC_SPOT"]["SPOT"] - 2.828427125) < 1e-9
    assert "EUR_ESTR" not in m["stdev"] and "EMPTY" not in m["stdev"]             # nothing is said from one change
    assert m["observations"] == {"USD_SOFR": 4, "BTC_SPOT": 2}
    assert V.typical_moves({})["stdev"] == {} and V.typical_moves(None)["stdev"] == {}


def test_the_report_carries_the_moves_beside_the_var_and_the_var_is_as_it_was():
    """The ladder VaR's own figures do not change by being read for the moves: same P&L vector, same quantile."""
    days = [date(2026, 1, d) for d in range(5, 15)]
    ch = {"USD_SOFR": [(d, {"1-5Y": float(i - 4)}) for i, d in enumerate(days)]}
    ladder = [{"curve": "USD_SOFR", "buckets": {"1-5Y": -1000.0}, "total": -1000.0}]
    pnl, missing = V.simulate(ladder, {}, ch)
    assert not missing and [v for _, v in pnl] == [-1000.0 * (i - 4) for i in range(10)]
    sd = V.typical_moves(ch)["stdev"]["USD_SOFR"]["1-5Y"]
    assert abs(sd - 3.0276503541) < 1e-9                                          # stdev of −4 … 5
    assert abs(1000.0 * sd - 3027.6503541) < 1e-6                                 # what a usual day moves that bucket by


def _book():
    """A report's ladder and rows for a book on two curves, a currency, a digital asset, a surface and a forward basis."""
    rows = [{"desk": "RATES", "book": "G10", "npv": 0.0, "ir01": 4000.0, "usd_rate": 1.0, "kr01": {"USD_SOFR": {"1-5Y": 3000.0, "5-10Y": 1000.0}}, "spot01": {},
             "vega": {"USD_SWVOL_ATM": {"1-5Y": 1200.0, "5-10Y": -200.0}}, "fund01": {}},
            {"desk": "DIGITAL", "book": "BTC", "npv": 0.0, "ir01": 0.0, "usd_rate": 2.0, "kr01": {"EUR_ESTR": {"0-1Y": -400.0}}, "spot01": {"BTC": 30000.0, "EUR": -5000.0},
             "vega": {}, "fund01": {"BTC_FUNDING": {"FLAT": 600.0}}}]
    return {"ladder_rows": rows, "var": {}, "stress": [],
            "ladder": {"ladder": [{"curve": "EUR_ESTR", "buckets": {}, "total": -800.0}, {"curve": "USD_SOFR", "buckets": {}, "total": 4000.0}],
                       "spot01": {"BTC": 60000.0, "EUR": -10000.0}, "vega": [{"curve": "USD_SWVOL_ATM", "buckets": {}, "total": 1000.0}],
                       "crybasis01": {"BTC_FUNDING": -1200.0}}}


def test_a_limit_can_be_set_on_a_surfaces_vega_and_on_a_forward_basis():
    rep = _book()
    assert L.metric_value("VEGA:USD_SWVOL_ATM", rep, rep["ladder_rows"]) == 1000.0                 # 1,200 − 200, the size
    assert L.metric_value("VEGA:USD_SWVOL_ATM:5-10Y", rep, rep["ladder_rows"]) == 200.0
    assert L.metric_value("VEGA:NOPE", rep, rep["ladder_rows"]) == 0.0
    assert L.metric_value("CRYBASIS01:BTC_FUNDING", rep, rep["ladder_rows"]) == 1200.0             # 600 in a currency at 2 to the dollar
    ev = L.evaluate([{"id": "v", "metric": "VEGA:USD_SWVOL_ATM", "scope": "ALL", "scope_name": None, "limit": 1250.0, "warn_pct": 80.0},
                     {"id": "b", "metric": "CRYBASIS01:BTC_FUNDING", "scope": "ALL", "scope_name": None, "limit": 1000.0, "warn_pct": 80.0}], rep)
    by = {e["metric"]: e for e in ev}
    assert by["VEGA:USD_SWVOL_ATM"]["status"] == "WARN" and round(by["VEGA:USD_SWVOL_ATM"]["utilisation_pct"], 6) == 80.0
    assert by["CRYBASIS01:BTC_FUNDING"]["status"] == "BREACH" and round(by["CRYBASIS01:BTC_FUNDING"]["utilisation_pct"], 6) == 120.0


def test_every_curve_of_the_book_has_a_limit_its_own_or_the_standard_one_for_its_kind():
    rep = _book()
    ev = L.evaluate([], rep)
    got = {e["metric"]: (e["limit"], e.get("standard"), e.get("kind"), round(e["utilisation_pct"], 4), e["status"]) for e in ev}
    assert got == {"IR01:EUR_ESTR": (50000.0, True, "IR01", 1.6, "OK"), "IR01:USD_SOFR": (50000.0, True, "IR01", 8.0, "OK"),
                   "SPOT01:BTC": (75000.0, True, "CRY01", 80.0, "WARN"), "SPOT01:EUR": (150000.0, True, "FX01", 6.6667, "OK"),
                   "VEGA:USD_SWVOL_ATM": (25000.0, True, "VEGA", 4.0, "OK"), "CRYBASIS01:BTC_FUNDING": (10000.0, True, "CRYBASIS01", 12.0, "OK")}
    # a curve's own limit on its total takes the standard one's place; a limit on one of its buckets does not
    own = [{"id": "1", "metric": "ir01:usd_sofr", "scope": "ALL", "scope_name": None, "limit": 4000.0, "warn_pct": 80.0},
           {"id": "2", "metric": "KR01:EUR_ESTR:0-1Y", "scope": "ALL", "scope_name": None, "limit": 1000.0, "warn_pct": 80.0},
           {"id": "3", "metric": "SPOT01:BTC", "scope": "DESK", "scope_name": "DIGITAL", "limit": 1.0, "warn_pct": 80.0}]
    ev = L.evaluate(own, rep)
    sofr = [e for e in ev if e["metric"].upper() == "IR01:USD_SOFR"]
    assert len(sofr) == 1 and sofr[0]["limit"] == 4000.0 and not sofr[0].get("standard") and sofr[0]["status"] == "BREACH"
    assert sum(1 for e in ev if e["metric"] == "IR01:EUR_ESTR" and e.get("standard")) == 1          # still limited as a whole
    assert sum(1 for e in ev if e["metric"] == "SPOT01:BTC" and e.get("standard")) == 1             # a desk's limit is not the book's
    assert len(ev) == 3 + 5


def test_a_firm_sets_the_standard_size_of_a_kind_and_it_is_not_itself_a_limit_on_anything():
    rep = _book()
    lims = [{"id": "s", "metric": "STANDARD:IR01", "scope": "ALL", "scope_name": None, "limit": 5000.0, "warn_pct": 70.0, "set_by": "RISK"}]
    std = L.standards(lims)
    assert std["IR01"] == {"kind": "IR01", "limit": 5000.0, "warn_pct": 70.0, "id": "s", "set_by": "RISK", "built_in": False, "unit": "per bp, a curve"}
    assert std["VEGA"]["built_in"] and std["VEGA"]["limit"] == L.STANDARD_SIZES["VEGA"] and set(std) == set(L.STANDARD_SIZES)
    ev = {e["metric"]: e for e in L.evaluate(lims, rep)}
    assert "STANDARD:IR01" not in ev
    assert ev["IR01:USD_SOFR"]["limit"] == 5000.0 and ev["IR01:USD_SOFR"]["status"] == "WARN" and ev["IR01:USD_SOFR"]["warn_pct"] == 70.0      # 80% used, warned from 70%
    assert ev["IR01:EUR_ESTR"]["limit"] == 5000.0 and ev["SPOT01:BTC"]["limit"] == L.STANDARD_SIZES["CRY01"]
    assert L.evaluate([], {"ladder_rows": [], "var": {}, "stress": []}) == []                       # a report with no ladder has no curves to limit


def test_a_standard_limit_has_no_row_to_remove_and_a_kind_that_is_not_one_sets_no_size():
    assert L.remove_limit(None, "firm", "standard:IR01:USD_SOFR") == 0          # no query is made: a database that is not there is not touched
    assert L.remove_limit(None, "firm", "") == 0
    lims = [{"id": "x", "metric": "STANDARD:NOPE", "scope": "ALL", "scope_name": None, "limit": 1.0, "warn_pct": 80.0},
            {"id": "y", "metric": "STANDARD:IR01", "scope": "DESK", "scope_name": "RATES", "limit": 1.0, "warn_pct": 80.0}]
    std = L.standards(lims)
    assert set(std) == set(L.STANDARD_SIZES) and all(v["built_in"] for v in std.values())
    assert all(not e["metric"].upper().startswith("STANDARD:") for e in L.evaluate(lims, _book()))
    assert "XAU" in L._FIAT and [k for k, m in L.factor_metrics({"ladder": {"spot01": {"XAU": 1.0, "SOL": 1.0}}})] == ["FX01", "CRY01"]


# ── fixings: what resets, day by day ─────────────────────────────────────────

from risk import fixings as F          # noqa: E402


def test_a_fixing_counts_for_the_days_to_the_next_business_day_and_none_is_listed_for_a_day_already_fixed():
    """Friday 6 Nov 2026 to Friday 13 Nov, New York: Wednesday 11 Nov is Veterans Day. Seen from Monday 9 Nov."""
    days = F.fixing_days(date(2026, 11, 6), date(2026, 11, 13), date(2026, 11, 9), date(2027, 1, 1), "NEW_YORK")
    assert days == [(date(2026, 11, 9), 1), (date(2026, 11, 10), 2), (date(2026, 11, 12), 1)]              # Tuesday's fixing carries the holiday
    # seen from the Saturday, Friday's fixing (which carries the weekend) is made: the first to come is Monday's
    assert F.fixing_days(date(2026, 11, 6), date(2026, 11, 13), date(2026, 11, 7), date(2027, 1, 1), "NEW_YORK")[0] == (date(2026, 11, 9), 1)
    # the whole period from its start: seven calendar days in all, and the last fixing stops at the period's end
    whole = F.fixing_days(date(2026, 11, 6), date(2026, 11, 13), date(2026, 11, 1), date(2027, 1, 1), "NEW_YORK")
    assert whole[0] == (date(2026, 11, 6), 3) and sum(k for _, k in whole) == 7
    assert F.fixing_days(date(2026, 11, 6), date(2026, 11, 13), date(2026, 11, 6), date(2026, 11, 9), "NEW_YORK") == [(date(2026, 11, 6), 3), (date(2026, 11, 9), 1)]   # nothing past the horizon
    # a period whose dates are not adjusted and that opens on a Saturday (17 Feb 2029, with Presidents' Day on the Monday):
    # its first three days are set by Friday's fixing, the day before it opens, and every day of the period is counted
    opens = F.fixing_days(date(2029, 2, 17), date(2029, 5, 17), date(2026, 11, 2), date(2100, 1, 1), "NEW_YORK")
    assert opens[0] == (date(2029, 2, 16), 3) and opens[1] == (date(2029, 2, 20), 1) and sum(k for _, k in opens) == (date(2029, 5, 17) - date(2029, 2, 17)).days
    # seen from that Saturday itself, Friday's fixing is made: the three days are not listed
    assert F.fixing_days(date(2029, 2, 17), date(2029, 5, 17), date(2029, 2, 17), date(2100, 1, 1), "NEW_YORK")[0] == (date(2029, 2, 20), 1)


def test_a_periods_fixing_01s_add_up_to_one_basis_point_on_the_period_and_are_signed_by_the_side_of_the_float():
    """100m, a quarter on ACT/360 (dcf 92/360), paid at a discount factor of 0.99: one bp on the period's rate is
    100e6 x 92/360 x 0.99 x 1e-4 = 2,530.00. Worked by hand; each day is its share of the 92 days."""
    cf = {"period_start": "2026-11-16", "period_end": "2027-02-16", "notional": 100e6, "dcf": 92 / 360, "df": 0.99, "cashflow_type": "COUPON"}
    rec = F.period_resets(cf, {"direction": "RECEIVE", "currency": "USD", "leg_type": "FLOAT"}, "USD_SOFR", "NEW_YORK", date(2026, 11, 1), date(2027, 12, 31))
    assert abs(sum(r["fixing01"] for r in rec) - 2530.0) < 1e-6 and sum(r["days"] for r in rec) == 92
    assert all(r["notional"] == 100e6 and r["index"] == "USD_SOFR" and r["ccy"] == "USD" for r in rec)
    first = rec[0]
    assert first["date"] == date(2026, 11, 16) and first["days"] == 1 and abs(first["fixing01"] - 100e6 / 360 * 0.99 * 1e-4) < 1e-9     # 27.50 a day
    fri = next(r for r in rec if r["date"] == date(2026, 11, 20))
    assert fri["days"] == 3 and abs(fri["fixing01"] - 3 * first["fixing01"]) < 1e-9                                                       # a Friday carries the weekend
    pay = F.period_resets(cf, {"direction": "PAY", "currency": "USD", "leg_type": "OIS"}, "USD_SOFR", "NEW_YORK", date(2026, 11, 1), date(2027, 12, 31))
    assert abs(sum(r["fixing01"] for r in pay) + 2530.0) < 1e-6 and pay[0]["notional"] == -100e6                                          # paying the float: short the fixing
    # part way through: only the days still to fix
    later = F.period_resets(cf, {"direction": "RECEIVE", "currency": "USD", "leg_type": "FLOAT"}, "USD_SOFR", "NEW_YORK", date(2027, 2, 12), date(2027, 12, 31))
    assert [(r["date"], r["days"]) for r in later] == [(date(2027, 2, 12), 4)]                                                              # Friday, over the weekend and Presidents' Day, to the period's end
    assert F.period_resets({**cf, "dcf": 0}, {"direction": "PAY"}, "X", "NEW_YORK", date(2026, 11, 1), date(2027, 1, 1)) == []


def test_only_a_floating_legs_coupons_reset_on_the_legs_own_curve_and_on_the_days_of_its_currency():
    cf = {"period_start": "2026-11-16", "period_end": "2027-02-16", "fixing_date": "2026-11-12", "notional": 50e6, "dcf": 0.25, "df": 0.98, "cashflow_type": "COUPON"}
    legs = [{"leg_id": "f", "leg_type": "FIXED", "direction": "PAY", "currency": "USD", "cashflows": [cf]},
            {"leg_id": "o", "leg_type": "OIS", "direction": "RECEIVE", "currency": "USD", "cashflows": [cf, {**cf, "cashflow_type": "CAPLET"}]}]
    rows = F.trade_resets(legs, {"o": {"forecast_curve_id": "usd_sofr"}}, "USD_LIBOR", date(2026, 11, 16), date(2026, 11, 20))
    assert {r["index"] for r in rows} == {"USD_SOFR"} and [r["date"].day for r in rows] == [16, 17, 18, 19, 20]                              # the floating leg's coupon only, on its own curve
    assert F.trade_resets(legs[1:], {}, "USD_SOFR", date(2026, 11, 16), date(2026, 11, 16))[0]["index"] == "USD_SOFR"                        # no leg record: the trade's curve
    # a CMS leg is valued by the pricer as the same compounded forward, and is listed the same way: day by day
    cms = F.trade_resets([{"leg_id": "c", "leg_type": "CMS", "direction": "RECEIVE", "currency": "USD", "cashflows": [cf]}], {}, "USD_SOFR", date(2026, 11, 16), date(2026, 11, 18))
    assert [r["date"].day for r in cms] == [16, 17, 18]
    # the days are the index's own: a euro leg resets on TARGET days whatever calendar its payments roll on.
    # Thursday 26 Nov 2026 is Thanksgiving in New York and a business day in TARGET
    eur = [{"leg_id": "e", "leg_type": "FLOAT", "direction": "PAY", "currency": "EUR", "cashflows": [cf]}]
    days = {r["date"] for r in F.trade_resets(eur, {"e": {"payment_calendar": "NEW_YORK", "forecast_curve_id": "EUR_ESTR"}}, "", date(2026, 11, 23), date(2026, 11, 27))}
    assert date(2026, 11, 26) in days
    usd = {r["date"] for r in F.trade_resets(legs[1:], {}, "USD_SOFR", date(2026, 11, 23), date(2026, 11, 27))}
    assert date(2026, 11, 26) not in usd and date(2026, 11, 25) in usd


def test_a_fixing_01_carries_the_compounding_of_the_periods_other_days():
    """Worked without the code: a quarter of daily overnight forwards at 5 % (ACT/360), 100m, discount factor 0.99.
    The period pays N x (Π(1 + f·n/360) − 1); moving one day's forward by 1bp changes it by N x n/360 x 1bp x the
    product over the other days. The code writes that product with the period's own rate for every day's."""
    from pricing.calendars import is_business_day
    start, end, n_, df, f = date(2026, 11, 16), date(2027, 2, 16), 100e6, 0.99, 0.05
    days = F.fixing_days(start, end, start, end, "NEW_YORK")
    assert all(is_business_day(d, "NEW_YORK") for d, _ in days) and sum(k for _, k in days) == 92
    grow = 1.0
    for _, k in days:
        grow *= 1.0 + f * k / 360.0
    rate = (grow - 1.0) / (92 / 360.0)                                   # the period's compounded rate, on its own day count
    cf = {"period_start": start.isoformat(), "period_end": end.isoformat(), "notional": n_, "dcf": 92 / 360.0, "df": df, "rate": rate, "cashflow_type": "COUPON"}
    rows = F.period_resets(cf, {"direction": "RECEIVE", "currency": "USD", "leg_type": "FLOAT"}, "USD_SOFR", "NEW_YORK", start, end)
    for (d, k), r in zip(days, rows):
        exact = n_ * df * (k / 360.0) * 1e-4 * grow / (1.0 + f * k / 360.0)
        assert r["date"] == d and abs(r["fixing01"] / exact - 1.0) < 2e-5, (d, r["fixing01"], exact)
    plain = n_ * (92 / 360.0) * df * 1e-4                                # 2,530.00: without the compounding
    total = sum(r["fixing01"] for r in rows)
    assert 1.012 < total / plain < 1.013                                 # low by R·τ, about 1.3 % on a quarter at 5 %
    # with no rate on the cashflow the factor is one, and the days add up to the plain figure
    assert abs(sum(r["fixing01"] for r in F.period_resets({**cf, "rate": None}, {"direction": "RECEIVE"}, "X", "NEW_YORK", start, end)) - plain) < 1e-6


def test_leverage_scales_a_reset_a_leg_at_leverage_nought_has_none_and_a_capped_floater_is_counted():
    cf = {"period_start": "2026-11-16", "period_end": "2027-02-16", "notional": 100e6, "dcf": 92 / 360, "df": 0.99, "rate": 0.10, "cashflow_type": "COUPON"}
    leg = [{"leg_id": "x", "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "cashflows": [cf]}]
    one = F.trade_resets([{**leg[0], "cashflows": [{**cf, "rate": 0.05}]}], {"x": {"leverage": 1}}, "USD_SOFR", date(2026, 11, 16), date(2026, 11, 16))[0]
    two = F.trade_resets(leg, {"x": {"leverage": 2}}, "USD_SOFR", date(2026, 11, 16), date(2026, 11, 16))[0]            # twice the index: the cashflow's rate is 2 x 5 %
    assert two["notional"] == 2 * one["notional"] == 200e6 and abs(two["fixing01"] - 2 * one["fixing01"]) < 1e-9
    assert F.trade_resets(leg, {"x": {"leverage": 0}}, "USD_SOFR", date(2026, 11, 16), date(2026, 11, 20)) == []        # how a cap is booked: no linear exposure
    assert F.trade_resets(leg, {"x": {"leverage": None}}, "USD_SOFR", date(2026, 11, 16), date(2026, 11, 16))[0]["notional"] == 100e6
    assert F.embedded_options({"a": {"leg_type": "FLOAT", "cap_rate": 0.06}, "b": {"leg_type": "FLOAT"}, "c": {"leg_type": "FIXED", "cap_rate": 0.06},
                               "d": {"leg_type": "OIS", "floor_rate": 0.0, "leverage": 1}, "e": {"leg_type": "FLOAT", "cap_rate": 0.05, "leverage": 0}}) == 2


def test_a_non_deliverable_forward_fixes_once_on_its_fixing_date_signed_by_its_side():
    class T:                                                  # noqa: D401
        terms = {"fixing_date": "2026-12-11"}
    buy = F.settlement_fixing(T, {"notional": 250.0, "direction": "BUY", "settle": date(2026, 12, 15)}, "BTCUSD", "CME CF BRR", 22900.0, date(2026, 11, 13))
    assert buy == {"date": date(2026, 12, 11), "pair": "BTCUSD", "source": "CME CF BRR", "unit": "BTC", "units": 250.0, "spot01": 22900.0, "note": ""}
    sell = F.settlement_fixing(T, {"notional": 5e6, "direction": "SELL", "fixing_date": date(2027, 1, 4)}, "EURUSD", "", -500.0, date(2026, 11, 13))
    assert sell["units"] == -5e6 and sell["date"] == date(2027, 1, 4) and sell["unit"] == "EUR"                                              # the terms' own date first
    assert F.settlement_fixing(T, {"notional": 1.0, "direction": "BUY"}, "BTCUSD", "", None, date(2026, 12, 12)) is None                    # fixed already
    # a trade that names no fixing date is listed on its settlement date and says so; a currency's on a Saturday says that too
    class N:                                                  # noqa: D401
        terms = {}
    sat = F.settlement_fixing(N, {"notional": 1e7, "direction": "BUY", "settle": date(2027, 2, 13)}, "EURUSD", "WM/Reuters 4pm London", 1.0, date(2026, 11, 2))
    assert sat["date"] == date(2027, 2, 13) and sat["note"] == "its settlement date, a weekend"
    assert F.settlement_fixing(N, {"notional": 10.0, "direction": "BUY", "fixing_date": date(2027, 2, 13)}, "BTCUSD", "CME CF BRR", 1.0, date(2026, 11, 2))["note"] == ""      # a digital asset fixes every day
