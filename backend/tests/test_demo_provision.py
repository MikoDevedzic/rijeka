"""
Hosted-demo provisioning and the demo-scoped signing policy.

No database here: the row-level behaviour of /api/demo/provision runs against
Postgres (UUID/ARRAY columns), so these tests pin the pure parts — the demo
LEI shape, the dev-key scope, the market-data copy SQL, the role upgrade —
and the quota's refusal path through the route with a fake session.
"""
import os
import uuid
from unittest.mock import MagicMock

import pytest


# ── Demo LEIs ────────────────────────────────────────────────────────────────

def test_demo_lei_is_lei_shaped_and_per_user():
    from api.routes.demo import demo_lei_for, DEMO_BANK_LEI, DEMO_LEI_PREFIX
    a, b = demo_lei_for(uuid.uuid4()), demo_lei_for(uuid.uuid4())
    assert len(a) == 20 and a.startswith(DEMO_LEI_PREFIX) and a.isalnum() and a == a.upper()
    assert a != b
    assert len(DEMO_BANK_LEI) == 20 and DEMO_BANK_LEI.startswith(DEMO_LEI_PREFIX)


# ── Dev-key scope ────────────────────────────────────────────────────────────

def test_dev_seed_signs_everything_when_unscoped(monkeypatch):
    from chain import keys
    monkeypatch.setenv("RIJEKA_CHAIN_DEV_SEED", "t")
    monkeypatch.delenv("RIJEKA_CHAIN_DEV_LEI_PREFIX", raising=False)
    k = keys.resolve({"lei": "W22LROWP2IHZNBB6K528", "name": "GS"})
    assert k.private_key is not None and k.source == "dev"


def test_dev_seed_scoped_to_demo_prefix_refuses_real_leis(monkeypatch):
    from chain import keys
    monkeypatch.setenv("RIJEKA_CHAIN_DEV_SEED", "t")
    monkeypatch.setenv("RIJEKA_CHAIN_DEV_LEI_PREFIX", "DEMO")
    demo = keys.resolve({"lei": "DEMO0000RIJEKABANK01", "name": "demo bank"})
    assert demo.private_key is not None and demo.source == "dev"
    with pytest.raises(LookupError) as e:
        keys.resolve({"lei": "W22LROWP2IHZNBB6K528", "name": "GS"})
    assert "signs only for demo entities" in str(e.value)
    # An explicit env key for a real LEI still wins over the scope
    from eth_account import Account
    acct = Account.create()
    monkeypatch.setenv("RIJEKA_CHAIN_KEY_W22LROWP2IHZNBB6K528", acct.key.hex())
    k = keys.resolve({"lei": "W22LROWP2IHZNBB6K528", "name": "GS"})
    assert k.address == acct.address and k.source == "env"


def test_prefix_list_and_case(monkeypatch):
    from chain.keys import _dev_key_allowed
    monkeypatch.setenv("RIJEKA_CHAIN_DEV_LEI_PREFIX", "demo, TEST-")
    assert _dev_key_allowed("DEMO1234") and _dev_key_allowed("test-abc")
    assert not _dev_key_allowed("549300ABC")


# ── Market-data copy SQL ─────────────────────────────────────────────────────

class _FakeDB:
    """Records SQL; answers information_schema with a fixed column list."""
    def __init__(self, cols):
        self.cols, self.sql = cols, []
    def execute(self, stmt, params=None):
        s = str(stmt)
        if "information_schema.columns" in s:
            r = MagicMock(); r.__iter__ = lambda self_: iter([(c,) for c in cols_for(params["t"], self.cols)]); return r
        self.sql.append((s, params))
        r = MagicMock(); r.rowcount = 3; return r

def cols_for(table, cols):
    return cols.get(table, [])


def test_copy_sql_regenerates_ids_and_reassigns_owner():
    from api.routes.demo import _copy_market_data
    db = _FakeDB({
        "market_data_snapshots": ["id", "curve_id", "valuation_date", "quotes", "source", "created_at", "created_by", "user_id"],
        "swaption_vol_skew":     ["id", "valuation_date", "expiry_label", "atm_vol_bp", "user_id"],
        "cap_vol_surface":       [],   # absent table → skipped
        "sabr_params":           ["id", "valuation_date", "alpha", "user_id"],
        "xva_calibration":       ["id", "curve_id", "valuation_date", "model", "a", "user_id"],
    })
    src, dst = uuid.uuid4(), uuid.uuid4()
    out = _copy_market_data(db, src, dst)
    assert set(out) == {"market_data_snapshots", "swaption_vol_skew", "sabr_params", "xva_calibration"}
    snap = next(s for s, _ in db.sql if "INSERT INTO market_data_snapshots" in s)
    assert "gen_random_uuid()" not in snap and "INSERT INTO market_data_snapshots (curve_id," in snap and "ON CONFLICT DO NOTHING" in snap
    assert "PARTITION BY curve_id" in snap and "NOT LIKE 'TEST-%'" in snap
    assert "SELECT curve_id, valuation_date, quotes, source, now(), :dst, :dst" in snap
    vol = next(s for s, _ in db.sql if "INSERT INTO swaption_vol_skew" in s)
    assert "OVER ()" in vol and "TEST-" not in vol
    xva = next(s for s, _ in db.sql if "INSERT INTO xva_calibration" in s)
    assert "PARTITION BY curve_id, model" in xva
    assert all(p == {"src": src, "dst": dst} for _, p in db.sql)


# ── Role upgrade ─────────────────────────────────────────────────────────────

def test_role_upgrade_only_lifts_viewers():
    from api.routes.demo import _grant_write_role
    for current, expect_changed in ((None, True), ("viewer", True), ("read_only", True), ("trader", False), ("admin", False)):
        db = MagicMock()
        db.execute.return_value.first.return_value = (current,)
        assert _grant_write_role(db, uuid.uuid4()) is expect_changed
        updates = [str(c.args[0]) for c in db.execute.call_args_list if "UPDATE auth.users" in str(c.args[0])]
        assert bool(updates) is expect_changed


# ── Provisioning switch ─────────────────────────────────────────────────────

def test_provision_switch(monkeypatch):
    from api.routes import demo
    monkeypatch.delenv("RIJEKA_DEMO_PROVISION", raising=False); assert demo.enabled()
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0");             assert not demo.enabled()
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "false");         assert not demo.enabled()


# ── Chain quota ──────────────────────────────────────────────────────────────

def test_chain_quota_unset_is_unlimited(monkeypatch):
    from api.routes.chain import _check_chain_quota
    monkeypatch.delenv("RIJEKA_CHAIN_DAILY_LIMIT", raising=False)
    db = MagicMock()
    _check_chain_quota(db, uuid.uuid4())
    db.execute.assert_not_called()


def test_chain_quota_refuses_at_limit(monkeypatch):
    from fastapi import HTTPException
    from api.routes.chain import _check_chain_quota
    monkeypatch.setenv("RIJEKA_CHAIN_DAILY_LIMIT", "5")
    db = MagicMock()
    db.execute.return_value.scalar.return_value = 4
    _check_chain_quota(db, uuid.uuid4())                      # under: fine
    db.execute.return_value.scalar.return_value = 5
    with pytest.raises(HTTPException) as e:
        _check_chain_quota(db, uuid.uuid4())
    assert e.value.status_code == 429 and "limit of 5" in e.value.detail
