"""A generated trade reference cannot repeat for one user (api/routes/_trade_ref.py).

Before: `TRD-` + the last eight digits of the clock's second, so two bookings by one user inside a second
asked for the same name, the insert broke `uq_trades_user_ref` and the API answered 500 (10 November 2026,
a package posting its legs one after another).

No database here: the session below keeps the one rule that matters, (user_id, trade_ref) unique, and
raises what psycopg2 raises. The same journeys against the real index are in
tests/integration/test_trade_ref.py.
"""
import contextlib
import re
import uuid
import types
from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from api.routes import _trade_ref
from api.routes import booking as booking_route
from api.routes import trades as trades_route
from api.routes.booking import BookingRequest, LegInput, book_trade
from api.routes.trades import TradeCreate, create_trade
from db.models import Trade, TradeEvent, TradeLeg

SECOND = 1_794_312_345                    # one frozen second: every booking below happens inside it
SHAPE = re.compile(r"^TRD-\d{8}$")
USER_A, USER_B = UUID("0000000a-0000-4000-8000-0000000000aa"), UUID("0000000b-0000-4000-8000-0000000000bb")


class _Query:
    def __init__(self, rows): self.rows = rows
    def filter(self, *a, **k): return self
    def order_by(self, *a, **k): return self
    def all(self): return list(self.rows)
    def first(self): return self.rows[0] if self.rows else None


class Book:
    """A session with the trades table's one uniqueness rule. `inserts` counts trade rows sent to it."""

    def __init__(self, fail_with: str | None = None):
        self.taken: set = set()           # (user_id, trade_ref) of every trade row that was flushed
        self.pending: list = []
        self.legs: list = []
        self.events: list = []
        self.inserts = 0
        self.fail_with = fail_with        # another constraint's name: every trade insert breaks it
        self.savepoints = 0
        self.rollbacks = 0

    def add(self, obj): self.pending.append(obj)

    def flush(self):
        pending, self.pending = self.pending, []
        for obj in pending:
            if isinstance(obj, Trade):
                self.inserts += 1
                key = (obj.user_id, obj.trade_ref)
                name = self.fail_with or ("uq_trades_user_ref" if key in self.taken else None)
                if name:
                    raise IntegrityError("INSERT INTO trades", {}, Exception(f'duplicate key value violates unique constraint "{name}"'))
                self.taken.add(key)
            elif isinstance(obj, TradeLeg):
                self.legs.append(obj)
            elif isinstance(obj, TradeEvent):
                self.events.append(obj)

    @contextlib.contextmanager
    def begin_nested(self):
        self.savepoints += 1
        try:
            yield
        except Exception:
            self.pending = []
            raise

    def query(self, model): return _Query(self.legs if model is TradeLeg else [])
    def commit(self): self.flush()

    def execute(self, stmt, params=None):
        # The two looks the reference code takes at the trades table: is a name taken (:r), does anything
        # stand under it (:p, the name followed by a dash and anything).
        q = params or {}
        mine = {ref for (u, ref) in self.taken if str(u) == str(q.get("u"))}
        under = str(q["p"])[:-1] if "p" in q else None
        hit = (q.get("r") in mine) or (under is not None and any(ref.startswith(under) for ref in mine))
        return _Query([1] if hit else [])
    def rollback(self): self.rollbacks += 1; self.pending = []
    def refresh(self, obj): pass

    def refs(self, user=USER_A): return sorted(r for u, r in self.taken if u == user)


@pytest.fixture(autouse=True)
def one_second(monkeypatch):
    monkeypatch.setattr(_trade_ref, "time", types.SimpleNamespace(time=lambda: SECOND + 0.4))
    monkeypatch.setattr(trades_route, "invalidate_trade_cache", lambda: None)


def _who(uid=USER_A): return {"sub": str(uid), "user_metadata": {"role": "trader"}}


def _ticket(**over):
    return TradeCreate(**{"asset_class": "RATES", "instrument_type": "IR_SWAP", "notional": 10_000_000, "trade_date": "2026-11-10",
                          "effective_date": "2026-11-12", "maturity_date": "2031-11-12", **over})


def _booking(**over):
    legs = [LegInput(leg_ref="FIXED-1", leg_seq=1, leg_type="FIXED", direction="PAY", currency="USD", notional=Decimal("10000000"),
                     fixed_rate=Decimal("0.0375")),
            LegInput(leg_ref="FLOAT-1", leg_seq=2, leg_type="FLOAT", direction="RECEIVE", currency="USD", notional=Decimal("10000000"),
                     spread=Decimal("0"), forecast_curve_id="USD_SOFR")]
    return BookingRequest(**{"asset_class": "RATES", "instrument_type": "IR_SWAP", "structure": "VANILLA", "notional": Decimal("10000000"),
                             "notional_ccy": "USD", "trade_date": date(2026, 11, 10), "effective_date": date(2026, 11, 12),
                             "maturity_date": date(2031, 11, 12), "terms": {"direction": "PAY"}, "legs": legs, **over})


# ── the reference itself ─────────────────────────────────────────────────────────────────────────

def test_the_reference_keeps_its_shape_and_is_the_clocks_second():
    assert _trade_ref.generated_ref(SECOND) == "TRD-94312345" == f"TRD-{str(SECOND)[-8:]}"       # what the API always made
    assert _trade_ref.generated_ref(1_700_000_042) == "TRD-00000042"                             # leading zeros stay
    assert _trade_ref.generated_ref(1_799_999_999 + 1) == "TRD-00000000"                         # the eight digits roll over
    assert all(SHAPE.match(r) for r in _trade_ref._candidates())


def test_a_collision_is_told_from_any_other_integrity_error():
    def err(text, constraint=None):
        orig = Exception(text)
        if constraint:
            orig.diag = types.SimpleNamespace(constraint_name=constraint)
        return IntegrityError("INSERT", {}, orig)
    assert _trade_ref.is_ref_collision(err('duplicate key value violates unique constraint "uq_trades_user_ref"'))
    assert _trade_ref.is_ref_collision(err("23505", constraint="uq_trades_user_ref"))
    assert not _trade_ref.is_ref_collision(err('violates foreign key constraint "trades_counterparty_id_fkey"'))
    assert not _trade_ref.is_ref_collision(err("23505", constraint="pk_idempotency_keys"))


# ── two bookings in one second ───────────────────────────────────────────────────────────────────

def test_two_tickets_in_the_same_second_get_two_references():
    db = Book()
    first = create_trade(_ticket(), db=db, user=_who())
    second = create_trade(_ticket(), db=db, user=_who())          # raised HTTPException(500) before
    assert first["trade_ref"] == "TRD-94312345"                   # the first booking of a second reads as it always did
    assert second["trade_ref"] == "TRD-94312346"                  # the next free number, same shape
    assert db.refs() == ["TRD-94312345", "TRD-94312346"] and db.rollbacks == 0


def test_two_atomic_bookings_in_the_same_second_get_two_references():
    db = Book()
    first = book_trade(db, USER_A, _booking())
    second = book_trade(db, USER_A, _booking())                   # 409 "trade_ref ... already exists" before
    refs = [first["trade"]["trade_ref"], second["trade"]["trade_ref"]]
    assert refs == ["TRD-94312345", "TRD-94312346"] and db.refs() == refs
    assert len(first["legs"]) == 2 and first["trade"]["id"] != second["trade"]["id"]


def test_the_booked_event_carries_the_reference_the_row_was_given():
    """The event stream is the record. POST /api/book/trade assembled its BOOKED event before the row was named,
    so a generated reference was null in the event (Edgar and Vera, 10 November 2026)."""
    db = Book()
    create_trade(_ticket(), db=db, user=_who())
    book_trade(db, USER_A, _booking())                            # collides, so the name in the event is the retried one
    book_trade(db, USER_A, _booking(trade_ref="MY-OWN-REF"))
    in_events = [(e.payload["trade"]["trade_ref"], e.post_state["trade"]["trade_ref"]) for e in db.events]
    assert in_events == [("TRD-94312345",) * 2, ("TRD-94312346",) * 2, ("MY-OWN-REF",) * 2]


def test_the_index_named_here_is_the_one_the_model_and_the_schema_have():
    """A renamed index would turn the retry into a 500 without a test noticing (Vera, 10 November 2026)."""
    from pathlib import Path
    assert _trade_ref.UNIQUE in {c.name for c in Trade.__table__.constraints}
    schema = Path(__file__).resolve().parents[2] / "docs" / "schema.sql"
    assert f"CREATE UNIQUE INDEX {_trade_ref.UNIQUE} ON public.trades USING btree (user_id, trade_ref)" in schema.read_text()


def test_the_two_routes_share_one_users_names():
    db = Book()
    a = create_trade(_ticket(), db=db, user=_who())["trade_ref"]
    b = book_trade(db, USER_A, _booking())["trade"]["trade_ref"]
    c = create_trade(_ticket(), db=db, user=_who())["trade_ref"]
    assert len({a, b, c}) == 3 and all(SHAPE.match(r) for r in (a, b, c))


def test_another_user_in_the_same_second_is_not_in_the_way():
    db = Book()
    mine = create_trade(_ticket(), db=db, user=_who(USER_A))["trade_ref"]
    theirs = create_trade(_ticket(), db=db, user=_who(USER_B))["trade_ref"]
    assert mine == theirs == "TRD-94312345"                       # unique per user, as the index is


def test_a_burst_inside_one_second_all_books_with_a_bounded_number_of_attempts():
    db = Book()
    refs = [create_trade(_ticket(), db=db, user=_who())["trade_ref"] for _ in range(60)]
    assert len(set(refs)) == 60 and all(SHAPE.match(r) for r in refs)
    assert refs[:_trade_ref.IN_A_ROW] == [_trade_ref.generated_ref(SECOND + k) for k in range(_trade_ref.IN_A_ROW)]
    assert db.inserts <= 60 * (_trade_ref.IN_A_ROW + 2)           # past the run of eight, a random name; not a walk that grows


def test_each_attempt_is_its_own_savepoint_so_the_callers_transaction_survives():
    db = Book()
    create_trade(_ticket(), db=db, user=_who())
    create_trade(_ticket(), db=db, user=_who())
    assert db.savepoints == 3 and db.rollbacks == 0               # 1 + (collision, retry): never a rollback of the whole


# ── a reference the client supplies ──────────────────────────────────────────────────────────────

def test_a_supplied_reference_is_used_as_it_is():
    db = Book()
    assert create_trade(_ticket(trade_ref="TRD-94312345-2"), db=db, user=_who())["trade_ref"] == "TRD-94312345-2"
    assert book_trade(db, USER_A, _booking(trade_ref="MY-OWN-REF"))["trade"]["trade_ref"] == "MY-OWN-REF"
    assert db.savepoints == 0 and db.inserts == 2


def test_a_supplied_duplicate_is_refused_not_renamed():
    db = Book()
    create_trade(_ticket(trade_ref="DESK-1"), db=db, user=_who())
    with pytest.raises(HTTPException) as e:
        create_trade(_ticket(trade_ref="DESK-1"), db=db, user=_who())
    assert e.value.status_code == 409 and "DESK-1" in e.value.detail          # 500 before
    with pytest.raises(HTTPException) as e:
        book_trade(db, USER_A, _booking(trade_ref="DESK-1"))
    assert e.value.status_code == 409 and "DESK-1" in e.value.detail
    assert db.refs() == ["DESK-1"] and db.inserts == 3                         # one attempt each, no second name tried


def test_a_generated_reference_never_takes_a_packages_leg_name():
    """A package names its further legs after the first (TRD-94312345-2). The name made here for a second
    ticket in that second must not be that one, or the package's own leg would then be refused."""
    db = Book()
    first = create_trade(_ticket(), db=db, user=_who())["trade_ref"]
    other_ticket = create_trade(_ticket(), db=db, user=_who())["trade_ref"]
    leg_two = create_trade(_ticket(trade_ref=f"{first}-2"), db=db, user=_who())["trade_ref"]
    assert leg_two == "TRD-94312345-2" and other_ticket != leg_two


# ── what is not a collision stays what it was ────────────────────────────────────────────────────

def test_another_constraint_is_not_retried():
    db = Book(fail_with="trades_counterparty_id_fkey")
    with pytest.raises(HTTPException) as e:
        create_trade(_ticket(), db=db, user=_who())
    assert e.value.status_code == 500 and db.inserts == 1 and db.rollbacks == 1
    db = Book(fail_with="trades_counterparty_id_fkey")
    with pytest.raises(HTTPException) as e:
        book_trade(db, USER_A, _booking())
    assert e.value.status_code == 409 and "trade_ref" not in e.value.detail and db.inserts == 1


def test_when_every_name_tried_is_taken_the_answer_says_so(monkeypatch):
    db = Book()
    create_trade(_ticket(), db=db, user=_who())
    monkeypatch.setattr(_trade_ref, "_candidates", lambda: iter(["TRD-94312345"] * _trade_ref.ATTEMPTS))
    for call in (lambda: create_trade(_ticket(), db=db, user=_who()), lambda: book_trade(db, USER_A, _booking())):
        with pytest.raises(HTTPException) as e:
            call()
        assert e.value.status_code == 503 and "reference" in e.value.detail
    assert db.refs() == ["TRD-94312345"]


def test_neither_route_builds_a_reference_from_the_clock_itself():
    """The pattern that broke, in the two places it lived: both now go through insert_trade."""
    import inspect
    for mod in (trades_route, booking_route):
        src = inspect.getsource(mod)
        assert "time.time()" not in src and 'f"TRD-' not in src, mod.__name__
        assert "insert_trade(" in src, mod.__name__


# ── a package: one trade ID, a leg ID under it for each leg ───────────────────────────────────────

def test_a_package_gets_a_trade_id_no_trade_has_and_its_legs_stand_under_it(monkeypatch):
    from api.routes import _trade_ref as R
    monkeypatch.setattr(R.time, "time", lambda: SECOND)
    db = Book()
    pid = R.free_package_id(db, USER_A)
    assert SHAPE.match(pid) and pid == R.generated_ref(SECOND + R.PACKAGE_OFFSET), "the clock proposes, half the number space from a single trade's name"
    assert pid != R.generated_ref(SECOND), "a trade and a package booked in one second do not reach for one name"
    assert [R.leg_ref(pid, i) for i in (1, 2, 3)] == [f"{pid}-1", f"{pid}-2", f"{pid}-3"]
    # the legs are booked: the name is held by them, for a package and for a single trade alike
    db.taken |= {(USER_A, f"{pid}-1"), (USER_A, f"{pid}-2")}
    assert R.package_holds(db, USER_A, pid) and not R.package_holds(db, USER_B, pid), "one user's names"
    nxt = R.free_package_id(db, USER_A)
    assert nxt != pid and nxt == R.generated_ref(SECOND + R.PACKAGE_OFFSET + 1)
    # a single trade already called that: not a free trade ID either
    db.taken.add((USER_A, nxt))
    assert R.free_package_id(db, USER_A) == R.generated_ref(SECOND + R.PACKAGE_OFFSET + 2)
    # an older package (its first leg the bare name, the others -2, -3): the bare name and what stands under it are both seen
    old = R.generated_ref(SECOND + R.PACKAGE_OFFSET + 3)
    db.taken |= {(USER_A, old), (USER_A, f"{old}-2"), (USER_A, R.generated_ref(SECOND + R.PACKAGE_OFFSET + 2) + "-1")}
    assert R.free_package_id(db, USER_A) == R.generated_ref(SECOND + R.PACKAGE_OFFSET + 4)


def test_a_single_trade_is_never_given_a_name_a_packages_legs_stand_under(monkeypatch):
    from api.routes import _trade_ref as R
    monkeypatch.setattr(R.time, "time", lambda: SECOND)
    db = Book()
    held = R.generated_ref(SECOND)                       # what the clock would propose for a single trade
    db.taken |= {(USER_A, f"{held}-1"), (USER_A, f"{held}-2")}

    def row(ref):
        return Trade(id=uuid.uuid4(), user_id=USER_A, trade_ref=ref)
    t = R.insert_trade(db, row, None)
    assert t.trade_ref == R.generated_ref(SECOND + 1) and held not in {ref for (_u, ref) in db.taken}
    # another user's package does not hold the name for this one
    db2 = Book()
    db2.taken |= {(USER_B, f"{held}-1")}
    assert R.insert_trade(db2, row, None).trade_ref == held
    # a reference the client supplies is still used as it is
    assert R.insert_trade(Book(), row, "MY-REF").trade_ref == "MY-REF"
