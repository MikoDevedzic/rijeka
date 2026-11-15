"""One reading inside a report (db/reading.py): made once inside the block, every time outside it."""
import threading

from db.reading import one_reading, read_once


def test_outside_a_report_every_read_is_made():
    n = []
    assert [read_once("k", lambda: n.append(1) or len(n)) for _ in range(3)] == [1, 2, 3]


def test_inside_a_report_a_read_is_made_once_for_its_key_and_forgotten_after():
    n = []
    load = lambda: n.append(1) or len(n)      # noqa: E731
    with one_reading():
        assert [read_once(("cap", "u", "2026-11-13"), load) for _ in range(3)] == [1, 1, 1]
        assert read_once(("cap", "u", "2026-11-14"), load) == 2          # another date is another read
        with one_reading():                                               # a report inside a report shares it
            assert read_once(("cap", "u", "2026-11-13"), load) == 1
        assert read_once(("cap", "u", "2026-11-13"), load) == 1
    assert read_once(("cap", "u", "2026-11-13"), load) == 3              # the block is over: it is read again


def test_a_report_in_another_thread_has_readings_of_its_own():
    seen = {}

    def other():
        with one_reading():
            seen["other"] = read_once("k", lambda: "theirs")
    with one_reading():
        assert read_once("k", lambda: "mine") == "mine"
        t = threading.Thread(target=other); t.start(); t.join()
        assert read_once("k", lambda: "changed") == "mine"
    assert seen["other"] == "theirs"


def test_a_failed_read_is_not_kept():
    n = []

    def load():
        n.append(1)
        if len(n) == 1:
            raise RuntimeError("the database did not answer")
        return "rows"
    with one_reading():
        try:
            read_once("k", load)
        except RuntimeError:
            pass
        assert read_once("k", load) == "rows"


# ── the two reads a report makes once: each caller owns what it is given; a user and a date have their own ─────────
class _Rows:
    def __init__(self, rows): self._rows = rows
    def mappings(self): return self
    def all(self): return self._rows


class _SurfaceDb:
    """Answers the cap surface's two statements from `by_date`; counts them; can fail the first `fail` times."""
    def __init__(self, fail=0):
        self.asked, self.fail = [], fail

    def execute(self, statement, params=None):
        self.asked.append(dict(params or {}))
        if self.fail:
            self.fail -= 1
            raise OSError("statement timeout")
        vd = (params or {}).get("vd")
        if vd is None:
            return _Rows([])
        return _Rows([{"cap_tenor_y": 5.0, "strike_spread_bp": 0.0, "flat_vol_bp": 80.0 + int(str(vd)[-2:]), "is_atm": True, "source": (params or {}).get("user_id")}])


def test_the_cap_surface_is_read_once_a_report_for_its_user_and_date_and_each_caller_owns_its_rows():
    from api.routes.pricer import _load_cap_surface
    db = _SurfaceDb()
    with one_reading():
        a = _load_cap_surface(db, "2026-11-13", "u1")
        a[0]["flat_vol_bp"] = -1.0                                   # a caller that changes what it was given
        b = _load_cap_surface(db, "2026-11-13", "u1")
        assert b[0]["flat_vol_bp"] == 93.0 and len(db.asked) == 1    # the next caller is not handed the change
        assert _load_cap_surface(db, "2026-11-14", "u1")[0]["flat_vol_bp"] == 94.0 and len(db.asked) == 2     # another date
        assert _load_cap_surface(db, "2026-11-13", "u2")[0]["source"] == "u2" and len(db.asked) == 3           # another user
    _load_cap_surface(db, "2026-11-13", "u1")
    assert len(db.asked) == 4                                        # outside a report it is read as it stands


def test_a_cap_surface_that_could_not_be_read_is_no_rows_once_and_is_asked_for_again():
    from api.routes.pricer import _load_cap_surface
    db = _SurfaceDb(fail=1)
    with one_reading():
        assert _load_cap_surface(db, "2026-11-13", "u1") == []       # as it always was: no rows, no error
        assert _load_cap_surface(db, "2026-11-13", "u1")[0]["flat_vol_bp"] == 93.0     # not an empty surface for the rest of the report
