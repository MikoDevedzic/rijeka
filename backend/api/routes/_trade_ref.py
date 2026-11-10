"""The reference a trade gets when the client names none, and the insert that makes it stick.

`TRD-` and eight digits, the last eight of the clock's second: readable, and the shape everything
else already knows (the blotter's REF column, a package's further legs `TRD-12345678-2`, a leg's
`TRD-12345678-L1`, the brief's rule that an identifier's digits are not a figure).

A second holds more than one booking (two tickets, two windows, a double press, a package's legs),
and one user's references are unique (`uq_trades_user_ref`). So the clock only proposes: the trade
row is inserted inside a savepoint, and when the database says the name is taken the next number is
tried, a few in a row and then numbers drawn at random, so a long burst costs a bounded number of
attempts. The database decides, not a read before the write: two requests in flight cannot both be
told a name is free.

A suffix (`-2`) was not used: a package names its own further legs that way, and a reference made
here must never take the name a client is about to ask for.

A reference the client supplies is never changed. If it is taken, the insert fails as it always
did and the route answers 409.
"""
from __future__ import annotations

import random
import time
from typing import Callable, Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

UNIQUE = "uq_trades_user_ref"
IN_A_ROW = 8          # the numbers after the clock's, tried in order
ATTEMPTS = 32         # then random ones; 10^8 names, so a second draw is already rare


def generated_ref(n: int) -> str:
    return f"TRD-{n % 10**8:08d}"


def is_ref_collision(e: IntegrityError) -> bool:
    """The (user_id, trade_ref) uniqueness, by the driver's constraint name or, failing that, its message."""
    orig = getattr(e, "orig", None)
    if getattr(getattr(orig, "diag", None), "constraint_name", None) == UNIQUE:
        return True
    return UNIQUE in str(orig if orig is not None else e)


def _candidates():
    base = int(time.time())
    for k in range(IN_A_ROW):
        yield generated_ref(base + k)
    for _ in range(ATTEMPTS - IN_A_ROW):
        yield generated_ref(random.randrange(10**8))


# ── A package: one trade ID, and a leg ID under it for each leg ──────────────────────────────────
# A package of legs (a strip, a collar) is one trade to the desk: it has a trade ID of the usual shape,
# `TRD-12345678`, and each leg, a trade row of its own, is `TRD-12345678-1`, `-2`, ... . No row carries the bare
# ID, so the name is taken by a look, inside the booking's transaction, that nothing of this user's is called it
# or starts with it; the legs' own uniqueness then holds it. The clock proposes here too, half the number space
# away from the single trades of the same second, so a trade and a package booked together do not reach for one
# name; and a single trade is never given a name a package's legs already stand under (package_holds).
PACKAGE_OFFSET = 50_000_000


def package_candidates():
    base = int(time.time()) + PACKAGE_OFFSET
    for k in range(IN_A_ROW):
        yield generated_ref(base + k)
    for _ in range(ATTEMPTS - IN_A_ROW):
        yield generated_ref(random.randrange(10**8))


def leg_ref(trade_id: str, i: int) -> str:
    return f"{trade_id}-{i}"


def package_holds(db: Session, user_id, ref: str) -> bool:
    """A package of this user's has legs under `ref` (TRD-12345678-1, ...)."""
    from sqlalchemy import text
    return db.execute(text("SELECT 1 FROM trades WHERE user_id = :u AND trade_ref LIKE :p LIMIT 1"),
                      {"u": str(user_id), "p": ref + "-%"}).first() is not None


def free_package_id(db: Session, user_id) -> str:
    """A trade ID no trade of this user's has and none starts with."""
    from sqlalchemy import text
    for ref in package_candidates():
        taken = db.execute(text("SELECT 1 FROM trades WHERE user_id = :u AND (trade_ref = :r OR trade_ref LIKE :p) LIMIT 1"),
                           {"u": str(user_id), "r": ref, "p": ref + "-%"}).first()
        if taken is None:
            return ref
    raise HTTPException(status_code=503, detail="No free trade ID was found for the package; book again.")


def insert_trade(db: Session, row: Callable[[str], object], supplied: Optional[str]):
    """Add and flush the trade row `row(trade_ref)` builds; returns it, with the reference it was given.

    supplied: the client's own reference, used as it is (a duplicate raises IntegrityError to the caller).
    Otherwise a generated one, retried on a collision; the savepoint keeps whatever the caller's
    transaction already holds, so this is safe inside a larger unit of work (commit=False bookings).
    """
    if supplied:
        trade = row(supplied)
        db.add(trade)
        db.flush()
        return trade
    for ref in _candidates():
        trade = row(ref)
        if package_holds(db, getattr(trade, "user_id", None), ref):
            continue                    # a package's trade ID: its legs stand under this name
        try:
            with db.begin_nested():
                db.add(trade)
                db.flush()
            return trade
        except IntegrityError as e:
            if not is_ref_collision(e):
                raise
    raise HTTPException(status_code=503, detail="No free trade reference was found; book again, or give the trade a reference of its own.")
