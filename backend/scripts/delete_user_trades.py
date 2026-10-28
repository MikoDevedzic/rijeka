"""
Delete every trade one user owns (their blotter), with everything that hangs
off those trades: legs, cashflows and PnL snapshots cascade; trade_events do
not, because that table is append-only by trigger.

    python scripts/delete_user_trades.py --email you@example.com                  # dry run: counts only
    python scripts/delete_user_trades.py --email you@example.com --apply          # trades that have no events
    python scripts/delete_user_trades.py --email you@example.com --apply --include-events

--include-events lifts the append-only trigger inside this one transaction,
for this user's trades only, and restores it before commit. Confirmed trades
always have events, so clearing a blotter that holds confirmations needs it.
The on-chain record of a confirmed trade is immutable and is not touched;
the counterparty's own booking of the same trade belongs to them and stays.

Run from backend/ with its .env (DATABASE_URL).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sqlalchemy import text  # noqa: E402
from db.session import SessionLocal  # noqa: E402

APPEND_ONLY_TRIGGERS_SQL = """select tgname from pg_trigger
    where tgrelid = 'trade_events'::regclass and tgfoid = 'trade_events_reject_mutation'::regproc"""


def main(email: str, apply: bool, include_events: bool) -> None:
    db = SessionLocal()
    try:
        uid = db.execute(text("select id from auth.users where lower(email) = lower(:e)"), {"e": email}).scalar()
        if uid is None:
            sys.exit(f"no user with email {email}")
        p = {"u": uid}
        total = db.execute(text("select count(*) from trades where user_id = :u"), p).scalar()
        with_events = db.execute(text(
            "select count(*) from trades t where t.user_id = :u and exists (select 1 from trade_events e where e.trade_id = t.id)"), p).scalar()
        events = db.execute(text(
            "select count(*) from trade_events where trade_id in (select id from trades where user_id = :u)"), p).scalar()
        print(f"user {str(uid)[:8]}…  trades: {total}  (with events: {with_events}, events: {events})")

        if not apply:
            scope = total if include_events else total - with_events
            print(f"would delete {scope} trades" + ("" if include_events else f"; {with_events} need --include-events"))
            return

        triggers = []
        if include_events:
            triggers = [r[0] for r in db.execute(text(APPEND_ONLY_TRIGGERS_SQL))]
            for t in triggers:
                db.execute(text(f'alter table trade_events disable trigger "{t}"'))
            n = db.execute(text("update trades set latest_event_id = null where user_id = :u and latest_event_id is not null"), p).rowcount
            print(f"cleared   {n:6}  latest_event pointers")
            n = db.execute(text("delete from trade_events where trade_id in (select id from trades where user_id = :u)"), p).rowcount
            print(f"deleted   {n:6}  trade_events")
            n = db.execute(text("delete from trades where user_id = :u"), p).rowcount
        else:
            n = db.execute(text(
                "delete from trades t where t.user_id = :u and not exists (select 1 from trade_events e where e.trade_id = t.id)"), p).rowcount
        print(f"deleted   {n:6}  trades (legs, cashflows, pnl snapshots cascaded)")

        for t in triggers:
            db.execute(text(f'alter table trade_events enable trigger "{t}"'))
        if triggers:
            enabled = db.execute(text(
                "select count(*) from pg_trigger where tgrelid = 'trade_events'::regclass and tgenabled <> 'D'"
                " and tgfoid = 'trade_events_reject_mutation'::regproc")).scalar()
            assert enabled == len(triggers), "append-only trigger not restored; rolling back"
            print(f"restored  {enabled:6}  append-only trigger(s)")
        db.commit()
        left = db.execute(text("select count(*) from trades where user_id = :u"), p).scalar()
        print(f"committed; {left} trades remain for this user")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--include-events", action="store_true")
    a = ap.parse_args()
    main(a.email, a.apply, a.include_events)
