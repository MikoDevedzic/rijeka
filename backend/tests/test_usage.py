"""Usage beacons: a daily-rotating one-way visitor id, a per-address limit, memory until the table exists,
and a funnel series that reads the trading tables."""
from datetime import date, datetime, timedelta, timezone

from api.routes import usage as U


def test_visitor_id_rotates_daily_and_never_reveals_the_inputs():
    a = U.visitor_id("1.2.3.4", "Mozilla", date(2026, 10, 30), secret="s")
    b = U.visitor_id("1.2.3.4", "Mozilla", date(2026, 10, 31), secret="s")
    c = U.visitor_id("1.2.3.5", "Mozilla", date(2026, 10, 30), secret="s")
    assert a != b and a != c and len(a) == 16 and "1.2.3.4" not in a


def test_rate_limit_per_address():
    U._rate.clear()
    now = 1000.0
    assert all(U._allow("9.9.9.9", now + i * 0.1) for i in range(U.HIT_PER_MINUTE))
    assert U._allow("9.9.9.9", now + 30) is False
    assert U._allow("9.9.9.8", now + 30) is True
    assert U._allow("9.9.9.9", now + 61.5) is True                 # the window slid


class _DB:
    def __init__(self, table=False, counts=None):
        self.table, self.counts = table, counts or {}
        self.inserted = []
    def execute(self, sql, params=None):
        s = str(sql)
        class R:
            def __init__(_s, rows=None, scalar=None): _s._rows, _s._scalar = rows, scalar
            def scalar(_s): return _s._scalar
            def all(_s): return _s._rows or []
        if "to_regclass" in s:
            return R(scalar="usage_hits" if self.table else None)
        if s.startswith("INSERT"):
            self.inserted.append(params); return R()
        if "FROM usage_hits" in s:
            return R(rows=[])
        for key, rows in self.counts.items():
            if key in s:
                return R(rows=rows)
        return R(rows=[])
    def commit(self): pass
    def rollback(self): pass


def test_hits_count_in_memory_without_the_table_and_feed_the_series():
    U._memory.clear(); U._table.update(at=0.0, present=None)
    db = _DB(table=False, counts={"auth.users": [(date(2026, 10, 29), 1)], "FROM trades": [(date(2026, 10, 30), 2)],
                                  "NOT LIKE 'TEST-%' GROUP BY 1": [(date(2026, 10, 30), 1)], "anchored": [(date(2026, 10, 30), 1)]})
    t = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)
    assert U.record_hit(db, "view", "/", "v1", "abc", now=t) == "memory"
    U.record_hit(db, "view", "/blotter", "v1", "abc", now=t); U.record_hit(db, "view", "/", "v2", "abc", now=t)
    U.record_hit(db, "signup_started", "/signup", "v2", "abc", now=t)
    U.record_hit(db, "view", "/", "v9", "abc", now=t - timedelta(days=1))
    out = U.usage(db, today=date(2026, 10, 30), days=3)
    by = {r["date"]: r for r in out["series"]}
    assert by["2026-10-30"]["visitors"] == 2 and by["2026-10-30"]["views"] == 3 and by["2026-10-30"]["signup_started"] == 1
    assert by["2026-10-29"]["visitors"] == 1 and by["2026-10-29"]["signups"] == 1
    assert by["2026-10-30"]["trades"] == 2 and by["2026-10-30"]["confirms"] == 1 and by["2026-10-30"]["anchors"] == 1
    assert out["totals"]["visitors"] == 3 and out["totals"]["views"] == 4 and out["hits_stored_in"].startswith("memory")


def test_hits_go_to_the_table_when_it_exists():
    U._memory.clear(); U._table.update(at=0.0, present=None)
    db = _DB(table=True)
    assert U.record_hit(db, "view", "/risk", "v1", "abc") == "db"
    assert db.inserted and db.inserted[0]["route"] == "/risk" and len(U._memory) == 0
    U._table.update(at=0.0, present=None)
