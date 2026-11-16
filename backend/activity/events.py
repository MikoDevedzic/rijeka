"""Which signed-in requests count as which kind of activity.

A request that was answered (below 400) for a verified account is always `seen`; when its method and path are on
the list below it is also one kind of activity, with a detail from a fixed list of words. Nothing of the request's
content is read: not its body, not its query, not an id in its path.

The list is by path family, in the order it is tried; the first match wins. A scheduler's own calls (`/tick`) and
the operator's and the public routes are no account's activity, not even `seen`. A signed-in request that is on no
line (the app reading the account's own settings, the blotter) is `seen` and nothing more.

    classify(method, path)   -> (event, detail) or None
    KINDS                    every event the list can give, for the read-out's order and its words
"""
from __future__ import annotations

import re
from typing import Optional

SEEN = "seen"

# (methods, pattern, event, detail)
_RULES: list[tuple[frozenset[str], re.Pattern, str, str]] = [(frozenset(m.split("|")), re.compile(p), e, d) for m, p, e, d in [
    # never an account's activity
    ("GET|POST|PUT|PATCH|DELETE", r"^/api/(ops|public)(/|$)", "", ""),
    ("GET|POST|PUT|PATCH|DELETE", r"/tick$", "", ""),
    # a price
    ("POST", r"^/price(/preview)?$", "priced", "rates"),
    ("POST", r"^/api/price(/|$)", "priced", "rates"),
    ("POST", r"^/api/currency/option/(scenario|ladder)$", "scenario", "option"),
    ("POST", r"^/api/currency/(forward|option)/price$", "priced", "currency"),
    ("POST", r"^/api/crypto/forward/price$", "priced", "crypto"),
    # what a trade costs
    ("POST", r"^/api/xva/incremental$", "xva", "incremental"),
    ("POST", r"^/api/xva/currency(-option|-package)?$", "xva", "currency"),
    ("POST", r"^/api/xva/(simulate|calibrate)$", "xva", "rates"),
    ("POST", r"^/api/capital(/|$)", "capital", ""),
    # a trade's life
    ("POST", r"^/api/book/(trade|package)$", "booked", ""),
    ("POST", r"^/api/chain/(confirm/[^/]+|confirm-package|countersign/[^/]+)$", "confirmed", ""),
    ("POST", r"^/api/trade-events/confirm/[^/]+$", "confirmed", "off-chain"),
    ("POST", r"^/api/chain/(amend|partial-terminate|terminate)/[^/]+$", "lifecycle", ""),
    ("POST", r"^/api/chain/verify/[^/]+$", "verified", ""),
    # the book's views (opening the page reads them)
    ("GET|POST", r"^/api/risk(/|$)", "risk", "market"),
    ("GET|POST", r"^/api/ccr(/|$)", "risk", "counterparty"),
    ("GET|POST", r"^/api/pnl(/|$)", "pnl", ""),
    ("GET|POST", r"^/api/ipv(/|$)", "ipv", ""),
    ("GET|POST|PUT|DELETE", r"^/api/collateral(/|$)", "collateral", ""),
    ("GET", r"^/api/cashflows(/|$)", "cashflows", ""),
    # the desk's own inputs
    ("POST|PUT|PATCH|DELETE", r"^/api/(market-data|bloomberg)(/|$)", "market_data", ""),
    ("POST|PUT|PATCH|DELETE", r"^/api/currency/(forward-curve|vol-surface|forward-mode|spot|fixings|flat)(/|$)", "market_data", "currency"),
    ("POST|PUT|PATCH|DELETE", r"^/api/crypto/(spot|funding)(/|$)", "market_data", "crypto"),
    ("POST|PUT|PATCH|DELETE", r"^/api/(counterparties|legal-entities)(/|$)", "static_data", ""),
    # talking: to the assistant, to another desk
    ("POST", r"^/api/(prometheus|analyse)(/|$)", "assistant", ""),
    ("POST", r"^/api/chat/rooms/[^/]+/messages$", "chat", "message"),
    ("POST", r"^/api/chat/(rooms/[^/]+/trades|trades/[^/]+/send)$", "chat", "trade card"),
    # reading how a number is made
    ("GET", r"^/api/methodology(/|$)", "methodology", ""),
]]

KINDS: tuple[str, ...] = (SEEN, "priced", "scenario", "xva", "capital", "booked", "confirmed", "lifecycle", "verified", "risk", "pnl", "ipv",
                          "collateral", "cashflows", "market_data", "static_data", "assistant", "chat", "methodology")


def classify(method: str, path: str) -> Optional[tuple[str, str]]:
    """The kind of activity a request is, or None when it is only `seen` (or nobody's)."""
    m = (method or "").upper()
    for methods, pattern, event, detail in _RULES:
        if m in methods and pattern.search(path or ""):
            return (event, detail) if event else None
    return None


def counts(method: str, path: str) -> bool:
    """False for the routes that are no account's activity at all, not even `seen`."""
    m = (method or "").upper()
    for methods, pattern, event, _ in _RULES:
        if m in methods and pattern.search(path or ""):
            return bool(event)
    return True


def rules() -> list[tuple[frozenset[str], str, str, str]]:
    return [(m, p.pattern, e, d) for m, p, e, d in _RULES]
