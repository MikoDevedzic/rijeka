"""Demo market data: public-source parsers, curve builders, synthetic vols, and the tick route."""
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from market_data import demo_feed as f

SOFR_JSON = '{ "refRates": [ { "effectiveDate": "2026-10-28", "type": "SOFR" ,"percentRate": 3.94 } ] }'
UST_XML = """<feed><entry><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-27T00:00:00</d:NEW_DATE>
<d:BC_1MONTH m:type="Edm.Double">4.05</d:BC_1MONTH><d:BC_2MONTH m:type="Edm.Double">4.10</d:BC_2MONTH>
<d:BC_3MONTH m:type="Edm.Double">4.15</d:BC_3MONTH><d:BC_4MONTH m:type="Edm.Double">4.20</d:BC_4MONTH>
<d:BC_6MONTH m:type="Edm.Double">4.30</d:BC_6MONTH><d:BC_1YEAR m:type="Edm.Double">4.40</d:BC_1YEAR>
<d:BC_2YEAR m:type="Edm.Double">4.60</d:BC_2YEAR><d:BC_3YEAR m:type="Edm.Double">4.70</d:BC_3YEAR>
<d:BC_5YEAR m:type="Edm.Double">4.80</d:BC_5YEAR><d:BC_7YEAR m:type="Edm.Double">4.90</d:BC_7YEAR>
<d:BC_10YEAR m:type="Edm.Double">5.00</d:BC_10YEAR><d:BC_20YEAR m:type="Edm.Double">5.20</d:BC_20YEAR>
<d:BC_30YEAR m:type="Edm.Double">5.30</d:BC_30YEAR></m:properties></entry>
<entry><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-28T00:00:00</d:NEW_DATE>
<d:BC_1MONTH m:type="Edm.Double">4.07</d:BC_1MONTH><d:BC_2MONTH m:type="Edm.Double">4.12</d:BC_2MONTH>
<d:BC_3MONTH m:type="Edm.Double">4.18</d:BC_3MONTH><d:BC_4MONTH m:type="Edm.Double">4.22</d:BC_4MONTH>
<d:BC_6MONTH m:type="Edm.Double">4.33</d:BC_6MONTH><d:BC_1YEAR m:type="Edm.Double">4.47</d:BC_1YEAR>
<d:BC_2YEAR m:type="Edm.Double">4.67</d:BC_2YEAR><d:BC_3YEAR m:type="Edm.Double">4.75</d:BC_3YEAR>
<d:BC_5YEAR m:type="Edm.Double">4.85</d:BC_5YEAR><d:BC_7YEAR m:type="Edm.Double">4.95</d:BC_7YEAR>
<d:BC_10YEAR m:type="Edm.Double">5.05</d:BC_10YEAR><d:BC_20YEAR m:type="Edm.Double">5.30</d:BC_20YEAR>
<d:BC_30YEAR m:type="Edm.Double">5.37</d:BC_30YEAR></m:properties></entry></feed>"""
ESTR_CSV = "KEY,FREQ,TIME_PERIOD,OBS_VALUE\nEST.B.EU000A2X2A25.WT,B,2026-10-28,2.439\n"
AAA_CSV = "KEY,TIME_PERIOD,OBS_VALUE\n" + "\n".join(
    f"YC.B.U2.EUR.4F.G_N_A.SV_C_YM.PY_{k},2026-10-28,{v}"
    for k, v in [("3M", 2.55), ("6M", 2.65), ("1Y", 2.9), ("2Y", 3.05), ("5Y", 3.15), ("10Y", 3.37), ("20Y", 3.55), ("30Y", 3.58)])
BOE_CSV = "DATE,IUDSOIA,IUDSNPY,IUDMNPY,IUDLNPY\n26 Oct 2026,3.7328,4.9407,5.3048,5.5955\n27 Oct 2026,3.734,4.9444,5.3046,5.5902\n"
SNB_CSV = '"Date";"D0";"Value"\n"2026-08";"SARON";"-0.060456"\n"2026-09";"SARON";"-0.067988"\n'


# ── parsers ────────────────────────────────────────────────────────────────────

def test_parsers_read_the_fixtures():
    assert f.fetch_sofr(SOFR_JSON) == (date(2026, 10, 28), 3.94)
    d, ust = f.fetch_ust_par(text=UST_XML)
    assert d == date(2026, 10, 28) and ust[10] == 5.05 and ust[1 / 12] == 4.07     # latest entry wins
    assert f.fetch_estr(ESTR_CSV) == (date(2026, 10, 28), 2.439)
    d, aaa = f.fetch_ecb_aaa_par(AAA_CSV)
    assert d == date(2026, 10, 28) and aaa[0.25] == 2.55 and aaa[30.0] == 3.58
    d, boe = f.fetch_boe(text=BOE_CSV)
    assert d == date(2026, 10, 27) and boe["SONIA"] == 3.734 and boe["20Y"] == 5.5902
    assert f.fetch_saron(SNB_CSV) == (date(2026, 9, 1), -0.067988)


def test_parsers_reject_empty_feeds():
    with pytest.raises(ValueError):
        f.parse_ust_xml("<feed></feed>")
    with pytest.raises(ValueError):
        f.fetch_boe(text="DATE,A\n")
    with pytest.raises(ValueError):
        f.fetch_saron('"Date";"D0";"Value"\n')


# ── builders ───────────────────────────────────────────────────────────────────

def test_usd_sofr_curve_has_the_template_pillars_and_sits_below_treasuries():
    _, ust = f.fetch_ust_par(text=UST_XML)
    qs = f.build_usd_sofr(3.94, ust)
    assert [q["tenor"] for q in qs] == f.OIS_TENORS
    assert qs[0] == {"tenor": "ON", "quote_type": "OISDeposit", "rate": 3.94, "enabled": True}
    assert all(q["quote_type"] == "OIS" for q in qs[1:])
    by = {q["tenor"]: q["rate"] for q in qs}
    assert by["10Y"] == pytest.approx(5.05 - 0.40, abs=1e-6)        # spread schedule applied
    assert by["30Y"] == pytest.approx(5.37 - 0.70, abs=1e-6)
    assert by["50Y"] == by["30Y"]                                      # flat beyond the last government point
    assert 3.94 <= by["1W"] <= by["1M"] <= 4.07                        # short end blends from the fixing
    assert by["18M"] == pytest.approx((4.47 - 0.20 + 4.67 - 0.25) / 2, abs=0.02)


def test_eur_and_gbp_curves_apply_their_spreads():
    _, aaa = f.fetch_ecb_aaa_par(AAA_CSV)
    eur = {q["tenor"]: q["rate"] for q in f.build_eur_estr(2.439, aaa)}
    assert eur["ON"] == 2.439 and eur["10Y"] == pytest.approx(3.37 + 0.30, abs=1e-6)
    _, boe = f.fetch_boe(text=BOE_CSV)
    gbp = {q["tenor"]: q["rate"] for q in f.build_gbp_sonia(boe)}
    assert gbp["ON"] == 3.734 and gbp["10Y"] == pytest.approx(5.3046 - 0.40, abs=1e-6)
    assert gbp["20Y"] == pytest.approx(5.5902 - 0.70, abs=1e-6)
    assert gbp["1Y"] < gbp["5Y"]                                       # interpolates up to the first gilt point


def test_synthetic_vols_are_smooth_and_in_range():
    atm = {q["tenor"]: q["rate"] for q in f.build_swvol_atm()}
    assert len(atm) == 30 and set(atm) >= {"1Yx5Y", "5Yx5Y", "7Yx9Y"}
    assert 60 < min(atm.values()) and max(atm.values()) < 110
    assert atm["1Yx1Y"] > atm["5Yx1Y"] > atm["7Yx1Y"]                 # level falls with expiry
    assert atm["1Yx1Y"] > atm["1Yx9Y"]                                 # and with tenor
    cells = f.build_skew_cells("DEMO · synthetic surface")
    assert len(cells) == 15
    c = cells[0]
    assert c["spread_p200"] > c["spread_p100"] > c["spread_p50"] > c["spread_p25"] >= 0
    assert c["spread_m200"] > c["spread_m100"] > 0 and c["spread_p200"] > c["spread_m200"]   # slight call skew
    rows = f.build_cap_rows(date(2026, 10, 29), lambda y: 4.0 + 0.1 * y, "DEMO · synthetic surface")
    assert len(rows) == len(f.CAP_TENORS) * len(f.CAP_SPREADS)
    atm_rows = [r for r in rows if r["is_atm"]]
    assert len(atm_rows) == len(f.CAP_TENORS) and atm_rows[0]["strike_pct"] == 4.1
    assert all(r["flat_vol_bp"] >= next(a["flat_vol_bp"] for a in atm_rows if a["cap_tenor_y"] == r["cap_tenor_y"]) for r in rows)


def test_assemble_skips_curves_whose_feed_failed_and_stamps_sources():
    collected = {"ok": {"sofr": (date(2026, 10, 28), 3.94), "ust": f.fetch_ust_par(text=UST_XML)[0:2] and f.fetch_ust_par(text=UST_XML)},
                 "failed": {"estr": "timeout", "aaa": "timeout", "boe": "timeout", "saron": "timeout"}}
    built = f.assemble(collected, date(2026, 10, 29))
    assert set(built["curves"]) == {"USD_SOFR", "USD_SWVOL_ATM"}
    assert built["curves"]["USD_SOFR"]["source"].startswith("DEMO · NY Fed SOFR") and "as of 2026-10-28" in built["curves"]["USD_SOFR"]["source"]
    assert built["curves"]["USD_SWVOL_ATM"]["source"] == "DEMO · synthetic surface"
    assert built["failed"]["estr"] == "timeout" and len(built["caps"]) == 54
    # cap strikes follow the demo par curve
    par = f.par_rate_lookup(built["curves"]["USD_SOFR"]["quotes"])
    assert next(r for r in built["caps"] if r["is_atm"] and r["cap_tenor_y"] == 5.0)["strike_pct"] == pytest.approx(par(5.0), abs=1e-6)


def test_helpers():
    assert f.tenor_years("18M") == 1.5 and f.tenor_years("2W") == pytest.approx(14 / 365)
    assert f.interp([(1, 10), (3, 30)], 2) == 20 and f.interp([(1, 10), (3, 30)], 9) == 30
    with pytest.raises(ValueError):
        f.tenor_years("1Q")


# ── route ──────────────────────────────────────────────────────────────────────

def test_tick_needs_the_cron_secret(monkeypatch):
    import main
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    c = TestClient(main.app)
    assert c.post("/api/market-data/demo/tick").status_code == 403
    assert c.post("/api/market-data/demo/tick", headers={"X-Rijeka-Cron": "wrong"}).status_code == 403


def test_tick_dry_run_builds_without_writing(monkeypatch):
    import main
    from api.routes import demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    main.app.dependency_overrides[r.get_db] = lambda: db
    collected = {"ok": {"sofr": (date(2026, 10, 28), 3.94), "ust": f.fetch_ust_par(text=UST_XML)}, "failed": {"boe": "down"}}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), \
         patch.object(r.demo_feed, "collect", return_value=collected):
        resp = TestClient(main.app).post("/api/market-data/demo/tick?dry_run=1", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    b = resp.json()
    assert b["dry_run"] is True and b["curves"]["USD_SOFR"]["quotes"] == 33 and b["failed_sources"] == {"boe": "down"}
    assert b["preview"]["USD_SOFR"][0]["tenor"] == "ON"
    db.execute.assert_not_called()


def test_tick_writes_template_rows_then_copies_to_demo_accounts(monkeypatch):
    import main
    from api.routes import demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    db.execute.return_value.all.return_value = [("visitor-1",), ("visitor-2",)]
    main.app.dependency_overrides[r.get_db] = lambda: db
    collected = {"ok": {"sofr": (date(2026, 10, 28), 3.94), "ust": f.fetch_ust_par(text=UST_XML)}, "failed": {}}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), \
         patch.object(r.demo_feed, "collect", return_value=collected), \
         patch.object(r.demo, "_copy_market_data", return_value={"market_data_snapshots": 2}) as copy:
        resp = TestClient(main.app).post("/api/market-data/demo/tick", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    b = resp.json()
    assert b["skew_saved"] == 15 and b["sabr_fitted"] == 15 and b["caps_saved"] == 54 and b["copied_to"] == 2
    assert copy.call_count == 2 and copy.call_args_list[0].args[1:] == ("tmpl", "visitor-1")
    sqls = [str(c.args[0]) for c in db.execute.call_args_list]
    assert sum("INSERT INTO market_data_snapshots" in s for s in sqls) == 2          # USD_SOFR + USD_SWVOL_ATM
    assert sum("INSERT INTO sabr_params" in s for s in sqls) == 15
    assert sum("INSERT INTO cap_vol_surface" in s for s in sqls) == 54
    assert db.commit.called


def test_sources_is_public_and_lists_assumptions():
    import main
    from api.routes import demo_market_data as r
    db = MagicMock()
    db.execute.return_value.all.return_value = [MagicMock(curve_id="USD_SOFR", valuation_date=date(2026, 10, 29), source="DEMO · x")]
    main.app.dependency_overrides[r.get_db] = lambda: db
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"):
        resp = TestClient(main.app).get("/api/market-data/demo/sources")
    main.app.dependency_overrides.clear()
    assert resp.status_code == 200
    b = resp.json()
    assert b["latest"]["USD_SOFR"]["valuation_date"] == "2026-10-29"
    assert {s["curve"] for s in b["sources"]} >= {"USD_SOFR", "EUR_ESTR", "USD_SWVOL_ATM"}
    assert b["assumptions"]["USD_OIS_MINUS_UST_bp"][-1] == [30, -70]


def test_tick_explains_a_source_whitelist_that_predates_demo_data(monkeypatch):
    import main
    from sqlalchemy.exc import IntegrityError
    from api.routes import demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    class Orig(Exception):
        pass
    db.execute.side_effect = IntegrityError("INSERT …", {}, Orig('violates check constraint "market_data_snapshots_source_check"'))
    main.app.dependency_overrides[r.get_db] = lambda: db
    collected = {"ok": {"sofr": (date(2026, 10, 28), 3.94), "ust": f.fetch_ust_par(text=UST_XML)}, "failed": {}}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), \
         patch.object(r.demo_feed, "collect", return_value=collected):
        resp = TestClient(main.app).post("/api/market-data/demo/tick", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert resp.status_code == 409
    assert "2026-10-29_demo_market_data_source.sql" in resp.json()["detail"]
    assert db.rollback.called and not db.commit.called


JGB_CSV = """Interest Rate (October 2026),,,,,,,,,,,,,,,(Unit : %)
Date,1Y,2Y,3Y,4Y,5Y,6Y,7Y,8Y,9Y,10Y,15Y,20Y,25Y,30Y,40Y
2026/10/27,1.66,1.90,2.00,2.15,2.27,2.35,2.46,2.60,2.72,2.85,3.37,3.67,3.96,3.93,3.96
2026/10/28,1.674,1.915,2.015,2.166,2.281,2.365,2.473,2.614,2.739,2.867,3.385,3.685,3.973,3.941,3.974
"  (If you cannot download the latest csv data, please clear the browser's cache and download again.)",,,,,,,,,,,,,,,
"""
TONA_CSV = '"Date";"D0";"Value"\n"2026-08";"TONA";"0.977"\n"2026-09";"TONA";"1.226"\n'


def test_jpy_curve_from_tona_and_jgb_with_the_spread_applied():
    d, jgb = f.fetch_jgb(JGB_CSV)
    assert d == date(2026, 10, 28) and jgb[10.0] == 2.867 and jgb[40.0] == 3.974 and len(jgb) == 15
    assert f.fetch_tona(TONA_CSV) == (date(2026, 9, 1), 1.226)
    by = {q["tenor"]: q["rate"] for q in f.build_jpy_tona(1.226, jgb)}
    assert by["ON"] == 1.226 and by["10Y"] == pytest.approx(2.867 - 0.25, abs=1e-6) and by["30Y"] == pytest.approx(3.941 - 0.45, abs=1e-6)
    assert by["50Y"] == by["40Y"] and 1.226 <= by["1W"] <= by["1M"]


def test_chf_is_a_flat_term_structure_at_the_fixing():
    qs = f.build_chf_saron(-0.068)
    assert [q["tenor"] for q in qs] == f.OIS_TENORS and all(q["rate"] == -0.068 for q in qs)


def test_assemble_builds_jpy_when_both_feeds_answer():
    d, jgb = f.fetch_jgb(JGB_CSV)
    collected = {"ok": {"tona": (date(2026, 9, 1), 1.226), "jgb": (d, jgb)}, "failed": {}}
    built = f.assemble(collected, date(2026, 10, 29))
    assert "JPY_TONAR" in built["curves"] and "TONA 2026-09" in built["curves"]["JPY_TONAR"]["source"]
