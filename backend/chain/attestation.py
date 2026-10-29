"""
AttestationBackend — where a signed confirmation is anchored.

  EvmBackend   web3 against any EVM RPC (Anvil, Sepolia, mainnet, Besu),
               submitting to TradeConfirmationRegistry via a relayer key.
  NullBackend  no chain configured: signatures are still produced and
               stored off-chain, and every response says anchored=False.

The backend is chosen from the environment:
  RIJEKA_CHAIN_RPC            e.g. http://127.0.0.1:8545
  RIJEKA_CHAIN_RPC_FALLBACK   optional second node, used after the primary fails twice in a call
  RIJEKA_CHAIN_REGISTRY       deployed TradeConfirmationRegistry address
  RIJEKA_CHAIN_RELAYER_KEY    key that pays gas (anvil account 0 in dev)
  RIJEKA_CHAIN_EXPLORER       optional, e.g. https://sepolia.etherscan.io
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Protocol

import requests
from eth_utils import to_checksum_address

log = logging.getLogger("rijeka.chain")

# A public RPC node drops a connection now and then. Each chain call is retried
# with backoff; after two strikes on the primary node the fallback node (if
# configured) takes over for the rest of the process. A broadcast the node
# already acknowledged is never resent.
RPC_ATTEMPTS = 4
_TRANSIENT = (requests.exceptions.ConnectionError, requests.exceptions.Timeout, ConnectionError, TimeoutError)
_ALREADY_SENT = ("already known", "already imported", "nonce too low", "known transaction", "replacement transaction underpriced")

_ABI_PATH = Path(__file__).with_name("TradeConfirmationRegistry.json")

EXPLORERS = {
    1:        "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
}


@dataclass
class OnChainRecord:
    party_a:      str
    party_b:      str
    confirmed_at: int
    block_number: int
    prev_hash:    str
    status:       str            # None | Confirmed | Superseded | Terminated


@dataclass
class AnchorReceipt:
    anchored:     bool
    chain_id:     int
    registry:     Optional[str]
    tx_hash:      Optional[str]
    block_number: Optional[int]
    confirmed_at: Optional[int]
    explorer_tx:  Optional[str]
    note:         Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


class AttestationBackend(Protocol):
    chain_id: int
    registry: Optional[str]
    anchored: bool
    def confirm(self, trade_hash: bytes, party_a: str, party_b: str, sig_a: bytes, sig_b: bytes) -> AnchorReceipt: ...
    def amend(self, prev_hash: bytes, new_hash: bytes, sig_a: bytes, sig_b: bytes) -> AnchorReceipt: ...
    def terminate(self, trade_hash: bytes, sig_a: bytes, sig_b: bytes) -> AnchorReceipt: ...
    def get(self, trade_hash: bytes) -> Optional[OnChainRecord]: ...
    def confirmation_digest(self, trade_hash: bytes, counterparty: str) -> bytes: ...
    def amendment_digest(self, prev_hash: bytes, new_hash: bytes, counterparty: str) -> bytes: ...
    def termination_digest(self, trade_hash: bytes, counterparty: str) -> bytes: ...


# ── Null ─────────────────────────────────────────────────────────────────────

class NullBackend:
    chain_id = 0
    registry = None
    anchored = False

    _NOTE = "No chain configured (RIJEKA_CHAIN_RPC unset): attestation stored off-chain only."

    def confirm(self, trade_hash, party_a, party_b, sig_a, sig_b) -> AnchorReceipt:
        return AnchorReceipt(False, 0, None, None, None, None, None, note=self._NOTE)

    def amend(self, prev_hash, new_hash, sig_a, sig_b) -> AnchorReceipt:
        return AnchorReceipt(False, 0, None, None, None, None, None, note=self._NOTE)

    def terminate(self, trade_hash, sig_a, sig_b) -> AnchorReceipt:
        return AnchorReceipt(False, 0, None, None, None, None, None, note=self._NOTE)

    def get(self, trade_hash) -> Optional[OnChainRecord]:
        return None

    def confirmation_digest(self, trade_hash, counterparty) -> bytes:
        raise RuntimeError("No chain configured")

    def amendment_digest(self, prev_hash, new_hash, counterparty) -> bytes:
        raise RuntimeError("No chain configured")

    def termination_digest(self, trade_hash, counterparty) -> bytes:
        raise RuntimeError("No chain configured")


# ── EVM ──────────────────────────────────────────────────────────────────────

def load_artifact() -> dict:
    with open(_ABI_PATH) as f:
        return json.load(f)


class EvmBackend:
    anchored = True

    def __init__(self, rpc_url: str, registry: str, relayer_key: str, explorer: Optional[str] = None,
                 fallback_rpc: Optional[str] = None):
        self.w3 = self._connect(rpc_url)
        if not self.w3.is_connected():
            raise ConnectionError(f"Cannot reach chain RPC at {rpc_url}")
        self.fallback_rpc = fallback_rpc
        self._switched = False
        self.chain_id = self.w3.eth.chain_id
        self.registry = to_checksum_address(registry)
        self.relayer  = self.w3.eth.account.from_key(relayer_key)
        art = load_artifact()
        self.contract = self.w3.eth.contract(address=self.registry, abi=art["abi"])
        self.explorer = explorer or EXPLORERS.get(self.chain_id)

    @staticmethod
    def _connect(rpc_url: str):
        from web3 import Web3
        return Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))

    def _use_fallback(self) -> None:
        if not self.fallback_rpc or self._switched:
            return
        log.warning("chain: primary RPC failing, switching to the fallback node")
        self.w3 = self._connect(self.fallback_rpc)
        self.contract = self.w3.eth.contract(address=self.registry, abi=self.contract.abi)
        self._switched = True

    def _retry(self, what: str, call):
        delay = 1.0
        for attempt in range(1, RPC_ATTEMPTS + 1):
            try:
                return call()
            except _TRANSIENT as e:
                if attempt == RPC_ATTEMPTS:
                    raise
                log.warning("chain: %s failed (%s), attempt %d/%d", what, str(e)[:120], attempt, RPC_ATTEMPTS)
                if attempt >= 2:
                    self._use_fallback()
                time.sleep(delay)
                delay = min(delay * 2, 8.0)

    def _explorer_tx(self, tx_hash: str) -> Optional[str]:
        return f"{self.explorer}/tx/{tx_hash}" if self.explorer else None

    def confirmation_digest(self, trade_hash: bytes, counterparty: str) -> bytes:
        return self.contract.functions.confirmationDigest(trade_hash, to_checksum_address(counterparty)).call()

    def amendment_digest(self, prev_hash: bytes, new_hash: bytes, counterparty: str) -> bytes:
        return self.contract.functions.amendmentDigest(prev_hash, new_hash, to_checksum_address(counterparty)).call()

    def termination_digest(self, trade_hash: bytes, counterparty: str) -> bytes:
        return self.contract.functions.terminationDigest(trade_hash, to_checksum_address(counterparty)).call()

    def _send(self, fn, label: str) -> AnchorReceipt:
        """Sign with the relayer, submit, wait for the receipt. Reverts raise."""
        nonce = self._retry("nonce", lambda: self.w3.eth.get_transaction_count(self.relayer.address))
        tx = self._retry("build", lambda: fn.build_transaction({
            "from":  self.relayer.address,
            "nonce": nonce,
            "chainId": self.chain_id,
        }))
        signed = self.relayer.sign_transaction(tx)

        def broadcast():
            try:
                return self.w3.eth.send_raw_transaction(signed.raw_transaction)
            except ValueError as e:        # the node answered: either it already has this tx, or it rejected it
                msg = str(e).lower()
                if any(k in msg for k in _ALREADY_SENT):
                    log.info("chain: node already holds the %s transaction; waiting for its receipt", label)
                    return signed.hash
                raise
        h = self._retry("send", broadcast)
        rcpt = self._retry("receipt", lambda: self.w3.eth.wait_for_transaction_receipt(h, timeout=180))
        if rcpt.status != 1:
            raise RuntimeError(f"{label}() reverted in tx {h.hex()}")
        blk = self._retry("block", lambda: self.w3.eth.get_block(rcpt.blockNumber))
        tx_hex = "0x" + h.hex() if not h.hex().startswith("0x") else h.hex()
        return AnchorReceipt(True, self.chain_id, self.registry, tx_hex,
                             int(rcpt.blockNumber), int(blk.timestamp), self._explorer_tx(tx_hex))

    def confirm(self, trade_hash, party_a, party_b, sig_a, sig_b) -> AnchorReceipt:
        return self._send(self.contract.functions.confirm(
            trade_hash, to_checksum_address(party_a), to_checksum_address(party_b), sig_a, sig_b), "confirm")

    def amend(self, prev_hash, new_hash, sig_a, sig_b) -> AnchorReceipt:
        """Supersede prev_hash with new_hash. Parties are the pair recorded for prev_hash."""
        return self._send(self.contract.functions.amend(prev_hash, new_hash, sig_a, sig_b), "amend")

    def terminate(self, trade_hash, sig_a, sig_b) -> AnchorReceipt:
        return self._send(self.contract.functions.terminate(trade_hash, sig_a, sig_b), "terminate")

    def get(self, trade_hash) -> Optional[OnChainRecord]:
        a, b, ts, blk, prev, status = self.contract.functions.getConfirmation(trade_hash).call()
        if status == 0:
            return None
        return OnChainRecord(a, b, int(ts), int(blk), "0x" + bytes(prev).hex(),
                             ["None", "Confirmed", "Superseded", "Terminated"][status])


# ── Factory ──────────────────────────────────────────────────────────────────

_backend: Optional[AttestationBackend] = None


def get_backend(refresh: bool = False) -> AttestationBackend:
    global _backend
    if _backend is not None and not refresh:
        return _backend
    rpc = os.getenv("RIJEKA_CHAIN_RPC")
    reg = os.getenv("RIJEKA_CHAIN_REGISTRY")
    key = os.getenv("RIJEKA_CHAIN_RELAYER_KEY")
    if rpc and reg and key:
        _backend = EvmBackend(rpc, reg, key, os.getenv("RIJEKA_CHAIN_EXPLORER"),
                              fallback_rpc=os.getenv("RIJEKA_CHAIN_RPC_FALLBACK") or None)
    else:
        _backend = NullBackend()
    return _backend
