"""/api/public/pulse: unauthenticated, degrades field by field, cached."""
from datetime import date
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


def _db(curve_row=None, scalar=3):
    db = MagicMock()
    first = MagicMock(); first.first.return_value = curve_row
    def execute(sql, params=None):
        r = MagicMock()
        r.first.return_value = curve_row
        r.scalar.return_value = scalar
        return r
    db.execute.side_effect = execute
    return db


def test_pulse_is_public_and_filters_disabled_quotes(monkeypatch):
    from api.routes import public
    import main
    row = MagicMock(curve_id="USD_SOFR", valuation_date=date(2026, 10, 28),
                    quotes=[{"tenor": "1Y", "rate": 3.9}, {"tenor": "5Y", "rate": 4.1, "enabled": False},
                            {"tenor": "10Y", "rate": None}, {"tenor": "30Y", "rate": 4.4}])
    db = _db(curve_row=row, scalar=7)
    main.app.dependency_overrides[public.get_db] = lambda: db
    public._cache.update(at=0.0, body=None)
    with patch.object(public, "_template_user_id", return_value="uid"), \
         patch.object(public, "_chain", return_value={"anchored": True, "latest_block": 123}):
        r = TestClient(main.app).get("/api/public/pulse")          # no Authorization header
    main.app.dependency_overrides.clear()
    assert r.status_code == 200
    b = r.json()
    assert [q["tenor"] for q in b["curve"]["quotes"]] == ["1Y", "30Y"]
    assert b["confirmations"] == 7 and b["chain"]["latest_block"] == 123
    assert b["vol"]["curve_id"] == "USD_SOFR"    # the mock returns the same row for every snapshot query


def test_pulse_survives_missing_tables_and_chain():
    from api.routes import public
    db = MagicMock()
    db.execute.side_effect = RuntimeError("relation does not exist")
    with patch.object(public, "_template_user_id", return_value="uid"), \
         patch("chain.attestation.get_backend", side_effect=RuntimeError("no rpc")):
        b = public.build(db)
    assert b["curve"] is None and b["confirmations"] is None and b["chain"] == {"anchored": False}
    assert db.rollback.called


def test_pulse_is_cached(monkeypatch):
    from api.routes import public
    public._cache.update(at=0.0, body=None)
    calls = []
    with patch.object(public, "build", side_effect=lambda db: calls.append(1) or {"n": len(calls)}):
        assert public.pulse(db=MagicMock()) == {"n": 1}
        assert public.pulse(db=MagicMock()) == {"n": 1}
    assert len(calls) == 1
    public._cache.update(at=0.0, body=None)


def test_register_lists_anchored_confirmations_without_private_fields():
    from api.routes import public
    import main
    att = {"trade_hash": "0xabc", "bilateral": True, "schema_version": 2,
           "anchor": {"anchored": True, "block_number": 12, "tx_hash": "0xtx", "chain_id": 11155111, "registry": "0xreg", "confirmed_at": 1},
           "parties": {"own": {"lei": "LEI_A", "address": "0xA", "key_source": "env"}, "counterparty": {"lei": "LEI_B", "address": "0xB", "key_source": "registered"}}}
    row = MagicMock(payload={"attestation": att}, created_at=None, trade_id="t1", asset_class="RATES", instrument_type="IR_SWAP", structure="VANILLA")
    db = MagicMock()
    def execute(sql, params=None):
        r = MagicMock(); r.__iter__.return_value = iter([row]); r.scalar.return_value = 1; return r
    db.execute.side_effect = execute
    main.app.dependency_overrides[public.get_db] = lambda: db
    public._reg_cache.update(at=0.0, body=None, n=0)
    r = TestClient(main.app).get("/api/public/confirmations?limit=10")
    main.app.dependency_overrides.clear()
    assert r.status_code == 200
    b = r.json()
    assert b["total"] == 1 and b["confirmations"][0]["parties"] == ["LEI_A", "LEI_B"]
    assert b["confirmations"][0]["bilateral"] is True and b["confirmations"][0]["instrument_type"] == "IR_SWAP"
    assert "trade_ref" not in b["confirmations"][0] and "notional" not in b["confirmations"][0]
