"""The rates backfill on a real database: a desk's own rows are kept and counted, the demo's rows are made again on
every stored day (also one before the window and a weekend's), and an explicit replace writes the generator's curve
over the desk's own rows too. The spots' sources are not called. The rows belong to an account made for this test
and are removed at the end."""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration
END = date(2026, 11, 17)
OLD, SAT, OWN_DAY = date(2025, 3, 3), date(2026, 11, 14), date(2026, 11, 10)      # before a 0.05-year window; a Saturday; inside it
JUNK = [{"tenor": "1Y", "quote_type": "RATE", "rate": 9.99, "enabled": True}]


def _put(db, uid, curve, day, source):
    db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                    "VALUES (:c, :d, CAST(:q AS jsonb), :s, :u, :u)"), {"c": curve, "d": day, "q": json.dumps(JUNK), "s": source, "u": uid})


def _row(db, uid, curve, day):
    return db.execute(text("SELECT quotes, source FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
                      {"u": uid, "c": curve, "d": day}).first()


def test_a_backfill_keeps_a_desks_own_rates_rows_until_it_is_told_to_replace_them(stack, monkeypatch):
    from db.session import SessionLocal
    from market_data import demo_feed as feed
    from risk import history as H
    monkeypatch.setattr(H, "fx_history", lambda a, b: {})
    monkeypatch.setattr(H, "crypto_history", lambda a, b: {})
    uid = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.execute(text("INSERT INTO auth.users (id, aud, role, email) VALUES (:u, 'authenticated', 'authenticated', :e)"),
                   {"u": uid, "e": f"backfill-{uid[:8]}@stack.test"})
        _put(db, uid, "CHF_SARON", OWN_DAY, "MANUAL")                      # the desk's own
        _put(db, uid, "CHF_SARON", OLD, "DEMO · public sources")           # the old feed's, in a curve the desk also entered
        _put(db, uid, "USD_SOFR", OLD, "DEMO · public sources")            # the old feed's, before the window
        _put(db, uid, "USD_SOFR", SAT, "DEMO · public sources")            # and on a weekend
        db.commit()
        assert H.status(db, uid)["CHF_SARON"]["own"] == 1 and H.status(db, uid)["USD_SOFR"]["own"] == 0

        out = H.backfill(db, uid, years=0.05, end=END)
        assert out["kept_own"] == {"CHF_SARON": 1} and out["replaced_own"] == {} and "CHF_SARON" not in out["written"]
        assert _row(db, uid, "CHF_SARON", OWN_DAY).quotes == JUNK and _row(db, uid, "CHF_SARON", OLD).quotes == JUNK
        for day, of in ((OLD, OLD), (SAT, date(2026, 11, 13)), (END, END)):
            r = _row(db, uid, "USD_SOFR", day)
            assert r.source == H.RATES_SOURCE and r.quotes == feed.build_rates_curve("USD_SOFR", of), day

        again = H.backfill(db, uid, years=0.05, end=END, replace_own=True)
        assert again["replaced_own"] == {"CHF_SARON": 1} and again["kept_own"] == {}
        for day in (OWN_DAY, OLD):
            r = _row(db, uid, "CHF_SARON", day)
            assert r.source == H.RATES_SOURCE and r.quotes == feed.build_rates_curve("CHF_SARON", day), day
        assert H.status(db, uid)["CHF_SARON"]["own"] == 0 and H.own_rates_rows(db, uid) == {}
    finally:
        db.rollback()
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u"), {"u": uid})
        db.execute(text("DELETE FROM auth.users WHERE id = :u"), {"u": uid})          # its profile goes with it
        db.commit(); db.close()
