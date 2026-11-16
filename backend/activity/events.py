"""Which things an account does are recorded, and from where.

Two sources, both a fixed list; nothing a user typed and nothing of a request's content is ever stored.

From the browser (POST /api/me/activity, signed in), because only the browser knows that a person did it:
    view     a page was opened: the detail is the page's family, from PAGES, never the address itself
    priced   PRICE was pressed in a trade window: the detail is the ticket's asset class, from ASSETS
A request the app makes by itself (the blotter's refresh every minute, the chat's every four seconds, the home page
reading the risk report) is none of these, so a tab left open is not an active account, and the home page is not
the Risk page.

From the API itself (activity/recorder.py, after a request was answered below 400), for what is deliberate and
plain from the route alone: a write, a run, a signature. RULES is by method and path, first match wins; the detail
is a literal word of the list. Not its body, not its query, not an id in its path is read.

    classify(method, path)   -> (event, detail) or None
    page(route)              -> the family of a page's address, or None for an address that is no page of the app
    told(event, detail, route) -> (event, detail) for what the browser may say, or None
    KINDS                    every event either source can give
"""
from __future__ import annotations

import re
from typing import Optional

# (methods, pattern, event, detail)
_RULES: list[tuple[frozenset[str], re.Pattern, str, str]] = [(frozenset(m.split("|")), re.compile(p), e, d) for m, p, e, d in [
    # a scheduler's own call is nobody's activity
    ("GET|POST|PUT|PATCH|DELETE", r"^/api/[a-z-]+(/[a-z-]+)*/tick$", "", ""),
    # what a trade costs (a scenario is not here: the scenario tab asks the engine by itself when it is opened and
    # whenever the ticket changes, so its route says nothing of a person)
    ("POST", r"^/api/xva/incremental$", "xva", "incremental"),
    ("POST", r"^/api/xva/currency(-option|-package)?$", "xva", "fx or crypto"),
    ("POST", r"^/api/xva/(simulate|calibrate)$", "xva", "rates"),
    # a trade's life
    ("POST", r"^/api/book/(trade|package)$", "booked", ""),
    ("POST", r"^/api/chain/(confirm/[^/]+|confirm-package|countersign/[^/]+)$", "confirmed", ""),
    ("POST", r"^/api/trade-events/confirm/[^/]+$", "confirmed", "off-chain"),
    ("POST", r"^/api/chain/(amend|partial-terminate|terminate)/[^/]+$", "lifecycle", ""),
    ("POST", r"^/api/chain/verify/[^/]+$", "verified", ""),
    # the control functions' own acts
    ("POST", r"^/api/ipv/(run|inputs/approve|inputs/waive|apply|signoff|tolerances|independent)$", "ipv", ""),
    ("POST", r"^/api/pnl/(eod|signoff)$", "pnl", "run or sign-off"),
    ("POST", r"^/api/risk/limits$", "risk", "limits saved"),
    ("POST", r"^/api/ccr/run$", "risk", "counterparty run"),
    # the desk's own inputs, saved
    ("POST|PUT|PATCH|DELETE", r"^/api/collateral(/|$)", "saved", "collateral"),
    ("POST|PUT|PATCH|DELETE", r"^/api/(market-data|bloomberg)(/|$)", "saved", "market data"),
    ("POST|PUT|PATCH|DELETE", r"^/api/currency/(forward-curve|vol-surface|forward-mode|spot|fixings|flat)(/|$)", "saved", "market data"),
    ("POST|PUT|PATCH|DELETE", r"^/api/crypto/(spot|funding)(/|$)", "saved", "market data"),
    ("POST|PUT|PATCH|DELETE", r"^/api/(counterparties|legal-entities)(/|$)", "saved", "counterparties and entities"),
    # talking: to the assistant, to another desk
    ("POST", r"^/api/(prometheus|analyse)(/|$)", "assistant", ""),
    ("POST", r"^/api/chat/rooms/[^/]+/messages$", "chat", "message"),
    ("POST", r"^/api/chat/(rooms/[^/]+/trades|trades/[^/]+/send)$", "chat", "trade card"),
]]

# a page's family, by the start of its address in the app (longest first)
PAGES: tuple[tuple[str, str], ...] = (
    ("/configurations/market-data", "market data"), ("/configurations/system", "system"), ("/configurations", "configurations"),
    ("/command-center", "home"), ("/blotter", "blotter"), ("/news", "news"),
    ("/pnl/xva", "xva reserves"), ("/pnl/ipv", "ipv"), ("/pnl", "p&l"),
    ("/risk/ccr", "counterparty risk"), ("/risk/capital", "capital"), ("/risk/collateral", "collateral"), ("/risk", "market risk"),
    ("/methodology", "methodology"), ("/roadmap", "roadmap"), ("/messenger", "messenger"), ("/ticket", "ticket"),
)
ASSETS: tuple[str, ...] = ("rates", "fx", "crypto")

VIEW, PRICED = "view", "priced"
KINDS: tuple[str, ...] = (VIEW, PRICED, "xva", "booked", "confirmed", "lifecycle", "verified", "ipv", "pnl", "risk",
                          "saved", "assistant", "chat")


def classify(method: str, path: str) -> Optional[tuple[str, str]]:
    """What an answered request is, from its route alone; None when it is nothing deliberate."""
    m = (method or "").upper()
    for methods, pattern, event, detail in _RULES:
        if m in methods and pattern.search(path or ""):
            return (event, detail) if event else None
    return None


def page(route: str) -> Optional[str]:
    r = "/" + str(route or "").split("?")[0].split("#")[0].strip().lstrip("/")
    for start, family in PAGES:
        if r == start or r.startswith(start + "/"):
            return family
    return None


def told(event: str, detail: str = "", route: str = "") -> Optional[tuple[str, str]]:
    """What the browser may say, reduced to the list's own words; anything else is None and is not kept."""
    if event == VIEW:
        family = page(route)
        return (VIEW, family) if family else None
    if event == PRICED:
        asset = str(detail or "").strip().lower()
        return (PRICED, asset) if asset in ASSETS else None
    return None


def rules() -> list[tuple[frozenset[str], str, str, str]]:
    return [(m, p.pattern, e, d) for m, p, e, d in _RULES]
