"""What the operator is told, and when.

A problem a person hit is of no use on a page nobody is looking at. Each pass of the scheduler (a minute) this step,
under a lock so that two instances of the API never both run it:

  1. takes the problems not yet looked at (health_events.alerted_at is null), what the API saw for itself first;
  2. keeps for a message only those worth one now (`rings`):
       - a request the API failed with a 5xx other than 501 ("not supported" is an answer, not a fault);
       - a slow answer;
       - what a signed-in account's browser reported, judged by the signed-in reports alone: unless they all say
         the browser could not reach the API (source `net-`), which is one person's connection, until NET_ACCOUNTS
         accounts say it at once, which is the API being away.
     A report from a browser that is not signed in can be sent by anyone, as often as they like, saying anything,
     under any label: it is kept, shown on the SYSTEM page and counted in the day's summary; it never rings by
     itself, never lends its label to a fault, and never counts as the operator having been told;
  3. leaves out any fault the operator WAS told of in the last SAME_AGAIN_H hours;
  4. tells the operator of the rest in ONE message, at most MAX_LINES lines, what the API saw for itself first. The
     API's own faults and browsers' reports each have an hourly budget of messages (PER_HOUR, BROWSER_PER_HOUR), so
     that no account, by reporting, can use up the room a fault of the API's needs; what is over a budget waits,
     unmarked, and rings when its hour has room;
  5. marks a fault as told only when the message reached somebody: a support room or a mailbox, in the transaction
     that posts the message. When it reached nobody the fault stays unmarked and the pass fails with `NobodyToTell`;
  6. once a day, after DIGEST_HOUR_UTC, sends the summary of the last 24 hours (also when there was nothing: silence
     must mean "nothing went wrong", not "the alarm is off"); the day is marked done only when the summary reached
     somebody; then deletes rows older than the store keeps.

A pass that fails, for any reason, raises: the scheduler records the step as failed on GET /api/ops/health, the watch
fails on it, and the next pass tries again. Nothing is half done: one transaction, rolled back whole. The one thing
a rollback cannot undo is a mail already sent, which is then sent again by the pass that succeeds.

Telling is two things, both without a name in them (who was affected is on the SYSTEM page, which needs the admin
role; a message may be mirrored or mailed outside the platform):
  - a SYSTEM message from "Rijeka health" in the support room of every account with the admin role (an admin has
    one once they have opened the messenger), where the messenger's own alert (badge, chime, desktop notification)
    does the rest;
  - an e-mail through Resend's HTTP API when RESEND_API_KEY and RIJEKA_ALERT_EMAIL_TO are both set.

A browser's words are text from outside. In a message they are `said()`: one line, letters, digits and plain
punctuation only, every address replaced by the words "an address" and no dot left between two words, so that
nothing a stranger sends can become a link, a picture or formatting in the operator's messenger or mail.

The texts are pure functions.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text

from health import store

log = logging.getLogger("rijeka.health")

SAME_AGAIN_H = 6
MAX_LINES = 8
PER_HOUR = 6                          # messages an hour for what the API saw for itself
BROWSER_PER_HOUR = 2                  # and for what browsers reported, in a budget of their own
NET_ACCOUNTS = 3                      # accounts that cannot reach the API at once: that is not their connections
GIVE_UP_H = 24                        # a fault nobody could be told of for this long is left to the page and the summary
DIGEST_HOUR_UTC = 13                  # the day's summary goes out at the first pass after this hour
LOCK = "rijeka_health_step"
SENDER = "Rijeka health"
WHERE = "Who was affected, and the details: Configurations → SYSTEM."
RESEND_URL = "https://api.resend.com/emails"


class NobodyToTell(Exception):
    """There was something to tell the operator, and no admin support room or mailbox to tell it to."""


# ── the words ────────────────────────────────────────────────────────────────
_ADDRESS = re.compile(r"(?:[a-z][a-z0-9+.-]*:)?//\S+|\bwww\.\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+", re.I)
_PLAIN = re.compile(r"[^A-Za-z0-9 .,:;'\"!?/%+=#&-]")
_DOTTED = re.compile(r"(?<=[A-Za-z0-9])\.(?=[A-Za-z])")
_METHOD = re.compile(r"[^A-Z]")


def said(message: Any, limit: int = 140) -> str:
    """A browser's words made safe to repeat: one line, no address, nothing a messenger or a mail would format or
    turn into a link (no dot is left between two words: a mail reader makes a link of `name.example/page`)."""
    t = _ADDRESS.sub(" an address ", " ".join(str(message or "").split()))
    t = re.sub(r" +([.,;:!?])", r"\1", " ".join(_PLAIN.sub(" ", t).split()))
    t = " ".join(_DOTTED.sub(" ", t).split())            # last: nothing after this can put two words and a dot back together
    return (t[:limit].rstrip() + ("…" if len(t) > limit else "")) or "an error"


def rings(g: dict) -> bool:
    """Whether a problem is worth a message now."""
    kind = g.get("kind")
    if kind == "slow":
        return True
    if kind == "api":
        status = int(g.get("status") or 0)
        return status >= 500 and status != 501
    # a browser's report: a signed-in account's only, and by what the signed-in reports say of themselves
    accounts = int(g.get("accounts") or 0)
    if not accounts:
        return False
    sources = g.get("signed_sources")
    if sources is None:                                  # a group made elsewhere than store.group: its one source
        sources = [str(g.get("source") or "")]
    if any(not str(x).startswith("net-") for x in sources):
        return True
    return accounts >= NET_ACCOUNTS                      # nobody reaches the API: not their connections


def _times(n: int) -> str:
    return "once" if n == 1 else "twice" if n == 2 else f"{n} times"


def _who(g: dict) -> str:
    n, anon = int(g.get("accounts") or 0), int(g.get("anonymous") or 0)
    if n and anon:
        return f"{n} account{'s' if n != 1 else ''} and visitors not signed in"
    if n:
        return f"{n} account{'s' if n != 1 else ''}"
    return "a visitor not signed in" if anon == 1 else "visitors not signed in"


def describe(g: dict) -> str:
    """One problem in one line, with no account named."""
    route = g.get("route") or "?"
    method = _METHOD.sub("", str(g.get("source") or "").upper())[:10] or "A request"
    if g["kind"] == "api":
        what = f"{method} {route} answered {int(g.get('status') or 0) or '5xx'}"
    elif g["kind"] == "slow":
        secs = round((g.get("slowest_ms") or 0) / 1000)
        what = f"{method} {route} took {secs} s"
    else:
        what = f"On {said(route, 60)}: {said(g.get('message'))}"
    return f"{what} · {_who(g)}, {_times(int(g.get('count') or 1))}"


def compose(groups: list[dict]) -> str:
    """The message for problems the operator has not been told of."""
    n = len(groups)
    head = "A problem on the desk" if n == 1 else f"{n} problems on the desk"
    lines = [f"- {describe(g)}" for g in groups[:MAX_LINES]]
    if n > MAX_LINES:
        lines.append(f"- and {n - MAX_LINES} more")
    return "\n".join([f"**{head}**", *lines, WHERE])


def digest(groups: list[dict], day: str) -> str:
    """The day's summary: also sent when there was nothing."""
    if not groups:
        return f"**The last 24 hours, to {day}**\nNo problem was reported by any browser, and the API answered no request with an error or too slowly."
    total = sum(int(g.get("count") or 0) for g in groups)
    lines = [f"- {describe(g)}" for g in groups[:MAX_LINES]]
    if len(groups) > MAX_LINES:
        lines.append(f"- and {len(groups) - MAX_LINES} more")
    return "\n".join([f"**The last 24 hours, to {day}: {len(groups)} problem{'s' if len(groups) != 1 else ''}, {total} occurrence{'s' if total != 1 else ''}**",
                      *lines, WHERE])


def plain(body: str) -> str:
    """The same text without the chat's marks, for a mail."""
    return body.replace("**", "")


# ── telling ──────────────────────────────────────────────────────────────────
def mail_settings() -> Optional[dict]:
    key, to = (os.getenv("RESEND_API_KEY") or "").strip(), (os.getenv("RIJEKA_ALERT_EMAIL_TO") or "").strip()
    if not key or not to:
        return None
    return {"key": key, "to": [a.strip() for a in to.split(",") if a.strip()],
            "sender": (os.getenv("RIJEKA_ALERT_EMAIL_FROM") or "Rijeka health <miko@rijeka.app>").strip()}


def send_mail(subject: str, body: str, post=None) -> bool:
    """One mail through Resend, when it is set up. False when it is not, or when it was refused; never raises."""
    cfg = mail_settings()
    if not cfg:
        return False
    try:
        if post is None:
            import httpx
            post = httpx.post
        r = post(RESEND_URL, headers={"Authorization": f"Bearer {cfg['key']}"}, timeout=10.0,
                 json={"from": cfg["sender"], "to": cfg["to"], "subject": subject, "text": plain(body)})
        ok = 200 <= int(getattr(r, "status_code", 500)) < 300
        if not ok:
            log.warning("health mail refused: HTTP %s", getattr(r, "status_code", "?"))
        return ok
    except Exception as e:                              # noqa: BLE001 — the class only: a message can carry the key's host
        log.warning("health mail not sent: %s", type(e).__name__)
        return False


def admin_rooms(db) -> list:
    """The support room of every account with the admin role that has one (it exists once the messenger was opened)."""
    from db.models import ChatRoom, ChatRoomMember
    admins = [r[0] for r in db.execute(text("SELECT id FROM profiles WHERE lower(role) = 'admin'")).all()]
    if not admins:
        return []
    rooms = (db.query(ChatRoom).join(ChatRoomMember, ChatRoomMember.room_id == ChatRoom.id)
               .filter(ChatRoom.kind == "SUPPORT", ChatRoomMember.user_id.in_(admins)).all())
    return list({r.id: r for r in rooms}.values())


def tell(db, subject: str, body: str) -> dict:
    """Post and mail. Nothing is committed here: the caller commits the message with the mark that it was sent, or
    neither. A message that could not be posted is undone by itself and reported as no room reached."""
    out = {"rooms": 0, "mailed": False}
    try:
        with db.begin_nested():
            from api.routes import chat
            rooms = admin_rooms(db)
            if rooms:
                platform = chat._platform(db)
                for room in rooms:
                    chat._post(db, room, kind="SYSTEM", name=SENDER, firm=platform, body=body)
            out["rooms"] = len(rooms)
    except Exception as e:                              # noqa: BLE001
        out["rooms"] = 0
        log.warning("health message not posted: %s", type(e).__name__)
    out["mailed"] = send_mail(subject, body)
    return out


def _reached(d: dict) -> bool:
    return bool(d.get("rooms")) or bool(d.get("mailed"))


# ── the step ─────────────────────────────────────────────────────────────────
KEYS = ("id", "at", "kind", "source", "route", "status", "ms", "message", "release", "user_id", "email", "fingerprint", "alerted_at")


def reachable(db) -> bool:
    """Whether a message would reach anybody at all."""
    return bool(mail_settings()) or bool(admin_rooms(db))


def _sent(db, now: datetime, browser: bool) -> int:
    """Messages in the last hour that told of the API's own faults, or of browsers' reports."""
    return int(db.execute(text("SELECT count(DISTINCT alerted_at) FROM health_events WHERE rang AND alerted_at >= :s AND (kind = 'browser') = :b"),
                          {"s": now - timedelta(hours=1), "b": browser}).scalar() or 0)


def step(db, now: Optional[datetime] = None, teller=tell) -> dict[str, Any]:
    """One pass. Returns what it did; raises when it could not do it (`NobodyToTell`, or whatever the database said),
    after rolling its transaction back, so that a pass that failed is never recorded as one that worked."""
    now = now or datetime.now(timezone.utc)
    if not store.table_present(db):
        return {"skipped": "the health table is not applied"}
    nobody = 0
    try:
        if not db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"), {"k": LOCK}).scalar():
            return {"skipped": "another instance of the API has the step"}
        mark = text("UPDATE health_events SET alerted_at = :n, rang = :r WHERE id = :id")
        # a fault the operator was told of lately: every new occurrence is looked at, however many there are
        db.execute(text("UPDATE health_events SET alerted_at = :n, rang = false WHERE alerted_at IS NULL AND kind <> 'digest' AND fingerprint IN "
                        "(SELECT DISTINCT fingerprint FROM health_events WHERE rang AND alerted_at >= :s)"),
                   {"n": now, "s": now - timedelta(hours=SAME_AGAIN_H)})
        # and one nobody could be told of for a day is left to the page and the summary, so that the queue stays short
        db.execute(text("UPDATE health_events SET alerted_at = :n, rang = false WHERE alerted_at IS NULL AND kind <> 'digest' AND at < :old"),
                   {"n": now, "old": now - timedelta(hours=GIVE_UP_H)})
        fresh = [dict(zip(KEYS, r)) for r in db.execute(text(
            "SELECT id, at, kind, source, route, status, ms, message, release, user_id, NULL AS email, fingerprint, alerted_at "
            "FROM health_events WHERE alerted_at IS NULL AND kind <> 'digest' ORDER BY (kind = 'browser'), at LIMIT 500")).all()]
        out: dict[str, Any] = {"new": len(fresh), "told": 0}
        if fresh:
            groups = [g for g in store.group(fresh) if rings(g)]
            for r in fresh:                             # what does not ring: looked at, and silences nothing
                if r["fingerprint"] not in {g["fingerprint"] for g in groups}:
                    db.execute(mark, {"n": now, "r": False, "id": r["id"]})
            room = {False: _sent(db, now, False) < PER_HOUR, True: _sent(db, now, True) < BROWSER_PER_HOUR}
            ready = [g for g in groups if room[g["kind"] == "browser"]]
            if len(ready) < len(groups):
                out["held"] = len(groups) - len(ready)  # unmarked: they ring when their hour has room
            if ready:
                body = compose(ready)
                d = teller(db, body.split("\n")[0].strip("*"), body)
                out.update(d)
                if _reached(d):
                    told = {g["fingerprint"] for g in ready}
                    for r in fresh:
                        if r["fingerprint"] in told:
                            db.execute(mark, {"n": now, "r": True, "id": r["id"]})
                    out["told"] = len(ready)
                else:
                    nobody += len(ready)                # unmarked: the next pass tries again
        if now.hour >= DIGEST_HOUR_UTC and not db.execute(text(
                "SELECT 1 FROM health_events WHERE kind = 'digest' AND at >= :d LIMIT 1"), {"d": now.replace(hour=0, minute=0, second=0, microsecond=0)}).first():
            if not reachable(db):
                nobody += 1                             # the day's read is not made for nobody
            else:
                day = store.rows_since(db, now - timedelta(hours=24), strict=True)       # unread is not "none": it raises
                body = digest(store.group(day), now.strftime("%d %b %Y %H:%M UTC"))
                d = teller(db, body.split("\n")[0].strip("*"), body)
                out["digest"] = d
                if _reached(d):                         # the day is done only when the summary reached somebody
                    db.execute(text("INSERT INTO health_events (at, kind, message, fingerprint, alerted_at) VALUES (:n, 'digest', :m, 'digest', :n)"),
                               {"n": now, "m": body[:500]})
                    db.execute(text("DELETE FROM health_events WHERE at < :old"), {"old": now - timedelta(days=store.KEEP_DAYS)})
                else:
                    nobody += 1
        db.commit()
    except Exception as e:                              # noqa: BLE001 — undone whole, and said: the scheduler records a failed step
        try:
            db.rollback()
        except Exception:                               # noqa: BLE001
            pass
        log.warning("health step failed: %s", type(e).__name__)
        raise
    if nobody:
        raise NobodyToTell(f"{nobody} to tell the operator and no admin support room or mailbox to tell it to")
    return out
