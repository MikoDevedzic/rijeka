"""The desk globe's feed: chain health with the relayer balance, the action inbox, recent anchors
and the book drawn as arcs between home cities."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
import uuid

from api.routes import desk


def test_city_lookup_prefers_jurisdiction_then_currency_then_default():
    assert desk.city_for(SimpleNamespace(jurisdiction="CH", home_currency="USD"))["city"] == "ZURICH"
    assert desk.city_for(SimpleNamespace(jurisdiction="XX", home_currency="GBP"))["city"] == "LONDON"
    assert desk.city_for(None)["city"] == "NEW YORK"
    assert desk.city_for(SimpleNamespace(jurisdiction=None, home_currency=None), default="JP")["city"] == "TOKYO"


def test_chain_health_reads_block_and_relayer_balance(monkeypatch):
    desk._chain_cache.update(at=0.0, body=None)
    w3 = SimpleNamespace(eth=SimpleNamespace(block_number=9_900_001, get_balance=lambda a: int(0.0123 * 1e18)))
    be = SimpleNamespace(anchored=True, chain_id=11155111, registry="0x" + "ab" * 20, explorer="https://sepolia.etherscan.io",
                         w3=w3, relayer=SimpleNamespace(address="0x" + "cd" * 20), _switched=False)
    import chain.attestation as at
    monkeypatch.setattr(at, "get_backend", lambda: be)
    h = desk._chain_health()
    assert h["network"] == "SEPOLIA" and h["latest_block"] == 9_900_001 and h["reachable"] and h["node"] == "primary"
    assert h["relayer"]["low"] and abs(h["relayer"]["balance_eth"] - 0.0123) < 1e-9
    desk._chain_cache.update(at=0.0, body=None)


def test_chain_health_is_off_chain_without_a_backend(monkeypatch):
    desk._chain_cache.update(at=0.0, body=None)
    import chain.attestation as at
    monkeypatch.setattr(at, "get_backend", lambda: SimpleNamespace(anchored=False, chain_id=0))
    assert desk._chain_health() == {"anchored": False, "network": "OFF-CHAIN"}
    desk._chain_cache.update(at=0.0, body=None)


class _Q:
    def __init__(self, rows): self.rows = rows
    def filter(self, *a, **k): return self
    def all(self): return self.rows
    def first(self): return self.rows[0] if self.rows else None


def _db(by_model, exec_rows):
    db = MagicMock()
    db.query = lambda m: _Q(by_model.get(m, []))
    class _Res:
        def __init__(self, rows): self.rows = rows
        def __iter__(self): return iter(self.rows)
        def scalar(self): return self.rows[0] if self.rows else 0
    db.execute = lambda sql, params=None: _Res(exec_rows.get(str(sql).strip().split("\n")[0][:20], []))
    return db


def test_lifecycle_builds_inbox_arcs_and_anchors(monkeypatch):
    uid = str(uuid.uuid4())
    own = SimpleNamespace(id=uuid.uuid4(), is_own_entity=True, is_active=True, jurisdiction="US", home_currency="USD")
    bank_ent = SimpleNamespace(id=uuid.uuid4(), is_own_entity=False, is_active=True, jurisdiction="CH", home_currency="USD")
    cp = SimpleNamespace(id=uuid.uuid4(), name="RIJEKA DEMO BANK", legal_entity_id=bank_ent.id)
    now = datetime.now(timezone.utc)
    t_conf = SimpleNamespace(id=uuid.uuid4(), trade_ref="IRS-1", status="CONFIRMED", counterparty_id=cp.id, instrument_type="IR_SWAP",
                             asset_class="RATES", maturity_date=date.today() + timedelta(days=10), notional=10e6, notional_ccy="USD", created_at=now)
    t_pend = SimpleNamespace(id=uuid.uuid4(), trade_ref="FXF-2", status="PENDING", counterparty_id=cp.id, instrument_type="FX_FORWARD",
                             asset_class="FX", maturity_date=date.today() + timedelta(days=400), notional=5e6, notional_ccy="EUR", created_at=now)
    t_old = SimpleNamespace(id=uuid.uuid4(), trade_ref="IRS-0", status="CANCELLED", counterparty_id=cp.id, instrument_type="IR_SWAP",
                            asset_class="RATES", maturity_date=None, notional=None, notional_ccy=None, created_at=now)
    anchored = {"attestation": {"trade_hash": "0xaa", "bilateral": True, "anchor": {"anchored": True, "block_number": 123, "tx_hash": "0xtx", "explorer_tx": "https://x/tx"}}}
    off = {"attestation": {"trade_hash": "0xbb", "bilateral": False, "anchor": {"anchored": False, "note": "No chain configured"}}}
    firm_id = uuid.uuid4()
    rows = {
        "SELECT m.id AS messa": [SimpleNamespace(message_id=uuid.uuid4(), room_id=uuid.uuid4(), created_at=now,
                                                  card={"trade_ref": "IRS-9", "booker_firm": "ACME CAPITAL"}, status="PENDING")],
        "SELECT e.created_at,": [SimpleNamespace(created_at=now, payload=anchored, trade_ref="IRS-1", instrument_type="IR_SWAP", asset_class="RATES", counterparty_id=cp.id, mine=True),
                                 SimpleNamespace(created_at=now - timedelta(days=1), payload=off, trade_ref="IRS-7", instrument_type="IR_SWAP", asset_class="RATES", counterparty_id=cp.id, mine=True)],
    }
    rows["SELECT t.status, (t."] = [SimpleNamespace(status="CONFIRMED", mine=False, own_j="GB", own_c="GBP", cp_j="JP", cp_c="JPY")] * 2
    rows["SELECT count(*) FROM"] = [7]
    db = _db({desk.Trade: [t_conf, t_pend, t_old], desk.Counterparty: [cp], desk.LegalEntity: [own, bank_ent],
              desk.FirmMember: [SimpleNamespace(user_id=uid, firm_id=firm_id)]}, rows)
    monkeypatch.setattr(desk, "_chain_health", lambda: {"anchored": True, "network": "SEPOLIA", "latest_block": 1, "reachable": True,
                                                        "relayer": {"address": "0x1", "balance_eth": 0.01, "low": True}})
    out = desk.lifecycle(db, {"sub": uid})
    kinds = [a["kind"] for a in out["actions"]]
    assert kinds == ["COUNTERSIGN", "AWAITING", "MATURITY", "OFF_CHAIN", "WALLET"]
    assert out["actions"][0]["title"] == "Countersign IRS-9" and "ACME" in out["actions"][0]["detail"]
    assert out["actions"][2]["title"] == "IRS-1 matures in 10d"
    assert out["home"]["city"] == "NEW YORK"
    assert [a["trade_ref"] for a in out["arcs"]] == ["IRS-1", "FXF-2"] and out["arcs"][0]["to"]["city"] == "ZURICH"
    assert out["anchors"][0]["anchored"] and out["anchors"][0]["explorer_tx"] == "https://x/tx" and out["anchors"][0]["counterparty"] == "RIJEKA DEMO BANK"
    assert out["counts"] == {"confirmed": 1, "pending": 1, "anchored": 1, "actions": 5}
    net = out["network"]
    assert net["total_anchored"] == 7 and net["arcs"] == [{"from": desk.city_for(SimpleNamespace(jurisdiction="GB", home_currency="GBP")),
                                                           "to": desk.city_for(SimpleNamespace(jurisdiction="JP", home_currency="JPY")),
                                                           "status": "CONFIRMED", "mine": False, "count": 2}]
    assert [a["mine"] for a in net["anchors"]] == [True] and net["anchors"][0]["block_number"] == 123   # the off-chain one is not in orbit


def test_lifecycle_route_needs_auth():
    import main
    from fastapi.testclient import TestClient
    assert TestClient(main.app).get("/api/desk/lifecycle").status_code == 401
