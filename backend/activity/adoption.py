"""The figures of the operator's Adoption view: who came, who came back, what they used.

Pure: `summarise()` takes the accounts, the activity counters and the trading tables' own counts and returns the
view's body. Bookings and confirmations are read from the trading tables themselves (they go back to the first
trade); every other kind of activity exists only from the day the activity table was applied, which the body says
as `tracking_since`.

An account is active on a day when it has any counter that day (it was seen, or it booked or confirmed a trade).
Weeks start on Monday (UTC). The platform's own admins and test accounts are not accounts here: the caller leaves
them out.

    weeks      the last 8 weeks: accounts created, accounts active, and of those the ones created in an earlier week
    funnel     of all accounts: seen again after the day they were created, priced, booked, ran XVA, confirmed
    first_trade_hours   the median time from an account's creation to its first booked trade
    cohorts    by the week an account was created (last 6): how many were active one, two and three weeks later
    features   the last 28 days by kind and detail: accounts and times
    rows       each account: created, last active, days active in 28, and its counts of the four steps
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any, Iterable, Optional

WEEKS = 8
COHORTS = 6
FEATURE_DAYS = 28
ROWS_MAX = 200
STEPS = ("returned", "priced", "booked", "xva", "confirmed")
FROM_TABLES = ("booked", "confirmed")          # read from trades and trade_events, never from the counters


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _day(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return (v.astimezone(timezone.utc) if v.tzinfo else v).date()
    return v if isinstance(v, date) else None


def summarise(accounts: Iterable[dict], activity: Iterable[dict], booked: Iterable[dict], confirmed: Iterable[dict],
              today: date, tracking_since: Optional[date] = None, recording: bool = False) -> dict:
    accounts = [a for a in accounts if a.get("id")]
    ids = {str(a["id"]) for a in accounts}
    created = {str(a["id"]): _day(a.get("created_at")) for a in accounts}

    # one list of (account, day, event, detail, n, first_at)
    days: list[tuple[str, date, str, str, int, Any]] = []
    for r in activity:
        if str(r["user_id"]) in ids and r["event"] not in FROM_TABLES:
            days.append((str(r["user_id"]), r["day"], r["event"], r.get("detail") or "", int(r.get("n") or 0), r.get("first_at")))
    for event, rows in (("booked", booked), ("confirmed", confirmed)):
        for r in rows:
            if str(r["user_id"]) in ids:
                days.append((str(r["user_id"]), r["day"], event, "", int(r.get("n") or 0), r.get("first_at")))

    active_days: dict[str, set[date]] = {}
    for u, d, *_ in days:
        active_days.setdefault(u, set()).add(d)

    # weeks
    this = monday(today)
    weeks = []
    for i in range(WEEKS - 1, -1, -1):
        start = this - timedelta(weeks=i); end = start + timedelta(days=7)
        active = {u for u, ds in active_days.items() if any(start <= d < end for d in ds)}
        new = {u for u, c in created.items() if c and start <= c < end}
        weeks.append({"week": start.isoformat(), "created": len(new), "active": len(active),
                      "returning": len({u for u in active if created.get(u) and created[u] < start})})

    # funnel: distinct accounts that ever did each step
    did: dict[str, set[str]] = {s: set() for s in STEPS}
    first_booked: dict[str, Any] = {}
    for u, d, event, _detail, _n, first_at in days:
        if event in did:
            did[event].add(u)
        if created.get(u) and d > created[u]:
            did["returned"].add(u)
        if event == "booked" and first_at is not None and (u not in first_booked or first_at < first_booked[u]):
            first_booked[u] = first_at
    total = len(accounts)
    funnel = [{"step": "created", "accounts": total, "share": 1.0 if total else None}] + [
        {"step": s, "accounts": len(did[s]), "share": (len(did[s]) / total) if total else None} for s in STEPS]

    hours = []
    by_id = {str(a["id"]): a for a in accounts}
    for u, at in first_booked.items():
        c = by_id[u].get("created_at")
        if isinstance(c, datetime) and isinstance(at, datetime):
            h = (at - c).total_seconds() / 3600.0
            if h >= 0:
                hours.append(h)
    first_trade = {"accounts": len(hours), "median_hours": round(median(hours), 2) if hours else None}

    # cohorts by the week of creation
    cohorts = []
    for i in range(COHORTS - 1, -1, -1):
        start = this - timedelta(weeks=i); end = start + timedelta(days=7)
        members = [u for u, c in created.items() if c and start <= c < end]
        after = []
        for k in (1, 2, 3):
            ws = start + timedelta(weeks=k); we = ws + timedelta(days=7)
            if ws > today:                                   # that week has not begun
                after.append(None); continue
            after.append(sum(1 for u in members if any(ws <= d < we for d in active_days.get(u, ()))))
        cohorts.append({"week": start.isoformat(), "accounts": len(members), "active_after": after})

    # features, last 28 days
    since = today - timedelta(days=FEATURE_DAYS - 1)
    feats: dict[tuple[str, str], dict] = {}
    for u, d, event, detail, n, _ in days:
        if d >= since and event != "seen":
            f = feats.setdefault((event, detail), {"event": event, "detail": detail, "users": set(), "n": 0})
            f["users"].add(u); f["n"] += n
    features = sorted(({"event": f["event"], "detail": f["detail"], "accounts": len(f["users"]), "times": f["n"]} for f in feats.values()),
                      key=lambda f: (-f["accounts"], -f["times"], f["event"], f["detail"]))

    # accounts
    rows = []
    for a in accounts:
        u = str(a["id"]); ds = active_days.get(u, set())
        count = {s: 0 for s in ("priced", "booked", "xva", "confirmed")}
        for uu, _d, event, _detail, n, _ in days:
            if uu == u and event in count:
                count[event] += n
        rows.append({"email": a.get("email") or "", "firm": a.get("firm") or "", "created": created[u].isoformat() if created[u] else None,
                     "last_active": max(ds).isoformat() if ds else None, "days_active": sum(1 for d in ds if d >= since), **count})
    rows.sort(key=lambda r: (r["last_active"] or "", r["created"] or ""), reverse=True)

    return {"today": today.isoformat(), "recording": bool(recording), "tracking_since": tracking_since.isoformat() if tracking_since else None,
            "accounts": total, "weeks": weeks, "funnel": funnel, "first_trade": first_trade, "cohorts": cohorts,
            "features": features, "feature_days": FEATURE_DAYS, "rows": rows[:ROWS_MAX], "rows_total": len(rows)}
