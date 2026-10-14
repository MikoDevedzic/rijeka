"""
Delete rows the test suite leaves behind when it runs against a shared
database (everything it creates is prefixed TEST-RLS / TEST-), plus any
placeholder snapshot dated more than a year in the future (a 2099 vol row
once outranked the real surface).

    python scripts/cleanup_test_rows.py            # dry run: counts only
    python scripts/cleanup_test_rows.py --apply    # delete

Run from backend/ with its .env (DATABASE_URL). Trade legs, cashflows and
PnL snapshots cascade from trades; trade_events do not, so they go first.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sqlalchemy import text  # noqa: E402
from db.session import SessionLocal  # noqa: E402

STEPS = [
    ("trade_events",  "delete from trade_events where trade_id in (select id from trades where trade_ref like 'TEST-RLS%')"),
    ("trades",        "delete from trades where trade_ref like 'TEST-RLS%'"),
    ("counterparties","delete from counterparties where name like 'TEST-RLS%'"),
    ("legal_entities","delete from legal_entities where name like 'TEST-RLS%' and id not in "
                      "(select legal_entity_id from counterparties where legal_entity_id is not null)"),
    ("snapshots",     "delete from market_data_snapshots where curve_id like 'TEST-%'"),
    ("xva_calibration","delete from xva_calibration where curve_id like 'TEST-%'"),
    ("future snapshots","delete from market_data_snapshots where valuation_date > current_date + 365"),
    ("future vol skew","delete from swaption_vol_skew where valuation_date > current_date + 365"),
]

def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        for name, sql in STEPS:
            if apply:
                n = db.execute(text(sql)).rowcount
            else:
                n = db.execute(text("select count(*) from (" + sql.replace("delete from", "select 1 from", 1) + ") s")).scalar()
            print(f"{'deleted' if apply else 'would delete':12} {n:6}  {name}")
        if apply:
            db.commit(); print("committed")
        else:
            print("dry run — re-run with --apply to delete")
    finally:
        db.close()

if __name__ == "__main__":
    main("--apply" in sys.argv)
