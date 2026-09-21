"""
Party signing keys.

A legal entity confirms a trade by signing with a key it controls. How that
key is held is deployment policy, not contract logic:

  * DEV  — derived deterministically from RIJEKA_CHAIN_DEV_SEED and the
           entity's LEI, so a local demo needs no key management at all.
           Never use on a network with value.
  * ENV  — RIJEKA_CHAIN_KEY_<LEI> holds a hex private key for that entity.
  * PROD — an HSM / signer service behind the same resolve() interface.
           Not implemented here; the interface is the point.

resolve(entity) -> PartyKey(address, private_key | None). A None
private_key means "we can name the signer but cannot sign for them", which
is the normal state for a counterparty whose signature arrives from their
own system.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Optional

from eth_account import Account
from eth_utils import keccak, to_checksum_address


@dataclass(frozen=True)
class PartyKey:
    lei:         str
    address:     str
    private_key: Optional[bytes]   # None = cannot sign locally
    source:      str               # "env" | "dev" | "address-only"


def _lei_of(entity: Any) -> str:
    lei = entity.get("lei") if isinstance(entity, dict) else getattr(entity, "lei", None)
    if not lei:
        name = entity.get("name") if isinstance(entity, dict) else getattr(entity, "name", "")
        # Entities without an LEI get a stable pseudo-LEI from their name (dev only).
        lei = "NOLEI-" + keccak(text=str(name or "")).hex()[:14].upper()
    return str(lei)


def _env_key_name(lei: str) -> str:
    return "RIJEKA_CHAIN_KEY_" + re.sub(r"[^A-Z0-9]", "_", lei.upper())


def resolve(entity: Any) -> PartyKey:
    lei = _lei_of(entity)

    env_key = os.getenv(_env_key_name(lei))
    if env_key:
        acct = Account.from_key(env_key)
        return PartyKey(lei, acct.address, acct.key, "env")

    env_addr = os.getenv(_env_key_name(lei) + "_ADDRESS")
    if env_addr:
        return PartyKey(lei, to_checksum_address(env_addr), None, "address-only")

    seed = os.getenv("RIJEKA_CHAIN_DEV_SEED")
    if seed:
        pk = keccak(text=f"rijeka-dev-party-key|{seed}|{lei}")
        acct = Account.from_key(pk)
        return PartyKey(lei, acct.address, acct.key, "dev")

    raise LookupError(
        f"No signing key for legal entity {lei}. Set {_env_key_name(lei)} "
        f"(or RIJEKA_CHAIN_DEV_SEED for a local demo)."
    )
