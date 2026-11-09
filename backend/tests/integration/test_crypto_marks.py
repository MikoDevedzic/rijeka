"""Digital-asset marks on a real database: the refresh writes the template's rows and pushes them to demo accounts
without touching what an account entered itself, the ticket prices on them and names them, a built history row
cannot replace them, and switching the source off removes them. The venue is not called: the chain is built from
a known smile (tests/test_deribit.py). Every row written here is removed at the end, so the pinned book, which
reads the latest forward curve, is valued on the seed's market as before."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.integration.conftest import USER_A, USER_B
from tests.test_deribit import NOW, PILLARS, chain

pytestmark = pytest.mark.integration
ASOF, EXPIRY, SETTLE = "2026-11-02", "2027-01-29", "2027-01-30"


def _rows(db, uid, like="%"):
    return {r.curve_id: r for r in db.execute(text(
        "SELECT curve_id, quotes, source FROM market_data_snapshots WHERE user_id = :u AND valuation_date = :d AND curve_id LIKE :l"),
        {"u": uid, "d": date.today(), "l": like}).all()}


def test_marks_are_stored_pushed_priced_on_and_removed(client, auth_a, auth_b):
    from api.routes import crypto, demo_market_data as r
    from db.session import SessionLocal
    from market_data import deribit
    from risk import history as H
    from stack.seed import SPOTS                    # the chain sits on the stack's own spots: the refresh checks the venue's index against them
    from tests.test_deribit import INDEX
    def on(spot):
        return [(code, fwd * spot / INDEX, atm, rr, bf) for code, fwd, atm, rr, bf in PILLARS]
    built = {a: deribit.build(chain(on(SPOTS[f"{a}USD"]), prefix=a, base=a, index=SPOTS[f"{a}USD"]), a, NOW) for a in ("BTC", "ETH")}
    off = deribit.build(chain(PILLARS, prefix="SOL_USDC", base="SOL"), "SOL", NOW)          # an index of 74,800 against a spot of 182
    got = {"ok": {**built, "SOL": off}, "failed": {}}
    db = SessionLocal()
    opt = {"pair": "BTCUSD", "option_type": "PUT", "base_notional": 10, "expiry_date": EXPIRY, "valuation_date": ASOF}
    fwd = {"pair": "BTCUSD", "shape": "FORWARD", "base_notional": 10, "direction": "BUY", "settlement_date": SETTLE, "valuation_date": ASOF}
    before = client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()
    try:
        assert not _rows(db, USER_A, "%USD\\_FWD") and before["market_points"] is None
        # what an account entered itself stays in force until it replaces it, whatever the row's date
        own = [{"tenor": "1M", "quote_type": "FWD_POINTS", "rate": 1.0, "enabled": True}, {"tenor": "3M", "quote_type": "FWD_POINTS", "rate": 3.0, "enabled": True}]
        r._upsert_snapshot(db, USER_B, "ETHUSD_FWD", date.today() - timedelta(days=1), own, "MANUAL")
        db.commit()
        with patch.object(deribit, "collect", return_value=got), patch.object(crypto, "fetch_spot", side_effect=RuntimeError("not in this test")):
            out = r.refresh_crypto(db, now=NOW)
        assert set(out["assets"]) == {"BTC", "ETH"} and out["spot"] is None
        assert list(out["failed"]) == ["SOL"] and out["failed"]["SOL"].endswith("from the spot")          # refused against the last stored spot
        a, b = _rows(db, USER_A, "%USD\\_%"), _rows(db, USER_B, "%USD\\_%")
        for cid in ("BTCUSD_VOL", "BTCUSD_FWD", "ETHUSD_VOL"):
            assert a[cid].source.startswith("DEMO · Deribit") and "2026-11-09 11:59 UTC" in a[cid].source
            assert b[cid].quotes == a[cid].quotes and b[cid].source == a[cid].source
        assert "ETHUSD_FWD" not in b and a["ETHUSD_FWD"].source.startswith("DEMO · Deribit forwards")       # nothing written over B's own curve of yesterday
        # the daily copy has the same rule for a venue's row (Nikola, 2026-11-09: without it the copy undid the push within two hours)
        from api.routes import demo
        demo._copy_market_data(db, uuid.UUID(USER_A), uuid.UUID(USER_B))
        db.commit()
        assert "ETHUSD_FWD" not in _rows(db, USER_B, "ETHUSD\\_FWD") and _rows(db, USER_B, "BTCUSD\\_FWD")["BTCUSD_FWD"].source.startswith("DEMO · Deribit")
        assert "SOLUSD_FWD" not in a and out["pushed_rows"] >= 3
        # a second run replaces its own rows in both accounts (a later mark), never duplicates them
        with patch.object(deribit, "collect", return_value={"ok": {"BTC": {**built["BTC"], "vol": [{**q, "rate": q["rate"] + 1} for q in built["BTC"]["vol"]]}}, "failed": {}}), \
             patch.object(crypto, "fetch_spot", side_effect=RuntimeError("not in this test")):
            r.refresh_crypto(db, now=NOW)
        assert _rows(db, USER_B, "BTCUSD\\_VOL")["BTCUSD_VOL"].quotes[0]["rate"] == pytest.approx(built["BTC"]["vol"][0]["rate"] + 1)

        # the ticket: the forward is spot plus the venue's points, the vol is the venue's surface, both named with their time
        f = client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()
        assert f["forward_mode"] == "MARKET" and f["market_points"] > 0 and f["forward"] == pytest.approx(f["spot"] + f["market_points"])
        assert "Deribit forwards · 2026-11-09 11:59 UTC" in f["forward_source"] and f["forward"] != pytest.approx(before["forward"])
        o = client.post("/api/currency/option/price", json=opt, headers=auth_a)
        assert o.status_code == 200, o.text
        o = o.json()
        assert o["vol_tier"] == "SURFACE" and o["vol_marks"].startswith("Deribit option marks · 2026-11-09 11:59 UTC") and o["forward"] == pytest.approx(f["forward"], rel=1e-3)
        assert 30 < o["vol_pct"] < 50                                      # the put side of a 40 % surface with a put skew
        mine = client.post("/api/currency/forward/price", json={**fwd, "base_rate_pct": 3.0}, headers=auth_a).json()
        assert mine["forward_mode"] == "IMPLIED" and mine["forward"] == pytest.approx(before["forward"])       # the seed's funding is 3 %
        pairs = {p["pair"]: p for p in client.get("/api/currency/pairs", headers=auth_b).json()["pairs"]}
        assert pairs["BTCUSD"]["vol_surface"]["label"] == "Deribit 9 Nov 11:59 UTC" and pairs["ETHUSD"]["forward_curve"]["source"] == "MANUAL"
        assert pairs["BTCUSD"]["forward_curve"]["in_use"] is True

        # the daily rebuild keeps the venue's surface, and a built history row cannot replace it
        kept = r.kept_marks(db, USER_A)
        assert set(kept) == {"BTCUSD_VOL", "ETHUSD_VOL"} and kept["ETHUSD_VOL"]["quotes"] == built["ETH"]["vol"]
        n = H.store(db, USER_A, {"ETHUSD_VOL": {date.today(): [{"tenor": "1M", "quote_type": "ATM", "rate": 99.0, "enabled": True}]}}, overwrite=True, source="DEMO · synthetic surface")
        assert n == {"ETHUSD_VOL": 0} and _rows(db, USER_A, "ETHUSD\\_VOL")["ETHUSD_VOL"].quotes == built["ETH"]["vol"]
        # health reads the time the marks carried, and only when all three assets have a venue surface (SOL has none here)
        assert r.last_marks_at(db) is None
        r._upsert_snapshot(db, USER_A, "SOLUSD_VOL", date.today(), built["ETH"]["vol"], "DEMO · Deribit option marks · 2026-11-09 09:10 UTC · listed to 26MAR27, flat beyond")
        db.commit()
        assert r.last_marks_at(db).isoformat() == "2026-11-09T09:10:00+00:00"                       # the oldest of the three
        # a row the template's owner typed is not the feed's to replace either
        db.execute(text("UPDATE market_data_snapshots SET source = 'MANUAL' WHERE user_id = :u AND curve_id = 'ETHUSD_VOL' AND valuation_date = :d"), {"u": USER_A, "d": date.today()})
        db.commit()
        with patch.object(deribit, "collect", return_value={"ok": {"ETH": {**built["ETH"], "vol": [{**q, "rate": q["rate"] + 5} for q in built["ETH"]["vol"]]}}, "failed": {}}), \
             patch.object(crypto, "fetch_spot", side_effect=RuntimeError("not in this test")):
            r.refresh_crypto(db, now=NOW)
        kept_own = _rows(db, USER_A, "ETHUSD\\_VOL")["ETHUSD_VOL"]
        assert kept_own.source == "MANUAL" and kept_own.quotes == built["ETH"]["vol"]
        assert _rows(db, USER_B, "ETHUSD\\_VOL")["ETHUSD_VOL"].source.startswith("DEMO · Deribit")       # and it is not copied to anyone
        # a desk spot on a pair whose points come from the feed: saved alone, the feed's points left as they are
        saved = client.post("/api/currency/forward-curve", json={"pair": "BTCUSD", "points": {}, "source": "MANUAL", "spot": 70123.0}, headers=auth_b)
        assert saved.status_code == 200, saved.text
        assert saved.json()["spot"] == 70123.0 and "Deribit" in saved.json()["forward_curve"]["source"] and saved.json()["forward_curve"]["label"] == "Deribit 9 Nov 11:59 UTC"
        assert _rows(db, USER_B, "BTCUSD\\_SPOT")["BTCUSD_SPOT"].source == "MANUAL"
        assert client.post("/api/currency/forward-curve", json={"pair": "BTCUSD", "points": {}, "source": "MANUAL"}, headers=auth_b).status_code == 422
        assert client.post("/api/currency/forward-curve", json={"pair": "BTCUSD", "points": {"1M": 1}, "source": "DEMO · Deribit x", "spot": 1.0}, headers=auth_b).status_code == 422
    finally:
        db.rollback()
        removed = r.purge_marks(db, USER_A)     # the switch-off path, and this test's cleanup
        db.execute(text("DELETE FROM market_data_snapshots WHERE source = 'MANUAL' AND valuation_date >= :d AND "
                        "((user_id = :b AND curve_id IN ('ETHUSD_FWD', 'BTCUSD_SPOT')) OR (user_id = :a AND curve_id = 'ETHUSD_VOL'))"),
                   {"a": USER_A, "b": USER_B, "d": date.today() - timedelta(days=1)})
        db.commit()
        db.close()
    assert removed >= 7
    after = client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()
    assert after["market_points"] is None and after["forward"] == pytest.approx(before["forward"])
    back = client.post("/api/currency/option/price", json=opt, headers=auth_a).json()
    assert back["vol_marks"] is None and back["vol_snapshot"] == ASOF                    # the seed's surface again, captioned by its date as before


def test_an_account_hands_a_pair_back_to_the_feed_and_nothing_is_deleted(client, auth_a, auth_b, monkeypatch):
    """Production, 9 November 2026: the template held its own saved BTC, ETH and SOL forward curves, so the feed
    (which never replaces an own entry) wrote vols and no forwards. The owner's way back, without losing history."""
    from api.routes import crypto, currencies, demo_market_data as r
    from db.session import SessionLocal
    from market_data import deribit
    from stack.seed import SPOTS
    from tests.test_deribit import INDEX
    # where the feed is off there is nothing to go back to, and the action says so instead of promising
    off = client.post("/api/currency/forward-curve/use-feed", json={"pair": "SOLUSD"}, headers=auth_a)
    assert off.status_code == 409 and "does not write to this account" in off.json()["detail"]
    monkeypatch.setenv("RIJEKA_DEMO_MARKET_DATA", "1")              # the integration environment runs with the demo feeds off
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")                # and without sandbox accounts: copies exist only where accounts are copies
    spot = SPOTS["SOLUSD"]
    built = deribit.build(chain([(c, f * spot / INDEX, a, rr, bf) for c, f, a, rr, bf in PILLARS], prefix="SOL_USDC", base="SOL", index=spot), "SOL", NOW)
    saved = [{"tenor": "1M", "quote_type": "FWD_POINTS", "rate": 0.5, "enabled": True}, {"tenor": "3M", "quote_type": "FWD_POINTS", "rate": 1.5, "enabled": True}]
    old, today = date.today() - timedelta(days=5), date.today()
    fwd = {"pair": "SOLUSD", "shape": "FORWARD", "base_notional": 100, "direction": "BUY", "settlement_date": SETTLE, "valuation_date": ASOF}
    db = SessionLocal()

    def rows(uid):
        return [(str(d), s_) for d, s_ in db.execute(text("SELECT valuation_date, source FROM market_data_snapshots WHERE user_id = :u AND curve_id = 'SOLUSD_FWD' ORDER BY 1"), {"u": uid}).all()]

    def tick():
        with patch.object(deribit, "collect", return_value={"ok": {"SOL": built}, "failed": {}}), patch.object(crypto, "fetch_spot", side_effect=RuntimeError("not here")):
            return r.refresh_crypto(db, now=NOW)
    try:
        for uid in (USER_A, USER_B):                                  # the template's own curve, and the copy the daily copy gave B
            r._upsert_snapshot(db, uid, "SOLUSD_FWD", old, saved, "MANUAL")
        db.commit()
        tick()
        assert rows(USER_A) == [(str(old), "MANUAL")] and _rows(db, USER_A, "SOLUSD\\_VOL")["SOLUSD_VOL"].source.startswith("DEMO · Deribit")   # vols, no forwards: what production showed
        on_own = client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()

        # only a digital-asset pair; and a copy account cannot go first: while the template prices on its own points there is no feed to go back to
        assert client.post("/api/currency/forward-curve/use-feed", json={"pair": "EURUSD"}, headers=auth_a).status_code == 422
        early = client.post("/api/currency/forward-curve/use-feed", json={"pair": "SOLUSD"}, headers=auth_b)
        assert early.status_code == 409 and "saved points stay in force" in early.json()["detail"] and rows(USER_B) == [(str(old), "MANUAL")]

        out = client.post("/api/currency/forward-curve/use-feed", json={"pair": "SOLUSD"}, headers=auth_a)
        assert out.status_code == 200, out.text
        out = out.json()
        assert out["handed_back"] is True and out["accounts"] == 2 and out["forward_curve"]["source"] == currencies.HANDED_BACK
        # nothing deleted: the saved row of five days ago is still there in both accounts, and today's row carries the same points under a feed label
        for uid in (USER_A, USER_B):
            assert rows(uid) == [(str(old), "MANUAL"), (str(today), currencies.HANDED_BACK)]
        assert _rows(db, USER_A, "SOLUSD\\_FWD")["SOLUSD_FWD"].quotes == saved
        same = client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()
        assert same["forward"] == pytest.approx(on_own["forward"])                                    # the forward does not move until the venue's points arrive
        # the next marks run replaces the handed-back row with the venue's, for the template and its copy
        tick()
        for uid in (USER_A, USER_B):
            assert rows(uid) == [(str(old), "MANUAL"), (str(today), _rows(db, uid, "SOLUSD\\_FWD")["SOLUSD_FWD"].source)]
            assert _rows(db, uid, "SOLUSD\\_FWD")["SOLUSD_FWD"].source.startswith("DEMO · Deribit forwards")
        assert client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()["forward"] != pytest.approx(on_own["forward"])
        # already on the feed: nothing to hand back, nothing written
        again = client.post("/api/currency/forward-curve/use-feed", json={"pair": "SOLUSD"}, headers=auth_a).json()
        assert again["handed_back"] is False and again["accounts"] == 0 and "Deribit" in again["forward_curve"]["source"]
        # a copy account that then saves its own points can hand them back itself, now that the feed has forwards
        mine = [{**q, "rate": q["rate"] + 9} for q in saved]
        r._upsert_snapshot(db, USER_B, "SOLUSD_FWD", today, mine, "MANUAL")
        db.commit()
        tick()
        assert _rows(db, USER_B, "SOLUSD\\_FWD")["SOLUSD_FWD"].source == "MANUAL"                   # its own entry stands
        b = client.post("/api/currency/forward-curve/use-feed", json={"pair": "SOLUSD"}, headers=auth_b).json()
        assert b["handed_back"] is True and b["accounts"] == 1
        tick()
        assert _rows(db, USER_B, "SOLUSD\\_FWD")["SOLUSD_FWD"].source.startswith("DEMO · Deribit forwards")
    finally:
        db.rollback()
        r.purge_marks(db, USER_A)
        db.execute(text("DELETE FROM market_data_snapshots WHERE curve_id = 'SOLUSD_FWD' AND user_id IN (:a, :b)"), {"a": USER_A, "b": USER_B})
        db.commit()
        db.close()
