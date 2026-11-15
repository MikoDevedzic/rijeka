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
