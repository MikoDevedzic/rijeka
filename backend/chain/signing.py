"""
EIP-712 typed data for TradeConfirmationRegistry.sol, and signing/recovery.

Must match the contract byte for byte:
    domain  = EIP712Domain(name="Rijeka Trade Confirmation", version="1",
                           chainId, verifyingContract)
    TradeConfirmation(bytes32 tradeHash, address counterparty)
    TradeAmendment(bytes32 prevHash, bytes32 newHash, address counterparty)
    TradeTermination(bytes32 tradeHash, address counterparty)

Each party signs with the OTHER party's address as `counterparty`, which
binds the signature to this specific pairing.
"""

from __future__ import annotations

from eth_account import Account
from eth_account.messages import encode_typed_data, _hash_eip191_message
from eth_utils import to_checksum_address

DOMAIN_NAME    = "Rijeka Trade Confirmation"
DOMAIN_VERSION = "1"

_TYPES = {
    "EIP712Domain": [
        {"name": "name",              "type": "string"},
        {"name": "version",           "type": "string"},
        {"name": "chainId",           "type": "uint256"},
        {"name": "verifyingContract", "type": "address"},
    ],
    "TradeConfirmation": [
        {"name": "tradeHash",    "type": "bytes32"},
        {"name": "counterparty", "type": "address"},
    ],
    "TradeAmendment": [
        {"name": "prevHash",     "type": "bytes32"},
        {"name": "newHash",      "type": "bytes32"},
        {"name": "counterparty", "type": "address"},
    ],
    "TradeTermination": [
        {"name": "tradeHash",    "type": "bytes32"},
        {"name": "counterparty", "type": "address"},
    ],
}


def _domain(chain_id: int, registry: str) -> dict:
    return {
        "name": DOMAIN_NAME,
        "version": DOMAIN_VERSION,
        "chainId": int(chain_id),
        "verifyingContract": to_checksum_address(registry),
    }


def _typed(chain_id: int, registry: str, primary: str, message: dict) -> dict:
    return {
        "types": {"EIP712Domain": _TYPES["EIP712Domain"], primary: _TYPES[primary]},
        "primaryType": primary,
        "domain": _domain(chain_id, registry),
        "message": message,
    }


def confirmation_typed_data(chain_id: int, registry: str, trade_hash: bytes, counterparty: str) -> dict:
    return _typed(chain_id, registry, "TradeConfirmation",
                  {"tradeHash": trade_hash, "counterparty": to_checksum_address(counterparty)})


def amendment_typed_data(chain_id: int, registry: str, prev_hash: bytes, new_hash: bytes, counterparty: str) -> dict:
    return _typed(chain_id, registry, "TradeAmendment",
                  {"prevHash": prev_hash, "newHash": new_hash, "counterparty": to_checksum_address(counterparty)})


def termination_typed_data(chain_id: int, registry: str, trade_hash: bytes, counterparty: str) -> dict:
    return _typed(chain_id, registry, "TradeTermination",
                  {"tradeHash": trade_hash, "counterparty": to_checksum_address(counterparty)})


def sign(typed_data: dict, private_key: str | bytes) -> bytes:
    """65-byte r||s||v signature (v in {27, 28}) as the contract expects."""
    signed = Account.sign_message(encode_typed_data(full_message=typed_data), private_key=private_key)
    return signed.signature


def recover(typed_data: dict, signature: bytes) -> str:
    """Checksummed signer address."""
    return Account.recover_message(encode_typed_data(full_message=typed_data), signature=signature)


def eip712_digest(typed_data: dict) -> bytes:
    """keccak256(0x1901 || domainSeparator || structHash) — the digest the contract computes."""
    return _hash_eip191_message(encode_typed_data(full_message=typed_data))
