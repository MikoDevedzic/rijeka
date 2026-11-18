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

from tests.integration.conftest import USER_B, set_role

pytestmark = pytest.mark.integration
END = date(2026, 11, 17)
OLD, SAT, OWN_DAY = date(2025, 3, 3), date(2026, 11, 14), date(2026, 11, 10)      # before a 0.05-year window; a Saturday; inside it
AHEAD = date(2027, 1, 4)                                                           # a row the desk dated after the run's end
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
        _put(db, uid, "CHF_SARON", AHEAD, "IMPORT")                        # and one it imported, dated ahead
        _put(db, uid, "CHF_SARON", OLD, "DEMO · public sources")           # the old feed's, in a curve the desk also entered
        _put(db, uid, "USD_SOFR", OLD, "DEMO · public sources")            # the old feed's, before the window
        _put(db, uid, "USD_SOFR", SAT, "DEMO · public sources")            # and on a weekend
        db.commit()
        assert H.status(db, uid)["CHF_SARON"]["own"] == 2 and H.status(db, uid)["USD_SOFR"]["own"] == 0

        out = H.backfill(db, uid, years=0.05, end=END)
        assert out["kept_own"] == {"CHF_SARON": 2} and out["replaced_own"] == {} and "CHF_SARON" not in out["written"]
        assert _row(db, uid, "CHF_SARON", OWN_DAY).quotes == JUNK and _row(db, uid, "CHF_SARON", OLD).quotes == JUNK
        for day, of in ((OLD, OLD), (SAT, date(2026, 11, 13)), (END, END)):
            r = _row(db, uid, "USD_SOFR", day)
            assert r.source == H.RATES_SOURCE and r.quotes == feed.build_rates_curve("USD_SOFR", of), day

        again = H.backfill(db, uid, years=0.05, end=END, replace_own=True)
        assert again["replaced_own"] == {"CHF_SARON": 2} and again["kept_own"] == {}
        for day in (OWN_DAY, OLD, AHEAD):                                   # every stored day, whoever wrote it and whenever it is dated
            r = _row(db, uid, "CHF_SARON", day)
            assert r.source == H.RATES_SOURCE and r.quotes == feed.build_rates_curve("CHF_SARON", day), day
        assert H.status(db, uid)["CHF_SARON"]["own"] == 0 and H.own_rates_rows(db, uid) == {}
    finally:
        db.rollback()
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u"), {"u": uid})
        db.execute(text("DELETE FROM auth.users WHERE id = :u"), {"u": uid})          # its profile goes with it
        db.commit(); db.close()


def test_replacing_a_desks_own_rows_is_for_the_account_that_holds_them_or_an_administrator(client, auth_a, auth_b):
    """Two reviews, 18 November 2026. The backfill's door admits a firm's admin and the risk role; every demo account
    is the admin of its own firm and can give itself the risk role, while the history written is the template's, read
    by all of them. User B is neither the template account nor an administrator: refused as a trader, refused with
    the risk role, and the page is told so. An administrator may, and so may user A, whose rows they are (the page
    is told; the run is not started here, it would call the spot sources)."""
    from api.routes import risk
    ask = "/api/risk/history/backfill?years=0.1&replace_own=true"
    try:
        for role in ("trader", "risk"):
            set_role(USER_B, role)
            r = client.post(ask, headers=auth_b)
            assert r.status_code == 403 and "an administrator" in r.json()["detail"], role
            assert client.get("/api/risk/history", headers=auth_b).json()["can_replace_own"] is False, role
        assert not risk._backfill.get("running")
        set_role(USER_B, "admin")
        assert client.get("/api/risk/history", headers=auth_b).json()["can_replace_own"] is True
    finally:
        set_role(USER_B, "trader")
    assert client.get("/api/risk/history", headers=auth_a).json()["can_replace_own"] is True          # the template account, a trader
    assert client.post(ask).status_code in (401, 403)                                                # and nobody without an account
