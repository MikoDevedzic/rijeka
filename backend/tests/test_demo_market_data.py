"""Demo market data: synthetic rates curves, synthetic vols, and the tick route."""
import math
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from market_data import demo_feed as f
from market_data import synthetic_rates


@pytest.fixture(autouse=True)
def _feeds_on(monkeypatch):
    """The integration suite switches the demo feed off for its process; these tests are about the feed being on."""
    monkeypatch.delenv("RIJEKA_DEMO_MARKET_DATA", raising=False)
    monkeypatch.delenv("RIJEKA_DERIBIT", raising=False)


# ── rates curves ───────────────────────────────────────────────────────────────

def test_rates_curve_has_the_template_pillars_with_their_quote_types():
    assert len(f.RATE_CURVES) == 5
    for curve in f.RATE_CURVES:
        qs = f.build_rates_curve(curve, date(2026, 11, 17))
        assert [q["tenor"] for q in qs] == f.OIS_TENORS and len(qs) == 33
        assert qs[0]["quote_type"] == "OISDeposit" and all(q["quote_type"] == "OIS" for q in qs[1:])
        assert all(q["enabled"] is True for q in qs)


def test_overnight_pillar_is_the_generators_overnight_rate_to_four_decimals():
    d = date(2026, 11, 17)
    for curve in f.RATE_CURVES:
        assert f.build_rates_curve(curve, d)[0]["rate"] == round(synthetic_rates.overnight(curve, d), 4)


def test_every_rate_is_finite():
    for curve in f.RATE_CURVES:
        assert all(math.isfinite(q["rate"]) for q in f.build_rates_curve(curve, date(2026, 11, 17)))


def test_the_same_date_gives_the_same_quotes_and_two_business_days_differ():
    for curve in f.RATE_CURVES:
        assert f.build_rates_curve(curve, date(2026, 11, 17)) == f.build_rates_curve(curve, date(2026, 11, 17))
        assert f.build_rates_curve(curve, date(2026, 11, 17)) != f.build_rates_curve(curve, date(2026, 11, 18))


def test_a_saturday_carries_the_friday_before():
    sat, fri = date(2026, 11, 14), date(2026, 11, 13)
    assert sat.weekday() == 5 and fri.weekday() == 4
    for curve in f.RATE_CURVES:
        assert f.build_rates_curve(curve, sat) == f.build_rates_curve(curve, fri)


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


def test_assemble_builds_every_rates_curve_whatever_was_collected_and_keeps_the_vol_surfaces():
    built = f.assemble({"ok": {}, "failed": {"x": "timeout"}}, date(2026, 10, 29))
    fx_vols = {f"{pair}_VOL" for pair in f.VOL_LEVELS}                     # synthetic FX option surfaces, always written
    assert set(built["curves"]) == set(f.RATE_CURVES) | {"USD_SWVOL_ATM"} | fx_vols
    for curve in f.RATE_CURVES:
        assert len(built["curves"][curve]["quotes"]) == 33 and built["curves"][curve]["source"] == synthetic_rates.SOURCE
    assert built["curves"]["EURUSD_VOL"]["source"] == "DEMO · synthetic surface" and len(built["curves"]["EURUSD_VOL"]["quotes"]) == 24
    assert built["curves"]["USD_SWVOL_ATM"]["source"] == "DEMO · synthetic surface"
    assert built["failed"] == {"x": "timeout"} and len(built["caps"]) == 54
    # cap strikes follow the demo par curve
    par = f.par_rate_lookup(built["curves"]["USD_SOFR"]["quotes"])
    assert next(r for r in built["caps"] if r["is_atm"] and r["cap_tenor_y"] == 5.0)["strike_pct"] == pytest.approx(par(5.0), abs=1e-6)


def test_collect_fetches_nothing():
    assert f.collect() == {"ok": {}, "failed": {}}


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
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), \
         patch.object(r.demo_feed, "collect", return_value={"ok": {}, "failed": {"boe": "down"}}):
        resp = TestClient(main.app).post("/api/market-data/demo/tick?dry_run=1", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    b = resp.json()
    assert b["dry_run"] is True and b["failed_sources"] == {"boe": "down"}
    assert all(b["curves"][c] == {"quotes": 33, "source": synthetic_rates.SOURCE} for c in f.RATE_CURVES)
    assert b["preview"]["USD_SOFR"][0]["tenor"] == "ON"
    # a dry run reads (the venue's surfaces it would keep) and writes nothing
    assert all(str(c.args[0]).lstrip().startswith("SELECT") for c in db.execute.call_args_list) and not db.commit.called


def test_tick_writes_template_rows_then_copies_to_demo_accounts(monkeypatch):
    import main
    from api.routes import demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    db.execute.return_value.all.return_value = [("visitor-1",), ("visitor-2",)]
    main.app.dependency_overrides[r.get_db] = lambda: db
    venue = {"BTCUSD_VOL": {"quotes": [{"tenor": "1M", "quote_type": "ATM", "rate": 38.5, "enabled": True}],
                            "source": "DEMO · Deribit option marks · 2026-10-28 23:50 UTC · listed to 24SEP27, flat beyond"}}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), \
         patch.object(r, "kept_marks", return_value=venue), \
         patch.object(r.demo, "_copy_market_data", return_value={"market_data_snapshots": 2}) as copy:
        resp = TestClient(main.app).post("/api/market-data/demo/tick", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    b = resp.json()
    # the venue's last surface is written for the day in place of the parametric one, its own time still in the source
    assert b["curves"]["BTCUSD_VOL"] == {"quotes": 1, "source": venue["BTCUSD_VOL"]["source"]}
    assert b["curves"]["ETHUSD_VOL"]["source"] == "DEMO · synthetic surface"
    assert b["skew_saved"] == 15 and b["sabr_fitted"] == 15 and b["caps_saved"] == 54 and b["copied_to"] == 2
    assert copy.call_count == 2 and copy.call_args_list[0].args[1:] == ("tmpl", "visitor-1")
    sqls = [str(c.args[0]) for c in db.execute.call_args_list]
    assert sum("INSERT INTO market_data_snapshots" in s for s in sqls) == len(f.RATE_CURVES) + 1 + len(f.VOL_LEVELS)   # the rates curves + USD_SWVOL_ATM + the FX and digital-asset vol surfaces
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
    rates = {s["curve"]: s for s in b["sources"] if s["curve"] in f.RATE_CURVES}
    assert set(rates) == set(f.RATE_CURVES) and len(rates) == 5
    assert all(s["kind"] == "synthetic" and s["url"] is None for s in rates.values())
    a = b["assumptions"]
    assert {"rates", "shock", "seed", "parameters_set_on", "parameters_long_end_overnight_less_long_end_hump_tau", "scale", "daily_shock_bp",
            "carried_to_next_day", "mean_reversion_a_year", "shared_share_of_variance", "pillars", "overnight_pillar_years",
            "quotes_rounded_to_decimals"} <= set(a)
    assert a["seed"] == "rijeka synthetic rates 1" and "SHA-256" in a["shock"] and len(a["pillars"]) == 33
    assert a["parameters_set_on"] == "2026-11-17"
    assert set(a["parameters_long_end_overnight_less_long_end_hump_tau"]) == set(f.RATE_CURVES)


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
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), patch.object(r, "kept_marks", return_value={}):
        resp = TestClient(main.app).post("/api/market-data/demo/tick", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert resp.status_code == 409
    assert "2026-10-29_demo_market_data_source.sql" in resp.json()["detail"]
    assert db.rollback.called and not db.commit.called



# ── digital-asset marks (market_data/deribit.py) ───────────────────────────────

SPOT = {"BTC": 74_790.0, "ETH": 2121.0, "SOL": 86.7}


def _built(asset, when=None, index=None):
    from datetime import datetime, timezone
    when = when or datetime(2026, 11, 9, 12, 57, tzinfo=timezone.utc)
    return {"asset": asset, "asof": when, "index": index or SPOT[asset] * 1.0002, "last_expiry": "24SEP27", "dropped": {"10NOV26": "inside two days"},
            "vol": [{"tenor": "1M", "quote_type": "ATM", "rate": 38.5, "enabled": True}, {"tenor": "3M", "quote_type": "ATM", "rate": 38.9, "enabled": True}],
            "forward": [{"tenor": "1M", "quote_type": "FWD_POINTS", "rate": 348.3, "enabled": True}, {"tenor": "3M", "quote_type": "FWD_POINTS", "rate": 1011.7, "enabled": True}],
            "expiries": [{"code": "27NOV26"}, {"code": "24SEP27"}]}


def test_crypto_tick_writes_the_marks_with_their_time_and_pushes_them_to_demo_accounts(monkeypatch):
    import main
    from api.routes import crypto, currencies, demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    db.execute.return_value.rowcount = 12
    main.app.dependency_overrides[r.get_db] = lambda: db
    got = {"ok": {"BTC": _built("BTC"), "SOL": _built("SOL")}, "failed": {"ETH": "HTTPStatusError: 503"}}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), patch.object(r.deribit, "collect", return_value=got), \
         patch.object(crypto, "fetch_spot", return_value={"BTC": 74_790.0, "ETH": 2121.0, "SOL": 86.7}), \
         patch.object(currencies, "_save_pairs", return_value=3) as save:
        resp = TestClient(main.app).post("/api/market-data/demo/crypto/tick", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    b = resp.json()
    assert set(b["assets"]) == {"BTC", "SOL"} and b["failed"] == {"ETH": "HTTPStatusError: 503"} and b["pushed_rows"] == 12
    assert b["assets"]["BTC"]["dropped"] == 1                              # a count on the stored summary; the codes only on a dry run
    assert b["assets"]["BTC"]["marks_at"].startswith("2026-11-09T12:57")
    calls = [(str(c.args[0]), c.args[1]) for c in db.execute.call_args_list]
    upserts = [p for s, p in calls if "INSERT INTO market_data_snapshots" in s and "CROSS JOIN" not in s]
    assert [p["c"] for p in upserts] == ["BTCUSD_VOL", "BTCUSD_FWD", "SOLUSD_VOL", "SOLUSD_FWD"]            # ETH keeps the rows it has
    assert upserts[0]["s"] == "DEMO · Deribit option marks · 2026-11-09 12:57 UTC · listed to 24SEP27, flat beyond"
    assert upserts[1]["s"].startswith("DEMO · Deribit forwards · 2026-11-09 12:57 UTC")
    assert save.call_args.args[1:] == ("tmpl", {"BTCUSD": 74_790.0, "ETHUSD": 2121.0, "SOLUSD": 86.7})
    push = [p for s, p in calls if "CROSS JOIN" in s]
    assert len(push) == 1 and push[0]["t"] == "tmpl" and push[0]["p"] == "DEMO%"
    assert push[0]["ids"] == ["BTCUSD_VOL", "BTCUSD_FWD", "SOLUSD_VOL", "SOLUSD_FWD", "BTCUSD_SPOT", "ETHUSD_SPOT", "SOLUSD_SPOT"]
    # an account's own entries stand, the template's included: only a feed's rows are copied, and only a feed's rows replaced
    # (the statements' behaviour is tested on a real database in tests/integration/test_crypto_marks.py; here, that they are the guarded ones)
    assert "AND (s.source LIKE 'DEMO%' OR (s.source = 'IMPORT' AND right(s.curve_id, 5) = '_SPOT'))" in r.PUSH_SQL
    assert "(market_data_snapshots.quotes, market_data_snapshots.source) IS DISTINCT FROM (EXCLUDED.quotes, EXCLUDED.source)" in r.PUSH_SQL
    assert all(s == r.MARKS_UPSERT_SQL for s, _ in calls if "INSERT INTO market_data_snapshots" in s and "CROSS JOIN" not in s)
    assert "ORDER BY o.valuation_date DESC LIMIT 1), true)" in r.MARKS_UPSERT_SQL and "ORDER BY o.valuation_date DESC LIMIT 1), true)" in r.PUSH_SQL
    assert db.begin_nested.call_count == 2


def test_crypto_tick_writes_nothing_when_the_venue_does_not_answer_or_on_a_dry_run(monkeypatch):
    import main
    from api.routes import crypto, currencies, demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    main.app.dependency_overrides[r.get_db] = lambda: db
    c = TestClient(main.app)
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), \
         patch.object(r.deribit, "collect", return_value={"ok": {}, "failed": {a: "ConnectTimeout" for a in ("BTC", "ETH", "SOL")}}), \
         patch.object(crypto, "fetch_spot", side_effect=RuntimeError("no spot")), patch.object(currencies, "_save_pairs") as save:
        down = c.post("/api/market-data/demo/crypto/tick", headers={"X-Rijeka-Cron": "s3cret"})
    assert down.status_code == 200 and down.json()["assets"] == {} and down.json()["spot"] is None and len(down.json()["failed"]) == 3
    assert not save.called and not any("INSERT" in str(c_.args[0]) for c_ in db.execute.call_args_list)       # the last good rows stand
    db.reset_mock()
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), patch.object(r.deribit, "collect", return_value={"ok": {"BTC": _built("BTC")}, "failed": {}}), \
         patch.object(crypto, "fetch_spot", return_value=SPOT):
        dry = c.post("/api/market-data/demo/crypto/tick?dry_run=1", headers={"X-Rijeka-Cron": "s3cret"})
        assert c.post("/api/market-data/demo/crypto/tick", headers={"X-Rijeka-Cron": "nope"}).status_code == 403
        monkeypatch.setenv("RIJEKA_DERIBIT", "0")
        assert c.post("/api/market-data/demo/crypto/tick", headers={"X-Rijeka-Cron": "s3cret"}).json() == {"enabled": False}
    main.app.dependency_overrides.clear()
    assert dry.status_code == 200 and dry.json()["assets"]["BTC"]["vol"][0]["rate"] == 38.5 and dry.json()["assets"]["BTC"]["dropped"] == {"10NOV26": "inside two days"}
    assert all(str(c_.args[0]).lstrip().startswith("SELECT") for c_ in db.execute.call_args_list) and not db.commit.called      # a dry run reads and writes nothing


def test_switching_the_venue_off_removes_its_rows_at_the_daily_rebuild_and_the_public_list(monkeypatch):
    import main
    from api.routes import demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    monkeypatch.setenv("RIJEKA_DERIBIT", "0")
    db = MagicMock()
    db.execute.return_value.all.return_value = []
    db.execute.return_value.rowcount = 7
    main.app.dependency_overrides[r.get_db] = lambda: db
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"):
        resp = TestClient(main.app).post("/api/market-data/demo/tick", headers={"X-Rijeka-Cron": "s3cret"})
        listed = TestClient(main.app).get("/api/market-data/demo/sources").json()["sources"]
    main.app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    assert resp.json()["curves"]["BTCUSD_VOL"]["source"] == "DEMO · synthetic surface"
    monkeypatch.delenv("RENDER", raising=False); monkeypatch.delenv("RIJEKA_SCHEDULER", raising=False); monkeypatch.delenv("RIJEKA_DERIBIT_PURGE", raising=False)
    deletes = [c.args[1] for c in db.execute.call_args_list if "DELETE FROM market_data_snapshots WHERE source LIKE" in str(c.args[0])]
    assert deletes == []                                                   # a developer's shell on the shared database deletes nothing
    monkeypatch.setenv("RENDER", "true")
    db.reset_mock()
    main.app.dependency_overrides[r.get_db] = lambda: db
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"):
        assert TestClient(main.app).post("/api/market-data/demo/tick", headers={"X-Rijeka-Cron": "s3cret"}).status_code == 200
        assert TestClient(main.app).post("/api/market-data/demo/tick?dry_run=1", headers={"X-Rijeka-Cron": "s3cret"}).status_code == 200
    main.app.dependency_overrides.clear()
    deletes = [c.args for c in db.execute.call_args_list if "DELETE FROM market_data_snapshots WHERE source LIKE" in str(c.args[0])]
    assert len(deletes) == 1 and deletes[0][1] == {"m": "DEMO · Deribit%", "t": "tmpl", "p": "DEMO%"}      # the deployed process, once, not on the dry run
    assert "user_id = :t OR user_id IN" in str(deletes[0][0]) and "lei LIKE :p AND is_own_entity" in str(deletes[0][0])
    monkeypatch.delenv("RENDER")
    monkeypatch.delenv("RIJEKA_SCHEDULER", raising=False)
    assert not r.purge_allowed()                                           # a shell that runs no batches
    monkeypatch.setenv("RIJEKA_SCHEDULER", "1")
    assert r.purge_allowed()                                               # a self-hosted instance that runs its own batches
    monkeypatch.setenv("RIJEKA_SCHEDULER", "0")
    assert not r.purge_allowed()
    monkeypatch.setenv("RIJEKA_DERIBIT_PURGE", "1")
    assert r.purge_allowed()                                               # driven by an outside cron, and says so
    assert not any("Deribit" in s["provider"] for s in listed)


def test_the_public_sources_name_the_venue_and_health_watches_its_marks(monkeypatch):
    import main
    from api.routes import demo_market_data as r, ops
    db = MagicMock()
    db.execute.return_value.all.return_value = []
    main.app.dependency_overrides[r.get_db] = lambda: db
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"):
        listed = TestClient(main.app).get("/api/market-data/demo/sources").json()["sources"]
    main.app.dependency_overrides.clear()
    venue = {s["curve"]: s for s in listed if "Deribit" in s["provider"]}
    assert set(venue) == {f"{a}USD_{k}" for a in ("BTC", "ETH", "SOL") for k in ("VOL", "FWD")} and all(s["kind"] == "public" for s in venue.values())
    names = [c[0] for c in ops.active_checks()]
    assert names[-1] == "crypto_marks" and ops.active_checks()[-1][2] == ("hours", 2) and ops.active_checks()[-1][1] is r.last_marks_at
    monkeypatch.setenv("RIJEKA_DERIBIT", "0")
    assert "crypto_marks" not in [c[0] for c in ops.active_checks()] and ops.active_checks() == ops.CHECKS
    monkeypatch.delenv("RIJEKA_DERIBIT")
    monkeypatch.setenv("RIJEKA_DEMO_MARKET_DATA", "0")           # an instance on its own marks never runs the tick: nothing to watch
    assert ops.active_checks() == ops.CHECKS


def test_an_index_that_disagrees_with_the_spot_is_not_stored(monkeypatch):
    from api.routes import crypto, currencies, demo_market_data as r
    db = MagicMock()
    db.execute.return_value.rowcount = 0
    got = {"ok": {"BTC": _built("BTC", index=SPOT["BTC"] * 1.08), "ETH": _built("ETH"), "SOL": _built("SOL", index=SPOT["SOL"] * 1000)}, "failed": {}}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), patch.object(r.deribit, "collect", return_value=got), \
         patch.object(crypto, "fetch_spot", return_value=SPOT), patch.object(currencies, "_save_pairs", return_value=3):
        out = r.refresh_crypto(db)
    assert set(out["assets"]) == {"ETH"} and out["failed"] == {"BTC": "index 8% from the spot", "SOL": "index 99900% from the spot"}
    written = [c.args[1]["c"] for c in db.execute.call_args_list if "INSERT INTO market_data_snapshots" in str(c.args[0]) and "CROSS JOIN" not in str(c.args[0])]
    assert written == ["ETHUSD_VOL", "ETHUSD_FWD"]
    # no fresh spot: the last stored one is the reference, with a wider band (it may be hours old)
    db.reset_mock()
    got = {"ok": {"BTC": _built("BTC", index=SPOT["BTC"] * 1.08), "ETH": _built("ETH", index=SPOT["ETH"] * 1.4)}, "failed": {}}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), patch.object(r.deribit, "collect", return_value=got), \
         patch.object(r, "_reference_spots", return_value=({}, {"BTCUSD": SPOT["BTC"], "ETHUSD": SPOT["ETH"]})):
        out = r.refresh_crypto(db)
    assert set(out["assets"]) == {"BTC"} and out["failed"] == {"ETH": "index 40% from the spot"} and out["spot"] is None


def test_one_asset_that_cannot_be_stored_does_not_take_the_others_with_it():
    from api.routes import crypto, currencies, demo_market_data as r
    db = MagicMock()
    db.execute.return_value.rowcount = 0
    bad = _built("BTC")
    bad["forward"] = [{"tenor": "1M", "quote_type": "FWD_POINTS", "rate": float("nan"), "enabled": True}]
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"), patch.object(r.deribit, "collect", return_value={"ok": {"BTC": bad, "ETH": _built("ETH")}, "failed": {}}), \
         patch.object(crypto, "fetch_spot", return_value=SPOT), patch.object(currencies, "_save_pairs", return_value=3):
        out = r.refresh_crypto(db)
    assert set(out["assets"]) == {"ETH"} and out["failed"] == {"BTC": "not stored (ValueError)"}       # NaN is refused before the database sees it
    push = [c.args[1] for c in db.execute.call_args_list if "CROSS JOIN" in str(c.args[0])]
    assert push[0]["ids"][:2] == ["ETHUSD_VOL", "ETHUSD_FWD"] and "BTCUSD_FWD" not in push[0]["ids"]


def test_health_reads_the_time_the_marks_carried_for_the_template_only():
    from datetime import datetime, timezone
    from api.routes import demo_market_data as r
    label = "DEMO · Deribit option marks · 2026-11-09 {} UTC · listed to 24SEP27, flat beyond"
    def db_with(sources):
        db = MagicMock()
        db.execute.return_value.all.return_value = [MagicMock(curve_id=c, source=s) for c, s in sources.items()]
        return db
    three = {"BTCUSD_VOL": label.format("12:57"), "ETHUSD_VOL": label.format("12:47"), "SOLUSD_VOL": label.format("09:10")}
    with patch.object(r.demo, "_template_user_id", return_value="tmpl"):
        db = db_with(three)
        assert r.last_marks_at(db) == datetime(2026, 11, 9, 9, 10, tzinfo=timezone.utc)                  # the oldest asset decides
        assert db.execute.call_args.args[1] == {"u": "tmpl", "ids": ["BTCUSD_VOL", "ETHUSD_VOL", "SOLUSD_VOL"]}
        assert r.last_marks_at(db_with({**three, "SOLUSD_VOL": "DEMO · synthetic surface"})) is None      # an asset back on the parametric surface
        assert r.last_marks_at(db_with({k: v for k, v in three.items() if k != "ETHUSD_VOL"})) is None    # an asset with no surface
    with patch.object(r.demo, "_template_user_id", return_value=None):
        assert r.last_marks_at(MagicMock()) is None
