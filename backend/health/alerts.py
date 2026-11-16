"""What the operator is told, and when.

A problem a person hit is of no use on a page nobody is looking at. Each pass of the scheduler (a minute) this step:

  1. takes the problems not yet told of (health_events.alerted_at is null);
  2. keeps for a message only those worth one now: what the API saw for itself (a 5xx, a slow answer) and what a
     signed-in account's browser reported. A report from a browser that is not signed in can be sent by anyone, as
     often as they like, saying anything: it is kept, shown on the SYSTEM page and counted in the day's summary,
     and never rings by itself;
  3. leaves out any whose fingerprint was told of in the last SAME_AGAIN_H hours (the same fault hit again is not
     news; the summary counts it);
  4. tells the operator of the rest in ONE message, at most MAX_LINES lines, and at most PER_HOUR messages an hour
     (beyond that they wait for the summary), and marks everything it looked at as told;
  5. once a day, after DIGEST_HOUR_UTC, sends the summary of the last 24 hours (also when there was nothing: silence
     must mean "nothing went wrong", not "the alarm is off"), and deletes rows older than the store keeps.

Telling is two things, both optional and both without a name in them (who was affected is on the SYSTEM page, which
needs the admin role; a message may be mirrored or mailed outside the platform):
  - a SYSTEM message from "Rijeka health" in the support room of every account with the admin role, where the
    messenger's own alert (badge, chime, desktop notification) does the rest;
  - an e-mail through Resend's HTTP API when RESEND_API_KEY and RIJEKA_ALERT_EMAIL_TO are both set. Unset, no mail
    is sent and nothing fails.

A browser's words are text from outside. In a message they are `said()`: one line, letters, digits and plain
punctuation only, every address replaced by the words "an address", so that nothing a stranger sends can become a link, a picture or
formatting in the operator's messenger or mail.

`step()` never raises: a failed pass is logged and tried again at the next. The texts are pure functions.
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
PER_HOUR = 6
DIGEST_HOUR_UTC = 13
SENDER = "Rijeka health"
WHERE = "Who was affected, and the details: Configurations → SYSTEM."
RESEND_URL = "https://api.resend.com/emails"


# ── the words ────────────────────────────────────────────────────────────────
_ADDRESS = re.compile(r"(?:[a-z][a-z0-9+.-]*:)?//\S+|\bwww\.\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+", re.I)
_PLAIN = re.compile(r"[^A-Za-z0-9 .,:;'\"!?/%+=#&-]")


def said(message: Any, limit: int = 140) -> str:
    """A browser's words made safe to repeat: one line, no address, nothing a messenger or a mail would format."""
    t = _ADDRESS.sub(" an address ", " ".join(str(message or "").split()))
    t = " ".join(_PLAIN.sub(" ", t).split())
    return (t[:limit].rstrip() + ("…" if len(t) > limit else "")) or "an error"


def rings(g: dict) -> bool:
    """Whether a problem is worth a message now: the API's own observation, or a signed-in account's report."""
    return g.get("kind") in ("api", "slow") or int(g.get("accounts") or 0) > 0


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
    if g["kind"] == "api":
        what = f"{g.get('source') or 'A request'} {route} answered {g.get('status') or '5xx'}"
    elif g["kind"] == "slow":
        secs = round((g.get("slowest_ms") or 0) / 1000)
        what = f"{g.get('source') or 'A request'} {route} took {secs} s"
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


def post_to_admins(db, body: str) -> int:
    """A SYSTEM message in the support room of every admin who has one. Returns how many rooms."""
    from api.routes import chat
    from db.models import ChatRoom, ChatRoomMember
    admins = [r[0] for r in db.execute(text("SELECT id FROM profiles WHERE lower(role) = 'admin'")).all()]
    if not admins:
        return 0
    rooms = (db.query(ChatRoom).join(ChatRoomMember, ChatRoomMember.room_id == ChatRoom.id)
               .filter(ChatRoom.kind == "SUPPORT", ChatRoomMember.user_id.in_(admins)).all())
    platform = chat._platform(db)
    for room in {r.id: r for r in rooms}.values():
        chat._post(db, room, kind="SYSTEM", name=SENDER, firm=platform, body=body)
    return len({r.id for r in rooms})


def tell(db, subject: str, body: str) -> dict:
    out = {"rooms": 0, "mailed": False}
    try:
        out["rooms"] = post_to_admins(db, body)
        db.commit()
    except Exception as e:                              # noqa: BLE001
        db.rollback(); log.warning("health message not posted: %s", type(e).__name__)
    out["mailed"] = send_mail(subject, body)
    return out


# ── the step ─────────────────────────────────────────────────────────────────
def step(db, now: Optional[datetime] = None, teller=tell) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    try:
        if not store.table_present(db):
            return {"skipped": "the health table is not applied"}
        fresh = db.execute(text(
            "SELECT id, at, kind, source, route, status, ms, message, release, user_id, NULL AS email, fingerprint, alerted_at "
            "FROM health_events WHERE alerted_at IS NULL AND kind <> 'digest' ORDER BY at LIMIT 500")).all()
        keys = ("id", "at", "kind", "source", "route", "status", "ms", "message", "release", "user_id", "email", "fingerprint", "alerted_at")
        fresh = [dict(zip(keys, r)) for r in fresh]
        out: dict[str, Any] = {"new": len(fresh), "told": 0}
        if fresh:
            told_of = {r[0] for r in db.execute(text("SELECT DISTINCT fingerprint FROM health_events WHERE alerted_at >= :s"),
                                             {"s": now - timedelta(hours=SAME_AGAIN_H)}).all()}
            groups = [g for g in store.group(fresh) if g["fingerprint"] not in told_of and rings(g)]
            sent = int(db.execute(text("SELECT count(DISTINCT alerted_at) FROM health_events WHERE kind <> 'digest' AND alerted_at >= :s AND rang"),
                                  {"s": now - timedelta(hours=1)}).scalar() or 0)
            ring = bool(groups) and sent < PER_HOUR
            if ring:
                out.update(teller(db, compose(groups).split("\n")[0].strip("*"), compose(groups)), told=len(groups))
            elif groups:
                out["held_for_the_summary"] = len(groups)
            rang = {g["fingerprint"] for g in groups} if ring else set()
            for r in fresh:               # few rows: one statement each keeps the SQL plain on every driver
                db.execute(text("UPDATE health_events SET alerted_at = :n, rang = :r WHERE id = :id"),
                           {"n": now, "r": r["fingerprint"] in rang, "id": r["id"]})
            db.commit()
        if now.hour >= DIGEST_HOUR_UTC and not db.execute(text(
                "SELECT 1 FROM health_events WHERE kind = 'digest' AND at >= :d LIMIT 1"), {"d": now.replace(hour=0, minute=0, second=0, microsecond=0)}).first():
            day = store.rows_since(db, now - timedelta(hours=24)) or []
            body = digest(store.group(day), now.strftime("%d %b %Y %H:%M UTC"))
            db.execute(text("INSERT INTO health_events (at, kind, message, fingerprint, alerted_at) VALUES (:n, 'digest', :m, 'digest', :n)"),
                       {"n": now, "m": body[:500]})
            db.execute(text("DELETE FROM health_events WHERE at < :old"), {"old": now - timedelta(days=store.KEEP_DAYS)})
            db.commit()
            out["digest"] = teller(db, body.split("\n")[0].strip("*"), body)
        return out
    except Exception as e:                              # noqa: BLE001
        try:
            db.rollback()
        except Exception:                               # noqa: BLE001
            pass
        log.warning("health step failed: %s", type(e).__name__)
        return {"failed": type(e).__name__}
