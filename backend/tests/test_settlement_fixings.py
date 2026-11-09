"""Fixings for digital assets: the venue's delivery prices to rows (market_data/deribit.py), the store
(settlement/store.py), the tick with its checks, the health signal, the desk's own entry, the administrator's
correction, the names a source may have (settlement/sources.py), and the one settlement rule (settlement/rule.py)
as the booked valuation and the ticket apply it.

No network and none of the venue's data: every payload and price here is made up. The expected figures of the
valuation tests are literals, taken from the code as it stood before the rule existed or worked out by hand in the
test; none is the code under test compared with itself."""
from __future__ import annotations

import contextlib
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
from settlement import rule as R, sources as SRC, store as S
from tests.test_crypto_option import BTC_VOL, _trade as _option_trade
from tests.test_deribit import _Client, _Stream
from tests.test_fx_option import FakeMarket, USD

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
TODAY = NOW.date()
FIX_DAY = date(2027, 1, 29)                    # tests/test_crypto_option.EXP: the option's expiry, and the forward's fixing date here
EVE = FIX_DAY + timedelta(days=2)              # the eve of a settlement three days after the fixing
BRR, DELIVERY = "CME CF BRR", "Deribit BTC delivery price"
K, FIXING, AMOUNT = 100_000.0, 104_250.0, 42_500.0        # 10 BTC: 10 × (104,250 − 100,000)


@pytest.fixture(autouse=True)
def _feeds_on(monkeypatch):
    """The integration suite switches the demo feed off for its process; these tests say when they want it off."""
    monkeypatch.delenv("RIJEKA_DEMO_MARKET_DATA", raising=False)
    monkeypatch.delenv("RIJEKA_DERIBIT", raising=False)


def day(n: int) -> date:
    return TODAY - timedelta(days=n)


def payload(rows) -> dict:
    return {"result": {"data": [{"date": d.isoformat() if isinstance(d, date) else d, "delivery_price": v} for d, v in rows], "records_total": len(rows)}}


# ── the venue's delivery prices to rows ────────────────────────────────────────

def test_delivery_prices_become_rows_ascending_by_date_and_no_more_than_were_asked_for():
    rows = D.parse_delivery(payload([(day(0), 70_300.5), (day(1), 70_100.0), (day(2), 69_900.25)]), "BTC", NOW, 3)
    assert rows == [{"pair": "BTCUSD", "fixing_date": day(n), "fixing_time": "08:00 UTC", "source": DELIVERY, "value": v}
                    for n, v in ((2, 69_900.25), (1, 70_100.0), (0, 70_300.5))]
    assert D.delivery_source("ETH") == "Deribit ETH delivery price" and D.DELIVERY_INDEX == {"BTC": "btc_usd", "ETH": "eth_usd", "SOL": "sol_usd"}
    assert set(D.DELIVERY_BOUNDS) == set(D.ASSETS) and all(0 < lo < hi < 1e9 for lo, hi in D.DELIVERY_BOUNDS.values())
    # the window is [today − count, the latest published date] and the rows used are the latest `count`
    wide = payload([(day(n), 70_000.0 + n) for n in range(8)])
    assert [r["fixing_date"] for r in D.parse_delivery(wide, "BTC", NOW, 3)] == [day(2), day(1), day(0)]
    assert [r["fixing_date"] for r in D.parse_delivery(wide, "BTC", NOW, 5)] == [day(n) for n in (4, 3, 2, 1, 0)]
    assert [r["fixing_date"] for r in D.parse_delivery(payload([(day(n), 70_000.0) for n in (3, 4, 5)]), "BTC", NOW, 3)] == [day(3)]


def test_a_day_has_a_price_only_once_the_venue_has_published_it():
    at = lambda h, m: datetime(2026, 11, 9, h, m, tzinfo=timezone.utc)
    assert D.expected_delivery_date(at(7, 59)) == day(1) and D.expected_delivery_date(at(8, 9)) == day(1)
    assert D.expected_delivery_date(at(8, 10)) == day(0) and D.expected_delivery_date(at(23, 59)) == day(0)
    rows = payload([(day(0), 70_300.0), (day(1), 70_100.0)])
    for early in (at(0, 5), at(7, 59), at(8, 5)):                    # a row dated today before its price exists would block the real one for good
        assert [r["fixing_date"] for r in D.parse_delivery(rows, "BTC", early, 3)] == [day(1)]
    assert [r["fixing_date"] for r in D.parse_delivery(rows, "BTC", at(8, 10), 3)] == [day(1), day(0)]
    assert D.parse_delivery(payload([(day(-1), 70_000.0), (day(-400), 70_000.0)]), "BTC", NOW, 3) == []       # tomorrow, next year


def test_hostile_and_junk_payloads_never_become_a_fixing():
    good = [(day(2), 100.0), (day(1), 101.0), (day(0), 102.0)]
    junk = [(day(3), float("nan")), (day(4), float("inf")), (day(5), "99.5"), (day(6), True), (day(7), None), (day(8), 0.0), (day(9), -5.0),
            (day(10), 10 ** 400), (day(11), 1e300), (day(12), 1e-9),                                   # an integer no float holds; absurd either way
            ("2026-13-01", 99.0), ("2026-02-30", 99.0), ("26-11-06", 99.0), ("2026-11-6", 99.0), (" 2026-11-05", 99.0), ("2026-11-05\n", 99.0),
            ("2026-11-05T08:00:00", 99.0), ("٢٠٢٦-١١-٠٥", 99.0), ("2026/11/05", 99.0), (20261105, 99.0), (None, 99.0), ("<script>", 99.0)]
    p = payload(good + junk)
    p["result"]["data"] += ["not a row", None, 7, [], {"date": "2026-10-20"}, {"delivery_price": 99.0}]
    rows = D.parse_delivery(p, "SOL", NOW, 30)
    assert [(r["fixing_date"], r["value"]) for r in rows] == sorted(good)
    json.dumps([r["value"] for r in rows], allow_nan=False)
    assert D._num(10 ** 400) is None and D._num(-(10 ** 400)) is None and D._num(7) == 7.0
    for not_it in (None, [], "x", 5, {}, {"result": None}, {"result": []}, {"result": {"data": None}}, {"result": {"data": {"date": "2026-11-09"}}}, {"error": {"message": "<b>busy</b>"}}):
        assert D.parse_delivery(not_it, "BTC", NOW) == []
    # the absolute bounds, whatever else agrees: a lone row of 1e-9 or 1e300, and a price no market of the asset has had
    for asset, bad in (("BTC", 1e-9), ("BTC", 1e300), ("BTC", 50.0), ("BTC", 2e8), ("ETH", 0.5), ("SOL", 2e6), ("SOL", 0.001)):
        assert D.parse_delivery(payload([(day(0), bad)]), asset, NOW) == [], (asset, bad)
    # no recency, no row: the year one, and a hundred and twenty rows of 2020 when three days were asked for
    assert D.parse_delivery(payload([("0001-01-01", 70_000.0)]), "BTC", NOW, 3) == []
    old = payload([(date(2020, 3, 1) + timedelta(days=i), 9_000.0) for i in range(120)])
    assert D.parse_delivery(old, "BTC", NOW, 3) == [] and D.parse_delivery(old, "BTC", NOW, D.MAX_DELIVERY_ROWS) == []
    # the same date twice is not a response this module reads, whichever row comes first and wherever the date lies
    for twice in ([(day(0), 102.0), (day(0), 55.0)], [(day(0), 102.0), (day(1), 101.0), (day(1), 101.0)], [("2020-01-01", 9.0), ("2020-01-01", 9.0), (day(0), 102.0)]):
        with pytest.raises(D.Unusable, match="the same date twice"):
            D.parse_delivery(payload(twice), "SOL", NOW)
    # more rows than the cap: only the first MAX_DELIVERY_ROWS are read at all
    many = payload([(day(n), 70_000.0) for n in range(D.MAX_DELIVERY_ROWS + 50)])
    assert len(D.parse_delivery(many, "BTC", NOW, 10 ** 6)) == D.MAX_DELIVERY_ROWS
    # what this module cannot know alone (a whole batch out by the same factor, two wrong rows that agree, a row 55 % off)
    # is inside the bounds and passes here; the caller's check against an independent spot refuses it (the tick's tests below)
    assert len(D.parse_delivery(payload([(day(n), 70_000.0 * 1000) for n in range(3)]), "BTC", NOW, 3)) == 3


def test_the_delivery_read_is_capped_deadlined_and_reports_in_its_own_words(monkeypatch):
    body = json.dumps(payload([(day(0), 70_000.0)])).encode()
    ok = _Client(_Stream([body[:20], body[20:]]))
    assert D.parse_delivery(D.fetch_delivery("BTC", ok, 3), "BTC", NOW)[0]["value"] == 70_000.0
    assert ok.asked == ("GET", D.DELIVERY_API, {"index_name": "btc_usd", "count": 3})
    assert D.DELIVERY_API == "https://www.deribit.com/api/v2/public/get_delivery_prices"
    wide = _Client(_Stream([body]))
    D.fetch_delivery("SOL", wide, 10 ** 9)
    assert wide.asked[2] == {"index_name": "sol_usd", "count": D.MAX_DELIVERY_ROWS}           # a backfill is bounded too
    too_many = json.dumps(payload([(day(0), 1.0)] * (D.MAX_DELIVERY_ROWS + 1))).encode()
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
    with D._client() as c:                                                    # the cap counts decoded bytes: the encoding asked for is pinned
        assert c.headers["accept-encoding"] == "gzip" and c.follow_redirects is False


def test_collect_delivery_reports_a_failed_asset_in_its_own_words_and_keeps_the_others():
    def fetch(asset, client, count):
        if asset == "ETH":
            raise RuntimeError("503 <b>from the venue</b>")
        if asset == "SOL":
            return payload([("2999-01-01", 100.0)])                   # nothing usable
        return payload([(day(1), 70_000.0), (day(0), 70_500.0)])
    with patch.object(D, "fetch_delivery", side_effect=fetch) as f:
        got = D.collect_delivery(count={"BTC": 2, "ETH": 7, "SOL": 4}, now=NOW, pause=0)
    assert list(got["ok"]) == ["BTC"] and [r["fixing_date"] for r in got["ok"]["BTC"]] == [day(1), day(0)]
    assert got["failed"] == {"ETH": "RuntimeError", "SOL": "no usable delivery price"}       # a class name, never the message
    assert [(c.args[0], c.args[2]) for c in f.call_args_list] == [("BTC", 2), ("ETH", 7), ("SOL", 4)]
    with patch.object(D, "fetch_delivery", return_value=payload([(day(0), 70_000.0), (day(0), 70_000.0)])):
        assert D.collect_delivery(count=3, assets=("BTC",), now=NOW, pause=0) == {"ok": {}, "failed": {"BTC": "the same date twice in one response"}}


# ── the store ──────────────────────────────────────────────────────────────────

class _Presence:
    """A session that answers the presence question and counts how often it is asked."""
    def __init__(self, answers): self.answers, self.asked, self.rolled, self.sql = list(answers), 0, 0, []
    def execute(self, sql, params=None):
        self.asked += 1
        self.sql.append(" ".join(str(sql).split()))
        v = self.answers.pop(0)
        if isinstance(v, Exception):
            raise v
        return SimpleNamespace(scalar=lambda: v, first=lambda: None, all=lambda: [])
    def rollback(self): self.rolled += 1


def test_presence_is_asked_until_the_table_is_there_and_a_stand_in_session_is_not_a_yes():
    db = _Presence([False, RuntimeError("no catalogue"), None, 1, True])
    assert [S.tables_present(db) for _ in range(4)] == [False, False, False, False] and db.asked == 4 and db.rolled == 1
    assert S.tables_present(db) is True and S.tables_present(db) is True and db.asked == 5          # a yes is kept, a no never was
    assert "table_schema = 'public'" in db.sql[0] and "table_name = 'fixings'" in db.sql[0] and "column_name = 'disputed_at'" in db.sql[0]
    S._tables.clear()
    assert S.tables_present(MagicMock()) is False and S.tables_present(None) is False and "present" not in S._tables
    # absent: reads return nothing, writes say which migration
    m = MagicMock()
    assert S.get(m, "BTCUSD", TODAY, BRR, "u") is None and S.recent(m, "BTCUSD", 30, "u") == [] and S.latest_shared(m, [("BTCUSD", BRR)]) == {}
    assert S.shared_dates(m, [("BTCUSD", DELIVERY)], TODAY) == {("BTCUSD", DELIVERY): set()} and S.disputed(m, [("BTCUSD", DELIVERY)]) == 0
    for write in (lambda: S.put_own(m, "u", "BTCUSD", TODAY, BRR, 1.0), lambda: S.put_shared(m, []), lambda: S.own_usage(m, "u", "BTCUSD", TODAY, BRR),
                  lambda: S.put_correction(m, "BTCUSD", TODAY, DELIVERY, 1.0, "08:00 UTC", "a", "because")):
        with pytest.raises(RuntimeError, match="2026-11-10_fixings.sql"):
            write()


class _Shared:
    """An in-memory stand-in for the shared rows of the fixings table: enough SQL for the store's feed path."""
    def __init__(self, rows=None):
        self.rows = {k: SimpleNamespace(id=str(uuid4()), value=v, origin=o, disputed_at=d, pair=k[0], fixing_date=k[1], source=k[2], note=None)
                     for k, (v, o, d) in (rows or {}).items()}
        self.log, self.commits, self.rollbacks = [], 0, 0
    def execute(self, sql, p=None):
        q, p = " ".join(str(sql).split()), p or {}
        self.log.append((q, p))
        res = SimpleNamespace(first=lambda: None, all=lambda: [], scalar=lambda: None, rowcount=0)
        by_id = {r.id: r for r in self.rows.values()}
        if q.startswith("SELECT id, value, origin, disputed_at FROM fixings"):
            hit = self.rows.get((p["p"], p["d"], p["s"]))
            res.first = lambda: hit
        elif q.startswith("SELECT pair, source, fixing_date FROM fixings"):
            res.all = lambda: [r for r in self.rows.values() if r.fixing_date >= p["d"]]
        elif q.startswith("SELECT pair, source, max(fixing_date)"):
            last: dict = {}
            for r in self.rows.values():
                last[(r.pair, r.source)] = max(last.get((r.pair, r.source), r.fixing_date), r.fixing_date)
            res.all = lambda: [SimpleNamespace(pair=k[0], source=k[1], d=v) for k, v in last.items()]
        elif q.startswith("SELECT count(*) FROM fixings WHERE user_id IS NULL AND superseded_at IS NULL AND disputed_at IS NOT NULL"):
            res.scalar = lambda: sum(1 for r in self.rows.values() if r.disputed_at is not None)
        elif q.startswith("UPDATE fixings SET disputed_at = COALESCE"):
            by_id[p["id"]].disputed_at = by_id[p["id"]].disputed_at or "now"
        elif q.startswith("UPDATE fixings SET disputed_at = NULL"):
            by_id[p["id"]].disputed_at = None
        elif q.startswith("UPDATE fixings SET superseded_at = now() WHERE user_id IS NULL"):
            self.rows.pop((p["p"], p["d"], p["s"]), None)
        elif q.startswith("INSERT INTO fixings"):
            k = (p["p"], p["d"], p["s"])
            if k in self.rows:
                return res
            self.rows[k] = SimpleNamespace(id=p["id"], value=p["v"], origin="CORRECTION" if "'CORRECTION'" in q else "FEED", disputed_at=None,
                                           pair=k[0], fixing_date=k[1], source=k[2], note=p.get("n"))
            res.rowcount = 1
        return res
    def begin_nested(self): return contextlib.nullcontext()
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1
    def writes(self): return [(q, p) for q, p in self.log if q.startswith(("INSERT", "UPDATE", "DELETE"))]
    def value(self, asset, d): return self.rows[(f"{asset}USD", d, D.delivery_source(asset))].value


def _rows(asset, *days_values):
    return [{"pair": f"{asset}USD", "fixing_date": d, "fixing_time": "08:00 UTC", "source": D.delivery_source(asset), "value": v} for d, v in days_values]


def test_the_feed_inserts_once_and_a_batch_that_disagrees_with_a_stored_day_stores_nothing(caplog):
    S._tables["present"] = True
    key = lambda n: ("BTCUSD", day(n), DELIVERY)
    db = _Shared({key(2): (69_000.0, "FEED", None), key(1): (70_000.0, "FEED", None)})
    # an agreeing re-read (inside the tolerance) and a new day: the new day is written, nothing else is touched
    out = S.put_shared(db, _rows("BTC", (day(2), 69_000.0 * (1 + 1e-9)), (day(1), 70_000.0), (day(0), 70_500.0)))
    assert out == {"written": 1, "known": 2, "differs": 0, "unchecked": 0, "refused": 0, "held": 0}
    (q, p), = db.writes()
    assert q.startswith("INSERT INTO fixings") and "NULL, :p" in q and "'FEED'" in q and q.endswith("ON CONFLICT DO NOTHING") and p["v"] == 70_500.0
    # a re-read that differs: the stored value stands, the date is disputed, and the new day of the same batch is NOT written
    db = _Shared({key(2): (69_000.0, "FEED", None), key(1): (70_000.0, "FEED", None)})
    with caplog.at_level(logging.WARNING, logger="rijeka.settlement"):
        out = S.put_shared(db, _rows("BTC", (day(2), 69_000.0), (day(1), 70_250.0), (day(0), 70_500.0)))
    assert out == {"written": 0, "known": 2, "differs": 1, "unchecked": 0, "refused": 0, "held": 1}
    assert key(0) not in db.rows and db.rows[key(1)].value == 70_000.0 and db.rows[key(1)].disputed_at and db.rows[key(2)].disputed_at is None
    assert [q.split(" WHERE")[0] for q, _ in db.writes()] == ["UPDATE fixings SET disputed_at = COALESCE(disputed_at, now())"]
    assert S.disputed(db, [("BTCUSD", DELIVERY)]) == 1 and "the date is disputed" in caplog.text
    # a later re-read that agrees clears the dispute, and the batch is stored again
    out = S.put_shared(db, _rows("BTC", (day(1), 70_000.0), (day(0), 70_500.0)))
    assert out["written"] == 1 and out["differs"] == 0 and db.rows[key(1)].disputed_at is None and db.value("BTC", day(0)) == 70_500.0
    # a date an administrator corrected is the administrator's: the venue reading otherwise is not a dispute and does not hold the batch
    db = _Shared({key(1): (70_000.0, "CORRECTION", None)})
    out = S.put_shared(db, _rows("BTC", (day(1), 71_000.0), (day(0), 70_500.0)))
    assert out["written"] == 1 and out["differs"] == 0 and db.rows[key(1)].value == 70_000.0 and db.rows[key(1)].disputed_at is None
    # the verdicts of the independent check decide a new day; without one for a date it is unchecked
    db = _Shared()
    out = S.put_shared(db, _rows("BTC", (day(3), 1.0), (day(2), 2.0), (day(1), 3.0), (day(0), 4.0)), {day(3): "ok", day(2): "refused", day(1): "unchecked"})
    assert out == {"written": 1, "known": 0, "differs": 0, "unchecked": 2, "refused": 1, "held": 0} and list(db.rows) == [key(3)]
    # a dry run counts and writes nothing, the dispute included
    db = _Shared({key(1): (70_000.0, "FEED", None)})
    assert S.put_shared(db, _rows("BTC", (day(1), 1.0), (day(0), 2.0)), write=False)["differs"] == 1 and db.writes() == []
    assert S.put_shared(_Shared(), _rows("BTC", (day(0), 2.0)), write=False)["written"] == 1
    for bad in (float("nan"), float("inf"), 0.0, -1.0):                       # refused before anything is compared or written
        db = _Shared()
        with pytest.raises(ValueError):
            S.put_shared(db, _rows("BTC", (day(1), 70_000.0), (day(0), bad)))
        assert db.log == []


def _sql(db) -> list[tuple[str, dict]]:
    return [(" ".join(str(c.args[0]).split()), c.args[1] if len(c.args) > 1 else {}) for c in db.execute.call_args_list]


def test_an_own_entry_supersedes_only_the_callers_row_and_a_correction_only_the_shared_one():
    S._tables["present"] = True
    db = MagicMock()
    uid, admin = str(uuid4()), str(uuid4())
    S.put_own(db, uid, "BTCUSD", TODAY, BRR, 70_123.0, "16:00 London")
    (upd, up), (ins, ip) = _sql(db)
    assert upd.startswith("UPDATE fixings SET superseded_at = now() WHERE user_id = CAST(:u AS uuid)") and "superseded_at IS NULL" in upd and "user_id IS NULL" not in upd
    assert up == {"u": uid, "p": "BTCUSD", "d": TODAY, "s": BRR}
    assert "'MANUAL'" in ins and ip["v"] == 70_123.0 and ip["t"] == "16:00 London" and ip["u"] == uid
    for bad in (None, ""):
        with pytest.raises(ValueError):
            S.put_own(db, bad, "BTCUSD", TODAY, BRR, 1.0)
    with pytest.raises(ValueError):
        S.put_own(db, uid, "BTCUSD", TODAY, BRR, float("nan"))
    db.reset_mock()
    S.put_correction(db, "BTCUSD", TODAY, DELIVERY, 70_400.0, "08:00 UTC", admin, "  the venue restated the day  ")
    (upd, up), (ins, ip) = _sql(db)
    assert upd.startswith("UPDATE fixings SET superseded_at = now() WHERE user_id IS NULL AND pair = :p") and "superseded_at IS NULL" in upd and "DELETE" not in upd
    assert "NULL, :p" in ins and "'CORRECTION'" in ins and ip["a"] == admin and ip["n"] == "the venue restated the day" and ip["v"] == 70_400.0
    for author, note in ((None, "a reason"), (admin, ""), (admin, "   ")):
        with pytest.raises(ValueError):
            S.put_correction(db, "BTCUSD", TODAY, DELIVERY, 1.0, None, author, note)
    # the read: exactly the named source, the caller's row before the shared one
    S.get(db, "BTCUSD", TODAY, BRR, uid)
    q, qp = _sql(db)[-1]
    assert "source = :s" in q and "(user_id IS NULL OR user_id = CAST(:u AS uuid))" in q and "ORDER BY (user_id IS NULL) LIMIT 1" in q and "superseded_at IS NULL" in q
    assert qp == {"p": "BTCUSD", "d": TODAY, "s": BRR, "u": uid}
    assert S.get(db, "BTCUSD", TODAY, "", uid) is None                                              # a trade that names no source has no fixing


def test_the_feed_is_delivering_only_when_it_is_on_the_table_is_there_and_a_fixing_is_recent(monkeypatch):
    key = ("BTCUSD", DELIVERY)
    db = _Shared({(*key, ): (70_000.0, "FEED", None)} if False else {("BTCUSD", day(3), DELIVERY): (70_000.0, "FEED", None)})
    assert S.feed_enabled() and not S.feed_delivering(db, "BTCUSD", TODAY)                           # the table is not there (a deploy ahead of the migration)
    S._tables["present"] = True
    assert S.feed_delivering(db, "BTCUSD", TODAY)                                                    # three days old: still delivering
    assert not S.feed_delivering(db, "BTCUSD", TODAY + timedelta(days=1))                            # four: the feed has stopped
    assert not S.feed_delivering(db, "ETHUSD", TODAY) and not S.feed_delivering(_Shared(), "BTCUSD", TODAY)       # no shared fixing of that pair
    assert not S.feed_delivering(db, "EURUSD", TODAY) and SRC.feed_source("EURUSD") is None           # a pair the feed does not fix
    broken = MagicMock()
    broken.execute.side_effect = RuntimeError("connection lost")
    assert not S.feed_delivering(broken, "BTCUSD", TODAY) and broken.rollback.called                 # a store that cannot be read is not delivering
    for var in ("RIJEKA_DERIBIT", "RIJEKA_DEMO_MARKET_DATA"):                                        # either switch off
        monkeypatch.setenv(var, "0")
        assert not S.feed_enabled() and not S.feed_delivering(db, "BTCUSD", TODAY)
        monkeypatch.delenv(var)
    assert S.feed_delivering(db, "BTCUSD", TODAY)


# ── the tick ───────────────────────────────────────────────────────────────────

def _stored(*assets_days) -> dict:
    """Shared rows: _stored(("BTC", range(1, 11)), ...) stores those days back for the asset."""
    return {(f"{a}USD", day(n), D.delivery_source(a)): (1.0, "FEED", None) for a, ns in assets_days for n in ns}


def _tick(db, got, spots, now=NOW, **kw):
    from api.routes import demo_market_data as r
    with patch.object(r.deribit, "collect_delivery", return_value=got) as collect, patch.object(r, "template_spots", side_effect=lambda db_, pair, dates: spots.get(pair, {})):
        return r.refresh_fixings(db, now=now, **kw), collect


def test_the_tick_asks_only_for_what_is_missing_and_deep_enough_to_reach_it():
    from api.routes import demo_market_data as r
    S._tables["present"] = True
    full = [("BTC", range(0, 10)), ("ETH", range(0, 10)), ("SOL", range(0, 10))]
    out, collect = _tick(_Shared(_stored(*full)), {"ok": {}, "failed": {}}, {})
    assert out == {"stored": True, "dry_run": False, "current": True, "asked": [], "waiting": [], "failed": {}, "assets": {}} and not collect.called
    # today's price is out and one asset has it already: the other two are asked, three days deep
    db = _Shared(_stored(("BTC", range(0, 10)), ("ETH", range(1, 10)), ("SOL", range(1, 10))))
    out, collect = _tick(db, {"ok": {}, "failed": {"ETH": "HTTP 503", "SOL": "HTTP 503"}}, {})
    assert collect.call_args.kwargs == {"count": {"ETH": 3, "SOL": 3}, "assets": ("ETH", "SOL"), "now": NOW}
    assert out["asked"] == ["ETH", "SOL"] and out["current"] is False and out["failed"] == {"ETH": "HTTP 503", "SOL": "HTTP 503"} and db.rollbacks == 1
    # a hole after an outage: the asset is asked deep enough to reach its oldest missing date (six days back: eight rows)
    db = _Shared(_stored(("BTC", [1, 2, 3, 7, 8, 9]), ("ETH", range(0, 10)), ("SOL", range(0, 10))))
    assert r.fixings_missing(db, NOW) == {"BTC": [day(6), day(5), day(4), day(0)], "ETH": [], "SOL": []}
    out, collect = _tick(db, {"ok": {}, "failed": {"BTC": "HTTP 503"}}, {})
    assert collect.call_args.kwargs["count"] == {"BTC": 8} and collect.call_args.kwargs["assets"] == ("BTC",)
    # an empty store is asked at once, for all ten days, whatever the hour
    late = datetime(2026, 11, 9, 22, 40, tzinfo=timezone.utc)
    out, collect = _tick(_Shared(), {"ok": {}, "failed": {}}, {}, now=late)
    assert collect.call_args.kwargs["count"] == {a: 11 for a in D.ASSETS} and out["asked"] == ["BTC", "ETH", "SOL"]
    # before 08:10 today's price is not expected: with yesterday stored there is nothing to ask
    early = datetime(2026, 11, 9, 8, 5, tzinfo=timezone.utc)
    out, collect = _tick(_Shared(_stored(("BTC", range(1, 11)), ("ETH", range(1, 11)), ("SOL", range(1, 11)))), {"ok": {}, "failed": {}}, {}, now=early)
    assert out["current"] is True and not collect.called


def test_an_asset_that_stays_missing_is_asked_less_often_and_a_backfill_is_forced():
    from api.routes import demo_market_data as r
    at = lambda h, m: datetime(2026, 11, 9, h, m, tzinfo=timezone.utc)
    today_gone = {"BTC": [], "ETH": [day(0)], "SOL": []}
    assert r.fixings_to_ask(today_gone, at(8, 15)) == {"ETH": 3} and r.fixings_to_ask(today_gone, at(14, 5)) == {"ETH": 3}       # the first six hours: every pass
    assert r.fixings_to_ask(today_gone, at(14, 40)) == {} and r.fixings_to_ask(today_gone, at(16, 10)) == {}                    # after that, not every pass
    assert r.fixings_to_ask(today_gone, at(15, 10)) == {"ETH": 3} and r.fixings_to_ask(today_gone, at(18, 29)) == {"ETH": 3}    # the first half hour of every third hour
    assert r.fixings_to_ask(today_gone, at(15, 31)) == {}
    old_hole = {"BTC": [day(5)], "ETH": [], "SOL": []}                           # only an older hole (unchecked, refused, or never published): the slow lane from the start
    assert r.fixings_to_ask(old_hole, at(9, 20)) == {"BTC": 7} and r.fixings_to_ask(old_hole, at(10, 20)) == {}
    assert sum(bool(r.fixings_to_ask(old_hole, at(h, m))) for h in range(24) for m in (10, 40)) == 8                           # eight passes a day, not forty-eight
    never = {"BTC": [], "ETH": [], "SOL": [day(n) for n in range(9, -1, -1)]}     # one asset has never had a fixing while the others have
    assert r.fixings_to_ask(never, at(10, 20)) == {"SOL": 11} and r.fixings_to_ask(never, at(16, 40)) == {} and r.fixings_to_ask(never, at(18, 5)) == {"SOL": 11}
    # a backfill: every asset, now, as deep as asked (and never beyond the row cap)
    assert r.fixings_to_ask({a: [] for a in D.ASSETS}, at(10, 20), count=40, force=True) == {a: 40 for a in D.ASSETS}
    assert r.fixings_to_ask(old_hole, at(10, 20), count=10 ** 6, force=True) == {a: D.MAX_DELIVERY_ROWS for a in D.ASSETS}
    S._tables["present"] = True
    db = _Shared(_stored(("BTC", range(0, 10)), ("ETH", range(1, 10)), ("SOL", range(0, 10))))
    out, collect = _tick(db, {"ok": {}, "failed": {}}, {}, now=at(16, 40))
    assert out["asked"] == [] and out["waiting"] == ["ETH"] and out["current"] is False and not collect.called


def test_a_price_is_stored_only_when_an_independent_spot_agrees_with_it():
    from api.routes import demo_market_data as r
    S._tables["present"] = True
    assert r.FIXING_SPOT_BAND == 0.15
    assert [r.spot_verdict(v, 100.0) for v in (100.0, 114.9, 85.1, 115.1, 84.9, 100_000.0, 1e-9)] == ["ok", "ok", "ok", "refused", "refused", "refused", "refused"]
    assert r.spot_verdict(100.0, None) == "unchecked"
    spots = {"BTCUSD": {day(n): 70_000.0 for n in range(0, 11)}, "ETHUSD": {day(1): 3_000.0}, "SOLUSD": {day(n): 150.0 for n in range(0, 11)}}
    hostile = {
        "a whole batch out by a thousand": _rows("BTC", (day(2), 7e7), (day(1), 7e7), (day(0), 7e7)),
        "two wrong rows that agree": _rows("BTC", (day(1), 35_000.0), (day(0), 35_000.0)),
        "a row 55 % off": _rows("BTC", (day(0), 70_000.0 * 1.55)),
        "a drift of 40 % a day": _rows("BTC", (day(2), 98_000.0), (day(1), 137_200.0), (day(0), 192_080.0)),
    }
    for what, rows in hostile.items():
        db = _Shared()
        out, _ = _tick(db, {"ok": {"BTC": rows}, "failed": {}}, spots)
        assert db.rows == {} and out["written"] == 0 and out["refused"] == len(rows) and out["assets"]["BTC"]["refused"] == len(rows), what
    # a date with no stored spot is not stored and is reported, counts only; the dates that can be checked are
    db = _Shared()
    got = {"ok": {"BTC": _rows("BTC", (day(1), 69_000.0), (day(0), 71_000.0)), "ETH": _rows("ETH", (day(1), 3_050.0), (day(0), 3_060.0)),
                  "SOL": _rows("SOL", (day(0), 149.0))}, "failed": {}}
    out, _ = _tick(db, got, spots)
    assert sorted(db.rows) == sorted([("BTCUSD", day(1), DELIVERY), ("BTCUSD", day(0), DELIVERY), ("ETHUSD", day(1), "Deribit ETH delivery price"),
                                      ("SOLUSD", day(0), "Deribit SOL delivery price")])
    assert out["written"] == 4 and out["unchecked"] == 1 and out["refused"] == 0 and out["assets"]["ETH"] == {"read": 2, "latest": day(0).isoformat(), "written": 1, "known": 0, "differs": 0, "unchecked": 1, "refused": 0, "held": 0}
    assert db.commits == 1 and all(isinstance(v, (int, str, bool, list, dict)) for v in out.values())
    # no template account, no independent spot: nothing is stored at all
    with patch.object(r.demo, "_template_user_id", return_value=None):
        assert r.template_spots(MagicMock(), "BTCUSD", [day(0)]) == {}
    # a re-read that differs: nothing of that asset's batch, a reason in the summary, the other asset unaffected
    db = _Shared({("BTCUSD", day(1), DELIVERY): (69_000.0, "FEED", None)})
    got = {"ok": {"BTC": _rows("BTC", (day(1), 69_500.0), (day(0), 71_000.0)), "SOL": _rows("SOL", (day(0), 149.0))}, "failed": {}}
    out, _ = _tick(db, got, spots)
    assert ("BTCUSD", day(0), DELIVERY) not in db.rows and db.value("BTC", day(1)) == 69_000.0 and ("SOLUSD", day(0), "Deribit SOL delivery price") in db.rows
    assert out["failed"] == {"BTC": "a re-read differs from a stored fixing: nothing stored, the date is disputed"} and out["differs"] == 1 and out["held"] == 1 and out["written"] == 1
    assert r.last_fixing_at(db, NOW) is None                                                        # disputed: health is red until it is corrected
    # a dry run asks the venue, reads the spots and writes nothing
    db = _Shared()
    out, _ = _tick(db, {"ok": {"BTC": _rows("BTC", (day(0), 71_000.0))}, "failed": {}}, spots, dry_run=True)
    assert out["dry_run"] is True and out["written"] == 1 and db.rows == {} and db.writes() == [] and db.commits == 0


def test_one_asset_that_cannot_be_stored_does_not_take_the_others_with_it():
    S._tables["present"] = True
    db = _Shared()
    got = {"ok": {"BTC": _rows("BTC", (day(0), float("nan"))), "ETH": _rows("ETH", (day(0), 3_000.0))}, "failed": {}}
    out, _ = _tick(db, got, {"BTCUSD": {day(0): 70_000.0}, "ETHUSD": {day(0): 3_000.0}})
    assert set(out["assets"]) == {"ETH"} and out["failed"] == {"BTC": "not stored (ValueError)"} and out["written"] == 1


def test_the_route_is_gated_like_the_marks_and_both_drivers_make_the_same_call(monkeypatch):
    import main
    import scheduler as sch
    from api.routes import demo_market_data as r
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    db = MagicMock()
    main.app.dependency_overrides[r.get_db] = lambda: db
    c, url, h = TestClient(main.app), "/api/market-data/demo/fixings/tick", {"X-Rijeka-Cron": "s3cret"}
    try:
        with patch.object(r, "refresh_fixings", return_value={"stored": True}) as refresh:
            assert c.post(url).status_code == 403 and c.post(url, headers={"X-Rijeka-Cron": "wrong"}).status_code == 403
            assert c.post(url + "?count=0", headers=h).status_code == 422 and c.post(url + f"?count={D.MAX_DELIVERY_ROWS + 1}", headers=h).status_code == 422
            assert c.post(url, headers=h).json() == {"stored": False}                                 # the table is not there: nothing asked, nothing written
            S._tables["present"] = True
            for var in ("RIJEKA_DERIBIT", "RIJEKA_DEMO_MARKET_DATA"):
                monkeypatch.setenv(var, "0")
                assert c.post(url, headers=h).json() == {"enabled": False}
                monkeypatch.delenv(var)
            assert not refresh.called
            assert c.post(url + "?dry_run=1&count=40&force=1", headers=h).json() == {"stored": True}
            assert refresh.call_args.args == (db,) and refresh.call_args.kwargs == {"count": 40, "dry_run": True, "force": True}
            # the scheduler's step is a plain call of the same tick: the skip rule lives in refresh_fixings, for both drivers
            step = {n: (g, fn) for n, g, fn in sch._define_steps()}["crypto_fixings"]
            assert step[0] == "half_hourly" and not hasattr(sch, "_fixings")
            assert step[1](db, "s3cret") == {"stored": True} and refresh.call_args.kwargs == {"count": 3, "dry_run": False, "force": False}
            assert step[1](db, "wrong-secret-is-refused-by-the-route-too") if False else True
    finally:
        main.app.dependency_overrides.clear()


def test_health_is_red_for_a_hole_a_dispute_or_an_asset_without_a_fixing(monkeypatch):
    from api.routes import demo_market_data as r, ops
    db = MagicMock()
    assert "crypto_fixings" not in [c[0] for c in ops.active_checks(db)]                             # no table: no check, not a stale batch
    S._tables["present"] = True
    last = ops.active_checks(db)[-1]
    assert last[0] == "crypto_fixings" and last[1] is r.last_fixing_at and last[2] == ("hours", 36)
    eight = lambda *holes: [n for n in range(0, 8) if n not in holes]
    whole = _Shared(_stored(("BTC", eight()), ("ETH", eight()), ("SOL", eight())))
    assert r.last_fixing_at(whole, NOW) == datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    # today's price not in yet: the latest stored date, at the hour the venue publishes (the check's own 36 hours decide)
    behind = _Shared(_stored(("BTC", eight()), ("ETH", eight(0)), ("SOL", eight())))
    assert r.last_fixing_at(behind, NOW) == datetime(2026, 11, 8, 8, 0, tzinfo=timezone.utc)
    # a hole anywhere in the seven days before the latest expected date, for any asset: red, however fresh the latest row
    for hole in (1, 4, 7):
        assert r.last_fixing_at(_Shared(_stored(("BTC", eight()), ("ETH", eight()), ("SOL", eight(hole)))), NOW) is None, hole
    assert r.last_fixing_at(_Shared(_stored(("BTC", range(0, 9)), ("ETH", range(0, 9)), ("SOL", [0, 1, 2, 3, 4, 5, 6, 7]))), NOW) is not None      # day 8 is beyond the seven
    assert r.last_fixing_at(_Shared(_stored(("BTC", eight()), ("ETH", eight()))), NOW) is None                                                      # an asset with none
    disputed = _Shared(_stored(("BTC", eight()), ("ETH", eight()), ("SOL", eight())))
    disputed.rows[("ETHUSD", day(3), "Deribit ETH delivery price")].disputed_at = "2026-11-09"
    assert r.last_fixing_at(disputed, NOW) is None
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
    assert ("fixings", "2026-11-10_fixings.sql", "stored fixings for digital assets; without it an expired trade is valued on the stored spot, flagged provisional",
            "settlement.store", "tables_present") in ops.OPTIONAL_MIGRATIONS
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


# ── the names a source may have ────────────────────────────────────────────────

LOOK_ALIKES = ["Deribit BTC delivery price.", "Deribit BTC delivery-price", "Deribit BTC deIivery price", "Deribit BTC delivery price (official)",
               "deribit  btc DELIVERY price", "Deribit ETH delivery price", "DERIBIT SOL DELIVERY PRICE", "Der1bit BTC delivery price", "Derlblt BTC",
               "Deribit BTC de1ivery price", "Derib1t BTC delivery pr1ce", "D.e.r.i.b.i.t BTC", "Deribit", "My Deribit 08:00 fix", "Deribit BTC-PERPETUAL mark",
               "Deribit BTC delivery price\u200b", "Deri\u200bbit BTC delivery price", "\uff24\uff45\uff52\uff49\uff42\uff49\uff54 BTC delivery price", "Deribit BTC delivery\u00a0price",
               "Deribit BTC delivery price\u202e", "D\u0435ribit BTC delivery price"]          # the last with a Cyrillic \u0435


def test_a_desk_cannot_store_or_book_under_a_name_that_reads_like_the_feeds():
    from api.routes import currencies as C
    assert C.SETTLEMENT_SOURCES is SRC.SETTLEMENT_SOURCES
    assert {p: [x["source"] for x in v if x["auto"]] for p, v in SRC.SETTLEMENT_SOURCES.items()} == {D.pair(a): [D.delivery_source(a)] for a in D.ASSETS}
    assert all(x["time"] == (D.DELIVERY_TIME if x["auto"] else "16:00 London") for v in SRC.SETTLEMENT_SOURCES.values() for x in v)
    assert set(SRC.SETTLEMENT_SOURCES) == set(C.CRYPTO_PAIRS) and SRC.feed_source("SOLUSD") == "Deribit SOL delivery price"
    for name in LOOK_ALIKES:
        with pytest.raises(ValueError):
            SRC.check_desk_source(name)
    assert all(SRC.feed_owns(n) for n in LOOK_ALIKES[:20]) and SRC.skeleton("Deribit BTC deIivery price") == SRC.skeleton(DELIVERY) and SRC.skeleton("O0 Il1") == "00lll"
    for honest in ("CME CF BRR", "CME CF ETHUSD_RR", "Coinbase SOL-USD", "Kraken (XBT/USD) 4pm.", "A" * 80, "Desk close 17:00", "BRR+1",
                   "Kaiko BTC", "Bitstamp BTC/USD", "Derive index", "Bybit BTC index", "Bitfinex BTCUSD", "Binance BTCUSDT", "OKX BTC index", "Delivery price desk", "Deriv"):
        assert SRC.check_desk_source(f"  {honest} ") == honest and not SRC.feed_owns(honest)
    # a name one or two slips from the venue's, or from a feed source's own: taken for it (Magnus, 2026-11-10)
    for squat in ("Derbit", "Deribt", "Dcribit", "Deribil BTC delivery price", "Derbit BTC delivery price", "Deribt 08:00 fix", "Dribit BTC", "Deeribit", "Deribitt BTC",
                  "Ceribit ETH delivery price", "Derihit SOL"):
        assert SRC.feed_owns(squat), squat
        with pytest.raises(ValueError, match="reads like it"):
            SRC.check_desk_source(squat)
    assert SRC._within("derlblt", "derlve", 3) and not SRC._within("derlblt", "derlve", 2) and SRC._within("abc", "abc", 0) and not SRC._within("abcdef", "abc", 2)
    assert SRC.feed_owns("Debit rate") and not SRC.feed_owns("Dbit")            # the one plain word the rule catches (two slips from the venue's name); a four-letter one is too short to judge
    for bad in ("", "   ", "x" * 81, "<script>alert(1)</script>", "CME CF BRR\nX", "BRR; DROP TABLE fixings", "\uff23\uff2d\uff25", "-BRR", "BRR\u200b", "BRR\x00", "BRR\u2028", None, 7, ["CME CF BRR"]):
        with pytest.raises(ValueError):
            SRC.check_desk_source(bad)
    assert not SRC.printable("a\u200bb") and not SRC.printable("a\u202eb") and not SRC.printable("a\tb") and SRC.printable("a b · c")


def _terms(inst="CRYPTO_FORWARD", **kw):
    base = {"digital_asset": "BTC", "notional_amount": "10", "direction": "BUY", "settlement_price_source": BRR, "valuation_time": "16:00 London"}
    return inst, {**base, **kw}


def test_booking_takes_the_pairs_feed_source_or_a_desk_source_at_the_time_that_source_is_published():
    ok = [_terms(), _terms(settlement_price_source=DELIVERY, valuation_time="08:00 UTC"),
          _terms("CRYPTO_OPTION", settlement_price_source=DELIVERY, valuation_time="08:00 UTC"), _terms("CRYPTO_OPTION"),
          _terms("CRYPTO_OPTION", valuation_time="08:00 UTC"),                    # what every option ticket before 0.14.0 writes beside the benchmark
          _terms(settlement_price_source="Kraken (XBT/USD) 4pm.", valuation_time="16:00 New York"), _terms(settlement_price_source="Desk close", valuation_time=None),
          _terms(settlement_price_source=None), _terms(settlement_price_source=""), ("CRYPTO_FORWARD", {"digital_asset": "BTC"}),
          _terms(digital_asset="eth", settlement_price_source="Deribit ETH delivery price", valuation_time="08:00 UTC"),
          _terms(digital_asset="SOL", settlement_price_source="Coinbase SOL-USD"),
          ("FX_FORWARD", {"settlement_price_source": DELIVERY}), ("NDF", {"fixing_source": "Deribit BTC delivery price."}), ("IR_SWAP", {}), ("CRYPTO_FORWARD", None)]
    for inst, terms in ok:
        SRC.check_booked(inst, terms)
    bad = [_terms(valuation_time="08:00 UTC"),                                     # the benchmark at the venue's time, on a forward
           _terms(settlement_price_source=DELIVERY), _terms(settlement_price_source=DELIVERY, valuation_time=None),      # the venue's price at the benchmark's time, or none
           _terms("CRYPTO_OPTION", settlement_price_source=DELIVERY, valuation_time="16:00 London"),
           _terms("CRYPTO_OPTION", valuation_time="10:00 New York"), _terms(valuation_time=""), _terms(valuation_time=None),
           _terms(settlement_price_source="Deribit ETH delivery price", valuation_time="08:00 UTC"),                    # another pair's feed source
           _terms(settlement_price_source=" CME CF BRR"), _terms(settlement_price_source=7), _terms(settlement_price_source=["CME CF BRR"]),
           *[_terms(settlement_price_source=n, valuation_time="08:00 UTC") for n in LOOK_ALIKES]]
    for inst, terms in bad:
        with pytest.raises(ValueError):
            SRC.check_booked(inst, terms)
    # a forward's fixing date: after the trade date, on or before the settlement date, at most seven days before it; without one it is the settlement date
    dated = lambda **kw: (_terms(settlement_date="2027-01-30", **kw)[1], date(2026, 11, 2), "2027-01-30")
    for fine in (dated(), dated(valuation_date=None), dated(valuation_date=""), dated(valuation_date="2027-01-30"), dated(valuation_date="2027-01-29"),
                 dated(valuation_date="2027-01-23"), dated(valuation_date=date(2027, 1, 25))):                # the 23rd: seven days before, the most there may be
        SRC.check_booked("CRYPTO_FORWARD", *fine)
    assert SRC.MAX_FIXING_GAP_DAYS == 7
    SRC.check_booked("CRYPTO_FORWARD", _terms(valuation_date="2027-01-29")[1], None, "2027-01-30")              # the settlement date from the trade's maturity
    SRC.check_booked("CRYPTO_OPTION", _terms("CRYPTO_OPTION", valuation_date="2030-01-01", settlement_date="2027-01-30")[1], "2026-11-02", "2027-01-30")    # an option's date is its expiry's affair
    near = lambda **kw: (_terms(settlement_date="2026-11-05", **kw)[1], date(2026, 11, 2), "2026-11-05")
    SRC.check_booked("CRYPTO_FORWARD", *near(valuation_date="2026-11-03"))
    for wrong, why in ((dated(valuation_date="2027-01-31"), "cannot be after the settlement date"), (near(valuation_date="2026-11-01"), "the fixing date must be after the trade date"),
                       (near(valuation_date="2026-11-02"), "the fixing date must be after the trade date"),      # a fixing dated the trade date may be published already
                       (dated(valuation_date="2027-01-22"), "the fixing date can be at most 7 days before the settlement date"),
                       (dated(valuation_date="2026-11-03"), "the fixing date can be at most 7 days before the settlement date"),
                       (dated(valuation_date="soon"), "is not a date"), (dated(valuation_date=20270129), "is not a date")):
        with pytest.raises(ValueError, match=why):
            SRC.check_booked("CRYPTO_FORWARD", *wrong)
    # records booked before 0.14.0 still pass (confirming the counterparty's side re-validates them through the booking model, trade_cards.book_mirror):
    # the benchmark at 16:00 London on a forward fixed on its settlement date or with no fixing date at all; the benchmark at 08:00 UTC on an option
    old_forward = {"digital_asset": "BTC", "notional_amount": "10", "direction": "BUY", "forward_price": "100000", "price_currency": "USD", "valuation_time": "16:00 London",
                   "settlement_date": "2027-01-30", "settlement_currency": "USD", "settlement_price_source": BRR, "calculation_agent": None}
    old_option = {"direction": "BUY", "digital_asset": "ETH", "notional_amount": "10", "option_type": "CALL", "strike_price": "3800", "expiration_date": "2027-01-29",
                  "expiration_time": "08:00 UTC", "valuation_date": "2027-01-29", "valuation_time": "08:00 UTC", "settlement_date": "2027-01-30", "settlement_price_source": "CME CF ETHUSD_RR"}
    for inst, terms in (("CRYPTO_FORWARD", {**old_forward, "valuation_date": "2027-01-30"}), ("CRYPTO_FORWARD", old_forward), ("CRYPTO_OPTION", old_option)):
        SRC.check_booked(inst, terms, "2026-10-28", "2027-01-30")
    assert SRC.LEGACY_OPTION_TIME == "08:00 UTC"
    # both booking routes use it, and say so in plain words
    from api.routes.booking import BookingRequest
    from api.routes.trades import TradeCreate
    common = dict(asset_class="CRYPTO", instrument_type="CRYPTO_FORWARD", structure="VANILLA", notional=10, notional_ccy="BTC",
                  trade_date="2026-11-02", effective_date="2026-11-02", maturity_date="2027-01-30")
    for model, extra in ((TradeCreate, {}), (BookingRequest, {"legs": []})):
        assert model(**common, **extra, terms=_terms()[1]).terms["settlement_price_source"] == BRR
        assert model(**common, **extra, terms=_terms(settlement_price_source=DELIVERY, valuation_time="08:00 UTC")[1])
        assert model(**common, **extra, terms=_terms(valuation_date="2027-01-29", settlement_date="2027-01-30")[1])             # fixed the day before it is paid
        for wrong, why in ((_terms(settlement_price_source="Deribit BTC delivery price.")[1], "reads like it"), (_terms(valuation_time="08:00 UTC")[1], "valuation_time must be 16:00 London"),
                           (_terms(settlement_price_source="BRR\u200b")[1], "non-printing"), (_terms(valuation_date="2027-01-31")[1], "cannot be after the settlement date"),
                           (_terms(valuation_date="2026-11-01", settlement_date="2027-01-30")[1], "must be after the trade date"),
                           (_terms(valuation_date="2027-01-20", settlement_date="2027-01-30")[1], "at most 7 days before the settlement date")):
            with pytest.raises(ValueError, match=why):
                model(**common, **extra, terms=wrong)
        assert model(**{**common, "asset_class": "FX", "instrument_type": "NDF"}, **extra, terms={"fixing_source": "Deribit BTC delivery price."})       # not this rule's
        early = {**common, "trade_date": "2026-10-28", "effective_date": "2026-10-28"}
        assert model(**early, **extra, terms=old_forward) and model(**{**early, "instrument_type": "CRYPTO_OPTION", "structure": "EUROPEAN"}, **extra, terms=old_option)


# ── the pairs answer, the desk's own entry, the correction ─────────────────────

def test_fixing_default_stays_the_benchmark_and_settlement_default_follows_the_feed(monkeypatch):
    import main
    from api.routes import currencies as C
    db = MagicMock()
    db.execute.return_value.first.return_value = None
    benchmark = {"BTCUSD": "CME CF BRR", "ETHUSD": "CME CF ETHUSD_RR", "SOLUSD": "Coinbase SOL-USD"}
    def states(delivering):
        with patch.object(S, "feed_delivering", side_effect=lambda db_, pair, today=None: pair in delivering) as asked:
            return {p: C.pair_state(db, "u", p) for p in (*benchmark, "EURUSD", "USDJPY")}, asked
    off, _ = states(())
    on, asked = states(("BTCUSD", "SOLUSD"))
    for st in (off, on):                                             # what clients older than 0.14.0 read: unchanged, whatever the feed does
        assert {p: st[p]["fixing_default"] for p in benchmark} == benchmark and all("fixing_default_time" not in x for x in st.values())
        assert st["EURUSD"]["fixing_default"] == st["USDJPY"]["fixing_default"] == "WM/Reuters 4pm London"
        assert "settlement_default" not in st["EURUSD"] and "fixing_sources" not in st["EURUSD"]
    # the venue's source is offered only where the feed is delivering it: "fixed automatically each day" is not promised where it is not true
    assert all(off[p]["fixing_sources"] == [{"source": b, "time": "16:00 London", "auto": False}] for p, b in benchmark.items())
    assert on["BTCUSD"]["fixing_sources"] == SRC.SETTLEMENT_SOURCES["BTCUSD"] and on["BTCUSD"]["fixing_sources"][0] is not SRC.SETTLEMENT_SOURCES["BTCUSD"][0]
    assert on["ETHUSD"]["fixing_sources"] == [{"source": "CME CF ETHUSD_RR", "time": "16:00 London", "auto": False}]
    SRC.check_booked(*_terms(digital_asset="ETH", settlement_price_source="Deribit ETH delivery price", valuation_time="08:00 UTC"))     # only the offer changes: such a record is still booked
    assert {p: off[p]["settlement_default"] for p in benchmark} == {p: {"source": b, "time": "16:00 London"} for p, b in benchmark.items()}
    assert on["BTCUSD"]["settlement_default"] == {"source": DELIVERY, "time": "08:00 UTC"} and on["SOLUSD"]["settlement_default"]["source"] == "Deribit SOL delivery price"
    assert on["ETHUSD"]["settlement_default"] == {"source": "CME CF ETHUSD_RR", "time": "16:00 London"}        # that pair's feed is not delivering
    assert sorted(c.args[1] for c in asked.call_args_list) == sorted(benchmark)                              # asked for the digital assets only
    # the pricer does not read the sources and does not ask the fixings store about them
    with patch.object(S, "feed_delivering") as asked:
        st = C.pair_state(db, "u", "BTCUSD", settlement=False)
    assert not asked.called and "settlement_default" not in st and st["fixing_default"] == "CME CF BRR"
    assert C.settlement_default(db, "EURUSD") is None and C.settlement_default(db, "BTCUSD") == {"source": BRR, "time": "16:00 London"}      # the real question, on a session with no table
    # the route: the tenor grid the forward points are quoted on, once, at the top
    main.app.dependency_overrides[C.get_db] = lambda: db
    main.app.dependency_overrides[C.verify_token] = lambda: {"sub": str(uuid4()), "user_metadata": {"role": "viewer"}}
    try:
        body = TestClient(main.app).get("/api/currency/pairs").json()
    finally:
        main.app.dependency_overrides.clear()
    assert body["tenor_days"] == C.TENOR_DAYS and body["tenor_days"]["1M"] == 30 and {p["pair"] for p in body["pairs"]} == set(C.PAIRS)


@pytest.fixture
def desk():
    """The currency routes with a stand-in session and a signed-in trader; yields (client, db, user)."""
    import main
    from api.routes import _limits, currencies
    db, user = MagicMock(), {"sub": str(uuid4()), "user_metadata": {"role": "trader"}}
    main.app.dependency_overrides[currencies.get_db] = lambda: db
    main.app.dependency_overrides[currencies.verify_token] = lambda: user
    _limits._buckets.clear()
    usage = {"rows": 0, "total": 0, "sources": 0, "replaces": False, "source_known": False}
    try:
        with patch.object(S, "own_usage", side_effect=lambda *a: dict(usage)):
            yield TestClient(main.app), db, user, usage
    finally:
        main.app.dependency_overrides.clear()
        _limits._buckets.clear()


def test_an_own_fixing_is_validated_before_anything_is_stored(desk):
    c, db, user, usage = desk
    S._tables["present"] = True
    good = {"pair": "BTCUSD", "fixing_date": "2026-11-09", "source": BRR, "value": 70_012.5}
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    bad = [{**good, "pair": "DOGEUSD"}, {**good, "pair": "EURUSD"}, {**good, "pair": "x" * 5000}, {**good, "fixing_date": tomorrow}, {**good, "fixing_date": "soon"},
           {**good, "fixing_date": "2014-12-31"}, {**good, "fixing_date": "0001-01-01"},
           {**good, "value": 0}, {**good, "value": -1.0}, {**good, "value": 1e13}, {**good, "value": "abc"}, {**good, "value": None},
           {**good, "source": "x" * 81}, {**good, "source": ""}, {**good, "source": "   "}, {**good, "source": "<script>alert(1)</script>"},
           {**good, "source": "CME CF BRR\nX"}, {**good, "source": "BRR; DROP TABLE fixings"}, {**good, "source": "\uff23\uff2d\uff25"}, {**good, "source": "-BRR"},
           *[{**good, "source": n} for n in (DELIVERY, *LOOK_ALIKES)],
           {k: v for k, v in good.items() if k != "source"}, {k: v for k, v in good.items() if k != "fixing_date"}]
    from api.routes import _limits
    for body in bad:
        _limits._buckets.clear()                                                 # this is about validation, not the limit
        r = c.post("/api/currency/fixings", json=body)
        assert r.status_code == 422, (body, r.status_code, r.text)
    for raw in ('{"pair": "BTCUSD", "fixing_date": "2026-11-09", "source": "CME CF BRR", "value": NaN}', '{"pair": "BTCUSD", "fixing_date": "2026-11-09", "source": "CME CF BRR", "value": Infinity}'):
        assert c.post("/api/currency/fixings", content=raw, headers={"Content-Type": "application/json"}).status_code == 422
    assert not any(s.startswith(("INSERT", "UPDATE")) for s, _ in _sql(db)) and not db.commit.called
    # eighty characters is the limit, not beyond it; a source the feed does not own may be any plain name; the floor is a date, not a wall
    db.execute.return_value.all.return_value = []
    for body in ({**good, "source": "A" * 80}, {**good, "source": "Coinbase BTC-USD"}, {**good, "source": "Kraken (XBT/USD) 4pm."}, good, {**good, "fixing_date": "2015-01-01"}):
        assert c.post("/api/currency/fixings", json=body).status_code == 200, body
    # the caps: an account's live rows, and its distinct sources on a pair; replacing a row or reusing a source is not growth
    usage.update(rows=S.OWN_ROWS_MAX)
    assert c.post("/api/currency/fixings", json=good).status_code == 422
    usage.update(replaces=True)
    assert c.post("/api/currency/fixings", json=good).status_code == 200
    usage.update(rows=10, replaces=False, sources=S.OWN_SOURCES_MAX)
    r = c.post("/api/currency/fixings", json=good)
    assert r.status_code == 422 and "sources" in r.json()["detail"]
    usage.update(source_known=True)
    assert c.post("/api/currency/fixings", json=good).status_code == 200
    # every replacement keeps the row it replaces: an account's rows in all are capped too, replacements included (Edgar, 2026-11-10)
    usage.update(rows=3, replaces=True, total=S.OWN_TOTAL_MAX)
    full = c.post("/api/currency/fixings", json=good)
    assert full.status_code == 409 and "replaced ones included" in full.json()["detail"]
    usage.update(total=S.OWN_TOTAL_MAX - 1)
    assert c.post("/api/currency/fixings", json=good).status_code == 200
    assert S.OWN_ROWS_MAX == 5000 and S.OWN_SOURCES_MAX == 20 and S.OWN_TOTAL_MAX == 20000


def test_an_own_fixing_needs_a_trader_the_migration_and_is_rate_limited(desk):
    from sqlalchemy.exc import IntegrityError
    c, db, user, _ = desk
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
    assert r.json() == {"pair": "BTCUSD", "stored": True, "sources": [{"source": BRR, "time": "16:00 London", "auto": False}],
                        "fixings": [{"date": "2026-11-09", "source": BRR, "time": "16:00 London", "value": 70_012.5, "origin": "MANUAL", "own": True, "disputed": False}]}
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


def test_a_shared_fixing_is_corrected_by_an_administrator_with_a_reason_and_the_feeds_own_checks(desk):
    from api.routes import demo_market_data as r
    c, db, user, _ = desk
    url = "/api/currency/fixings/correct"
    published = r.expected_fixing_date()
    good = {"pair": "BTCUSD", "fixing_date": (published - timedelta(days=1)).isoformat(), "source": DELIVERY, "value": 70_400.0, "reason": "the venue restated the day after a bad print"}
    spot = {"v": 70_000.0}
    role = {"v": "trader"}
    gate = {"v": True}
    def signup(db_):
        if isinstance(gate["v"], Exception):
            raise gate["v"]
        return gate["v"]
    own = {"v": user["sub"]}                                                     # the instance's own account: the caller, until the test says otherwise
    with patch("api.routes.me.db_role", side_effect=lambda db_, uid: role["v"]), patch("api.routes.ops.signup_role_applied", side_effect=signup), \
         patch("api.routes.demo._template_user_id", side_effect=lambda db_: own["v"]), \
         patch.object(r, "template_spots", side_effect=lambda db_, pair, dates: {d: spot["v"] for d in dates} if spot["v"] else {}):
        for who in ("trader", "viewer", "risk", None):                           # the profile's role decides, and only admin
            role["v"] = who
            assert c.post(url, json=good).status_code == 403, who
        role["v"] = "admin"                                                      # an admin who is not the instance's own account: refused, whatever made them one
        for other in (str(uuid4()), None):
            own["v"] = other
            refused = c.post(url, json=good)
            assert refused.status_code == 403 and "instance's own account" in refused.json()["detail"], other
        own["v"] = user["sub"]
        role["v"], user["user_metadata"]["role"] = "trader", "admin"             # a claim in the token does not outrank the profile
        assert c.post(url, json=good).status_code == 403
        role["v"] = "admin"
        assert c.post(url, json=good).status_code == 409                         # before the migration
        S._tables["present"] = True
        bad = [{**good, "pair": "EURUSD"}, {**good, "pair": "DOGEUSD"}, {**good, "source": BRR}, {**good, "source": "Deribit ETH delivery price"}, {**good, "source": "deribit btc delivery price"},
               {**good, "value": 0}, {**good, "value": -5}, {**good, "value": 50.0}, {**good, "value": 2e8}, {**good, "value": "x"},
               {**good, "fixing_date": (published + timedelta(days=1)).isoformat()}, {**good, "fixing_date": "2014-12-31"}, {**good, "fixing_date": "soon"},
               {**good, "reason": ""}, {**good, "reason": "too short"}, {**good, "reason": "x" * 501}, {**good, "reason": "a reason with a hidden\u200b character"},
               {**good, "reason": "          "}, {k: v for k, v in good.items() if k != "reason"},
               {**good, "value": 70_000.0 * 1.16}, {**good, "value": 70_000.0 * 0.84}]          # the last two: inside the bounds, outside the spot's band
        from api.routes import _limits
        for body in bad:
            _limits._buckets.clear()
            res = c.post(url, json=body)
            assert res.status_code == 422, (body, res.status_code, res.text)
        raw = json.dumps(good).replace("70400.0", "NaN")
        assert c.post(url, content=raw, headers={"Content-Type": "application/json"}).status_code == 422
        spot["v"] = None                                                         # no stored spot for the date: it cannot be checked, so it cannot be stored
        res = c.post(url, json=good)
        assert res.status_code == 422 and "no stored spot" in res.json()["detail"]
        assert not any(s.startswith(("INSERT", "UPDATE", "DELETE")) for s, _ in _sql(db)) and not db.commit.called
        spot["v"] = 70_000.0
        db.reset_mock()
        _limits._buckets.clear()
        db.execute.return_value.all.return_value = [SimpleNamespace(fixing_date=published - timedelta(days=1), fixing_time="08:00 UTC", source=DELIVERY, value=70_400.0, origin="CORRECTION", user_id=None)]
        res = c.post(url, json={**good, "pair": "btcusd", "reason": "  the venue restated the day\n after a bad print "})
        assert res.status_code == 200, res.text
        assert res.json()["fixings"] == [{"date": good["fixing_date"], "source": DELIVERY, "time": "08:00 UTC", "value": 70_400.0, "origin": "CORRECTION", "own": False, "disputed": False}]
        (upd, up), (ins, ip) = [(s, p) for s, p in _sql(db) if s.startswith(("INSERT", "UPDATE"))]
        assert "user_id IS NULL" in upd and up == {"p": "BTCUSD", "d": published - timedelta(days=1), "s": DELIVERY}
        assert "'CORRECTION'" in ins and ip["a"] == user["sub"] and ip["n"] == "the venue restated the day after a bad print" and ip["t"] == "08:00 UTC" and db.commit.call_count == 1
        # a genuine fixing after a move larger than the band, or on a date with no stored spot: stored only with the override, a fuller reason, and a note that says so
        _limits._buckets.clear()
        far = {**good, "value": 70_000.0 * 1.30}
        long_reason = "the market moved thirty per cent on the day; the venue's notice confirms the price"
        assert c.post(url, json=far).status_code == 422 and c.post(url, json={**far, "override_band": True, "reason": "a bad print, restated"}).status_code == 422       # a reason long enough without the override is too short with it
        assert c.post(url, json={**far, "override_band": True, "reason": "x" * 29}).status_code == 422
        assert c.post(url, json={**far, "override_band": True, "reason": long_reason, "value": 2e8}).status_code == 422                  # the bounds still apply
        assert c.post(url, json={**far, "override_band": True, "reason": long_reason, "source": BRR}).status_code == 422                 # and the source
        assert c.post(url, json={**far, "override_band": True, "reason": long_reason, "fixing_date": (published + timedelta(days=1)).isoformat()}).status_code == 422
        db.reset_mock()
        _limits._buckets.clear()
        assert c.post(url, json={**far, "override_band": True, "reason": long_reason}).status_code == 200
        ins = [p for q, p in _sql(db) if q.startswith("INSERT")][-1]
        assert ins["n"] == "[band overridden] " + long_reason and ins["v"] == 70_000.0 * 1.30
        spot["v"] = None                                                         # no stored spot at all: the same
        assert c.post(url, json=good).status_code == 422
        db.reset_mock()
        assert c.post(url, json={**good, "override_band": True, "reason": long_reason}).status_code == 200
        assert [p["n"] for q, p in _sql(db) if q.startswith("INSERT")] == ["[band overridden] " + long_reason]
        spot["v"] = 70_000.0
        # until the sign-up role migration is applied the admin role is not a safe gate for rows every account settles on: corrections are off
        db.reset_mock()
        for state in (False, None, RuntimeError("catalogue unreachable")):
            _limits._buckets.clear()
            gate["v"] = state
            off = c.post(url, json=good)
            assert off.status_code == 409 and off.json()["detail"] == "corrections are off until the sign-up role migration is applied", state
        assert not any(q.startswith(("INSERT", "UPDATE")) for q, _ in _sql(db))
        gate["v"] = True
        _limits._buckets.clear()
        codes = [c.post(url, json=good).status_code for _ in range(10)]
        assert codes[0] == 200 and codes[-1] == 429                              # six a minute


def test_the_fixings_route_serves_stored_spots_until_the_table_exists(desk):
    c, db, user, _ = desk
    spot = lambda d, v: SimpleNamespace(valuation_date=d, quotes=[{"tenor": "SPOT", "rate": v, "enabled": True}], source="IMPORT")
    db.execute.return_value.all.return_value = [spot(date(2026, 11, 7), 69_000.0), spot(date(2026, 11, 8), 70_000.0),
                                                SimpleNamespace(valuation_date=date(2026, 11, 9), quotes=[], source="IMPORT")]
    r = c.get("/api/currency/fixings/btcusd?days=7")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["pair"] == "BTCUSD" and b["stored"] is False and [x["source"] for x in b["sources"]] == [BRR]            # the venue's source is offered where it is delivered
    assert b["fixings"] == [{"date": d, "source": "stored spot (no fixing stored)", "time": None, "value": v, "origin": "SPOT", "own": False, "disputed": False}
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
    assert b["stored"] is True and b["fixings"] == [{"date": "2026-11-09", "source": DELIVERY, "time": "08:00 UTC", "value": 70_300.0, "origin": "FEED", "own": False, "disputed": False}]
    q, qp = _sql(db)[-1]
    assert qp["u"] == user["sub"] and qp["d"] == date.today() - timedelta(days=366) and "ORDER BY fixing_date" in q
    with patch.object(S, "feed_delivering", return_value=True):
        assert [x["source"] for x in c.get("/api/currency/fixings/BTCUSD").json()["sources"]] == [BRR, DELIVERY]
    db.execute.return_value.all.return_value = [SimpleNamespace(fixing_date=date(2026, 11, 9), fixing_time="08:00 UTC", source=DELIVERY, value=70_300.0, origin="FEED", user_id=None, disputed_at="2026-11-10")]
    assert c.get("/api/currency/fixings/BTCUSD").json()["fixings"][0]["disputed"] is True                     # the venue has since read the date differently
    paths = [p for p in __import__("main").app.openapi()["paths"] if "fixings" in p]
    assert len(paths) == 4 and not any("price" in p for p in paths)                                 # a browser journey waits on /api/currency/.*price


# ── the rule ───────────────────────────────────────────────────────────────────

def _forward(side="BUY", source=BRR, fixing=FIX_DAY, settle=FIX_DAY + timedelta(days=3), **terms):
    t = {"digital_asset": "BTC", "notional_amount": "10", "direction": side, "forward_price": "100000", "price_currency": "USD",
         "valuation_date": fixing.isoformat(), "valuation_time": "16:00 London", "settlement_date": settle.isoformat(), "settlement_currency": "USD",
         "settlement_price_source": source, **terms}
    return SimpleNamespace(id=uuid4(), trade_ref="TRD-CRF", instrument_type="CRYPTO_FORWARD", status="LIVE", notional=10, notional_ccy="BTC",
                           discount_curve_id="USD_SOFR", forecast_curve_id=None, terms=t, maturity_date=settle, trade_date=date(2026, 11, 2), user_id="u")


def _option(side="BUY", **terms):
    """A call on 10 BTC struck at 100,000, expiring FIX_DAY and paid the day after."""
    return _option_trade(side, **{"strike_price": "100000", **terms})


class _Fixings:
    """A stand-in for the store: rows by (pair, date, source), own rows by user; records what was asked."""
    def __init__(self, shared=None, own=None): self.shared, self.own, self.asked = shared or {}, own or {}, []
    def get(self, db, pair, fixing_date, source, user_id):
        self.asked.append((pair, fixing_date, source, user_id))
        v = self.own.get((user_id, pair, fixing_date, source))
        origin, mine = ("MANUAL", True) if v is not None else ("FEED", False)
        v = v if v is not None else self.shared.get((pair, fixing_date, source))
        return None if v is None else {"date": fixing_date.isoformat(), "source": source, "time": "16:00 London", "value": v, "origin": origin, "own": mine}


STORED = {("BTCUSD", FIX_DAY, BRR): FIXING, ("BTCUSD", FIX_DAY, DELIVERY): 99_999.0}


def test_the_rule_reads_the_named_source_only_own_before_shared_and_is_silent_before_the_fixing_date():
    f = _Fixings(shared=dict(STORED))
    with patch.object(R.store, "get", side_effect=f.get):
        assert R.settlement(None, "u", _forward(), FIX_DAY - timedelta(days=1)) is None and f.asked == []      # before the fixing date: not even a read
        buy, sell = R.settlement(None, "u", _forward(), FIX_DAY), R.settlement(None, "u", _forward("SELL"), FIX_DAY + timedelta(days=40))
        assert buy["fixing"] == {"source": BRR, "date": FIX_DAY.isoformat(), "time": "16:00 London", "value": FIXING, "origin": "FEED", "disputed": False}
        assert buy["provisional"] is False and buy["provisional_reason"] is None and buy["provisional_basis"] is None and buy["price"] == FIXING
        assert buy["settlement_amount"] == AMOUNT and sell["settlement_amount"] == -AMOUNT
        assert all(a == ("BTCUSD", FIX_DAY, BRR, "u") for a in f.asked)
        # a trade that names another source settles on that source's row, never on this one's
        other = R.settlement(None, "u", _forward(source=DELIVERY), FIX_DAY)
        assert other["fixing"]["value"] == 99_999.0 and other["settlement_amount"] == pytest.approx(10 * (99_999.0 - K))
        for unnamed in ("Some Other Index", "", None, "cme cf brr"):
            miss = R.settlement(None, "u", _forward(source=unnamed), FIX_DAY, spot=101_000.0)
            assert miss["fixing"] is None and miss["provisional"] is True and miss["provisional_reason"] == "no fixing stored" and miss["price"] == 101_000.0
            assert miss["settlement_amount"] == pytest.approx(10_000.0) and miss["provisional_basis"] == f"stored spot of {FIX_DAY.isoformat()}"
        # an account's own entry stands over the shared row, for that account only
        f.own[("u", "BTCUSD", FIX_DAY, BRR)] = 104_500.0
        mine, theirs = R.settlement(None, "u", _forward(), FIX_DAY), R.settlement(None, "v", _forward(), FIX_DAY)
        assert mine["fixing"]["value"] == 104_500.0 and mine["fixing"]["origin"] == "MANUAL" and theirs["fixing"]["value"] == FIXING
        # one read per key in a run that hands over its memo
        memo: dict = {}
        n = len(f.asked)
        assert [R.settlement(None, "u", _forward(), FIX_DAY, cache=memo)["fixing"]["value"] for _ in range(3)] == [104_500.0] * 3 and len(f.asked) == n + 1
        # an option: the fixing of its expiry date; its amount is added with the knock state (with_option_amount); other products: not this rule's
        opt = R.settlement(None, "u", _option(), FIX_DAY)
        assert opt["shape"] == "OPTION" and opt["fixing"]["value"] == 104_500.0 and opt["settlement_amount"] is None and opt["price"] == 104_500.0
        assert R.settlement(None, "u", SimpleNamespace(instrument_type="NDF", terms={"fixing_date": "2020-01-01"}), FIX_DAY) is None
        assert R.settlement(None, "u", SimpleNamespace(instrument_type="CRYPTO_FORWARD", terms={"digital_asset": "BTC"}, maturity_date=None, notional=None), FIX_DAY) is None
    # a disputed shared row (the venue has since read the date differently, nobody has ruled): its stored value is still the fixing, and the answer says so
    row = {"date": FIX_DAY.isoformat(), "source": BRR, "time": "16:00 London", "value": FIXING, "origin": "FEED", "own": False, "disputed": True}
    with patch.object(R.store, "get", return_value=row):
        d = R.settlement(None, "u", _forward(), FIX_DAY)
    assert d["fixing"] == {"source": BRR, "date": FIX_DAY.isoformat(), "time": "16:00 London", "value": FIXING, "origin": "FEED", "disputed": True}
    assert d["settlement_amount"] == AMOUNT and d["provisional"] is False and R.report(d)["fixing"]["disputed"] is True
    assert S._row(SimpleNamespace(fixing_date=FIX_DAY, source=BRR, fixing_time=None, value=1.0, origin="FEED", user_id=None, disputed_at=NOW))["disputed"] is True
    assert S._row(SimpleNamespace(fixing_date=FIX_DAY, source=BRR, fixing_time=None, value=1.0, origin="FEED", user_id=None, disputed_at=None))["disputed"] is False
    # the stored spot of the fixing date is what a provisional amount rests on, and the answer names the snapshot's own date
    with patch.object(R.store, "get", return_value=None), patch.object(R, "_stored_spot", return_value=(102_000.0, FIX_DAY - timedelta(days=2))):
        est = R.settlement(MagicMock(), "u", _forward(), FIX_DAY, spot=1.0)
    assert est["price"] == 102_000.0 and est["settlement_amount"] == pytest.approx(20_000.0) and est["provisional_basis"] == f"stored spot of {(FIX_DAY - timedelta(days=2)).isoformat()}"
    # a store that cannot be read is no fixing, never a failed valuation
    with patch.object(R.store, "get", side_effect=RuntimeError("connection lost")), patch.object(R, "_stored_spot", return_value=(None, None)):
        down = R.settlement(MagicMock(), "u", _forward(), FIX_DAY, spot=64_000.0)
    assert down["fixing"] is None and down["provisional"] is True and down["price"] == 64_000.0
    assert R.terms_of(_forward(valuation_date=None))["fixing_date"] == FIX_DAY + timedelta(days=3)       # an older record without the date: the settlement date
    assert R.INSTRUMENTS == SRC.INSTRUMENTS == ("CRYPTO_FORWARD", "CRYPTO_OPTION")
    # one reading of the terms: the valuation's is the rule's
    from pnl.valuation import _currency_terms
    pair, t = _currency_terms(_option("SELL"))
    k = R.parse(_option("SELL"))
    assert (pair, t["notional"], t["K"], t["expiry"], t["settle"], t["option_type"], t["direction"]) == (k["pair"], k["notional"], k["strike"], k["expiry"], k["settle"], k["option_type"], "SELL")
    for broken in ({"digital_asset": "BTC", "notional_amount": "ten"}, {"notional_amount": "10"}, {"digital_asset": "BTC", "notional_amount": "10", "settlement_date": "soon"}):
        with pytest.raises((KeyError, ValueError, TypeError)):
            _currency_terms(SimpleNamespace(instrument_type="CRYPTO_FORWARD", terms=broken, notional=10, maturity_date=None))


def test_amounts_and_a_fixed_cash_flow_by_hand():
    assert R.forward_amount("BUY", 10, K, FIXING) == AMOUNT and R.forward_amount("sell", 10, K, FIXING) == -AMOUNT
    assert R.settlement_amount("FORWARD", "BUY", 10, K, 95_000.0) == -50_000.0
    assert R.settlement_amount("CALL", "BUY", 10, K, FIXING) == AMOUNT and R.settlement_amount("CALL", "SELL", 10, K, FIXING) == -AMOUNT
    assert R.settlement_amount("CALL", "BUY", 10, K, 95_000.0) == 0.0 and R.settlement_amount("PUT", "BUY", 10, K, 95_000.0) == 50_000.0
    assert R.settlement_amount("put", "SELL", 10, K, 95_000.0) == -50_000.0 and R.settlement_amount("PUT", "BUY", 10, K, K) == 0.0
    # 10 BTC, K 100,000, fixing 104,250, flat 4 % continuous, ACT/365: three days before settlement, and on its eve
    df = lambda on: (lambda d: math.exp(-0.04 * (d - on).days / 365.0))
    three = R.fixed_cash(AMOUNT, FIX_DAY, FIX_DAY + timedelta(days=3), df(FIX_DAY))
    assert three["npv"] == pytest.approx(42_486.03, abs=0.005) and three["npv"] == pytest.approx(AMOUNT * math.exp(-0.04 * 3 / 365), rel=1e-14)
    assert three["ir01"] == three["ir01_disc"] == pytest.approx(-0.034920, abs=5e-7) and three["ir01_base"] == 0.0 and three["spot01"] == 0.0
    assert three["theta"] == pytest.approx(AMOUNT * math.exp(-0.04 * 2 / 365) - AMOUNT * math.exp(-0.04 * 3 / 365), rel=1e-9) and three["theta"] == pytest.approx(4.6564, abs=5e-4)
    eve = R.fixed_cash(-AMOUNT, EVE, EVE + timedelta(days=1), df(EVE))
    assert eve["npv"] == pytest.approx(-42_495.34, abs=0.005) and eve["theta"] == pytest.approx(42_495.34, abs=0.005) and eve["ir01"] == pytest.approx(0.011643, abs=5e-7)


def _market(as_of, spot=104_000.0):
    return FakeMarket(as_of, {"USD_SOFR": USD, "BTCUSD_SPOT": [{"tenor": "SPOT", "rate": spot}], "BTC_FUNDING": [{"tenor": "FLAT", "rate": 3.0}], "BTCUSD_VOL": BTC_VOL})


def _value(trade, on, spot=104_000.0, fixings=None):
    from pnl.valuation import value
    f = fixings or _Fixings()
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(vd, flat_rate=0.04)), patch.object(R.store, "get", side_effect=f.get):
        return value(None, {"sub": "u"}, trade, on, _market(on, spot))


# What pnl/valuation.py returned for these trades before the fixings store and the rule existed (commit 4eac0fa, run on
# the same market: BTC spot 104,000, funding 3 %, discounting flat 4 %, the vol surface of tests/test_crypto_option.py).
# crybasis01 = −fund01 everywhere (0.16.0).
# 0.16.0: a digital asset's spot date is T+0 (one convention across the API); the option's forward carries one more day, which moves ir01, fund01 and theta by a day's carry and leaves npv unchanged (was 11.9406 / −15.2723 / −643.030; on 28 Jan 0.2318 / −0.2547 / theta unchanged). The barrier (ko) rows use the exotic pricer, which carries from the valuation date already: unchanged.
BEFORE_THE_RULE = {
    ("fwd", "BUY", date(2026, 11, 2)): dict(npv=42173.42864466559, ir01=24.683802775594813, fund01=-25.73523679364007, crybasis01=25.73523679364007, spot01=10322.50387418387, theta=-23.6615456630243),
    ("fwd", "BUY", date(2027, 1, 28)): dict(npv=40096.398491646345, ir01=1.0954095256820437, fund01=-1.1393507602406316, crybasis01=1.1393507602406316, spot01=10396.58138391289, theta=-24.0921494222639),
    ("opt", "BUY", date(2026, 11, 2)): dict(npv=136671.42092108683, ir01=12.114207700826228, fund01=-15.445877403952181, crybasis01=15.445877403952181, spot01=6403.759579531441, theta=-642.8323876024806, vega=1939.849432718387),
    ("opt", "BUY", date(2027, 1, 28)): dict(npv=41752.38171746718, ir01=0.48653927875420777, fund01=-0.5094154971156968, crybasis01=0.5094154971156968, spot01=9557.325579448378, theta=-1704.1725064992643, vega=100.83026597686694),
    ("ko", "SELL", date(2026, 11, 2)): dict(npv=-15579.620873842141, ir01=-0.2481630272250186, fund01=0.6238784300257976, crybasis01=-0.6238784300257976, spot01=250.8999137690098, theta=-203.8800250762597, vega=595.9248887312278),
    ("ko", "SELL", date(2027, 1, 28)): dict(npv=-41752.383588404446, ir01=-0.24329907199717127, fund01=0.2547377366645378, crybasis01=-0.2547377366645378, spot01=-9557.327183782872, theta=1752.3835884044456, vega=-100.82089922705927),
}


def test_before_the_fixing_date_a_valuation_is_what_it_was_before_the_rule_existed():
    stored = _Fixings(shared=dict(STORED))
    make = {"fwd": lambda side: _forward(side), "opt": lambda side: _option(side), "ko": lambda side: _option(side, style="BARRIER", barrier_type="UP_OUT", barrier="130000")}
    for (kind, side, on), was in BEFORE_THE_RULE.items():
        now = _value(make[kind](side), on, fixings=stored)
        assert {k: now[k] for k in was} == pytest.approx(was, rel=1e-12, abs=1e-9), (kind, on)
        assert not {"fixing", "provisional", "settled", "settlement_amount", "provisional_reason"} & set(now), (kind, on)
    sell = _value(_forward("SELL"), date(2026, 11, 2), fixings=stored)
    assert sell["npv"] == pytest.approx(-42173.42864466559, rel=1e-12) and sell["spot01"] == pytest.approx(-10322.50387418387, rel=1e-12)
    # and by hand, the forward: F = S·e^(−0.03 t)/e^(−0.04 t), NPV = 10 × (F − K) × e^(−0.04 t), t = 91/365 from 2 November to 1 February
    t = (FIX_DAY + timedelta(days=3) - date(2026, 11, 2)).days / 365.0
    assert BEFORE_THE_RULE[("fwd", "BUY", date(2026, 11, 2))]["npv"] == pytest.approx(10 * (104_000.0 * math.exp(0.01 * t) - K) * math.exp(-0.04 * t), rel=1e-12)
    assert stored.asked == []                                                                        # the store is not read before the fixing date


def test_a_forward_from_its_fixing_date_is_the_settlement_amount_discounted_then_reported():
    settle = FIX_DAY + timedelta(days=3)
    stored = _Fixings(shared=dict(STORED))
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        v = _value(_forward(side), FIX_DAY, spot=10_000.0, fixings=stored)                           # the stored spot no longer matters
        assert v["npv"] == pytest.approx(sign * 42_486.03, abs=0.005) and v["settlement_amount"] == sign * AMOUNT and v["settled"] is False
        assert v["fixing"] == {"source": BRR, "date": FIX_DAY.isoformat(), "time": "16:00 London", "value": FIXING, "origin": "FEED", "disputed": False}
        assert v["provisional"] is False and v["provisional_reason"] is None and v["provisional_basis"] is None and v["settlement_price"] == FIXING
        assert v["spot01"] == 0.0 and v["fund01"] == 0.0 and v["ir01"] == v["ir01_disc"] == pytest.approx(sign * -0.034920, abs=5e-7)
        assert v["theta"] == pytest.approx(sign * 4.6564, abs=5e-4) and "fixed" in v["model"] and BRR in v["model"]
        eve = _value(_forward(side), EVE, fixings=stored)
        assert eve["npv"] == pytest.approx(sign * 42_495.34, abs=0.005) and eve["theta"] == pytest.approx(sign * -42_495.34, abs=0.005) and eve["ir01"] == pytest.approx(sign * -0.011643, abs=5e-7)
        for on in (settle, settle + timedelta(days=30)):                                             # the settlement date is reached: the mark is zero, the amount reported
            v = _value(_forward(side), on, fixings=stored)
            assert v["npv"] == 0.0 and v["settled"] is True and v["settlement_amount"] == sign * AMOUNT and v["fixing"]["value"] == FIXING and v["provisional"] is False
    # the ticket's usual forward: fixing date and settlement date the same day
    same = _value(_forward(settle=FIX_DAY), FIX_DAY + timedelta(days=1), fixings=stored)
    assert same["npv"] == 0.0 and same["settled"] is True and same["settlement_amount"] == AMOUNT


def test_without_a_stored_fixing_the_value_is_the_provisional_amount_discounted_never_a_forward_on_another_spot():
    """Emmy, 2026-11-10. Fixing 29 January, settlement 1 February, valued 30 January with no fixing stored; the stored
    spot of the fixing day 104,250, today's spot 110,000. The amount reported is 10 × (104,250 − 100,000) = 42,500,
    and the value is that amount discounted two days at 4 %: 42,490.69. Until this fix the value was the live forward
    on today's spot (about 100,000, with a spot sensitivity of about 11,000) beside an amount of 42,500."""
    only_other = _Fixings(shared={("BTCUSD", FIX_DAY, DELIVERY): 99_999.0})                           # another source's price is not this trade's fixing
    on = FIX_DAY + timedelta(days=1)
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        with patch.object(R, "_stored_spot", return_value=(FIXING, FIX_DAY)):
            v = _value(_forward(side), on, spot=110_000.0, fixings=only_other)
        assert v["npv"] == pytest.approx(sign * 42_490.69, abs=0.005) and v["npv"] == pytest.approx(sign * AMOUNT * math.exp(-0.04 * 2 / 365), rel=1e-12)
        assert v["settlement_amount"] == sign * AMOUNT and v["settlement_price"] == FIXING and v["spot01"] == 0.0 and v["fund01"] == 0.0
        assert v["ir01"] == v["ir01_disc"] == pytest.approx(v["npv"] * (math.exp(-1e-4 * 2 / 365) - 1), rel=1e-12) and v["theta"] == pytest.approx(sign * 4.6569, abs=5e-4)
        assert v["provisional"] is True and v["provisional_reason"] == "no fixing stored" and v["provisional_basis"] == f"stored spot of {FIX_DAY.isoformat()}"
        assert v["fixing"] is None and v["settled"] is False and v["fixing_source"] == BRR and "provisional on the stored spot of" in v["model"] and "fixed" not in v["model"]
        # the eve of settlement: theta is the whole value, as for a fixed amount
        with patch.object(R, "_stored_spot", return_value=(FIXING, FIX_DAY)):
            eve = _value(_forward(side), EVE, spot=110_000.0, fixings=only_other)
        assert eve["npv"] == pytest.approx(sign * 42_495.34, abs=0.005) and eve["theta"] == pytest.approx(-eve["npv"], rel=1e-12) and eve["spot01"] == 0.0
        # an expired option the same: its provisional payoff is one cash flow, valued as a fixed one is
        with patch.object(R, "_stored_spot", return_value=(FIXING, FIX_DAY)):
            o = _value(_option(side), FIX_DAY, spot=110_000.0, fixings=only_other)
        assert o["npv"] == pytest.approx(sign * 42_495.34, abs=0.005) and o["theta"] == pytest.approx(-o["npv"], rel=1e-12) and o["ir01"] == pytest.approx(sign * -0.011643, abs=5e-7)
        assert o["settlement_amount"] == sign * AMOUNT and o["provisional"] is True and o["provisional_reason"] == "no fixing stored" and o["spot01"] == 0.0 and o["vega"] == 0.0
        assert o["provisional_basis"] == f"stored spot of {FIX_DAY.isoformat()}" and "provisional" in o["model"] and "fixing" not in o["model"].replace("no fixing", "")
    # on the fixing date itself the day's stored spot is the estimate (this market has no history: the valuation day's own spot)
    first = _value(_forward(), FIX_DAY, spot=FIXING, fixings=only_other)
    assert first["npv"] == pytest.approx(42_486.03, abs=0.005) and first["spot01"] == 0.0 and first["provisional_basis"] == f"stored spot of {FIX_DAY.isoformat()}"
    # a forward whose record carries no contract price has nothing to fix against: the live value, flagged
    bare = _value(_forward(forward_price=None), FIX_DAY, spot=FIXING, fixings=only_other)
    assert bare["provisional"] is True and bare["settlement_amount"] is None and bare["npv"] == 0.0 and bare["spot01"] > 0
    done = _value(_forward(), FIX_DAY + timedelta(days=9), spot=101_000.0, fixings=only_other)
    assert done["npv"] == 0.0 and done["settled"] is True and done["provisional"] is True and done["fixing"] is None
    assert done["settlement_amount"] == pytest.approx(10_000.0) and done["provisional_basis"].startswith("stored spot of ")       # an estimate, flagged, and it says on what
    # no negative zero in what is reported: a sold forward that fixes at its own price, and a sold call that expires worthless
    flat = _Fixings(shared={("BTCUSD", FIX_DAY, BRR): K})
    for v in (_value(_forward("SELL"), FIX_DAY, fixings=flat), _value(_forward("SELL"), FIX_DAY + timedelta(days=5), fixings=flat), _value(_option("SELL"), FIX_DAY, fixings=flat),
              _value(_option("SELL"), FIX_DAY + timedelta(days=1), fixings=flat)):
        for k in ("npv", "settlement_amount", "ir01", "theta"):
            assert v[k] == 0.0 and math.copysign(1.0, v[k]) == 1.0, (k, v[k])
    assert math.copysign(1.0, R.report({**R.settlement(None, "u", _forward("SELL"), FIX_DAY, spot=K), "settlement_amount": -0.0})["settlement_amount"]) == 1.0


def test_an_expired_option_pays_on_the_fixing_and_is_the_same_cash_flow_as_a_fixed_forward():
    stored = _Fixings(shared=dict(STORED))
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        v = _value(_option(side), FIX_DAY, spot=60_000.0, fixings=stored)                            # the stored spot is out of the money; the fixing is not
        assert v["npv"] == pytest.approx(sign * 42_495.34, abs=0.005) and v["settlement_amount"] == sign * AMOUNT and v["settlement_price"] == FIXING
        assert v["fixing"]["value"] == FIXING and v["provisional"] is False and v["settled"] is False and "on the CME CF BRR fixing" in v["model"]
        # call payoff 42,500 fixed, settlement in one day: the forward with the same amount, the same figures (Emmy, 2026-11-10)
        fwd = _value(_forward(side, fixing=FIX_DAY, settle=FIX_DAY + timedelta(days=1)), FIX_DAY, fixings=stored)
        assert {k: v[k] for k in ("npv", "ir01", "ir01_disc", "theta", "spot01", "fund01")} == {k: fwd[k] for k in ("npv", "ir01", "ir01_disc", "theta", "spot01", "fund01")}
        assert v["ir01"] == pytest.approx(sign * -0.011643, abs=5e-7) and v["theta"] == pytest.approx(sign * -42_495.34, abs=0.005) and v["vega"] == 0.0
        paid = _value(_option(side), FIX_DAY + timedelta(days=1), spot=60_000.0, fixings=stored)
        assert paid["npv"] == 0.0 and paid["settled"] is True and paid["settlement_amount"] == sign * AMOUNT and paid["fixing"]["value"] == FIXING
    put = _value(_option(option_type="PUT"), FIX_DAY, fixings=stored)
    assert put["npv"] == 0.0 and put["settlement_amount"] == 0.0 and put["provisional"] is False
    digital = _value(_option(style="DIGITAL", payout="25000", payout_currency="QUOTE"), FIX_DAY, fixings=stored)
    assert digital["settlement_amount"] == 25_000.0 and digital["provisional"] is False                # a digital needs no knock state
    # an FX option is not this rule's: its expired payoff is the spot of the expiry date, with no new fields and the figures it had
    from tests.test_fx_option_styles import EXP as FX_EXP, SET as FX_SET, _market as fx_market, _trade as fx_trade
    from pnl.valuation import value
    with patch.object(R.store, "get", side_effect=AssertionError("the store is not read for an FX trade")), \
         patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(vd, flat_rate=0.04)):
        fx = value(None, {"sub": "u"}, fx_trade("BUY", strike="1.17", expiry_date=FX_EXP.isoformat(), settlement_date=FX_SET.isoformat()), FX_EXP + timedelta(days=1),
                   fx_market(FX_EXP + timedelta(days=1), spot=1.20))
    days = (FX_SET - FX_EXP).days - 1
    assert fx["npv"] == pytest.approx(1e7 * 0.03 * math.exp(-0.04 * days / 365), rel=1e-9) and fx["ir01"] == 0.0 and fx["theta"] == 0.0
    assert not {"fixing", "provisional", "settled", "settlement_amount"} & set(fx)


KNOCK_CASES = [
    # style fields, option type, fixing → amount (never touched), final?, how the knock state is known, the amount if it was touched (when not final)
    (dict(style="BARRIER", barrier_type="UP_OUT", barrier="104000"), "CALL", 104_250.0, 0.0, True, "price", None),                      # at or beyond an out barrier: knocked out
    (dict(style="BARRIER", barrier_type="UP_OUT", barrier="104250", rebate="50"), "CALL", 104_250.0, 500.0, True, "price", None),      # exactly on it, and the rebate is paid
    (dict(style="BARRIER", barrier_type="UP_OUT", barrier="110000"), "CALL", 104_250.0, AMOUNT, False, "unknown", 0.0),               # short of it: the path is unknown
    (dict(style="BARRIER", barrier_type="DOWN_OUT", barrier="95000"), "PUT", 94_000.0, 0.0, True, "price", None),
    (dict(style="BARRIER", barrier_type="DOWN_OUT", barrier="90000"), "PUT", 94_000.0, 60_000.0, False, "unknown", 0.0),
    (dict(style="BARRIER", barrier_type="UP_IN", barrier="104000"), "CALL", 104_250.0, AMOUNT, True, "price", None),                   # at or beyond an in barrier: knocked in
    (dict(style="BARRIER", barrier_type="UP_IN", barrier="110000", rebate="50"), "CALL", 104_250.0, 500.0, False, "unknown", AMOUNT),    # never touched: never knocked in
    (dict(style="BARRIER", barrier_type="DOWN_IN", barrier="95000"), "PUT", 94_000.0, 60_000.0, True, "price", None),
    (dict(style="BARRIER", barrier_type="DOWN_IN", barrier="90000"), "PUT", 94_000.0, 0.0, False, "unknown", 60_000.0),
    (dict(style="DOUBLE_BARRIER", barrier_type="KNOCK_OUT", lower="90000", upper="104000"), "CALL", 104_250.0, 0.0, True, "price", None),      # outside the corridor, above
    (dict(style="DOUBLE_BARRIER", barrier_type="KNOCK_OUT", lower="95000", upper="120000"), "PUT", 94_000.0, 0.0, True, "price", None),        # and below
    (dict(style="DOUBLE_BARRIER", barrier_type="KNOCK_OUT", lower="90000", upper="110000"), "CALL", 104_250.0, AMOUNT, False, "unknown", 0.0),
    (dict(style="DOUBLE_BARRIER", barrier_type="KNOCK_IN", lower="90000", upper="104250"), "CALL", 104_250.0, AMOUNT, True, "price", None),
    (dict(style="DOUBLE_BARRIER", barrier_type="KNOCK_IN", lower="90000", upper="110000"), "CALL", 104_250.0, 0.0, False, "unknown", AMOUNT),
    (dict(style="TOUCH", touch_type="ONE_TOUCH", barrier="104000", payout="25000"), "CALL", 104_250.0, 25_000.0, True, "price", None),         # an up level (the trade date's spot was 100,000)
    (dict(style="TOUCH", touch_type="ONE_TOUCH", barrier="104000", payout="25000"), "CALL", 103_000.0, 0.0, False, "unknown", 25_000.0),
    (dict(style="TOUCH", touch_type="NO_TOUCH", barrier="104000", payout="25000"), "CALL", 104_250.0, 0.0, True, "price", None),
    (dict(style="TOUCH", touch_type="NO_TOUCH", barrier="104000", payout="25000"), "CALL", 103_000.0, 25_000.0, False, "unknown", 0.0),
    (dict(style="TOUCH", touch_type="ONE_TOUCH", barrier="95000", payout="25000"), "CALL", 94_000.0, 25_000.0, True, "price", None),           # a down level
    (dict(style="TOUCH", touch_type="ONE_TOUCH", barrier="95000", payout="25000"), "CALL", 104_250.0, 0.0, False, "unknown", 25_000.0),            # above a down level is not beyond it
    (dict(style="TOUCH", touch_type="NO_TOUCH", barrier="95000", payout="25000"), "CALL", 95_000.0, 0.0, True, "price", None),
    (dict(style="TOUCH", touch_type="DOUBLE_ONE_TOUCH", lower="95000", upper="104000", payout="25000"), "CALL", 104_250.0, 25_000.0, True, "price", None),
    (dict(style="TOUCH", touch_type="DOUBLE_ONE_TOUCH", lower="95000", upper="110000", payout="25000"), "CALL", 104_250.0, 0.0, False, "unknown", 25_000.0),
    (dict(style="TOUCH", touch_type="DOUBLE_NO_TOUCH", lower="95000", upper="110000", payout="25000"), "CALL", 94_000.0, 0.0, True, "price", None),
    (dict(style="TOUCH", touch_type="DOUBLE_NO_TOUCH", lower="95000", upper="110000", payout="25000"), "CALL", 104_250.0, 25_000.0, False, "unknown", 0.0),
]


def test_a_barrier_or_touch_amount_is_final_only_when_its_knock_state_is_known():
    trade_day_spot = (100_000.0, date(2026, 10, 31))
    for fields, opt_type, fixing, amount, final, _how, if_touched in KNOCK_CASES:
        stored = _Fixings(shared={("BTCUSD", FIX_DAY, BRR): fixing})
        for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
            with patch.object(R, "_stored_spot", return_value=trade_day_spot):
                v = _value(_option(side, option_type=opt_type, **fields), FIX_DAY, fixings=stored)
                paid = _value(_option(side, option_type=opt_type, **fields), FIX_DAY + timedelta(days=1), fixings=stored)
            case = (fields, fixing, side)
            assert v["settlement_amount"] == sign * amount and paid["settlement_amount"] == sign * amount, case
            assert v["npv"] == pytest.approx(sign * amount * math.exp(-0.04 / 365), rel=1e-12, abs=1e-12) and paid["npv"] == 0.0 and paid["settled"] is True, case
            assert v["fixing"]["value"] == fixing and v["provisional"] is (not final) and paid["provisional"] is (not final), case
            if final:
                assert v["provisional_reason"] is None and v["provisional_basis"] is None and "at or beyond the barrier" in v["model"], case
                assert "settlement_amount_if_touched" not in v and "settlement_amount_if_touched" not in paid, case
            else:
                assert v["provisional_reason"] == paid["provisional_reason"] == "knock state not recorded" and v["provisional_basis"] == "the barrier taken as never touched", case
                assert "if the barrier was never touched" in v["model"], case
                # both outcomes are reported: the amount if it never was touched (the value rests on it) and the amount if it was
                assert v["settlement_amount_if_touched"] == paid["settlement_amount_if_touched"] == sign * if_touched, case
                assert math.copysign(1.0, v["settlement_amount_if_touched"]) == 1.0 or if_touched != 0, case
            assert "read from the fixing" not in v["model"] and "expiry spot" not in v["model"], case
            # the desk's record settles it either way, whatever the fixing says
            for knocked in (True, False):
                rec = _value(_option(side, option_type=opt_type, knocked=knocked, **fields), FIX_DAY, fixings=stored)
                assert rec["provisional"] is False and rec["provisional_reason"] is None and "knock" not in rec["model"] and "barrier" not in rec["model"], case
    # the record, by style. What was paid when the barrier was touched is not outstanding at expiry: a knock-out's rebate, and a one-touch that pays at the hit
    stored = _Fixings(shared=dict(STORED))
    out = dict(style="BARRIER", barrier_type="UP_OUT", barrier="110000", rebate="50")
    gone = _value(_option(knocked=True, **out), FIX_DAY, fixings=stored)
    assert gone["settlement_amount"] == 0.0 and gone["npv"] == 0.0 and gone["provisional"] is False and "paid at the hit: nothing is outstanding at expiry" in gone["model"]
    assert "paid at the hit" in _value(_option(knocked=True, **out), FIX_DAY + timedelta(days=1), fixings=stored)["model"]
    assert _value(_option(knocked=False, **out), FIX_DAY, fixings=stored)["settlement_amount"] == AMOUNT
    dko = dict(style="DOUBLE_BARRIER", barrier_type="KNOCK_OUT", lower="90000", upper="110000", rebate="50")
    assert _value(_option(knocked=True, **dko), FIX_DAY, fixings=stored)["settlement_amount"] == 0.0
    kin = dict(style="BARRIER", barrier_type="UP_IN", barrier="110000", rebate="50")                          # knocked in: the option is alive and pays at expiry
    alive = _value(_option(knocked=True, **kin), FIX_DAY, fixings=stored)
    assert alive["settlement_amount"] == AMOUNT and "paid at the hit" not in alive["model"]
    touch = dict(style="TOUCH", touch_type="ONE_TOUCH", barrier="110000", payout="25000")
    at_expiry = _value(_option(knocked=True, **touch), FIX_DAY, fixings=stored)                               # paid at expiry: outstanding until then
    assert at_expiry["settlement_amount"] == 25_000.0 and "paid at the hit" not in at_expiry["model"]
    at_hit = _value(_option(knocked=True, pay_at_hit=True, **touch), FIX_DAY, fixings=stored)
    assert at_hit["settlement_amount"] == 0.0 and at_hit["npv"] == 0.0 and "paid at the hit" in at_hit["model"]
    assert _value(_option(knocked=False, pay_at_hit=True, **touch), FIX_DAY, fixings=stored)["settlement_amount"] == 0.0
    no_touch = dict(style="TOUCH", touch_type="NO_TOUCH", barrier="110000", payout="25000", pay_at_hit=True)
    assert _value(_option(knocked=False, **no_touch), FIX_DAY, fixings=stored)["settlement_amount"] == 25_000.0            # a no-touch that survived is paid at expiry
    # a knock the fixing itself decides is paid at expiry like any other: the rebate of the out barrier the fixing is beyond is outstanding
    beyond = _value(_option(style="BARRIER", barrier_type="UP_OUT", barrier="104000", rebate="50"), FIX_DAY, fixings=stored)
    assert beyond["settlement_amount"] == 500.0 and "paid at the hit" not in beyond["model"]
    # a single touch level's side is not on the record: without the trade date's spot only a fixing exactly on the level decides
    spec = lambda **kw: SimpleNamespace(style="TOUCH", touch_type="ONE_TOUCH", barrier=104_000.0, lower=None, upper=None, barrier_type=None, **kw)
    assert R.knock_state(spec(), None, 104_250.0) == (None, None) and R.knock_state(spec(), None, 104_000.0) == (True, "price")
    assert R.knock_state(spec(), None, 104_250.0, ref_spot=100_000.0) == (True, "price") and R.knock_state(spec(), None, 104_250.0, ref_spot=110_000.0) == (None, None)
    assert R.knock_state(spec(), False, 999_999.0, ref_spot=100_000.0) == (False, "recorded") and R.knock_state(spec(), None, None) == (None, None)
    # with no fixing stored the reason is that, first: the knock state read from a stored spot is provisional with everything else
    none = _value(_option(style="BARRIER", barrier_type="UP_OUT", barrier="104000"), FIX_DAY, spot=FIXING)
    assert none["provisional"] is True and none["provisional_reason"] == "no fixing stored" and none["settlement_amount"] == 0.0 and none["provisional_basis"].startswith("stored spot of ")
    short = _value(_option(style="BARRIER", barrier_type="UP_OUT", barrier="110000"), FIX_DAY, spot=FIXING)
    assert short["provisional_reason"] == "no fixing stored" and short["settlement_amount"] == AMOUNT and short["provisional_basis"].startswith("stored spot of ")


# ── the ticket's view of a booked trade ────────────────────────────────────────

STATE_KEYS = {"state", "shape", "pair", "direction", "base_notional", "settlement_date", "fixing_date", "fixing", "settlement_amount", "settlement_price",
              "provisional", "provisional_reason", "provisional_basis", "quote_currency", "npv"}
QUOTE_ONLY = {"forward", "df_quote", "df_base", "t", "t_settle", "t_expiry", "vol_pct", "spot01", "vega"}


def _booked(trade, on, spot=104_000.0, fixings=None):
    from api.routes import currencies as C
    f = fixings or _Fixings()
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(vd, flat_rate=0.04)), patch.object(R.store, "get", side_effect=f.get), \
         patch("pnl.market.Market", side_effect=lambda db, uid, d: _market(d, spot)):
        return C.price_booked(trade, None, {"sub": "u"}, on, states=True)


def test_a_booked_trade_from_its_fixing_date_is_a_view_that_says_its_state_and_never_reads_as_a_quote():
    from api.routes import currencies as C
    assert set(C.QUOTE_ONLY) == QUOTE_ONLY
    stored = _Fixings(shared=dict(STORED))
    settle = FIX_DAY + timedelta(days=3)
    fixed = _booked(_forward("SELL"), FIX_DAY, fixings=stored)
    assert fixed["state"] == "FIXED" and STATE_KEYS | QUOTE_ONLY | {"forward_rate", "trade_id", "instrument_type", "npv_ccy", "valuation_date"} <= set(fixed)
    assert all(fixed[k] is None for k in QUOTE_ONLY) and "strike" not in fixed and fixed["forward_rate"] == K and fixed["shape"] == "NDF"
    assert fixed["npv"] == pytest.approx(-42_486.03, abs=0.005) and fixed["settlement_amount"] == -AMOUNT and fixed["settlement_price"] == FIXING
    assert fixed["fixing"]["value"] == FIXING and fixed["provisional"] is False and fixed["provisional_reason"] is None and fixed["direction"] == "SELL"
    assert (fixed["pair"], fixed["base_notional"], fixed["quote_currency"], fixed["settlement_date"], fixed["fixing_date"]) == ("BTCUSD", 10.0, "USD", settle.isoformat(), FIX_DAY.isoformat())
    assert fixed["quote_notional"] == 1_000_000.0 and fixed["fixing"]["disputed"] is False and "settlement_amount_if_touched" not in fixed
    # ir01 and theta are the valuation's, which are the rule's: one implementation, pinned through both callers
    v = _value(_forward("SELL"), FIX_DAY, fixings=stored)
    assert (fixed["npv"], fixed["ir01"], fixed["ir01_disc"], fixed["theta"]) == (v["npv"], v["ir01"], v["ir01_disc"], v["theta"])
    assert fixed["ir01"] == pytest.approx(0.034920, abs=5e-7) and fixed["theta"] == pytest.approx(-4.6564, abs=5e-4)
    eve = _booked(_forward(), EVE, fixings=stored)
    assert eve["state"] == "FIXED" and eve["ir01"] == pytest.approx(-0.011643, abs=5e-7) and eve["theta"] == pytest.approx(-42_495.34, abs=0.005)
    # provisional: the same keys, the valuation's figures, and what the estimate rests on
    prov = _booked(_forward(), FIX_DAY, spot=FIXING)
    assert prov["state"] == "FIXED" and set(prov) == set(fixed) and all(prov[k] is None for k in QUOTE_ONLY)
    assert prov["npv"] == pytest.approx(42_486.03, abs=0.005) and prov["provisional"] is True and prov["fixing"] is None           # the provisional amount, discounted
    assert prov["provisional_reason"] == "no fixing stored" and prov["provisional_basis"].startswith("stored spot of ") and prov["settlement_amount"] == AMOUNT
    # settled: before the rule this was 422 "settlement_date must be after the valuation date"
    for on in (settle, settle + timedelta(days=400)):
        done = _booked(_forward(), on, fixings=stored)
        assert done["state"] == "SETTLED" and set(done) == set(fixed) and all(done[k] is None for k in QUOTE_ONLY)
        assert done["npv"] == 0.0 and done["settled"] is True and done["settlement_amount"] == AMOUNT and done["ir01"] == 0.0 and done["theta"] == 0.0
    # an option: the strike in place of the contract rate, the same states
    o = _booked(_option(), FIX_DAY, fixings=stored)
    assert o["state"] == "FIXED" and STATE_KEYS | QUOTE_ONLY | {"strike", "option_type", "expiry_date", "style"} <= set(o) and "forward_rate" not in o
    assert o["strike"] == K and o["shape"] == "OPTION" and o["npv"] == pytest.approx(42_495.34, abs=0.005) and all(o[k] is None for k in QUOTE_ONLY)
    assert o["theta"] == pytest.approx(-42_495.34, abs=0.005) and o["ir01"] == pytest.approx(-0.011643, abs=5e-7)
    od = _booked(_option("SELL"), FIX_DAY + timedelta(days=1), fixings=stored)
    assert od["state"] == "SETTLED" and od["settlement_amount"] == -AMOUNT and set(od) == set(o)
    # the term sheet's fields, as a live quote carries them: null where the style has none
    sheet = {"style", "barrier", "lower", "upper", "barrier_type", "touch_type", "payout", "payout_currency", "pay_at_hit", "rebate", "quote_notional"}
    assert sheet <= set(o) and (o["style"], o["barrier"], o["lower"], o["upper"], o["barrier_type"], o["touch_type"], o["payout"], o["pay_at_hit"], o["rebate"]) == ("EUROPEAN", None, None, None, None, None, None, False, 0.0)
    assert o["quote_notional"] == 1_000_000.0 and o["payout_currency"] == "QUOTE"
    ko = _booked(_option(style="BARRIER", barrier_type="UP_OUT", barrier="110000", rebate="50"), FIX_DAY, fixings=stored)
    assert ko["provisional"] is True and ko["provisional_reason"] == "knock state not recorded" and ko["style"] == "BARRIER"
    assert (ko["barrier"], ko["barrier_type"], ko["rebate"]) == (110_000.0, "UP_OUT", 50.0) and ko["settlement_amount"] == AMOUNT and ko["settlement_amount_if_touched"] == 500.0
    assert set(ko) == set(o) | {"settlement_amount_if_touched"}
    tch = _booked(_option(style="TOUCH", touch_type="DOUBLE_NO_TOUCH", lower="95000", upper="110000", payout="25000", pay_at_hit=False, strike_price=None), FIX_DAY, fixings=stored)
    assert (tch["touch_type"], tch["lower"], tch["upper"], tch["payout"], tch["strike"], tch["quote_notional"]) == ("DOUBLE_NO_TOUCH", 95_000.0, 110_000.0, 25_000.0, None, None)
    assert tch["settlement_amount"] == 25_000.0 and tch["settlement_amount_if_touched"] == 0.0
    json.dumps([fixed, prov, done, o, od, ko], allow_nan=False)
    # a trade that cannot be read is told so, not valued
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        _booked(SimpleNamespace(id="x", trade_ref="x", instrument_type="CRYPTO_OPTION", terms={"digital_asset": "BTC"}, notional=10, maturity_date=None), FIX_DAY)
    assert e.value.status_code == 422


def test_a_forward_fixed_the_day_before_it_is_paid_is_live_then_fixed_then_settled():
    """The ticket's fixing date (terms.valuation_date) one day before the settlement date."""
    pay = FIX_DAY + timedelta(days=1)
    stored = _Fixings(shared=dict(STORED))
    early, usual = _forward(fixing=FIX_DAY, settle=pay), _forward(fixing=pay, settle=pay)
    # live before the fixing date: priced exactly as the forward that fixes on its settlement date (the pricer carries to the settlement date)
    for on in (date(2026, 11, 2), FIX_DAY - timedelta(days=1)):
        a, b = _value(early, on, fixings=stored), _value(usual, on, fixings=stored)
        assert a == b and a["spot01"] > 0 and "fixing" not in a and "settled" not in a, on
    assert stored.asked == []
    # the fixing date: the amount is known and discounted the one day to its payment
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        fixed = _booked(_forward(side, fixing=FIX_DAY, settle=pay), FIX_DAY, fixings=stored)
        assert fixed["state"] == "FIXED" and fixed["settlement_amount"] == sign * AMOUNT and fixed["provisional"] is False and fixed["fixing"]["value"] == FIXING
        assert fixed["npv"] == pytest.approx(sign * 42_495.34, abs=0.005) and fixed["npv"] == pytest.approx(sign * AMOUNT * math.exp(-0.04 / 365), rel=1e-12)
        assert fixed["theta"] == pytest.approx(-fixed["npv"], rel=1e-12) and fixed["settlement_date"] == pay.isoformat() and fixed["fixing_date"] == FIX_DAY.isoformat()
        # the day after is the settlement date: the mark is zero and the amount is reported
        done = _booked(_forward(side, fixing=FIX_DAY, settle=pay), pay, fixings=stored)
        assert done["state"] == "SETTLED" and done["npv"] == 0.0 and done["settlement_amount"] == sign * AMOUNT and done["fixing"]["value"] == FIXING
    # the usual forward on that same day is still a day from its own fixing: it has not fixed on the earlier date's price
    assert "fixing" not in _value(usual, FIX_DAY, fixings=stored)
    # with no fixing stored on the fixing date: FIXED and provisional, the live value until the fixing arrives
    prov = _booked(early, FIX_DAY, spot=FIXING)
    assert prov["state"] == "FIXED" and prov["provisional"] is True and prov["provisional_reason"] == "no fixing stored" and prov["settlement_amount"] == AMOUNT


def test_without_states_a_booked_trade_is_answered_as_it_was_before_the_rule():
    """Vera, 2026-11-10: the web app before 0.14.0 takes every 200 from POST /price for a live quote. It does not send
    `states`, and is answered exactly as it was: 422 from a forward's settlement date and from an option's expiry."""
    from fastapi import HTTPException
    from api.routes import currencies as C, pricer
    from tests.test_crypto_option import _mock_db
    assert pricer.PriceRequest(trade_id="x", curves=[]).states is False and pricer.PriceRequest(trade_id="x", curves=[], states=True).states is True
    stored = _Fixings(shared=dict(STORED))
    def ask(trade, on, **kw):
        with patch.object(C, "_curve", side_effect=lambda db, uid, cid, vd: Curve(vd, flat_rate=0.04)), patch.object(R.store, "get", side_effect=stored.get):
            return C.price_booked(trade, _mock_db(), {"sub": str(uuid4())}, on, **kw)
    settle = FIX_DAY + timedelta(days=3)
    # live, before the fixing date: the same quote whoever asks, and it says LIVE
    one = _forward()
    live = ask(one, FIX_DAY - timedelta(days=1))
    assert live["state"] == "LIVE" and live["forward"] > 0 and live["df_quote"] < 1 and ask(one, FIX_DAY - timedelta(days=1), states=True) == live
    assert ask(_option(), FIX_DAY - timedelta(days=1))["state"] == "LIVE"
    # between fixing and settlement the old answer was the live quote: still, and with no state for a new reader to trust
    between = ask(one, FIX_DAY + timedelta(days=1))
    assert "state" not in between and "fixing" not in between and between["forward"] > 0 and between["npv"] != 0 and set(between) == set(live) - {"state"}
    # from the settlement date, and an option from its expiry: the 422s they always were, with their messages
    for trade, on, why in ((_forward(), settle, "settlement_date must be after the valuation date"), (_forward(), settle + timedelta(days=30), "settlement_date must be after the valuation date"),
                           (_forward(settle=FIX_DAY), FIX_DAY, "settlement_date must be after the valuation date"), (_option(), FIX_DAY, "expiry_date must be after the valuation date"),
                           (_option(), FIX_DAY + timedelta(days=5), "expiry_date must be after the valuation date")):
        for kw in ({}, {"states": False}):
            with pytest.raises(HTTPException) as e:
                ask(trade, on, **kw)
            assert e.value.status_code == 422 and e.value.detail == why
    assert stored.asked == []                                                    # and the fixings store is not read for it
    # an FX trade has no states at all
    assert "states" in C.price_booked.__code__.co_varnames


def test_a_forward_that_names_no_fixing_date_fixes_on_its_settlement_date_and_obeys_the_same_rule():
    """The confirmation pass, 9 November 2026: the date rule ran only when valuation_date was present, so a forward
    without one, settling on or before its trade date, was accepted and fixed on a price already published."""
    from settlement.sources import check_booked
    base = {"digital_asset": "BTC", "settlement_price_source": "CME CF BRR", "valuation_time": "16:00 London"}
    check_booked("CRYPTO_FORWARD", {**base, "settlement_date": "2026-12-09"}, trade_date=date(2026, 11, 9))          # as every older record: accepted
    check_booked("CRYPTO_FORWARD", {**base}, trade_date=date(2026, 11, 9), maturity_date=date(2026, 12, 9))
    for settle in ("2026-11-09", "2026-11-08"):
        with pytest.raises(ValueError, match="after the trade date"):
            check_booked("CRYPTO_FORWARD", {**base, "settlement_date": settle}, trade_date=date(2026, 11, 9))
