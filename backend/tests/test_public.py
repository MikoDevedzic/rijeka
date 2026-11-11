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


H1, H2, ADDR_A, ADDR_B, REG = "0x" + "ab" * 32, "0x" + "cd" * 32, "0x" + "a1" * 20, "0x" + "b2" * 20, "0x920AE5AC65f72CB58af5bD3eF48168d9151dEd6e"
LEI_A, LEI_B = "DEMO0000000A00004000", "DEMO0000RIJEKABANK01"


def _register_of(rows):
    from api.routes import public
    import main
    db = MagicMock()
    def execute(sql, params=None):
        r = MagicMock(); r.__iter__.return_value = iter(rows); r.scalar.return_value = len(rows); return r
    db.execute.side_effect = execute
    main.app.dependency_overrides[public.get_db] = lambda: db
    public._reg_cache.update(at=0.0, body=None, n=0)
    r = TestClient(main.app).get("/api/public/confirmations?limit=10")
    main.app.dependency_overrides.clear()
    public._reg_cache.update(at=0.0, body=None, n=0)
    assert r.status_code == 200
    return r.json()


def _row(att, **kw):
    f = {"asset_class": "RATES", "instrument_type": "IR_SWAP", "structure": "VANILLA", **kw}
    return MagicMock(payload={"attestation": att}, created_at=None, trade_id="t1", **f)


def _att(**parties):
    return {"trade_hash": H1, "bilateral": True, "schema_version": 2,
            "anchor": {"anchored": True, "block_number": 12, "tx_hash": H2, "chain_id": 11155111, "registry": REG, "confirmed_at": 1,
                       "explorer_tx": "https://sepolia.etherscan.io/tx/" + H2},
            "parties": {"own": {"lei": LEI_A, "address": ADDR_A, "key_source": "env", **parties.get("own", {})},
                        "counterparty": {"lei": LEI_B, "address": ADDR_B, "key_source": "registered", **parties.get("counterparty", {})}}}


def test_register_lists_anchored_confirmations_without_private_fields():
    b = _register_of([_row(_att())])
    c = b["confirmations"][0]
    assert b["total"] == 1 and c["parties"] == [LEI_A, LEI_B]
    assert c["bilateral"] is True and c["instrument_type"] == "IR_SWAP" and c["structure"] == "VANILLA" and c["asset_class"] == "RATES"
    assert c["trade_hash"] == H1 and c["tx_hash"] == H2 and c["registry"] == REG and c["chain_id"] == 11155111 and c["block_number"] == 12
    assert c["explorer_tx"] == "https://sepolia.etherscan.io/tx/" + H2 and c["addresses"] == [ADDR_A, ADDR_B] and c["key_sources"] == ["env", "registered"]
    assert "trade_ref" not in c and "notional" not in c


def test_the_register_gives_out_nothing_that_is_not_in_the_shape_its_field_must_have():
    """What desks typed reaches this public answer (an LEI, a product), and until 11 November 2026 the public page
    wrote it into the page as markup. A demo key signs for any LEI that begins DEMO, so such a row could be anchored."""
    evil = '<img src=x onerror="alert(1)">'
    att = _att(own={"lei": "DEMO" + evil, "address": evil, "key_source": evil})
    att["anchor"].update(tx_hash=evil, registry='"><script>1</script>', explorer_tx="javascript:alert(1)", chain_id=evil, block_number=evil)
    no_hash = _att(); no_hash["trade_hash"] = H1 + evil
    b = _register_of([_row(att, asset_class=evil, instrument_type="IR_SWAP" + evil, structure=evil), _row(no_hash)])
    assert len(b["confirmations"]) == 1, "a row whose hash is not a hash is not listed: there is nothing to check on chain"
    c = b["confirmations"][0]
    assert c["trade_hash"] == H1 and c["parties"] == [LEI_B], "the party that is not an LEI is left out; the row stays (it is anchored)"
    for k in ("tx_hash", "registry", "explorer_tx", "chain_id", "block_number", "asset_class", "instrument_type", "structure"):
        assert c[k] is None, k
    assert c["addresses"] == [None, ADDR_B] and c["key_sources"] == [None, "registered"]
    import json
    assert not any(ch in json.dumps(b["confirmations"]) for ch in "<>") and "javascript" not in json.dumps(b), "no markup anywhere in the answer"
    # a final newline is not part of any shape (a row written straight to the database can end in one)
    nl = _att(own={"lei": LEI_A + "\n"})
    nl["anchor"].update(explorer_tx="https://sepolia.etherscan.io/tx/" + H2 + "\n")
    c = _register_of([_row(nl, instrument_type="IR_SWAP\n")])["confirmations"][0]
    assert c["parties"] == [LEI_B] and c["explorer_tx"] is None and c["instrument_type"] is None
    # a self-hosted explorer on its own port is kept
    port = _att(); port["anchor"].update(explorer_tx="https://explorer.desk.example:8443/tx/" + H2)
    assert _register_of([_row(port)])["confirmations"][0]["explorer_tx"] == "https://explorer.desk.example:8443/tx/" + H2
    # the labels the app writes today all pass: an option's structure, a package's
    ok = _register_of([_row(_att(), asset_class="FX", instrument_type="FX_OPTION", structure="DOUBLE_BARRIER")])["confirmations"][0]
    assert (ok["asset_class"], ok["instrument_type"], ok["structure"]) == ("FX", "FX_OPTION", "DOUBLE_BARRIER")


def test_the_pulse_reads_the_demo_setting_the_way_everything_else_does(monkeypatch):
    """Until 0.16.2 the pulse said demo for any non-empty value, 0 included, and not-demo when the variable was unset."""
    from api.routes import demo, public
    for value, want in (("0", False), ("false", False), ("1", True), (None, True)):
        monkeypatch.delenv("RIJEKA_DEMO_PROVISION", raising=False)
        if value is not None:
            monkeypatch.setenv("RIJEKA_DEMO_PROVISION", value)
        assert public._demo_provisioning() is want and demo.enabled() is want, value
    import inspect
    assert 'os.getenv("RIJEKA_DEMO_PROVISION")' not in inspect.getsource(public)
