"""The figures of the operator's Adoption view: who came, who used it, who came back, what they used.

Pure: `summarise()` takes the accounts, the activity counters and the trading tables' own counts and returns the
view's body. What each word means, so that no figure says more than was recorded:

    active on a day   the account did something deliberate that day: opened a page, pressed PRICE, ran, saved, sent,
                      booked or confirmed. A request the app makes by itself is not recorded (activity/events.py), so
                      a tab left open is not an active account.
    used it           the account has ever been active.
    came back         it was active a day (24 hours) or more after the first time it was active. Not "on a later
                      calendar day": an evening that crosses midnight UTC is one visit.
    priced, ran XVA   it ever did, on any day since the activity table was applied (read from the whole record,
                      never from a window of days).
    booked, confirmed read from the trading tables themselves, so they go back to the first trade.

Weeks start on Monday (UTC). The platform's own admins and test accounts are not accounts here: the caller leaves
them out.

    funnel       of all accounts: used it, came back, priced, booked, ran XVA, confirmed
    first_trade  the median time from an account's creation to its first booked trade
    weeks        the last 8: accounts created, accounts active, and of those the ones first active in an earlier week
    cohorts      by the week an account was created (last 6): how many were active one, two and three weeks later
    features     the last 28 days by kind and detail: accounts, and the days on which (a day counts once per account:
                 how many times within a day is not a figure, since one press can be several requests)
    rows         each account: created, first and last active, days active in 28, days it priced and ran XVA,
                 trades it booked and confirmed
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any, Iterable, Optional

WEEKS = 8
COHORTS = 6
FEATURE_DAYS = 28
ROWS_MAX = 200
CAME_BACK_AFTER = timedelta(hours=24)
STEPS = ("used", "returned", "priced", "booked", "xva", "confirmed")
FROM_TABLES = ("booked", "confirmed")          # read from trades and trade_events, never from the counters


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _utc(v: Any) -> Optional[datetime]:
    if not isinstance(v, datetime):
        return None
    return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)


def _day(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return _utc(v).date()
    return v if isinstance(v, date) else None


class _Account:
    __slots__ = ("days", "first", "last", "ever", "booked", "confirmed", "first_booked", "recent")

    def __init__(self):
        self.days: set[date] = set()            # every day it was active
        self.first: Optional[datetime] = None   # the first and the last moment it was active
        self.last: Optional[datetime] = None
        self.ever: dict[str, int] = {}          # kind -> days it ever happened on
        self.booked = 0; self.confirmed = 0     # trades, from the tables
        self.first_booked: Optional[datetime] = None
        self.recent: list[tuple[date, str, str]] = []   # (day, event, detail) in the features' window

    def moment(self, first: Any, last: Any) -> None:
        f, l = _utc(first), _utc(last) or _utc(first)
        if f and (self.first is None or f < self.first):
            self.first = f
        if l and (self.last is None or l > self.last):
            self.last = l


def summarise(accounts: Iterable[dict], activity: Iterable[dict], ever: Iterable[dict], booked: Iterable[dict], confirmed: Iterable[dict],
              today: date, tracking_since: Optional[date] = None, recording: bool = False) -> dict:
    accounts = [a for a in accounts if a.get("id")]
    created = {str(a["id"]): _day(a.get("created_at")) for a in accounts}
    acct: dict[str, _Account] = {u: _Account() for u in created}
    since = today - timedelta(days=FEATURE_DAYS - 1)

    for r in activity:                                           # the window of days: weeks, cohorts, features
        a = acct.get(str(r["user_id"]))
        if a is None or r["event"] in FROM_TABLES:
            continue
        a.days.add(r["day"])
        if r["day"] >= since:
            a.recent.append((r["day"], r["event"], r.get("detail") or ""))
    for r in ever:                                               # the whole record: ever, first, last
        a = acct.get(str(r["user_id"]))
        if a is None or r["event"] in FROM_TABLES:
            continue
        a.ever[r["event"]] = a.ever.get(r["event"], 0) + int(r.get("days") or 0)
        a.moment(r.get("first_at"), r.get("last_at"))
    for event, rows in (("booked", booked), ("confirmed", confirmed)):
        for r in rows:
            a = acct.get(str(r["user_id"]))
            if a is None:
                continue
            a.days.add(r["day"])
            a.moment(r.get("first_at"), r.get("last_at"))
            n = int(r.get("n") or 0)
            if event == "booked":
                a.booked += n
                f = _utc(r.get("first_at"))
                if f and (a.first_booked is None or f < a.first_booked):
                    a.first_booked = f
            else:
                a.confirmed += n
            if r["day"] >= since:
                a.recent.append((r["day"], event, ""))

    first_day = {u: (a.first.date() if a.first else (min(a.days) if a.days else None)) for u, a in acct.items()}

    # the funnel: distinct accounts that ever did each thing
    did = {
        "used": {u for u, a in acct.items() if a.days or a.first},
        "returned": {u for u, a in acct.items() if a.first and a.last and a.last - a.first >= CAME_BACK_AFTER},
        "priced": {u for u, a in acct.items() if a.ever.get("priced")},
        "booked": {u for u, a in acct.items() if a.booked},
        "xva": {u for u, a in acct.items() if a.ever.get("xva")},
        "confirmed": {u for u, a in acct.items() if a.confirmed},
    }
    total = len(accounts)
    funnel = [{"step": "created", "accounts": total, "share": 1.0 if total else None}] + [
        {"step": s, "accounts": len(did[s]), "share": (len(did[s]) / total) if total else None} for s in STEPS]

    hours = []
    for a0 in accounts:
        c, f = _utc(a0.get("created_at")), acct[str(a0["id"])].first_booked
        if c and f and f >= c:
            hours.append((f - c).total_seconds() / 3600.0)
    first_trade = {"accounts": len(hours), "median_hours": round(median(hours), 2) if hours else None}

    # weeks and cohorts
    this = monday(today)

    def active_in(u: str, start: date, end: date) -> bool:
        return any(start <= d < end for d in acct[u].days)

    weeks = []
    for i in range(WEEKS - 1, -1, -1):
        start = this - timedelta(weeks=i); end = start + timedelta(days=7)
        active = [u for u in acct if active_in(u, start, end)]
        weeks.append({"week": start.isoformat(), "created": sum(1 for c in created.values() if c and start <= c < end), "active": len(active),
                      "returning": sum(1 for u in active if first_day[u] and first_day[u] < start)})
    cohorts = []
    for i in range(COHORTS - 1, -1, -1):
        start = this - timedelta(weeks=i); end = start + timedelta(days=7)
        members = [u for u, c in created.items() if c and start <= c < end]
        after = []
        for k in (1, 2, 3):
            ws = start + timedelta(weeks=k)
            after.append(None if ws > today else sum(1 for u in members if active_in(u, ws, ws + timedelta(days=7))))
        cohorts.append({"week": start.isoformat(), "accounts": len(members), "active_after": after})

    # what was used, last 28 days: accounts, and account-days
    feats: dict[tuple[str, str], dict] = {}
    for u, a in acct.items():
        for d, event, detail in a.recent:
            f = feats.setdefault((event, detail), {"users": set(), "days": set()})
            f["users"].add(u); f["days"].add((u, d))
    features = sorted(({"event": e, "detail": d, "accounts": len(f["users"]), "days": len(f["days"])} for (e, d), f in feats.items()),
                      key=lambda f: (-f["accounts"], -f["days"], f["event"], f["detail"]))

    rows = []
    for a0 in accounts:
        u = str(a0["id"]); a = acct[u]
        rows.append({"email": a0.get("email") or "", "firm": a0.get("firm") or "", "created": created[u].isoformat() if created[u] else None,
                     "first_active": first_day[u].isoformat() if first_day[u] else None,
                     "last_active": (a.last.date() if a.last else max(a.days)).isoformat() if (a.last or a.days) else None,
                     "days_active": sum(1 for d in a.days if d >= since),
                     "priced_days": a.ever.get("priced", 0), "booked": a.booked, "xva_days": a.ever.get("xva", 0), "confirmed": a.confirmed})
    rows.sort(key=lambda r: (r["last_active"] or "", r["created"] or ""), reverse=True)

    return {"today": today.isoformat(), "recording": bool(recording), "tracking_since": tracking_since.isoformat() if tracking_since else None,
            "accounts": total, "funnel": funnel, "first_trade": first_trade, "weeks": weeks, "cohorts": cohorts,
            "features": features, "feature_days": FEATURE_DAYS, "rows": rows[:ROWS_MAX], "rows_total": len(rows)}
