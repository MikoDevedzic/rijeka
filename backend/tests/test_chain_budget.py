"""Relayer budget: attempts are charged before the send, per user, per firm and globally, serialised, and
counted whether or not the transaction later succeeds."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from chain import budget as B


class _DB:
    """A fake session: no chain_attempts table, no firm_members row unless given, no stored events."""
    def __init__(self, firm=None, events=0):
        self.firm, self.events, self.commits = firm, events, 0
    def execute(self, sql, params=None):
        s = str(sql)
        class R:
            def __init__(_s, v): _s.v = v
            def scalar(_s): return _s.v
            def first(_s): return _s.v
        if "to_regclass" in s: return R(None)
        if "firm_members" in s: return R(self.firm)
        if "pg_advisory_xact_lock" in s: raise RuntimeError("not postgres")
        if "trade_events" in s: return R(self.events)
        return R(None)
    def commit(self): self.commits += 1
    def rollback(self): pass


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    B._memory.clear(); B._table.update(at=0.0, present=None)
    monkeypatch.delenv("RIJEKA_CHAIN_DAILY_LIMIT", raising=False)
    monkeypatch.delenv("RIJEKA_CHAIN_FIRM_DAILY_LIMIT", raising=False)
    monkeypatch.delenv("RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT", raising=False)


def test_defaults_everything_off_until_the_user_cap_is_set(monkeypatch):
    assert B.limits() == {"user": 0, "firm": 0, "global": 0}
    assert B.charge(None, "u1")["stored"] == "none"                     # no cap: the database is not even touched
    monkeypatch.setenv("RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT", "50")
    assert B.limits() == {"user": 0, "firm": 0, "global": 50}            # an explicit global cap works on its own
    monkeypatch.delenv("RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT")
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "20")
    assert B.limits() == {"user": 20, "firm": 60, "global": 200}
    monkeypatch.setenv("RIJEKA_CHAIN_FIRM_DAILY_LIMIT", "25"); monkeypatch.setenv("RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT", "0")
    assert B.limits() == {"user": 20, "firm": 25, "global": 0}


def test_user_cap_counts_attempts_and_stops_at_the_limit(monkeypatch):
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "2")
    db = _DB(firm="f1")
    assert B.charge(db, "u1")["user"] == 1
    assert B.charge(db, "u1", kind="amend")["user"] == 2
    with pytest.raises(HTTPException) as e:
        B.charge(db, "u1")
    assert e.value.status_code == 429 and "This account" in e.value.detail
    assert B.charge(db, "u2")["user"] == 1                       # another user is not blocked by u1
    assert db.commits >= 3                                        # each charge commits its own small transaction


def test_attempts_count_even_when_the_send_later_fails(monkeypatch):
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "1")
    db = _DB()
    B.charge(db, "u1")                                            # the send after this is imagined to revert: no event is stored
    with pytest.raises(HTTPException):
        B.charge(db, "u1")                                        # the attempt still counted


def test_firm_and_global_caps(monkeypatch):
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "10"); monkeypatch.setenv("RIJEKA_CHAIN_FIRM_DAILY_LIMIT", "2"); monkeypatch.setenv("RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT", "3")
    B.charge(_DB(firm="f1"), "u1"); B.charge(_DB(firm="f1"), "u2")
    with pytest.raises(HTTPException) as e:
        B.charge(_DB(firm="f1"), "u3")                            # third person of the same firm
    assert "your firm" in e.value.detail.lower()
    B.charge(_DB(firm="f2"), "u4")                                # a different firm: the global count is now 3
    with pytest.raises(HTTPException) as e:
        B.charge(_DB(firm="f3"), "u5")
    assert "the demo" in e.value.detail.lower()


def test_stored_events_are_the_floor_for_the_user_count_without_the_table(monkeypatch):
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "3")
    db = _DB(events=3)                                            # three anchors already in trade_events, memory empty (restart)
    with pytest.raises(HTTPException):
        B.charge(db, "u1")


def test_window_is_rolling_24h(monkeypatch):
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "1")
    db = _DB()
    t0 = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
    B.charge(db, "u1", now=t0)
    with pytest.raises(HTTPException):
        B.charge(db, "u1", now=t0 + timedelta(hours=23))
    assert B.charge(db, "u1", now=t0 + timedelta(hours=25))["user"] == 1


def test_concurrent_charges_serialise(monkeypatch):
    import threading
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "5")
    ok, refused = [], []
    def go():
        try:
            B.charge(_DB(), "u1"); ok.append(1)
        except HTTPException:
            refused.append(1)
    ts = [threading.Thread(target=go) for _ in range(20)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert len(ok) == 5 and len(refused) == 15
