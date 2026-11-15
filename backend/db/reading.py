"""One reading of what does not change while a report is made.

A report (market risk, P&L, counterparty credit) values each trade many times: once for every bump of the ladder,
every day of a full-revaluation VaR, every path date. What the pricer reads from the database for a valuation (a
firm's cap surface for the date, a swaption's legs) is the same each time, and was asked for each time: a live
risk report on the integration book sent 233 statements, 129 of them the cap surface and 57 a trade's legs.

Inside `one_reading()` such a read is made once and kept until the block ends. Outside it nothing is kept, so a
price asked for from the ticket reads the surface as it stands. The memo lives in a context variable: a request
or a batch in its own thread has its own, and it is gone when the report returns.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Callable, Hashable, Iterator, Optional

_MEMO: ContextVar[Optional[dict]] = ContextVar("rijeka_one_reading", default=None)


@contextmanager
def one_reading() -> Iterator[None]:
    """Reads made through `read_once` inside this block are made once. Nested blocks share the outer one's."""
    if _MEMO.get() is not None:
        yield
        return
    token = _MEMO.set({})
    try:
        yield
    finally:
        _MEMO.reset(token)


def read_once(key: Hashable, load: Callable[[], Any]) -> Any:
    """`load()`, or what it gave the first time it was asked for `key` inside the present `one_reading()`. The
    caller copies what it is given before changing it."""
    memo = _MEMO.get()
    if memo is None:
        return load()
    if key not in memo:
        memo[key] = load()
    return memo[key]
