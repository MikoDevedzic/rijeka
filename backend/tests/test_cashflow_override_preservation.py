"""
test_cashflow_override_preservation.py — L4 fix (Apr 24 2026).

Covers the override-preservation helper in api/routes/_cashflow_overrides.py.

The helper is designed to be called in this sequence:
    snapshot = snapshot_overrides(db, trade_id, user_id)
    # ... delete PROJECTED rows ...
    for each newly-built row:
        apply_snapshot(new_row, snapshot, consumed)
        db.add(new_row)
    orphans = orphans_from_snapshot(snapshot, consumed)

These tests validate each stage and the end-to-end behavior over a
SQLite in-memory DB. They do not call the live /api/pricer route — that
integration is exercised by existing pricer tests. These lock the
helper's contract and prevent L4 regressions.
"""

from __future__ import annotations
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Cashflow
from api.routes._cashflow_overrides import (
    snapshot_overrides,
    apply_snapshot,
    orphans_from_snapshot,
)


@pytest.fixture
def db():
    """In-memory SQLite session with all tables created."""
    # L4 fix-forward (Apr 24 2026): create ONLY the Cashflow table.
    # Base.metadata.create_all fails on SQLite because legal_entities
    # uses ARRAY(String()), which SQLite cannot render. FK constraints
    # on Cashflow are also disabled — we do not seed related
    # trades / trade_legs / trade_events rows in this unit test.
    from sqlalchemy import event as _sa_event

    engine = create_engine("sqlite:///:memory:", future=True)

    @_sa_event.listens_for(engine, "connect")
    def _disable_fk(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys = OFF")
        cur.close()

    Cashflow.__table__.create(engine)
    TestSession = sessionmaker(bind=engine, future=True)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _make_cashflow(
    trade_id, leg_id, user_id,
    p_start, p_end, amount,
    is_overridden=False,
    amount_override=None,
):
    """Build a Cashflow row for fixture insertion."""
    return Cashflow(
        id=uuid4(),
        trade_id=trade_id,
        leg_id=leg_id,
        user_id=user_id,
        period_start=p_start,
        period_end=p_end,
        payment_date=p_end,
        currency="USD",
        amount=Decimal(str(amount)),
        status="PROJECTED",
        cashflow_type="COUPON",
        is_overridden=is_overridden,
        amount_override=Decimal(str(amount_override)) if amount_override is not None else None,
        last_modified_at=datetime.now(tz=timezone.utc) if is_overridden else None,
    )


# ---- Scenario 1: override survives same-schedule re-price --------------

def test_override_survives_same_schedule_reprice(db):
    """
    User overrides one cashflow. Schedule re-generates identically.
    Expected: overridden row has its override fields restored onto the
    freshly-computed row; zero orphans.
    """
    trade_id = uuid4()
    leg_id = uuid4()
    user_id = uuid4()

    # Original schedule: 2 quarters. Period 2 is overridden.
    p1_start, p1_end = date(2026, 1, 1), date(2026, 4, 1)
    p2_start, p2_end = date(2026, 4, 1), date(2026, 7, 1)

    db.add(_make_cashflow(trade_id, leg_id, user_id, p1_start, p1_end, 10000))
    db.add(_make_cashflow(trade_id, leg_id, user_id, p2_start, p2_end, 10000,
                          is_overridden=True, amount_override=12500))
    db.commit()

    # --- snapshot + wipe (simulating what pricer.py Site 2 does) ---
    snap = snapshot_overrides(db, trade_id, user_id)
    assert len(snap) == 1
    key = (str(leg_id), p2_start, p2_end)
    assert key in snap
    assert snap[key]["amount_override"] == Decimal("12500")

    db.query(Cashflow).filter(
        Cashflow.trade_id == trade_id,
        Cashflow.user_id == user_id,
        Cashflow.status == "PROJECTED",
    ).delete(synchronize_session=False)

    # --- Rebuild same schedule with slightly different computed amounts
    # (mimics curve unchanged but rate rounding; override must still win) ---
    consumed = set()
    for (p_start, p_end, fresh_amount) in [
        (p1_start, p1_end, 10001),
        (p2_start, p2_end, 10002),
    ]:
        new_row = _make_cashflow(trade_id, leg_id, user_id, p_start, p_end, fresh_amount)
        apply_snapshot(new_row, snap, consumed)
        db.add(new_row)
    db.commit()

    orphans = orphans_from_snapshot(snap, consumed)
    assert orphans == []

    rows = db.query(Cashflow).filter(Cashflow.trade_id == trade_id).order_by(Cashflow.period_start).all()
    assert len(rows) == 2
    # Row 1 unchanged — not overridden.
    assert rows[0].is_overridden is False
    assert rows[0].amount == Decimal("10001")
    # Row 2 — override preserved; fresh computed amount kept in amount.
    assert rows[1].is_overridden is True
    assert rows[1].amount_override == Decimal("12500")
    assert rows[1].amount == Decimal("10002")


# ---- Scenario 2: override survives curve-change re-price ---------------

def test_override_survives_curve_change_reprice(db):
    """
    User overrides a cashflow. A curve point bumps; same schedule shape
    but different computed amounts. Override must still survive.
    """
    trade_id = uuid4()
    leg_id = uuid4()
    user_id = uuid4()

    p1 = (date(2026, 1, 1), date(2026, 4, 1))
    p2 = (date(2026, 4, 1), date(2026, 7, 1))
    p3 = (date(2026, 7, 1), date(2026, 10, 1))
    p4 = (date(2026, 10, 1), date(2027, 1, 1))

    # Start with four periods; period 3 overridden.
    for p, amt in [(p1, 10000), (p2, 10000), (p3, 10000), (p4, 10000)]:
        row = _make_cashflow(
            trade_id, leg_id, user_id, p[0], p[1], amt,
            is_overridden=(p == p3),
            amount_override=(7500 if p == p3 else None),
        )
        db.add(row)
    db.commit()

    snap = snapshot_overrides(db, trade_id, user_id)
    assert len(snap) == 1

    db.query(Cashflow).filter(Cashflow.trade_id == trade_id).delete(synchronize_session=False)

    # Curve bump — amounts shift but schedule shape identical.
    consumed = set()
    for p, amt in [(p1, 10750), (p2, 10730), (p3, 10710), (p4, 10690)]:
        new_row = _make_cashflow(trade_id, leg_id, user_id, p[0], p[1], amt)
        apply_snapshot(new_row, snap, consumed)
        db.add(new_row)
    db.commit()

    assert orphans_from_snapshot(snap, consumed) == []

    p3_row = (
        db.query(Cashflow)
          .filter(
              Cashflow.trade_id == trade_id,
              Cashflow.period_start == p3[0],
          )
          .one()
    )
    assert p3_row.is_overridden is True
    assert p3_row.amount_override == Decimal("7500")
    assert p3_row.amount == Decimal("10710")  # fresh computed still present


# ---- Scenario 3: schedule-change orphans override ----------------------

def test_schedule_change_orphans_override(db):
    """
    User overrides a cashflow at period N. The schedule then changes
    (frequency change or tenor change) such that period N no longer
    appears in the new schedule.
    Expected: the overridden row is dropped at wipe and reported as an
    orphan. No phantom rows in the new schedule.
    """
    trade_id = uuid4()
    leg_id = uuid4()
    user_id = uuid4()

    # Original: semi-annual.
    h1 = (date(2026, 1, 1), date(2026, 7, 1))
    h2 = (date(2026, 7, 1), date(2027, 1, 1))

    db.add(_make_cashflow(trade_id, leg_id, user_id, h1[0], h1[1], 20000))
    db.add(_make_cashflow(
        trade_id, leg_id, user_id, h2[0], h2[1], 20000,
        is_overridden=True, amount_override=18000,
    ))
    db.commit()

    snap = snapshot_overrides(db, trade_id, user_id)
    assert len(snap) == 1

    db.query(Cashflow).filter(Cashflow.trade_id == trade_id).delete(synchronize_session=False)

    # New schedule: quarterly. Period keys now differ, so h2 is orphaned.
    q_dates = [
        (date(2026, 1, 1), date(2026, 4, 1)),
        (date(2026, 4, 1), date(2026, 7, 1)),
        (date(2026, 7, 1), date(2026, 10, 1)),
        (date(2026, 10, 1), date(2027, 1, 1)),
    ]
    consumed = set()
    for p_start, p_end in q_dates:
        new_row = _make_cashflow(trade_id, leg_id, user_id, p_start, p_end, 10000)
        apply_snapshot(new_row, snap, consumed)
        db.add(new_row)
    db.commit()

    orphans = orphans_from_snapshot(snap, consumed)
    assert len(orphans) == 1
    o = orphans[0]
    assert o["leg_id"] == str(leg_id)
    assert o["period_start"] == h2[0].isoformat()
    assert o["period_end"] == h2[1].isoformat()
    assert o["amount_override"] == 18000.0

    # Verify new rows are all non-overridden.
    rows = db.query(Cashflow).filter(Cashflow.trade_id == trade_id).all()
    assert len(rows) == 4
    assert all(r.is_overridden is False for r in rows)
