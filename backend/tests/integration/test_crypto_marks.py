"""Digital-asset marks on a real database: the refresh writes the template's rows and pushes them to demo accounts
without touching what an account entered itself, the ticket prices on them and names them, a built history row
cannot replace them, and switching the source off removes them. The venue is not called: the chain is built from
a known smile (tests/test_deribit.py). Every row written here is removed at the end, so the pinned book, which
reads the latest forward curve, is valued on the seed's market as before."""
from __future__ import annotations

from datetime import date
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
    built = {a: deribit.build(chain(PILLARS, prefix=a, base=a), a, NOW) for a in ("BTC", "ETH")}
    got = {"ok": built, "failed": {"SOL": "ConnectTimeout"}}
    db = SessionLocal()
    opt = {"pair": "BTCUSD", "option_type": "PUT", "base_notional": 10, "expiry_date": EXPIRY, "valuation_date": ASOF}
    fwd = {"pair": "BTCUSD", "shape": "FORWARD", "base_notional": 10, "direction": "BUY", "settlement_date": SETTLE, "valuation_date": ASOF}
    before = client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()
    try:
        assert not _rows(db, USER_A, "%USD\\_FWD") and before["market_points"] is None
        # what an account typed itself today is not the template's to replace
        own = [{"tenor": "1M", "quote_type": "FWD_POINTS", "rate": 1.0, "enabled": True}, {"tenor": "3M", "quote_type": "FWD_POINTS", "rate": 3.0, "enabled": True}]
        r._upsert_snapshot(db, USER_B, "ETHUSD_FWD", date.today(), own, "MANUAL")
        db.commit()
        with patch.object(deribit, "collect", return_value=got), patch.object(crypto, "fetch_spot", side_effect=RuntimeError("not in this test")):
            out = r.refresh_crypto(db, now=NOW)
        assert set(out["assets"]) == {"BTC", "ETH"} and out["failed"] == {"SOL": "ConnectTimeout"} and out["spot"] is None
        a, b = _rows(db, USER_A, "%USD\\_%"), _rows(db, USER_B, "%USD\\_%")
        for cid in ("BTCUSD_VOL", "BTCUSD_FWD", "ETHUSD_VOL"):
            assert a[cid].source.startswith("DEMO · Deribit") and "2026-11-09 11:59 UTC" in a[cid].source
            assert b[cid].quotes == a[cid].quotes and b[cid].source == a[cid].source
        assert b["ETHUSD_FWD"].source == "MANUAL" and b["ETHUSD_FWD"].quotes == own and a["ETHUSD_FWD"].source.startswith("DEMO · Deribit forwards")
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

        # the daily rebuild keeps the venue's surface, and a built history row cannot replace it
        kept = r.kept_marks(db, USER_A)
        assert set(kept) == {"BTCUSD_VOL", "ETHUSD_VOL"} and kept["ETHUSD_VOL"]["quotes"] == built["ETH"]["vol"]
        n = H.store(db, USER_A, {"ETHUSD_VOL": {date.today(): [{"tenor": "1M", "quote_type": "ATM", "rate": 99.0, "enabled": True}]}}, overwrite=True, source="DEMO · synthetic surface")
        assert n == {"ETHUSD_VOL": 0} and _rows(db, USER_A, "ETHUSD\\_VOL")["ETHUSD_VOL"].quotes == built["ETH"]["vol"]
    finally:
        db.rollback()
        removed = r.purge_marks(db)             # the switch-off path, and this test's cleanup
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = 'ETHUSD_FWD' AND source = 'MANUAL' AND valuation_date = :d"),
                   {"u": USER_B, "d": date.today()})
        db.commit()
        db.close()
    assert removed >= 7
    after = client.post("/api/currency/forward/price", json=fwd, headers=auth_a).json()
    assert after["market_points"] is None and after["forward"] == pytest.approx(before["forward"])
    assert "Deribit" not in client.post("/api/currency/option/price", json=opt, headers=auth_a).json()["vol_marks"]      # the seed's surface again
