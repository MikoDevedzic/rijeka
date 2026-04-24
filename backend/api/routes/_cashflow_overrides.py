"""
_cashflow_overrides.py  —  override-preservation helper (L4 fix, Apr 24 2026).

Before Sprint 14/ish: the cashflow wipe sites in pricer.py and cashflows.py
deleted all PROJECTED rows indiscriminately, including rows carrying user
overrides (`is_overridden=True`, `amount_override` populated). This lost
user input on every re-price.

This module provides two primitives that turn the wipe-and-replace pattern
into a preserve-and-replace pattern without changing its shape:

    1) snapshot_overrides(db, trade_id, user_id)
         -> dict keyed by (leg_id, period_start, period_end)

       Read overridden rows BEFORE the delete. The period tuple is stable
       across re-price (same schedule -> same keys); override survives.
       Schedule change -> key no longer matches any new row -> orphan.

    2) apply_snapshot(new_row, snapshot)
         -> bool (True if override restored, mutates new_row in place)

       After a fresh row is built but before it's added to the session,
       check whether its period key matches a snapshotted override. If so,
       copy amount_override, is_overridden, last_modified_at,
       last_modified_by onto the row. The freshly-computed `amount` stays
       as the "what the system would have computed" indicator; the override
       still governs effective amount for downstream consumers.

Callers are responsible for:
    - Calling snapshot_overrides BEFORE the delete
    - Calling apply_snapshot on each new row BEFORE db.add(row)
    - Tracking which snapshot keys were matched (via consumed set) and
      treating unmatched keys as orphans for response surfacing

Pricing/display consumers compute effective amount as:
    amount_override if is_overridden else amount

That convention is not enforced here — this module only preserves the
override fields on the row. Effective-amount logic lives in the pricer
and UI layers, unchanged.

Scope: this is Site 2 (live path) primary; Sites 1 and 3 use this
defensively. See KNOWN_LEGACY_BUGS.md L4 closure + L26 (parallel-override-
mechanism architectural debt, separate sprint item).
"""

from __future__ import annotations
from typing import Dict, Iterable, List, Optional, Tuple
from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from db.models import Cashflow


PeriodKey = Tuple[str, date, date]
"""(leg_id_str, period_start, period_end) — the stable natural key."""


def snapshot_overrides(
    db: Session,
    trade_id: UUID | str,
    user_id: UUID | str,
) -> Dict[PeriodKey, dict]:
    """
    Read all PROJECTED cashflows carrying user overrides for this trade
    and return a snapshot keyed by natural period.

    Called before any PROJECTED-wipe. The returned dict is safe to hold
    across the delete — contains plain Python values only, no ORM refs.

    Parameters
    ----------
    db : sqlalchemy Session
    trade_id : UUID or str
    user_id : UUID or str  (multi-tenancy — RLS-consistent scoping)

    Returns
    -------
    dict[(leg_id_str, period_start, period_end)] ->
        {
            "amount_override":   Decimal | None,
            "is_overridden":     bool,
            "last_modified_at":  datetime | None,
            "last_modified_by":  UUID | None,
        }
    """
    rows = (
        db.query(Cashflow)
          .filter(
              Cashflow.trade_id == trade_id,
              Cashflow.user_id == user_id,
              Cashflow.status == "PROJECTED",
              Cashflow.is_overridden == True,  # noqa: E712 (SQL eq)
          )
          .all()
    )
    return {
        (str(r.leg_id), r.period_start, r.period_end): {
            "amount_override":  r.amount_override,
            "is_overridden":    True,
            "last_modified_at": r.last_modified_at,
            "last_modified_by": r.last_modified_by,
        }
        for r in rows
    }


def apply_snapshot(
    new_row: Cashflow,
    snapshot: Dict[PeriodKey, dict],
    consumed: Optional[set] = None,
) -> bool:
    """
    If `new_row`'s period key is in `snapshot`, copy the override fields
    onto `new_row` in place.

    If `consumed` is provided, the matched key is added to it — callers
    use this to compute orphaned overrides as `set(snapshot) - consumed`.

    The freshly-computed `amount` on new_row is preserved — override
    users compute effective amount as
        amount_override if is_overridden else amount

    Returns True if the row had an override restored, False otherwise.
    """
    key = (str(new_row.leg_id), new_row.period_start, new_row.period_end)
    override = snapshot.get(key)
    if override is None:
        return False

    new_row.amount_override  = override["amount_override"]
    new_row.is_overridden    = override["is_overridden"]
    new_row.last_modified_at = override["last_modified_at"]
    new_row.last_modified_by = override["last_modified_by"]

    if consumed is not None:
        consumed.add(key)
    return True


def orphans_from_snapshot(
    snapshot: Dict[PeriodKey, dict],
    consumed: set,
) -> List[dict]:
    """
    Return orphaned overrides — snapshot entries whose period key was not
    matched by any new row. Shape is serializable for API responses.

    Each orphan is:
        {
            "leg_id":         str,
            "period_start":   "YYYY-MM-DD",
            "period_end":     "YYYY-MM-DD",
            "amount_override": float | None,
        }
    """
    out: List[dict] = []
    for key in set(snapshot) - consumed:
        leg_id, p_start, p_end = key
        meta = snapshot[key]
        ao = meta.get("amount_override")
        out.append({
            "leg_id":           leg_id,
            "period_start":     p_start.isoformat(),
            "period_end":       p_end.isoformat(),
            "amount_override":  float(ao) if ao is not None else None,
        })
    # Deterministic order — helps tests and reviewability.
    out.sort(key=lambda o: (o["leg_id"], o["period_start"]))
    return out
