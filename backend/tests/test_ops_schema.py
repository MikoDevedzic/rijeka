"""The health body names every optional migration and whether it is applied, so a release never guesses."""
import pytest

from api.routes import ops


class _DB:
    """A session whose information_schema knows no optional table or column."""
    def execute(self, *a, **k):
        class R:
            def scalar(self): return 0
            def first(self): return None
            def all(self): return []
        return R()
    def rollback(self): pass


@pytest.fixture
def fresh_presence_caches():
    """The presence checks cache per process; start from nothing and leave nothing behind for the other tests."""
    import modules
    from api.routes import counterparties
    from chain import pending
    from collateral import store as cstore
    from ipv import store as istore
    from jobs import queue
    dicts = (modules._PRESENT, counterparties._CAPITAL_PRESENT, cstore._tables, istore._tables)
    timed = (pending._table, queue._table)
    saved = [dict(d) for d in dicts + timed]
    for d in dicts:
        d.clear()
    for d in timed:
        d.update(present=None, at=0.0)
    ops._schema_cache.update(at=0.0, body=None)
    yield
    ops._schema_cache.update(at=0.0, body=None)
    for d, s in zip(dicts + timed, saved, strict=True):
        d.clear(); d.update(s)


def test_schema_status_lists_every_optional_migration_and_never_raises(fresh_presence_caches):
    out = ops.schema_status(_DB())
    assert set(out) == {m[0] for m in ops.OPTIONAL_MIGRATIONS} >= {"collateral", "pending_anchors", "jobs", "ipv", "firm_modules"}
    for name, v in out.items():
        assert v["applied"] in (False, None), name          # nothing is present on the empty session
        assert v["migration"].endswith(")") or v["migration"].endswith(".sql"), name
        assert v["gates"], name
    assert "worker is alive" in out["jobs"]["gates"]


def test_schema_status_is_cached_for_the_public_endpoint(fresh_presence_caches):
    calls = {"n": 0}

    class Counting(_DB):
        def execute(self, *a, **k):
            calls["n"] += 1
            return super().execute(*a, **k)
    first = ops.schema_status(Counting())
    n = calls["n"]
    assert n > 0 and ops.schema_status(Counting()) is first and calls["n"] == n      # the second call asks the database nothing


def test_schema_status_degrades_to_unknown_without_a_session(fresh_presence_caches):
    out = ops.schema_status(None)
    assert set(out) == {m[0] for m in ops.OPTIONAL_MIGRATIONS}
    assert all(v["applied"] in (False, None) for v in out.values())
