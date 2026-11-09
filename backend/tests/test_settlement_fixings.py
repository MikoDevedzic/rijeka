"""Fixings for digital assets: the venue's delivery prices to rows (market_data/deribit.py), the store
(settlement/store.py), the tick, the scheduler step and the health check, the desk's own entry, and the one
settlement rule (settlement/rule.py) as the booked valuation applies it.

No network and none of the venue's data: every payload and price here is made up."""
from __future__ import annotations

import json
import logging
import math
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from market_data import deribit as D
from pricing.curve import Curve
from settlement import rule as R, store as S
from tests.test_crypto_option import BTC_VOL, _trade as _option
from tests.test_deribit import _Client, _Stream
from tests.test_fx_option import FakeMarket, USD

TODAY = date(2026, 11, 9)
FIX_DAY = date(2027, 1, 29)                    # tests/test_crypto_option.EXP: the option's expiry, and the forward's fixing date here
SETTLE = FIX_DAY + timedelta(days=1)
BRR, DELIVERY = "CME CF BRR", "Deribit BTC delivery price"


@pytest.fixture(autouse=True)
def _feeds_on(monkeypatch):
    """The integration suite switches the demo feed off for its process; these tests say when they want it off."""
    monkeypatch.delenv("RIJEKA_DEMO_MARKET_DATA", raising=False)
    monkeypatch.delenv("RIJEKA_DERIBIT", raising=False)


def payload(rows) -> dict:
    return {"result": {"data": [{"date": d, "delivery_price": v} for d, v in rows], "records_total": len(rows)}}


# ── the venue's delivery prices to rows ────────────────────────────────────────

def test_delivery_prices_become_rows_ascending_by_date():
    rows = D.parse_delivery(payload([("2026-11-09", 70_300.5), ("2026-11-08", 70_100.0), ("2026-11-07", 69_900.25)]), "BTC", TODAY)
    assert rows == [{"pair": "BTCUSD", "fixing_date": date(2026, 11, d), "fixing_time": "08:00 UTC", "source": DELIVERY, "value": v}
                    for d, v in ((7, 69_900.25), (8, 70_100.0), (9, 70_300.5))]
    assert D.delivery_source("ETH") == "Deribit ETH delivery price" and set(D.DELIVERY_INDEX) == set(D.ASSETS)
    assert D.DELIVERY_INDEX == {"BTC": "btc_usd", "ETH": "eth_usd", "SOL": "sol_usd"}


def test_junk_non_finite_numbers_strings_and_future_dates_never_become_a_fixing():
    good = [("2026-11-07", 100.0), ("2026-11-08", 101.0), ("2026-11-09", 102.0)]
    junk = [("2026-11-10", 103.0),                                  # tomorrow
            ("2026-11-06", float("nan")), ("2026-11-05", float("inf")), ("2026-11-04", "99.5"), ("2026-11-03", True), ("2026-11-02", None),
            ("2026-11-01", 0.0), ("2026-10-31", -5.0),
            ("2026-13-01", 99.0), ("2026-02-30", 99.0), ("26-11-06", 99.0), ("2026-11-6", 99.0), (" 2026-11-06", 99.0), ("2026-11-06\n", 99.0),
            ("2026-11-06T08:00:00", 99.0), ("٢٠٢٦-١١-٠٦", 99.0), ("2026/11/06", 99.0), (20261106, 99.0), (None, 99.0), ("<script>", 99.0)]
    p = payload(good + junk)
    p["result"]["data"] += ["not a row", None, 7, [], {"date": "2026-11-06"}, {"delivery_price": 99.0}]
    rows = D.parse_delivery(p, "SOL", TODAY)
    assert [(r["fixing_date"].isoformat(), r["value"]) for r in rows] == good
    assert all(r["pair"] == "SOLUSD" and r["source"] == "Deribit SOL delivery price" for r in rows)
    json.dumps([r["value"] for r in rows], allow_nan=False)
    # a payload that is not the expected shape gives nothing, never an error
    for not_it in (None, [], "x", 5, {}, {"result": None}, {"result": []}, {"result": {"data": None}}, {"result": {"data": {"date": "2026-11-09"}}}, {"error": {"message": "<b>busy</b>"}}):
        assert D.parse_delivery(not_it, "BTC", TODAY) == []
    # the first row for a date stands; a second one for the same date is not a correction this module accepts
    assert [r["value"] for r in D.parse_delivery(payload([("2026-11-09", 102.0), ("2026-11-09", 55.0)]), "BTC", TODAY)] == [102.0]
    # today is today in UTC when no date is given: a row dated well ahead never passes
    ahead = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    assert D.parse_delivery(payload([(ahead, 100.0)]), "BTC") == []


def test_a_price_far_from_the_days_around_it_is_dropped_and_the_row_cap_holds():
    days = [(date(2026, 10, 1) + timedelta(days=i)).isoformat() for i in range(30)]
    clean = [(d, 70_000.0 + 150.0 * i) for i, d in enumerate(days)]
    for bad_at, bad in ((0, 7.0), (14, 700_000.0), (29, 70_000.0 * 0.39), (15, 70_000.0 * 1.75)):
        rows = D.parse_delivery(payload([(d, bad if i == bad_at else v) for i, (d, v) in enumerate(clean)]), "BTC", TODAY)
        assert [r["fixing_date"].isoformat() for r in rows] == [d for i, d in enumerate(days) if i != bad_at], bad_at
    # inside the band a move is a market: a fall of half in a day is kept, and so is a trend that doubles over the month
    half = D.parse_delivery(payload([(d, v * (0.5 if i >= 20 else 1.0)) for i, (d, v) in enumerate(clean)]), "BTC", TODAY)
    trend = D.parse_delivery(payload([(d, 100.0 * 1.025 ** i) for i, d in enumerate(days)]), "SOL", TODAY)
    assert len(half) == 30 and len(trend) == 30
    # two rows that disagree beyond the band have nothing to be judged by: neither is stored
    assert D.parse_delivery(payload([("2026-11-09", 70_000.0), ("2026-11-08", 7.0)]), "BTC", TODAY) == []
    assert len(D.parse_delivery(payload([("2026-11-09", 70_000.0)]), "BTC", TODAY)) == 1
    # more rows than the cap: only the first MAX_DELIVERY_ROWS are read
    many = [((date(2026, 11, 9) - timedelta(days=i)).isoformat(), 70_000.0) for i in range(D.MAX_DELIVERY_ROWS + 50)]
    got = D.parse_delivery(payload(many), "BTC", TODAY)
    assert len(got) == D.MAX_DELIVERY_ROWS and got[-1]["fixing_date"] == TODAY and D.DELIVERY_BAND == 0.60


def test_the_delivery_read_is_capped_deadlined_and_reports_in_its_own_words(monkeypatch):
    body = json.dumps(payload([("2026-11-09", 70_000.0)])).encode()
    ok = _Client(_Stream([body[:20], body[20:]]))
    assert D.parse_delivery(D.fetch_delivery("SOL", ok, 3), "SOL", TODAY)[0]["value"] == 70_000.0
    assert ok.asked == ("GET", D.DELIVERY_API, {"index_name": "sol_usd", "count": 3})
    assert D.DELIVERY_API == "https://www.deribit.com/api/v2/public/get_delivery_prices"
    wide = _Client(_Stream([body]))
    D.fetch_delivery("BTC", wide, 10 ** 9)
    assert wide.asked[2] == {"index_name": "btc_usd", "count": D.MAX_DELIVERY_ROWS}           # a backfill is bounded too
    too_many = json.dumps(payload([("2026-11-09", 1.0)] * (D.MAX_DELIVERY_ROWS + 1))).encode()
    for stream, why in ((_Stream([b"x" * 1_000_000] * 9), "response over the size cap"), (_Stream([b"<html>busy</html>"]), "response is not the expected JSON"),
                        (_Stream([b'{"error": {"message": "<script>"}}']), "response is not the expected JSON"), (_Stream([b""], status=503), "HTTP 503"),
                        (_Stream([b""], status=429), "HTTP 429"), (_Stream([b'{"result": [1, 2]}']), "response is not a list of delivery prices within the row cap"),
                        (_Stream([b'{"result": {"data": "x"}}']), "response is not a list of delivery prices within the row cap"),
                        (_Stream([too_many]), "response is not a list of delivery prices within the row cap")):
        with pytest.raises(D.Unusable, match=why):
            D.fetch_delivery("BTC", _Client(stream))
    monkeypatch.setattr(D, "DEADLINE", -1.0)
    with pytest.raises(D.Unusable, match="response over the deadline"):
        D.fetch_delivery("BTC", _Client(_Stream([body])))
    with pytest.raises(D.Unusable, match="response over the deadline"):       # one helper: the chain's read has the same deadline
        D.fetch_chain("BTC", _Client(_Stream([b"{}"])))


def test_collect_delivery_reports_a_failed_asset_in_its_own_words_and_keeps_the_others():
    def fetch(asset, client, count):
        if asset == "ETH":
            raise RuntimeError("503 <b>from the venue</b>")
        if asset == "SOL":
            return payload([("2999-01-01", 1.0)])                   # nothing usable
        return payload([("2026-11-08", 70_000.0), ("2026-11-09", 70_500.0)])
    with patch.object(D, "fetch_delivery", side_effect=fetch) as f:
        got = D.collect_delivery(count=2, today=TODAY, pause=0)
    assert list(got["ok"]) == ["BTC"] and [r["fixing_date"] for r in got["ok"]["BTC"]] == [date(2026, 11, 8), date(2026, 11, 9)]
    assert got["failed"] == {"ETH": "RuntimeError", "SOL": "no usable delivery price"}       # a class name, never the message
    assert [c.args[0] for c in f.call_args_list] == ["BTC", "ETH", "SOL"] and all(c.args[2] == 2 for c in f.call_args_list)


# ── the store ──────────────────────────────────────────────────────────────────

class _Presence:
    """A session that answers the presence question and counts how often it is asked."""
    def __init__(self, answers): self.answers, self.asked, self.rolled = list(answers), 0, 0
    def execute(self, sql, params=None):
        self.asked += 1
        v = self.answers.pop(0)
        if isinstance(v, Exception):
            raise v
        return SimpleNamespace(scalar=lambda: v, first=lambda: None, all=lambda: [])
    def rollback(self): self.rolled += 1


def test_presence_is_asked_until_the_table_is_there_and_a_stand_in_session_is_not_a_yes():
    db = _Presence([False, RuntimeError("no catalogue"), None, 1, True])
    assert [S.tables_present(db) for _ in range(4)] == [False, False, False, False] and db.asked == 4 and db.rolled == 1
    assert S.tables_present(db) is True and S.tables_present(db) is True and db.asked == 5          # a yes is kept, a no never was
    S._tables.clear()
    assert S.tables_present(MagicMock()) is False and S.tables_present(None) is False and "present" not in S._tables
    # absent: reads return nothing, writes say which migration
    assert S.get(MagicMock(), "BTCUSD", TODAY, BRR, "u") is None and S.recent(MagicMock(), "BTCUSD", 30, "u") == [] and S.latest_shared(MagicMock(), [("BTCUSD", BRR)]) == {}
    with pytest.raises(RuntimeError, match="2026-11-10_fixings.sql"):
        S.put_own(MagicMock(), "u", "BTCUSD", TODAY, BRR, 1.0)
    with pytest.raises(RuntimeError, match="2026-11-10_fixings.sql"):
        S.put_shared(MagicMock(), [])


def _sql(db) -> list[tuple[str, dict]]:
    return [(" ".join(str(c.args[0]).split()), c.args[1] if len(c.args) > 1 else {}) for c in db.execute.call_args_list]


def test_the_feed_inserts_only_and_a_differing_re_read_is_logged_not_written(caplog):
    S._tables["present"] = True
    db = MagicMock()
    stored = {("BTCUSD", date(2026, 11, 8)): 70_000.0, ("BTCUSD", date(2026, 11, 7)): 69_000.0}
    def execute(sql, params=None):
        r = MagicMock()
        had = stored.get((params["p"], params["d"]))
        r.first.return_value = SimpleNamespace(value=had) if had is not None else None
        r.rowcount = 1
        return r
    db.execute.side_effect = execute
    rows = [{"pair": "BTCUSD", "fixing_date": date(2026, 11, d), "fixing_time": "08:00 UTC", "source": DELIVERY, "value": v}
            for d, v in ((7, 69_000.0 * (1 + 1e-12)), (8, 70_250.0), (9, 70_500.0))]
    with caplog.at_level(logging.WARNING, logger="rijeka.settlement"):
        out = S.put_shared(db, rows)
    assert out == {"written": 1, "known": 2, "differs": 1}
    writes = [(s, p) for s, p in _sql(db) if not s.startswith("SELECT")]
    assert len(writes) == 1 and writes[0][1]["d"] == date(2026, 11, 9) and writes[0][1]["v"] == 70_500.0
    assert writes[0][0].startswith("INSERT INTO fixings") and "NULL, :p" in writes[0][0] and "'FEED'" in writes[0][0] and writes[0][0].endswith("ON CONFLICT DO NOTHING")
    assert not any("UPDATE" in s or "DELETE" in s for s, _ in _sql(db))                              # a published fixing is never overwritten
    assert len(caplog.records) == 1 and "2026-11-08" in caplog.text and "the stored value stands" in caplog.text
    for bad in (float("nan"), float("inf"), 0.0, -1.0):
        with pytest.raises(ValueError):
            S.put_shared(db, [{**rows[0], "value": bad}])


def test_an_own_entry_supersedes_only_the_callers_previous_row():
    S._tables["present"] = True
    db = MagicMock()
    uid = str(uuid4())
    S.put_own(db, uid, "BTCUSD", TODAY, BRR, 70_123.0, "16:00 London")
    (upd, up), (ins, ip) = _sql(db)
    assert upd.startswith("UPDATE fixings SET superseded_at = now() WHERE user_id = CAST(:u AS uuid)") and "superseded_at IS NULL" in upd and "user_id IS NULL" not in upd
    assert up == {"u": uid, "p": "BTCUSD", "d": TODAY, "s": BRR}
    assert "'MANUAL'" in ins and ip["v"] == 70_123.0 and ip["t"] == "16:00 London" and ip["u"] == uid
    with pytest.raises(ValueError):
        S.put_own(db, None, "BTCUSD", TODAY, BRR, 1.0)
    # the read: exactly the named source, the caller's row before the shared one
    S.get(db, "BTCUSD", TODAY, BRR, uid)
    q, qp = _sql(db)[-1]
    assert "source = :s" in q and "(user_id IS NULL OR user_id = CAST(:u AS uuid))" in q and "ORDER BY (user_id IS NULL) LIMIT 1" in q and "superseded_at IS NULL" in q
    assert qp == {"p": "BTCUSD", "d": TODAY, "s": BRR, "u": uid}
    assert S.get(db, "BTCUSD", TODAY, "", uid) is None                                              # a trade that names no source has no fixing


# ── the tick, the scheduler step, health, the public list ──────────────────────

def _rows(asset, *days_values):
    return [{"pair": f"{asset}USD", "fixing_date": d, "fixing_time": "08:00 UTC", "source": D.delivery_source(asset), "value": v} for d, v in days_values]


def test_the_tick_is_gated_like_the_marks_and_asks_the_venue_nothing_before_the_migration(monkeypatch):
    import main
    from api.routes import demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    main.app.dependency_overrides[r.get_db] = lambda: db
    c, url, h = TestClient(main.app), "/api/market-data/demo/fixings/tick", {"X-Rijeka-Cron": "s3cret"}
    got = {"ok": {"BTC": _rows("BTC", (date(2026, 11, 8), 70_000.0), (date(2026, 11, 9), 70_500.0)), "SOL": _rows("SOL", (date(2026, 11, 9), 150.0))},
           "failed": {"ETH": "HTTP 503"}}
    try:
        with patch.object(r.deribit, "collect_delivery", return_value=got) as collect:
            assert c.post(url).status_code == 403 and c.post(url, headers={"X-Rijeka-Cron": "wrong"}).status_code == 403
            assert c.post(url + "?count=0", headers=h).status_code == 422 and c.post(url + f"?count={D.MAX_DELIVERY_ROWS + 1}", headers=h).status_code == 422
            # the table is not there (the stand-in session is not a yes): nothing asked of the venue, nothing written
            assert c.post(url, headers=h).json() == {"stored": False}
            assert not collect.called and not db.commit.called
            S._tables["present"] = True
            for var in ("RIJEKA_DERIBIT", "RIJEKA_DEMO_MARKET_DATA"):
                monkeypatch.setenv(var, "0")
                assert c.post(url, headers=h).json() == {"enabled": False}
                monkeypatch.delenv(var)
            assert not collect.called
            # a dry run asks the venue and writes nothing
            db.reset_mock()
            dry = c.post(url + "?dry_run=1&count=5", headers=h)
            assert dry.status_code == 200 and collect.call_args.kwargs == {"count": 5}
            b = dry.json()
            assert b["dry_run"] is True and b["assets"] == {"BTC": {"read": 2, "latest": "2026-11-09"}, "SOL": {"read": 1, "latest": "2026-11-09"}}
            assert b["failed"] == {"ETH": "HTTP 503"} and b["preview"]["BTC"][1] == {"date": "2026-11-09", "value": 70_500.0}
            assert not db.execute.called and not db.commit.called and not db.begin_nested.called
            # the run: shared rows through the insert-only writer, one asset at a time
            db.reset_mock()
            db.execute.return_value.first.return_value = None
            db.execute.return_value.rowcount = 1
            out = c.post(url, headers=h)
    finally:
        main.app.dependency_overrides.clear()
    assert out.status_code == 200, out.text
    b = out.json()
    assert b["stored"] is True and b["written"] == 3 and b["known"] == 0 and b["differs"] == 0 and b["failed"] == {"ETH": "HTTP 503"}
    assert b["assets"]["BTC"] == {"read": 2, "latest": "2026-11-09", "written": 2, "differs": 0} and "preview" not in b
    inserts = [p for s, p in _sql(db) if s.startswith("INSERT INTO fixings")]
    assert [(p["p"], p["d"].isoformat(), p["s"]) for p in inserts] == [("BTCUSD", "2026-11-08", DELIVERY), ("BTCUSD", "2026-11-09", DELIVERY), ("SOLUSD", "2026-11-09", "Deribit SOL delivery price")]
    assert db.begin_nested.call_count == 2 and db.commit.called
    assert not any(s.startswith(("UPDATE", "DELETE")) for s, _ in _sql(db))


def test_one_asset_that_cannot_be_stored_does_not_take_the_others_with_it():
    from api.routes import demo_market_data as r
    S._tables["present"] = True
    db = MagicMock()
    db.execute.return_value.first.return_value = None
    db.execute.return_value.rowcount = 1
    got = {"ok": {"BTC": _rows("BTC", (date(2026, 11, 9), float("nan"))), "ETH": _rows("ETH", (date(2026, 11, 9), 3_000.0))}, "failed": {}}
    with patch.object(r.deribit, "collect_delivery", return_value=got):
        out = r.refresh_fixings(db)
    assert set(out["assets"]) == {"ETH"} and out["failed"] == {"BTC": "not stored (ValueError)"} and out["written"] == 1


def test_the_scheduler_step_skips_the_venue_once_the_latest_published_day_is_stored(monkeypatch):
    import scheduler as sch
    from api.routes import demo_market_data as r
    assert ("crypto_fixings", "half_hourly") in [(n, g) for n, g, _ in sch._define_steps()]
    at = lambda h: datetime(2026, 11, 9, h, 30, tzinfo=timezone.utc)
    assert r.expected_fixing_date(at(7)) == date(2026, 11, 8) and r.expected_fixing_date(at(8)) == date(2026, 11, 9)       # published at 08:00 UTC
    keys = r.FIXING_KEYS
    assert keys == [("BTCUSD", DELIVERY), ("ETHUSD", "Deribit ETH delivery price"), ("SOLUSD", "Deribit SOL delivery price")]
    stored = {k: date(2026, 11, 9) for k in keys}
    with patch.object(r.fixing_store, "latest_shared", return_value=stored):
        assert r.fixings_current(MagicMock(), at(9)) and r.fixings_current(MagicMock(), at(3))
    with patch.object(r.fixing_store, "latest_shared", return_value={**stored, keys[1]: date(2026, 11, 8)}):
        assert not r.fixings_current(MagicMock(), at(9)) and r.fixings_current(MagicMock(), at(3))       # before 08:00 yesterday's is the latest there is
    with patch.object(r.fixing_store, "latest_shared", return_value={k: v for k, v in stored.items() if k != keys[2]}):
        assert not r.fixings_current(MagicMock(), at(9))                                                # an asset with no fixing at all
    # the step: current, so the tick (and with it the venue) is not called; not current, so it is
    with patch.object(r, "fixings_current", return_value=True), patch.object(r, "fixings_tick") as tick:
        assert sch._fixings(MagicMock(), "s") == {"current": True} and not tick.called
    with patch.object(r, "fixings_current", return_value=False), patch.object(r, "fixings_tick", return_value={"written": 3}) as tick:
        db = MagicMock()
        assert sch._fixings(db, "s") == {"written": 3} and tick.call_args.kwargs == {"count": 3, "dry_run": False, "db": db, "x_rijeka_cron": "s"}
    # the switch off: the tick answers for itself and the store is not read
    monkeypatch.setenv("RIJEKA_DERIBIT", "0")
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s")
    with patch.object(r, "fixings_current") as current, patch.object(r.deribit, "collect_delivery") as collect:
        assert sch._fixings(MagicMock(), "s") == {"enabled": False} and not current.called and not collect.called


def test_health_watches_the_latest_shared_fixing_only_where_the_feed_and_the_table_are(monkeypatch):
    from api.routes import demo_market_data as r, ops
    db = MagicMock()
    assert "crypto_fixings" not in [c[0] for c in ops.active_checks(db)]                             # no table: no check, not a stale batch
    S._tables["present"] = True
    assert "crypto_fixings" not in [c[0] for c in ops.active_checks()]                               # no session to ask
    last = ops.active_checks(db)[-1]
    assert last[0] == "crypto_fixings" and last[1] is r.last_fixing_at and last[2] == ("hours", 36) and ops.active_checks(db)[-2][0] == "crypto_marks"
    for var in ("RIJEKA_DERIBIT", "RIJEKA_DEMO_MARKET_DATA"):
        monkeypatch.setenv(var, "0")
        assert ops.active_checks(db) == ops.CHECKS
        monkeypatch.delenv(var)
    # the oldest asset's latest date, at the hour the venue publishes
    keys = r.FIXING_KEYS
    with patch.object(r.fixing_store, "latest_shared", return_value={keys[0]: date(2026, 11, 9), keys[1]: date(2026, 11, 8), keys[2]: date(2026, 11, 9)}):
        assert r.last_fixing_at(db) == datetime(2026, 11, 8, 8, 0, tzinfo=timezone.utc)
    with patch.object(r.fixing_store, "latest_shared", return_value={keys[0]: date(2026, 11, 9)}):
        assert r.last_fixing_at(db) is None
    # the rule end to end: 08:00 on the 8th is stale from 20:00 on the 9th
    monkeypatch.setattr(ops, "CHECKS", [])
    monkeypatch.setattr(r, "last_marks_at", lambda db: datetime(2026, 11, 9, 20, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(r, "last_fixing_at", lambda db: datetime(2026, 11, 8, 8, 0, tzinfo=timezone.utc))
    ok = ops.evaluate(db, now=datetime(2026, 11, 9, 19, 59, tzinfo=timezone.utc))["checks"]["crypto_fixings"]
    late = ops.evaluate(db, now=datetime(2026, 11, 9, 20, 1, tzinfo=timezone.utc))["checks"]["crypto_fixings"]
    assert ok == {"ok": True, "last": "2026-11-08T08:00:00+00:00", "rule": "within 36h", "feeds": "digital-asset fixings"} and late["ok"] is False


def test_the_public_list_names_the_delivery_price_where_it_is_stored(monkeypatch):
    import main
    from api.routes import demo_market_data as r, ops
    assert ops.OPTIONAL_MIGRATIONS[-1] == ("fixings", "2026-11-10_fixings.sql", "stored fixings for digital assets; without it an expired trade is valued on the stored spot, flagged provisional",
                                           "settlement.store", "tables_present")
    db = MagicMock()
    db.execute.return_value.all.return_value = []
    main.app.dependency_overrides[r.get_db] = lambda: db
    def listed():
        with patch.object(r.demo, "_template_user_id", return_value="tmpl"):
            return {s["curve"]: s for s in TestClient(main.app).get("/api/market-data/demo/sources").json()["sources"] if "Deribit" in s["provider"]}
    try:
        assert not any(k.endswith("_FIXING") for k in listed())                                     # before the migration nothing is stored, so nothing is claimed
        S._tables["present"] = True
        got = listed()
        assert {k for k in got if k.endswith("_FIXING")} == {"BTCUSD_FIXING", "ETHUSD_FIXING", "SOLUSD_FIXING"}
        assert got["ETHUSD_FIXING"]["provider"].startswith("Deribit ETH delivery price, daily at 08:00 UTC") and got["ETHUSD_FIXING"]["kind"] == "public"
        monkeypatch.setenv("RIJEKA_DERIBIT", "0")
        assert listed() == {}
    finally:
        main.app.dependency_overrides.clear()


# ── sources, the default, the desk's own entry ─────────────────────────────────

def test_the_default_source_is_the_delivery_price_where_the_feed_runs_and_the_benchmark_where_it_does_not(monkeypatch):
    from api.routes import currencies as C
    assert {p: [x["source"] for x in v if x["auto"]] for p, v in C.SETTLEMENT_SOURCES.items()} == {D.pair(a): [D.delivery_source(a)] for a in D.ASSETS}
    assert all(x["time"] == (D.DELIVERY_TIME if x["auto"] else "16:00 London") for v in C.SETTLEMENT_SOURCES.values() for x in v)
    assert set(C.SETTLEMENT_SOURCES) == set(C.CRYPTO_PAIRS)
    benchmark = {"BTCUSD": "CME CF BRR", "ETHUSD": "CME CF ETHUSD_RR", "SOLUSD": "Coinbase SOL-USD"}
    assert all(any(x["source"] == b and not x["auto"] for x in C.SETTLEMENT_SOURCES[p]) for p, b in benchmark.items())
    # the feed runs (both switches on): the venue's delivery price, stored every day without anyone entering it
    assert C.fixings_feed_runs()
    assert {p: C.fixing_default(p) for p in benchmark} == {p: (f"Deribit {p[:3]} delivery price", "08:00 UTC") for p in benchmark}
    # either switch off: a delivery price would never be stored, so the licensed benchmark stays the default
    for var in ("RIJEKA_DERIBIT", "RIJEKA_DEMO_MARKET_DATA"):
        monkeypatch.setenv(var, "0")
        assert not C.fixings_feed_runs()
        assert {p: C.fixing_default(p) for p in benchmark} == {p: (b, "16:00 London") for p, b in benchmark.items()}
        assert C.fixing_default("USDJPY") == ("WM/Reuters 4pm London", None) and C.fixing_default("EURUSD") == ("WM/Reuters 4pm London", None)
        monkeypatch.delenv(var)
    assert C.fixing_default("USDJPY") == ("WM/Reuters 4pm London", None)                             # FX: the same with the feed on
    # the pairs response carries the rule's answer, its time, and both sources of a digital asset
    db = MagicMock()
    db.execute.return_value.first.return_value = None
    btc, eur = C.pair_state(db, "u", "BTCUSD"), C.pair_state(db, "u", "EURUSD")
    assert btc["fixing_default"] == DELIVERY and btc["fixing_default_time"] == "08:00 UTC" and btc["fixing_sources"] == C.SETTLEMENT_SOURCES["BTCUSD"]
    assert btc["fixing_sources"] is not C.SETTLEMENT_SOURCES["BTCUSD"]
    assert eur["fixing_default"] == "WM/Reuters 4pm London" and eur["fixing_default_time"] is None and "fixing_sources" not in eur
    monkeypatch.setenv("RIJEKA_DEMO_MARKET_DATA", "0")
    off = C.pair_state(db, "u", "SOLUSD")
    assert off["fixing_default"] == "Coinbase SOL-USD" and off["fixing_default_time"] == "16:00 London" and len(off["fixing_sources"]) == 2


@pytest.fixture
def desk():
    """The currency routes with a stand-in session and a signed-in trader; yields (client, db, user)."""
    import main
    from api.routes import _limits, currencies
    db, user = MagicMock(), {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: user
    _limits._buckets.clear()
    try:
        yield TestClient(main.app), db, user
    finally:
        main.app.dependency_overrides.clear()
        _limits._buckets.clear()


def test_an_own_fixing_is_validated_before_anything_is_stored(desk):
    c, db, user = desk
    S._tables["present"] = True
    good = {"pair": "BTCUSD", "fixing_date": "2026-11-09", "source": BRR, "value": 70_012.5}
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    bad = [{**good, "pair": "DOGEUSD"}, {**good, "pair": "EURUSD"}, {**good, "pair": "x" * 5000}, {**good, "fixing_date": tomorrow}, {**good, "fixing_date": "soon"},
           {**good, "value": 0}, {**good, "value": -1.0}, {**good, "value": 1e13}, {**good, "value": "abc"}, {**good, "value": None},
           {**good, "source": "x" * 81}, {**good, "source": ""}, {**good, "source": "   "}, {**good, "source": "<script>alert(1)</script>"},
           {**good, "source": "CME CF BRR\nX"}, {**good, "source": "BRR; DROP TABLE fixings"}, {**good, "source": "ＣＭＥ"}, {**good, "source": "-BRR"},
           {**good, "source": DELIVERY}, {**good, "source": "deribit  btc DELIVERY price"}, {**good, "source": "Deribit ETH delivery price"},
           {k: v for k, v in good.items() if k != "source"}, {k: v for k, v in good.items() if k != "fixing_date"}]
    for body in bad:
        r = c.post("/api/currency/fixings", json=body)
        assert r.status_code == 422, (body, r.status_code, r.text)
    for raw in ('{"pair": "BTCUSD", "fixing_date": "2026-11-09", "source": "CME CF BRR", "value": NaN}', '{"pair": "BTCUSD", "fixing_date": "2026-11-09", "source": "CME CF BRR", "value": Infinity}'):
        assert c.post("/api/currency/fixings", content=raw, headers={"Content-Type": "application/json"}).status_code == 422
    assert not any(s.startswith(("INSERT", "UPDATE")) for s, _ in _sql(db)) and not db.commit.called
    # eighty characters is the limit, not beyond it; a source the feed does not own may be any plain name
    db.execute.return_value.all.return_value = []
    for source in ("A" * 80, "Coinbase BTC-USD", "Kraken (XBT/USD) 4pm.", BRR):
        assert c.post("/api/currency/fixings", json={**good, "source": source}).status_code == 200, source


def test_an_own_fixing_needs_a_trader_the_migration_and_is_rate_limited(desk):
    from sqlalchemy.exc import IntegrityError
    c, db, user = desk
    good = {"pair": "btcusd", "fixing_date": "2026-11-09", "source": "  CME CF BRR ", "value": 70_012.5}
    assert c.post("/api/currency/fixings", json=good).status_code == 409                             # before the migration
    assert not any(s.startswith(("INSERT", "UPDATE")) for s, _ in _sql(db))
    S._tables["present"] = True
    user["user_metadata"]["role"] = "viewer"
    assert c.post("/api/currency/fixings", json=good).status_code == 403
    user["user_metadata"]["role"] = "trader"
    db.reset_mock()
    db.execute.return_value.all.return_value = [SimpleNamespace(fixing_date=date(2026, 11, 9), fixing_time="16:00 London", source=BRR, value=70_012.5, origin="MANUAL", user_id=user["sub"])]
    r = c.post("/api/currency/fixings", json=good)
    assert r.status_code == 200, r.text
    assert r.json() == {"pair": "BTCUSD", "stored": True, "sources": [{"source": BRR, "time": "16:00 London", "auto": False}, {"source": DELIVERY, "time": "08:00 UTC", "auto": True}],
                        "fixings": [{"date": "2026-11-09", "source": BRR, "time": "16:00 London", "value": 70_012.5, "origin": "MANUAL", "own": True}]}
    writes = [(s, p) for s, p in _sql(db) if s.startswith(("INSERT", "UPDATE"))]
    assert [s.split()[0] for s, _ in writes] == ["UPDATE", "INSERT"] and db.commit.call_count == 1
    assert writes[1][1]["u"] == user["sub"] and writes[1][1]["s"] == BRR and writes[1][1]["t"] == "16:00 London" and writes[1][1]["p"] == "BTCUSD"
    # two entries for one key at the same moment: one stands, the other is told to send again
    db.execute.side_effect = IntegrityError("insert", {}, Exception("ux_fixings_live"))
    clash = c.post("/api/currency/fixings", json=good)
    assert clash.status_code == 409 and db.rollback.called and "ux_fixings_live" not in clash.text
    db.execute.side_effect = None
    codes = [c.post("/api/currency/fixings", json=good).status_code for _ in range(40)]
    assert codes[0] == 200 and codes[-1] == 429


def test_the_fixings_route_serves_stored_spots_until_the_table_exists(desk):
    c, db, user = desk
    spot = lambda d, v: SimpleNamespace(valuation_date=d, quotes=[{"tenor": "SPOT", "rate": v, "enabled": True}], source="IMPORT")
    db.execute.return_value.all.return_value = [spot(date(2026, 11, 7), 69_000.0), spot(date(2026, 11, 8), 70_000.0),
                                                SimpleNamespace(valuation_date=date(2026, 11, 9), quotes=[], source="IMPORT")]
    r = c.get("/api/currency/fixings/btcusd?days=7")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["pair"] == "BTCUSD" and b["stored"] is False and [x["source"] for x in b["sources"]] == [BRR, DELIVERY]
    assert b["fixings"] == [{"date": d, "source": "stored spot (no fixing stored)", "time": None, "value": v, "origin": "SPOT", "own": False}
                            for d, v in (("2026-11-07", 69_000.0), ("2026-11-08", 70_000.0))]
    q, qp = [(s, p) for s, p in _sql(db) if "market_data_snapshots" in s][-1]
    assert qp["u"] == user["sub"] and qp["c"] == "BTCUSD_SPOT" and qp["d"] == date.today() - timedelta(days=7) and "DISTINCT ON (valuation_date)" in q
    assert c.get("/api/currency/fixings/DOGEUSD").status_code == 422 and c.get("/api/currency/fixings/BTCUSD?days=x").status_code == 422
    assert c.get("/api/currency/fixings/EURUSD").json() == {"pair": "EURUSD", "stored": False, "sources": [], "fixings": []}
    # the table exists: its rows, the caller's and the shared, and the day count is bounded
    S._tables["present"] = True
    db.reset_mock()
    db.execute.return_value.all.return_value = [SimpleNamespace(fixing_date=date(2026, 11, 9), fixing_time="08:00 UTC", source=DELIVERY, value=70_300.0, origin="FEED", user_id=None)]
    b = c.get("/api/currency/fixings/BTCUSD?days=100000").json()
    assert b["stored"] is True and b["fixings"] == [{"date": "2026-11-09", "source": DELIVERY, "time": "08:00 UTC", "value": 70_300.0, "origin": "FEED", "own": False}]
    q, qp = _sql(db)[-1]
    assert qp["u"] == user["sub"] and qp["d"] == date.today() - timedelta(days=366) and "ORDER BY fixing_date" in q
    paths = [p for p in __import__("main").app.openapi()["paths"] if "fixings" in p]
    assert len(paths) == 3 and not any("price" in p for p in paths)                                           # a browser journey waits on /api/currency/.*price


# ── the rule ───────────────────────────────────────────────────────────────────

def _forward(side="BUY", source=BRR, fixing=FIX_DAY, settle=SETTLE, **terms):
    t = {"digital_asset": "BTC", "notional_amount": "10", "direction": side, "forward_price": "65000", "price_currency": "USD",
         "valuation_date": fixing.isoformat(), "valuation_time": "16:00 London", "settlement_date": settle.isoformat(), "settlement_currency": "USD",
         "settlement_price_source": source, **terms}
    return SimpleNamespace(id=uuid4(), trade_ref="TRD-CRF", instrument_type="CRYPTO_FORWARD", status="LIVE", notional=10, notional_ccy="BTC",
                           discount_curve_id="USD_SOFR", forecast_curve_id=None, terms=t, maturity_date=settle, user_id="u")


class _Fixings:
    """A stand-in for the store: rows by (pair, date, source), own rows by user; records what was asked."""
    def __init__(self, shared=None, own=None): self.shared, self.own, self.asked = shared or {}, own or {}, []
    def get(self, db, pair, fixing_date, source, user_id):
        self.asked.append((pair, fixing_date, source, user_id))
        v = self.own.get((user_id, pair, fixing_date, source))
        origin, mine = ("MANUAL", True) if v is not None else ("FEED", False)
        v = v if v is not None else self.shared.get((pair, fixing_date, source))
        return None if v is None else {"date": fixing_date.isoformat(), "source": source, "time": "16:00 London", "value": v, "origin": origin, "own": mine}


def test_the_rule_reads_the_named_source_only_own_before_shared_and_is_silent_before_the_fixing_date():
    f = _Fixings(shared={("BTCUSD", FIX_DAY, BRR): 70_000.0, ("BTCUSD", FIX_DAY, DELIVERY): 99_999.0})
    with patch.object(R.store, "get", side_effect=f.get):
        assert R.settlement(None, "u", _forward(), FIX_DAY - timedelta(days=1)) is None and f.asked == []      # before the fixing date: not even a read
        buy, sell = R.settlement(None, "u", _forward(), FIX_DAY), R.settlement(None, "u", _forward("SELL"), FIX_DAY + timedelta(days=40))
        assert buy["fixing"] == {"source": BRR, "date": FIX_DAY.isoformat(), "time": "16:00 London", "value": 70_000.0, "origin": "FEED"} and buy["provisional"] is False
        assert buy["settlement_amount"] == pytest.approx(10 * (70_000.0 - 65_000.0)) and sell["settlement_amount"] == pytest.approx(-50_000.0)
        assert all(a == ("BTCUSD", FIX_DAY, BRR, "u") for a in f.asked)
        # a trade that names another source settles on that source's row, never on this one's
        other = R.settlement(None, "u", _forward(source=DELIVERY), FIX_DAY)
        assert other["fixing"]["value"] == 99_999.0 and other["settlement_amount"] == pytest.approx(10 * (99_999.0 - 65_000.0))
        for unnamed in ("Some Other Index", "", None, "cme cf brr"):
            miss = R.settlement(None, "u", _forward(source=unnamed), FIX_DAY, spot=66_000.0)
            assert miss["fixing"] is None and miss["provisional"] is True and miss["price"] == 66_000.0
            assert miss["settlement_amount"] == pytest.approx(10 * 1_000.0)                             # the stored spot, flagged
        # an account's own entry stands over the shared row, for that account only
        f.own[("u", "BTCUSD", FIX_DAY, BRR)] = 70_500.0
        mine, theirs = R.settlement(None, "u", _forward(), FIX_DAY), R.settlement(None, "v", _forward(), FIX_DAY)
        assert mine["fixing"]["value"] == 70_500.0 and mine["fixing"]["origin"] == "MANUAL" and theirs["fixing"]["value"] == 70_000.0
        # one read per key in a run that hands over its memo
        memo: dict = {}
        n = len(f.asked)
        assert [R.settlement(None, "u", _forward(), FIX_DAY, cache=memo)["fixing"]["value"] for _ in range(3)] == [70_500.0] * 3 and len(f.asked) == n + 1
        # an option: the fixing of its expiry date, no forward amount; other products: not this rule's
        opt = R.settlement(None, "u", _option(), FIX_DAY)
        assert opt["shape"] == "OPTION" and opt["fixing"]["value"] == 70_500.0 and opt["settlement_amount"] is None and opt["price"] == 70_500.0
        assert R.settlement(None, "u", SimpleNamespace(instrument_type="NDF", terms={"fixing_date": "2020-01-01"}), FIX_DAY) is None
        assert R.settlement(None, "u", SimpleNamespace(instrument_type="CRYPTO_FORWARD", terms={"digital_asset": "BTC"}, maturity_date=None), FIX_DAY) is None
    # a store that cannot be read is no fixing, never a failed valuation
    with patch.object(R.store, "get", side_effect=RuntimeError("connection lost")):
        down = R.settlement(MagicMock(), "u", _forward(), FIX_DAY, spot=64_000.0)
    assert down["fixing"] is None and down["provisional"] is True
    assert R.forward_amount("BUY", 2, 100.0, 110.0) == 20.0 and R.forward_amount("sell", 2, 100.0, 110.0) == -20.0
    assert R.terms_of(_forward(valuation_date=None))["fixing_date"] == SETTLE                         # an older record without the date: the settlement date


def _market(as_of, spot=65_000.0):
    return FakeMarket(as_of, {"USD_SOFR": USD, "BTCUSD_SPOT": [{"tenor": "SPOT", "rate": spot}], "BTC_FUNDING": [{"tenor": "FLAT", "rate": 3.0}], "BTCUSD_VOL": BTC_VOL})


def _value(trade, on, spot=65_000.0, fixings=None):
    from pnl.valuation import value
    f = fixings or _Fixings()
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(vd, flat_rate=0.04)), patch.object(R.store, "get", side_effect=f.get):
        return value(None, {"sub": "u"}, trade, on, _market(on, spot))


def test_before_the_fixing_date_a_valuation_is_what_it_was_to_the_last_digit():
    from pnl.valuation import value
    stored = _Fixings(shared={("BTCUSD", FIX_DAY, BRR): 70_000.0})
    for trade in (_forward(settle=FIX_DAY + timedelta(days=2)), _forward("SELL"), _option(), _option("SELL", style="BARRIER", barrier_type="UP_OUT", barrier="90000")):
        for on in (date(2026, 11, 2), FIX_DAY - timedelta(days=1)):
            with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(vd, flat_rate=0.04)):
                with patch("settlement.rule.settlement", return_value=None) as off:                 # the valuation as it was before the rule existed
                    was = value(None, {"sub": "u"}, trade, on, _market(on))
                assert off.called
            now = _value(trade, on, fixings=stored)
            assert now == was and not {"fixing", "provisional", "settled", "settlement_amount"} & set(now), (trade.instrument_type, on)
    assert stored.asked == []


def test_a_forward_from_its_fixing_date_is_the_settlement_amount_discounted_then_reported():
    settle = FIX_DAY + timedelta(days=2)
    stored = _Fixings(shared={("BTCUSD", FIX_DAY, BRR): 70_000.0, ("BTCUSD", FIX_DAY, DELIVERY): 10.0})
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        amount = sign * 10 * (70_000.0 - 65_000.0)
        for on in (FIX_DAY, FIX_DAY + timedelta(days=1)):                                            # fixed, not yet paid
            v = _value(_forward(side, settle=settle), on, spot=10_000.0, fixings=stored)             # the stored spot no longer matters
            df = math.exp(-0.04 * (settle - on).days / 365.0)
            assert v["npv"] == pytest.approx(amount * df, rel=1e-9) and v["settlement_amount"] == pytest.approx(amount) and v["settled"] is False
            assert v["fixing"] == {"source": BRR, "date": FIX_DAY.isoformat(), "time": "16:00 London", "value": 70_000.0, "origin": "FEED"} and v["provisional"] is False
            assert v["spot01"] == 0.0 and v["fund01"] == 0.0 and v["ir01"] == pytest.approx(-amount * df * (settle - on).days / 365.0 * 1e-4, rel=1e-3)
            assert "fixed" in v["model"] and BRR in v["model"]
        assert _value(_forward(side, settle=settle), settle - timedelta(days=1), fixings=stored)["theta"] == pytest.approx(-amount * math.exp(-0.04 / 365.0))
        for on in (settle, settle + timedelta(days=30)):                                             # the settlement date is reached: the mark is zero, the amount reported
            v = _value(_forward(side, settle=settle), on, fixings=stored)
            assert v["npv"] == 0.0 and v["settled"] is True and v["settlement_amount"] == pytest.approx(amount) and v["fixing"]["value"] == 70_000.0 and v["provisional"] is False
    # the ticket's usual forward: fixing date and settlement date the same day
    same = _value(_forward(), FIX_DAY + timedelta(days=1), fixings=stored)
    assert same["npv"] == 0.0 and same["settled"] is True and same["settlement_amount"] == pytest.approx(50_000.0)


def test_without_a_stored_fixing_the_valuation_is_as_before_and_says_provisional():
    from pnl.valuation import value
    settle = FIX_DAY + timedelta(days=2)
    only_other = _Fixings(shared={("BTCUSD", FIX_DAY, DELIVERY): 99_999.0})                           # another source's price is not this trade's fixing
    for trade in (_forward(settle=settle), _forward("SELL", settle=settle), _option()):
        on = FIX_DAY
        with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(vd, flat_rate=0.04)), patch("settlement.rule.settlement", return_value=None):
            was = value(None, {"sub": "u"}, trade, on, _market(on, 66_000.0))
        now = _value(trade, on, spot=66_000.0, fixings=only_other)
        assert now["provisional"] is True and now["fixing"] is None and now["settled"] is False and now["fixing_source"] == BRR
        assert {k: v for k, v in now.items() if k in was} == was, trade.instrument_type               # every figure it had, unchanged
    fwd = _value(_forward(settle=settle), FIX_DAY, spot=66_000.0, fixings=only_other)
    assert fwd["settlement_amount"] == pytest.approx(10 * 1_000.0) and fwd["spot01"] != 0.0            # still a forward on the stored spot
    done = _value(_forward(), SETTLE + timedelta(days=3), spot=66_000.0, fixings=only_other)
    assert done["npv"] == 0.0 and done["settled"] is True and done["provisional"] is True and done["fixing"] is None
    assert done["settlement_amount"] == pytest.approx(10_000.0)                                       # an estimate on the stored spot, flagged


def test_an_expired_option_pays_on_the_fixing_instead_of_the_stored_spot():
    stored = _Fixings(shared={("BTCUSD", FIX_DAY, BRR): 70_000.0})
    df = math.exp(-0.04 * 1 / 365.0)                                                                 # expiry to settlement: one day
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        v = _value(_option(side), FIX_DAY, spot=60_000.0, fixings=stored)                            # the stored spot is out of the money; the fixing is not
        assert v["npv"] == pytest.approx(sign * 10 * (70_000.0 - 68_000.0) * df, rel=1e-9) and v["settlement_amount"] == pytest.approx(sign * 20_000.0)
        assert v["fixing"]["value"] == 70_000.0 and v["provisional"] is False and v["settled"] is False and "on the CME CF BRR fixing" in v["model"]
        p = _value(_option(side), FIX_DAY, spot=69_000.0)                                            # no fixing: the stored spot, as before, flagged
        assert p["npv"] == pytest.approx(sign * 10 * 1_000.0 * df, rel=1e-9) and p["provisional"] is True and p["fixing"] is None and "fixing" not in p["model"]
        paid = _value(_option(side), SETTLE, spot=60_000.0, fixings=stored)
        assert paid["npv"] == 0.0 and paid["settled"] is True and paid["settlement_amount"] == pytest.approx(sign * 20_000.0) and paid["fixing"]["value"] == 70_000.0
    put = _value(_option(option_type="PUT"), FIX_DAY, fixings=stored)
    assert put["npv"] == 0.0 and put["settlement_amount"] == 0.0
    # a knocked-out barrier pays its rebate whatever the fixing; an alive one pays on the fixing
    ko = dict(style="BARRIER", barrier_type="UP_OUT", barrier="90000")
    assert _value(_option(**ko, knocked=True), FIX_DAY, fixings=stored)["settlement_amount"] == 0.0
    alive = _value(_option(**ko, knocked=False), FIX_DAY, fixings=stored)
    assert alive["settlement_amount"] == pytest.approx(20_000.0) and "knock status" not in alive["model"]
    assert "read from the fixing" in _value(_option(**ko), FIX_DAY, fixings=stored)["model"]
    # an FX option is not this rule's: its expired payoff is the spot of the expiry date, with no new fields
    from tests.test_fx_option_styles import EXP as FX_EXP, SET as FX_SET, _market as fx_market, _trade as fx_trade
    from pnl.valuation import value
    with patch.object(R.store, "get", side_effect=AssertionError("the store is not read for an FX trade")):
        fx = value(None, {"sub": "u"}, fx_trade("BUY", strike="1.17", expiry_date=FX_EXP.isoformat(), settlement_date=FX_SET.isoformat()), FX_EXP + timedelta(days=1),
                   fx_market(FX_EXP + timedelta(days=1), spot=1.20))
    assert fx["npv"] > 0 and not {"fixing", "provisional", "settled", "settlement_amount"} & set(fx)
