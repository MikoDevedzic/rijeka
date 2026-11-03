"""Confirm without holding the request: the backend hands an unmined transaction back as AnchorPending
after the short wait, the route records the pending anchor and answers 202 without writing the
event, a second confirm while it is in flight does not send again, reconciliation applies the one
CONFIRMED transition exactly once when the registry has the record, and a reverted or dropped
transaction leaves the trade PENDING with the failure recorded."""
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from web3.exceptions import TimeExhausted

from api.routes import chain as CH
from api.routes import trade_events
from chain import attestation as at
from chain import pending as P
from chain.attestation import AnchorPending, AnchorReceipt, OnChainRecord
from tests.test_chain_anchor_retry import FakeW3, _backend, _fn

TX = "0x" + "11" * 32
HASH = "0x" + "ab" * 32


class _Res:
    def __init__(self, v): self.v = v
    def scalar(self): return self.v
    def first(self): return self.v
    def all(self): return self.v or []


class _Q:
    def filter(self, *a, **k): return self
    def order_by(self, *a, **k): return self
    def all(self): return []
    def first(self): return None


class _PendingDB:
    """A fake session with the pending_anchors semantics the module relies on (one open row per trade,
    the status flips, attempts), answering by SQL substring."""
    def __init__(self, table=True):
        self.rows: dict[str, dict] = {}; self.table = table; self.commits = self.rollbacks = 0; self.sql = []
    def query(self, model): return _Q()
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1
    def close(self): pass
    def _open(self, trade_id): return next((r for r in self.rows.values() if r["trade_id"] == trade_id and r["status"] == "PENDING"), None)
    def execute(self, sql, params=None):
        s = str(sql); p = params or {}; self.sql.append(s)
        if "to_regclass" in s:
            return _Res("pending_anchors" if self.table else None)
        if "INSERT INTO pending_anchors" in s:
            row = self._open(p["t"])
            if row is None:
                row = {"id": str(uuid.uuid4()), "trade_id": p["t"], "user_id": p["u"], "kind": "confirm", "trade_hash": p["h"], "tx_hash": p["tx"],
                       "explorer_tx": p["ex"], "attestation": p["a"], "idempotency_key": p["k"], "status": "PENDING", "reason": p["n"],
                       "submitted_at": p["now"], "checked_at": None, "resolved_at": None, "attempts": 0}
                self.rows[row["id"]] = row
            else:
                row.update(tx_hash=p["tx"] or row["tx_hash"], attestation=p["a"], reason=p["n"])
            return _Res(dict(row))
        if "WHERE trade_id = :t AND status = 'PENDING'" in s:
            r = self._open(p["t"]); return _Res(dict(r) if r else None)
        if "ORDER BY submitted_at DESC" in s:
            rs = sorted([r for r in self.rows.values() if r["trade_id"] == p["t"]], key=lambda r: r["submitted_at"], reverse=True)
            return _Res(dict(rs[0]) if rs else None)
        if "WHERE status = 'PENDING' ORDER BY submitted_at ASC" in s:
            return _Res([dict(r) for r in self.rows.values() if r["status"] == "PENDING"])
        if "FOR UPDATE" in s:
            r = self.rows.get(p["id"]); return _Res(dict(r) if r and r["status"] == "PENDING" else None)
        if "FROM pending_anchors WHERE id = :id" in s:
            r = self.rows.get(p["id"]); return _Res(dict(r) if r else None)
        if s.startswith("UPDATE pending_anchors"):
            r = self.rows[p["id"]]
            if "SET status = 'ANCHORED'" in s: r["status"] = "ANCHORED"
            if "SET status = 'FAILED'" in s: r["status"] = "FAILED"
            if "attempts = attempts + 1" in s: r["attempts"] += 1
            if "reason = :r" in s: r["reason"] = p["r"]
            if "reason = NULL" in s: r["reason"] = None
            return _Res(None)
        raise AssertionError(f"unexpected sql: {s[:80]}")


class FakeBackend:
    anchored = True; chain_id = 11155111; registry = "0x" + "cd" * 20; explorer = "https://sepolia.etherscan.io"
    def __init__(self, pending_first=True):
        self.confirms = 0; self.record = None; self.tx = {"state": "pending"}; self.pending_first = pending_first; self.last_wait = None
    def confirm(self, h, a, b, sa, sb, wait=None):
        self.confirms += 1; self.last_wait = wait
        if self.pending_first and self.confirms == 1:
            raise AnchorPending(TX, self.chain_id, self.registry, f"{self.explorer}/tx/{TX}", "transaction sent, not mined within 25s; being followed")
        return AnchorReceipt(True, self.chain_id, self.registry, "0x" + "22" * 32, 100, 1700000000, None)
    def get(self, h): return self.record
    def tx_state(self, tx): return self.tx


@pytest.fixture
def world(monkeypatch):
    P._table.update(at=0.0, present=None)
    monkeypatch.delenv("RIJEKA_CHAIN_SYNC_WAIT_S", raising=False)
    trade = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), trade_ref="IRS-1", status="PENDING")
    applied = []
    def fake_apply(db, user_id, trade, event_type, new_status, payload, idempotency_key, confirmation_hash=None, counterparty_confirmed=False):
        applied.append({"user_id": user_id, "event_type": event_type, "payload": payload, "key": idempotency_key, "hash": confirmation_hash})
        trade.status = new_status
        return {"trade": {"id": str(trade.id), "status": new_status}, "legs": [], "event_id": "e1", "idempotent_replay": False}
    monkeypatch.setattr(trade_events, "_apply_lifecycle_transition", fake_apply)
    monkeypatch.setattr(P, "_load_trade", lambda db, tid: trade)
    import api.routes.booking as booking
    monkeypatch.setattr(booking, "_serialize_trade", lambda t: {"id": str(t.id), "status": t.status, "trade_ref": t.trade_ref})
    base = {"schema_version": 2, "trade_hash": HASH, "parties": {"own": {"signature": "0xaa"}, "counterparty": {"signature": "0xbb"}},
            "eip712": {"chain_id": 11155111}, "bilateral": False}
    return SimpleNamespace(db=_PendingDB(), be=FakeBackend(), trade=trade, applied=applied, base=base)


def _confirm(w, key="k-1"):
    return CH.anchor_confirmation(w.db, w.trade, w.trade.user_id, w.be, bytes.fromhex(HASH[2:]), "0x" + "01" * 20, "0x" + "02" * 20,
                                  b"\x01" * 65, b"\x02" * 65, w.base, key)


def test_late_block_answers_202_and_reconciliation_applies_the_transition_once(world):
    w = world
    resp = _confirm(w)
    assert resp.status_code == 202
    body = json.loads(resp.body)
    assert body["pending"] is True and body["tx_hash"] == TX and body["explorer_tx"].endswith(TX) and body["trade"]["status"] == "PENDING"
    assert w.be.last_wait == 25.0 and w.trade.status == "PENDING" and w.applied == []
    row = next(iter(w.db.rows.values()))
    assert row["status"] == "PENDING" and row["tx_hash"] == TX and json.loads(row["attestation"])["parties"]["own"]["signature"] == "0xaa"

    # pressing CONFIRM again while the transaction is in flight reconciles; nothing is resent
    again = _confirm(w)
    assert again.status_code == 202 and w.be.confirms == 1 and len(w.db.rows) == 1

    # the poll while the node still holds the transaction
    out = P.reconcile_trade(w.db, w.trade, w.be)
    assert out["pending"] is True and out["tx_hash"] == TX and out["anchor"]["attempts"] >= 1 and w.applied == []

    # mined: the registry has the record, the receipt names the block
    w.be.record = OnChainRecord("0x01", "0x02", 1700000001, 123, "0x" + "00" * 32, "Confirmed")
    w.be.tx = {"state": "mined", "block_number": 123, "confirmed_at": 1700000001}
    out = P.reconcile_trade(w.db, w.trade, w.be)
    assert out["applied"] is True and out["status"] == "CONFIRMED" and out["trade"]["status"] == "CONFIRMED" and out["event_id"] == "e1"
    assert len(w.applied) == 1
    a = w.applied[0]
    att = a["payload"]["attestation"]
    assert a["event_type"] == "CONFIRMED" and a["hash"] == HASH and a["key"] == "k-1" and a["user_id"] == w.trade.user_id
    assert att["anchor"] == {"anchored": True, "chain_id": 11155111, "registry": w.be.registry, "tx_hash": TX, "block_number": 123,
                             "confirmed_at": 1700000001, "explorer_tx": f"{w.be.explorer}/tx/{TX}", "note": None}
    assert att["parties"]["counterparty"]["signature"] == "0xbb" and att["bilateral"] is False
    assert row["status"] == "ANCHORED" and w.trade.status == "CONFIRMED"

    # once only: a later poll, and the scheduler, find nothing to do
    out = P.reconcile_trade(w.db, w.trade, w.be)
    assert out["pending"] is False and out["applied"] is False and len(w.applied) == 1
    assert P.reconcile_pending(w.db, w.be) == {"open": 0}


def test_two_reconcilers_apply_once(world):
    w = world
    _confirm(w)
    w.be.record = OnChainRecord("0x01", "0x02", 1700000001, 123, "0x" + "00" * 32, "Confirmed")
    rows = P.open_rows(w.db)
    first = P.resolve(w.db, rows[0]["id"], w.be)
    second = P.resolve(w.db, rows[0]["id"], w.be)        # the row is no longer PENDING: nothing to apply
    assert first["outcome"] == "applied" and second["outcome"] == "gone" and len(w.applied) == 1


def test_a_reverted_transaction_fails_the_anchor_and_the_trade_stays_pending(world):
    w = world
    assert _confirm(w).status_code == 202
    w.be.tx = {"state": "reverted", "block_number": 7}
    out = P.reconcile_trade(w.db, w.trade, w.be)
    assert out["failed"] is True and "reverted" in out["reason"] and out["status"] == "PENDING" and out["pending"] is False
    row = next(iter(w.db.rows.values()))
    assert row["status"] == "FAILED" and "reverted" in row["reason"] and w.trade.status == "PENDING" and w.applied == []
    # the poll after the failure reports it, and nothing is resent by polling
    out = P.reconcile_trade(w.db, w.trade, w.be)
    assert out["failed"] is True and w.be.confirms == 1
    # RETRY CONFIRM sends a fresh transaction; this one is mined inside the wait: the synchronous path, 201 shape
    w.be.tx = {"state": "pending"}
    res = _confirm(w, key="k-2")
    assert isinstance(res, dict) and res["trade"]["status"] == "CONFIRMED" and w.be.confirms == 2 and len(w.applied) == 1
    assert w.applied[0]["payload"]["attestation"]["anchor"]["tx_hash"] == "0x" + "22" * 32 and w.applied[0]["key"] == "k-2"


def test_the_scheduler_step_resolves_every_open_row(world):
    w = world
    _confirm(w)
    other = SimpleNamespace(id=uuid.uuid4(), user_id=w.trade.user_id, trade_ref="IRS-2", status="PENDING")
    P.record(w.db, trade_id=other.id, user_id=other.user_id, trade_hash="0x" + "ee" * 32, attestation=w.base, idempotency_key=None,
             tx_hash="0x" + "33" * 32, explorer_tx=None, note=None)
    assert P.reconcile_pending(w.db, w.be)["pending"] == 2
    w.be.record = OnChainRecord("0x01", "0x02", 1700000001, 123, "0x" + "00" * 32, "Confirmed")
    counts = P.reconcile_pending(w.db, w.be)
    assert counts["open"] == 2 and counts["applied"] + counts["gone"] == 2 and all(r["status"] == "ANCHORED" for r in w.db.rows.values())


def test_check_rules_for_dropped_old_and_hashless_anchors():
    be = FakeBackend(); be.tx = {"state": "unknown"}
    now = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
    row = {"trade_id": str(uuid.uuid4()), "trade_hash": HASH, "tx_hash": TX, "submitted_at": now - timedelta(minutes=5)}
    assert P.check(be, row, now)[0] == "pending"
    row["submitted_at"] = now - timedelta(minutes=20)
    state, why = P.check(be, row, now)
    assert state == "failed" and "dropped" in why
    be.tx = {"state": "pending"}; row["submitted_at"] = now - timedelta(hours=3)
    assert P.check(be, row, now)[0] == "failed"
    be.tx = {"state": "unknown"}; row["tx_hash"] = None; row["submitted_at"] = now - timedelta(minutes=40)
    assert P.check(be, row, now) == ("failed", "no transaction hash and no registry record after 30 minutes")
    row["submitted_at"] = now - timedelta(minutes=10)
    assert P.check(be, row, now)[0] == "pending"
    be.record = OnChainRecord("0x01", "0x02", 1700000001, 55, "0x" + "00" * 32, "Confirmed")
    state, rc = P.check(be, row, now)
    assert state == "anchored" and rc.block_number == 55 and rc.tx_hash is None and "registry" in rc.note


def test_backend_hands_back_an_unmined_transaction_only_when_asked_to_wait_briefly(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"receipt": [TimeExhausted("not mined")] * 10})
    with pytest.raises(AnchorPending) as e:
        _backend(w3)._send(_fn(), "confirm", reconcile=lambda: None, wait=25)
    assert e.value.tx_hash == TX and e.value.chain_id == 11155111 and e.value.explorer_tx is None and "25s" in e.value.note
    w3 = FakeW3({"receipt": [TimeExhausted("not mined")] * 10})
    with pytest.raises(TimeExhausted):                      # the full wait keeps today's behaviour: the error, not a pending
        _backend(w3)._send(_fn(), "confirm", reconcile=lambda: None)
    assert at.NullBackend().tx_state(TX) == {"state": "unknown"}


def test_sync_wait_needs_the_table_and_reads_the_environment(monkeypatch):
    P._table.update(at=0.0, present=None)
    assert P.sync_wait(_PendingDB(table=False)) is None
    P._table.update(at=0.0, present=None)
    db = _PendingDB()
    monkeypatch.delenv("RIJEKA_CHAIN_SYNC_WAIT_S", raising=False)
    assert P.sync_wait(db) == 25.0
    monkeypatch.setenv("RIJEKA_CHAIN_SYNC_WAIT_S", "40")
    assert P.sync_wait(db) == 40.0
    monkeypatch.setenv("RIJEKA_CHAIN_SYNC_WAIT_S", "0")
    assert P.sync_wait(db) is None
    assert P.reconcile_pending(_PendingDB(table=False) if P._table.update(at=0.0, present=None) is None else None) == {"skipped": "pending_anchors table missing"}


def test_reconcile_route_is_owner_only_and_reports_the_anchor(world, monkeypatch):
    w = world
    _confirm(w)
    uid = str(w.trade.user_id)
    class _TQ(_Q):
        def __init__(s, t): s.t = t
        def first(s): return s.t
    db = w.db
    db.query = lambda model: _TQ(w.trade)
    monkeypatch.setattr(CH, "get_backend", lambda: w.be)
    app = FastAPI(); app.include_router(CH.router)
    app.dependency_overrides[CH.get_db] = lambda: db
    app.dependency_overrides[CH.verify_token] = lambda: {"sub": uid, "user_metadata": {"role": "trader"}}
    c = TestClient(app)
    r = c.post(f"/api/chain/reconcile/{w.trade.id}")
    assert r.status_code == 200 and r.json()["pending"] is True and r.json()["tx_hash"] == TX
    w.be.record = OnChainRecord("0x01", "0x02", 1700000001, 123, "0x" + "00" * 32, "Confirmed")
    r = c.post(f"/api/chain/reconcile/{w.trade.id}")
    assert r.json()["applied"] is True and r.json()["status"] == "CONFIRMED" and len(w.applied) == 1
    r = c.post(f"/api/chain/reconcile/{w.trade.id}")
    assert r.json() == {"pending": False, "applied": False, "status": "CONFIRMED"}
    db.query = lambda model: _TQ(None)
    assert c.post(f"/api/chain/reconcile/{uuid.uuid4()}").status_code == 404
