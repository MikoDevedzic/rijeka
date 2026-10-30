"""Anchoring survives a flaky RPC node: transient connection errors are retried, a broadcast that
the node acknowledged as already known is not resent, and a fallback node takes over."""
from types import SimpleNamespace
from unittest.mock import MagicMock

import requests

from chain import attestation as at


class FakeW3:
    """Just enough of web3 for EvmBackend._send: scripted failures per call."""
    def __init__(self, fail_plan):
        self.fail_plan = dict(fail_plan)          # method -> list of exceptions to raise first
        self.calls = []
        self.eth = SimpleNamespace(
            get_transaction_count=lambda addr, *a: self._call("nonce", 7),
            send_raw_transaction=lambda raw: self._call("send", b"\x11" * 32),
            wait_for_transaction_receipt=lambda h, timeout=0: self._call("receipt", SimpleNamespace(status=1, blockNumber=99)),
            get_block=lambda n: self._call("block", SimpleNamespace(timestamp=1700000000)),
            contract=lambda address, abi: MagicMock(abi=abi),
            chain_id=11155111,
        )

    def _call(self, name, value):
        self.calls.append(name)
        plan = self.fail_plan.get(name) or []
        if plan:
            raise plan.pop(0)
        return value


def _backend(w3, fallback=None):
    b = at.EvmBackend.__new__(at.EvmBackend)
    b.w3 = w3; b.chain_id = 11155111; b.registry = "0x" + "ab" * 20; b.explorer = None
    b.relayer = SimpleNamespace(address="0x" + "cd" * 20,
                                sign_transaction=lambda tx: SimpleNamespace(raw_transaction=b"raw", hash=b"\x11" * 32))
    b.fallback_rpc = fallback; b._switched = False
    b.contract = MagicMock()
    return b


def _fn():
    fn = MagicMock(); fn.build_transaction = lambda p: {"nonce": p["nonce"], "chainId": p["chainId"]}
    return fn


def test_transient_connection_errors_are_retried(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"nonce": [requests.exceptions.ConnectionError("Remote end closed connection without response")],
                 "receipt": [requests.exceptions.ReadTimeout("slow")]})
    rc = _backend(w3)._send(_fn(), "confirm")
    assert rc.anchored and rc.block_number == 99 and rc.tx_hash == "0x" + "11" * 32
    assert w3.calls.count("nonce") == 2 and w3.calls.count("receipt") == 2 and w3.calls.count("send") == 1


def test_a_send_the_node_already_knows_is_not_resent(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"send": [ValueError({"code": -32000, "message": "already known"})]})
    rc = _backend(w3)._send(_fn(), "confirm")
    assert rc.anchored and w3.calls.count("send") == 1 and "receipt" in w3.calls


def test_a_revert_is_not_retried(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"send": [ValueError({"code": -32000, "message": "execution reverted: not a party"})]})
    try:
        _backend(w3)._send(_fn(), "confirm")
        assert False, "should raise"
    except ValueError:
        pass
    assert w3.calls.count("send") == 1


def test_fallback_node_takes_over_after_repeated_failures(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    primary = FakeW3({"nonce": [requests.exceptions.ConnectionError("down")] * 4})
    secondary = FakeW3({})
    b = _backend(primary, fallback="https://sepolia.example")
    monkeypatch.setattr(b, "_connect", lambda url: secondary)
    rc = b._send(_fn(), "confirm")
    assert rc.anchored and b._switched and secondary.calls.count("nonce") == 1
    assert primary.calls.count("nonce") == 2            # two strikes on the primary, then the fallback


def test_gives_up_after_the_last_attempt(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"nonce": [requests.exceptions.ConnectionError("down")] * 10})
    try:
        _backend(w3)._send(_fn(), "confirm")
        assert False, "should raise"
    except requests.exceptions.ConnectionError:
        pass
    assert w3.calls.count("nonce") == at.RPC_ATTEMPTS


# ── reconciliation against the registry, and the fee ceiling ─────────────────

class _Rec:
    def __init__(self, status="Confirmed", block=4242, ts=1700000777):
        self.status, self.block_number, self.confirmed_at = status, block, ts


def test_nonce_already_used_reconciles_from_the_registry(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"send": [ValueError({"code": -32000, "message": "nonce too low"})]})
    rc = _backend(w3)._send(_fn(), "confirm", reconcile=lambda: _Rec())
    assert rc.anchored and rc.block_number == 4242 and rc.tx_hash is None and "earlier transaction" in rc.note
    assert w3.calls.count("send") == 1 and "receipt" not in w3.calls           # never waits on a hash that was not accepted


def test_nonce_already_used_without_a_record_retries_once_with_a_fresh_nonce(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"send": [ValueError({"code": -32000, "message": "nonce too low"})]})
    rc = _backend(w3)._send(_fn(), "confirm", reconcile=lambda: None)
    assert rc.anchored and w3.calls.count("nonce") == 2 and w3.calls.count("send") == 2


def test_revert_with_the_hash_already_recorded_is_the_anchor(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({})
    w3.eth.wait_for_transaction_receipt = lambda h, timeout=0: w3._call("receipt", SimpleNamespace(status=0, blockNumber=100))
    rc = _backend(w3)._send(_fn(), "confirm", reconcile=lambda: _Rec(block=100))
    assert rc.anchored and rc.block_number == 100 and rc.tx_hash is None


def test_revert_without_a_record_is_an_error(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({})
    w3.eth.wait_for_transaction_receipt = lambda h, timeout=0: w3._call("receipt", SimpleNamespace(status=0, blockNumber=100))
    try:
        _backend(w3)._send(_fn(), "confirm", reconcile=lambda: None)
        assert False, "should raise"
    except RuntimeError as e:
        assert "reverted" in str(e)


def test_timeout_waiting_for_the_receipt_reconciles(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    w3 = FakeW3({"receipt": [TimeoutError("not mined")] * 10})
    rc = _backend(w3)._send(_fn(), "confirm", reconcile=lambda: _Rec(block=7))
    assert rc.anchored and rc.block_number == 7


def test_fee_above_the_ceiling_is_refused_before_sending(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    monkeypatch.setenv("RIJEKA_CHAIN_MAX_FEE_GWEI", "50")
    w3 = FakeW3({})
    w3.eth.get_block = lambda n: SimpleNamespace(baseFeePerGas=int(60e9), timestamp=1700000000)
    w3.eth.max_priority_fee = int(2e9)
    try:
        _backend(w3)._send(_fn(), "confirm")
        assert False, "should raise"
    except at.FeeTooHigh:
        pass
    assert "send" not in w3.calls


def test_fees_are_set_under_the_ceiling_when_the_node_reports_a_base_fee(monkeypatch):
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    monkeypatch.setenv("RIJEKA_CHAIN_MAX_FEE_GWEI", "100")
    w3 = FakeW3({})
    w3.eth.get_block = lambda n: SimpleNamespace(baseFeePerGas=int(10e9), timestamp=1700000000)
    w3.eth.max_priority_fee = int(2e9)
    seen = {}
    fn = MagicMock(); fn.build_transaction = lambda p: seen.update(p) or {"nonce": p["nonce"], "chainId": p["chainId"]}
    rc = _backend(w3)._send(fn, "confirm")
    assert rc.anchored and seen["maxFeePerGas"] == 22e9 and seen["maxPriorityFeePerGas"] == 2e9


def test_sends_are_serialised_per_process():
    import threading
    order = []
    w3 = FakeW3({})
    slow = {"first": True}
    def receipt(h, timeout=0):
        if slow["first"]:
            slow["first"] = False; order.append("a-in"); at.time.sleep(0.2); order.append("a-out")
        else:
            order.append("b-in"); order.append("b-out")
        return SimpleNamespace(status=1, blockNumber=1)
    w3.eth.wait_for_transaction_receipt = receipt
    b = _backend(w3)
    t1 = threading.Thread(target=lambda: b._send(_fn(), "confirm")); t2 = threading.Thread(target=lambda: b._send(_fn(), "confirm"))
    t1.start(); at.time.sleep(0.02); t2.start(); t1.join(); t2.join()
    assert order == ["a-in", "a-out", "b-in", "b-out"]
