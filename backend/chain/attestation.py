"""
AttestationBackend — where a signed confirmation is anchored.

  EvmBackend   web3 against any EVM RPC (Anvil, Sepolia, mainnet, Besu),
               submitting to TradeConfirmationRegistry via a relayer key.
  NullBackend  no chain configured: signatures are still produced and
               stored off-chain, and every response says anchored=False.

The backend is chosen from the environment:
  RIJEKA_CHAIN_RPC            e.g. http://127.0.0.1:8545
  RIJEKA_CHAIN_REGISTRY       deployed TradeConfirmationRegistry address
  RIJEKA_CHAIN_RELAYER_KEY    key that pays gas (anvil account 0 in dev)
  RIJEKA_CHAIN_EXPLORER       optional, e.g. https://sepolia.etherscan.io
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Protocol

from eth_utils import to_checksum_address

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
    def get(self, trade_hash: bytes) -> Optional[OnChainRecord]: ...
    def confirmation_digest(self, trade_hash: bytes, counterparty: str) -> bytes: ...


# ── Null ─────────────────────────────────────────────────────────────────────

class NullBackend:
    chain_id = 0
    registry = None
    anchored = False

    def confirm(self, trade_hash, party_a, party_b, sig_a, sig_b) -> AnchorReceipt:
        return AnchorReceipt(False, 0, None, None, None, None, None,
                             note="No chain configured (RIJEKA_CHAIN_RPC unset): attestation stored off-chain only.")

    def get(self, trade_hash) -> Optional[OnChainRecord]:
        return None

    def confirmation_digest(self, trade_hash, counterparty) -> bytes:
        raise RuntimeError("No chain configured")


# ── EVM ──────────────────────────────────────────────────────────────────────

def load_artifact() -> dict:
    with open(_ABI_PATH) as f:
        return json.load(f)


class EvmBackend:
    anchored = True

    def __init__(self, rpc_url: str, registry: str, relayer_key: str, explorer: Optional[str] = None):
        from web3 import Web3
        self.w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
        if not self.w3.is_connected():
            raise ConnectionError(f"Cannot reach chain RPC at {rpc_url}")
        self.chain_id = self.w3.eth.chain_id
        self.registry = to_checksum_address(registry)
        self.relayer  = self.w3.eth.account.from_key(relayer_key)
        art = load_artifact()
        self.contract = self.w3.eth.contract(address=self.registry, abi=art["abi"])
        self.explorer = explorer or EXPLORERS.get(self.chain_id)

    def _explorer_tx(self, tx_hash: str) -> Optional[str]:
        return f"{self.explorer}/tx/{tx_hash}" if self.explorer else None

    def confirmation_digest(self, trade_hash: bytes, counterparty: str) -> bytes:
        return self.contract.functions.confirmationDigest(trade_hash, to_checksum_address(counterparty)).call()

    def confirm(self, trade_hash, party_a, party_b, sig_a, sig_b) -> AnchorReceipt:
        fn = self.contract.functions.confirm(trade_hash, to_checksum_address(party_a),
                                             to_checksum_address(party_b), sig_a, sig_b)
        tx = fn.build_transaction({
            "from":  self.relayer.address,
            "nonce": self.w3.eth.get_transaction_count(self.relayer.address),
            "chainId": self.chain_id,
        })
        signed = self.relayer.sign_transaction(tx)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        rcpt = self.w3.eth.wait_for_transaction_receipt(h, timeout=180)
        if rcpt.status != 1:
            raise RuntimeError(f"confirm() reverted in tx {h.hex()}")
        blk = self.w3.eth.get_block(rcpt.blockNumber)
        tx_hex = "0x" + h.hex() if not h.hex().startswith("0x") else h.hex()
        return AnchorReceipt(True, self.chain_id, self.registry, tx_hex,
                             int(rcpt.blockNumber), int(blk.timestamp), self._explorer_tx(tx_hex))

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
        _backend = EvmBackend(rpc, reg, key, os.getenv("RIJEKA_CHAIN_EXPLORER"))
    else:
        _backend = NullBackend()
    return _backend
