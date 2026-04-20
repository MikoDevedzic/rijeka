"""
Rijeka -- event type drift invariants (BUG-L6 closer)
Charter Section 1.5 data-integrity invariant.

The set of valid event types lives in THREE places:

  1. backend/projections/trade_projection.py :: class EventType(str, Enum)
     -- AUTHORITATIVE. The source of truth. New event types are added here first.

  2. backend/api/routes/trade_events.py :: VALID_EVENT_TYPES
     -- Sprint 3 generic POST gate. CONFIRMED is deliberately EXCLUDED
        from this set (the atomic confirm endpoint owns CONFIRMED creation)
        so the test below allows this one documented divergence.

  3. Postgres CHECK constraint on trade_events.event_type
     -- Enforces type validity at the database level.

These three MUST stay in sync (modulo CONFIRMED exclusion in (2)). Tonight's
migration_002 proved they can silently drift: Sprint 12 added CONFIRMED to
(1) but not to (3), causing a runtime HTTP 409 when confirm_trade tried
to INSERT a CONFIRMED event.

This test file catches drift at CI time instead of runtime.

Layered coverage:
  - TestPythonEnumVsValidTypes (pure-function, always runs): catches drift
    between (1) and (2). Runs on every pytest invocation regardless of env.
  - TestDbConstraintMatchesEnum (DB-dependent, skipped without reachable DB):
    catches drift between (1) and (3). Requires DATABASE_URL with network
    access to the Postgres instance.
"""

import os
import re
import pytest

from projections.trade_projection import EventType
from api.routes.trade_events import VALID_EVENT_TYPES


# -- Shared reference sets --------------------------------------------------

# Every event type in the canonical enum.
ENUM_VALUES = frozenset(e.value for e in EventType)

# Event types that are intentionally excluded from VALID_EVENT_TYPES.
# Sprint 12 rationale: the atomic confirm_trade endpoint is the ONLY
# sanctioned path that creates CONFIRMED events, because it also updates
# the trade projection. The generic POST does not.
SPRINT3_INTENTIONAL_EXCLUSIONS = frozenset({"CONFIRMED"})


# =======================================================================
# Layer 1: Python-only drift (pure function, always runs)
# =======================================================================

class TestPythonEnumVsValidTypes:
    """
    The Sprint 3 generic POST's VALID_EVENT_TYPES must be a strict subset
    of the canonical EventType enum, and the only allowed difference is
    SPRINT3_INTENTIONAL_EXCLUSIONS.

    Catches:
      - Adding a new EventType without updating VALID_EVENT_TYPES (forgotten gate)
      - Adding an event type string to VALID_EVENT_TYPES that is NOT in EventType
        (typo, no handler, projection will fail)
    """

    def test_valid_event_types_is_subset_of_enum(self):
        """Every string in VALID_EVENT_TYPES must correspond to an EventType value."""
        unknown = VALID_EVENT_TYPES - ENUM_VALUES
        assert not unknown, (
            f"VALID_EVENT_TYPES contains strings not in canonical EventType enum: "
            f"{sorted(unknown)}. Remove them or add matching EventType members."
        )

    def test_no_accidental_enum_exclusions(self):
        """
        Every EventType value must be in VALID_EVENT_TYPES, EXCEPT the
        documented intentional exclusions.
        """
        missing = ENUM_VALUES - VALID_EVENT_TYPES - SPRINT3_INTENTIONAL_EXCLUSIONS
        assert not missing, (
            f"EventType enum contains values missing from VALID_EVENT_TYPES: "
            f"{sorted(missing)}. Add them to VALID_EVENT_TYPES, or add them to "
            f"SPRINT3_INTENTIONAL_EXCLUSIONS in this test with a written rationale."
        )

    def test_confirmed_exclusion_still_intentional(self):
        """
        Guard against someone "fixing" the CONFIRMED exclusion without
        understanding why it exists. If CONFIRMED is ever added to
        VALID_EVENT_TYPES, the generic POST creates projection-inconsistent
        events -- status stays PENDING while an event claims CONFIRMED.
        If you have reason to lift this exclusion, update both this test
        AND the comment in trade_events.py::VALID_EVENT_TYPES.
        """
        assert "CONFIRMED" in SPRINT3_INTENTIONAL_EXCLUSIONS
        assert "CONFIRMED" not in VALID_EVENT_TYPES, (
            "CONFIRMED must stay out of VALID_EVENT_TYPES. The atomic confirm_trade "
            "endpoint is the only sanctioned path that creates CONFIRMED events, "
            "because only it updates the trade projection in the same transaction."
        )


# =======================================================================
# Layer 2: DB vs enum drift (requires reachable Postgres)
# =======================================================================

def _db_reachable() -> bool:
    """
    True iff we can open a session to the configured DATABASE_URL. This is
    a cheap connectivity probe that does NOT run any user data queries.
    Returns False silently for any failure (no DATABASE_URL, network down,
    Supabase pauser, local DB not running, etc.).
    """
    try:
        from db.session import SessionLocal
        from sqlalchemy import text
        s = SessionLocal()
        try:
            s.execute(text("SELECT 1")).scalar()
            return True
        finally:
            s.close()
    except Exception:
        return False


def _fetch_constraint_values() -> set:
    """
    Query pg_constraint for trade_events_event_type_check and parse out
    the allowed string values.

    Format produced by Postgres:
      CHECK ((event_type = ANY (ARRAY['BOOKED'::text, 'CONFIRMED'::text, ...])))

    Parsing strategy: extract every quoted token followed by ::text via regex.
    Robust to Postgres's optional whitespace, reordering, and whether the
    constraint is phrased as IN (...) or = ANY (ARRAY[...]).
    """
    from db.session import SessionLocal
    from sqlalchemy import text

    s = SessionLocal()
    try:
        row = s.execute(text(
            "SELECT pg_get_constraintdef(oid) "
            "FROM pg_constraint "
            "WHERE conrelid = 'trade_events'::regclass "
            "  AND conname  = 'trade_events_event_type_check'"
        )).scalar()
    finally:
        s.close()

    if not row:
        pytest.fail(
            "trade_events_event_type_check constraint not found on trade_events. "
            "Run migration_002_add_CONFIRMED_event_type.sql in Supabase SQL Editor."
        )

    # Match quoted literals followed by ::text -- catches both IN (...) and
    # = ANY (ARRAY[...]) phrasings Postgres may use.
    tokens = re.findall(r"'([A-Z_]+)'::text", row)
    if not tokens:
        pytest.fail(
            f"Could not parse event-type values from constraint definition. "
            f"Raw definition: {row!r}"
        )
    return set(tokens)


@pytest.mark.skipif(
    not _db_reachable(),
    reason="DATABASE_URL unreachable (no env, network down, or Supabase paused). "
           "DB-invariant checks run in environments with DB access.",
)
class TestDbConstraintMatchesEnum:
    """
    The DB CHECK constraint on trade_events.event_type must contain the
    exact same set of strings as the canonical EventType enum.

    Catches:
      - Adding a new EventType without writing a migration (tonight's BUG-L6)
      - Removing an EventType without removing it from the constraint
      - Any other drift between code and schema
    """

    def test_db_constraint_matches_enum_exactly(self):
        db_values = _fetch_constraint_values()

        missing_from_db = ENUM_VALUES - db_values
        extra_in_db     = db_values - ENUM_VALUES

        msgs = []
        if missing_from_db:
            msgs.append(
                f"In EventType enum but NOT in DB constraint: {sorted(missing_from_db)}. "
                f"Write a migration that adds these to trade_events_event_type_check."
            )
        if extra_in_db:
            msgs.append(
                f"In DB constraint but NOT in EventType enum: {sorted(extra_in_db)}. "
                f"Either add these to EventType (with a projection handler if needed), "
                f"or write a migration that removes them from the constraint."
            )

        assert not msgs, (
            "DB constraint has drifted from EventType enum.\n"
            + "\n".join("  - " + m for m in msgs)
        )

    def test_constraint_is_present(self):
        """Separate sanity check: the constraint must exist at all."""
        db_values = _fetch_constraint_values()
        assert len(db_values) >= 1, (
            "trade_events_event_type_check constraint exists but has no values. "
            "This would allow any string as event_type -- a correctness disaster."
        )
