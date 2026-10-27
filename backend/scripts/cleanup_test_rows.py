"""
Delete rows the test suite leaves behind when it runs against a shared
database (everything it creates is prefixed TEST-RLS / TEST-), plus any
placeholder snapshot dated more than a year in the future (a 2099 vol row
once outranked the real surface).

    python scripts/cleanup_test_rows.py                           # dry run: counts only
    python scripts/cleanup_test_rows.py --apply                   # delete what needs no audit exception
    python scripts/cleanup_test_rows.py --apply --include-events  # also the test trades and their events

Run from backend/ with its .env (DATABASE_URL). Trade legs, cashflows and
PnL snapshots cascade from trades. trade_events is append-only by trigger
(a control worth keeping), and trades with events cannot be deleted while
their events exist. --include-events lifts that trigger inside this one
transaction, for the TEST-RLS rows only, and restores it before commit.
Run that flag yourself, deliberately; it is an audit exception.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sqlalchemy import text  # noqa: E402
from db.session import SessionLocal  # noqa: E402

EVENT_STEPS = [
    ("trade_events",  "delete from trade_events where trade_id in (select id from trades where trade_ref like 'TEST-RLS%')"),
    ("trades",        "delete from trades where trade_ref like 'TEST-RLS%'"),
]
STEPS = [
    ("trades (no events)", "delete from trades where trade_ref like 'TEST-RLS%' and not exists (select 1 from trade_events e where e.trade_id = trades.id)"),
    ("counterparties","delete from counterparties where name like 'TEST-RLS%'"),
    ("legal_entities","delete from legal_entities where name like 'TEST-RLS%' and id not in "
                      "(select legal_entity_id from counterparties where legal_entity_id is not null)"),
    ("snapshots",     "delete from market_data_snapshots where curve_id like 'TEST-%'"),
    ("xva_calibration","delete from xva_calibration where curve_id like 'TEST-%'"),
    ("future snapshots","delete from market_data_snapshots where valuation_date > current_date + 365"),
    ("future vol skew","delete from swaption_vol_skew where valuation_date > current_date + 365"),
]

APPEND_ONLY_TRIGGERS_SQL = """select tgname from pg_trigger
    where tgrelid = 'trade_events'::regclass and tgfoid = 'trade_events_reject_mutation'::regproc"""


def main(apply: bool, include_events: bool) -> None:
    db = SessionLocal()
    try:
        steps = (EVENT_STEPS if include_events else []) + STEPS
        triggers = []
        if apply and include_events:
            triggers = [r[0] for r in db.execute(text(APPEND_ONLY_TRIGGERS_SQL))]
            for t in triggers:
                db.execute(text(f'alter table trade_events disable trigger "{t}"'))
        for name, sql in steps:
            if apply:
                n = db.execute(text(sql)).rowcount
            else:
                n = db.execute(text("select count(*) from (" + sql.replace("delete from", "select 1 from", 1) + ") s")).scalar()
            print(f"{'deleted' if apply else 'would delete':12} {n:6}  {name}")
        for t in triggers:
            db.execute(text(f'alter table trade_events enable trigger "{t}"'))
        if apply:
            db.commit(); print("committed" + (f" (append-only trigger lifted and restored: {', '.join(triggers)})" if triggers else ""))
        else:
            print("dry run — re-run with --apply to delete" + ("" if include_events else "; add --include-events for the test trades that have events"))
    finally:
        db.close()

if __name__ == "__main__":
    main("--apply" in sys.argv, "--include-events" in sys.argv)
