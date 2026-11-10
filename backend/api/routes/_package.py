"""A package of legs: what it may be, how large, and the tag that ties a leg to it.

One definition for the booking route (which writes the tag), the confirmation route (which reads it), the
XVA route (which runs a package of bodies) and the trade routes (which must not let a client write one).
The browser reads the same tag (frontend/src/components/trade-window/fx-legs.js readPackageTag, and its
PACKAGE_STRUCTURES): tests/test_package_tag.py holds the two to each other.

The tag lives in the trade's `strategy`, the booking firm's own field, never shown to the counterparty:

    <STRUCTURE> <TRADE ID> <i>/<n>          STRIP TRD-12345678 2/3

Only the server writes a tag with a trade ID of that shape (POST /api/book/package). A client may not: the
ordinary booking and edit routes refuse a `strategy` that reads as one, so a package is the set of legs
that were booked together and nothing else. The ticket's older tag (a PKG- reference the browser made, one
request per leg) is still shown as a grouping in the blotter; it is not a package the server booked and is
not confirmed as one.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException

PACKAGE_STRUCTURES = ("STRIP", "COLLAR", "RISK REVERSAL", "STRADDLE", "CALENDAR", "CUSTOM")
PACKAGE_MAX_LEGS = 24
_TAG = re.compile(r"^([A-Z][A-Z ]*?) (TRD-\d{8}) (\d{1,3})/(\d{1,3})$")


def package_tag(structure: str, trade_id: str, i: int, n: int) -> str:
    return f"{structure} {trade_id} {i}/{n}"


def read_package_tag(strategy) -> Optional[tuple]:
    """(structure, the package's trade ID, the leg's place, the number of legs), or None for any other text."""
    m = _TAG.match(str(strategy or ""))
    if not m or m.group(1) not in PACKAGE_STRUCTURES:
        return None
    i, n = int(m.group(3)), int(m.group(4))
    return (m.group(1), m.group(2), i, n) if 1 <= i <= n <= PACKAGE_MAX_LEGS else None


def refuse_client_tag(strategy, was=None) -> None:
    """422 when a client sets, changes or removes a package tag: only POST /api/book/package writes one."""
    if read_package_tag(strategy) is not None and strategy != was:
        raise HTTPException(status_code=422, detail="strategy: this text is a package's tag, which only booking a package writes. Book the legs together (POST /api/book/package).")
    if read_package_tag(was) is not None and strategy != was:
        raise HTTPException(status_code=422, detail="strategy: this trade is a leg of a package and its tag is not edited.")
