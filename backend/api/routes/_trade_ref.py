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
        try:
            with db.begin_nested():
                db.add(trade)
                db.flush()
            return trade
        except IntegrityError as e:
            if not is_ref_collision(e):
                raise
    raise HTTPException(status_code=503, detail="No free trade reference was found; book again, or give the trade a reference of its own.")
