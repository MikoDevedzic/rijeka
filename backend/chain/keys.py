"""
Party signing keys.

A legal entity confirms a trade by signing with a key it controls. How that
key is held is deployment policy, not contract logic:

  * DEV  — derived deterministically from RIJEKA_CHAIN_DEV_SEED and the
           entity's LEI, so a local demo needs no key management at all.
           RIJEKA_CHAIN_DEV_LEI_PREFIX (e.g. "DEMO") restricts this to demo
           entities on a hosted instance. Never use on a network with value.
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


def _dev_key_allowed(lei: str) -> bool:
    """
    RIJEKA_CHAIN_DEV_LEI_PREFIX limits seed-derived keys to LEIs that start
    with one of the given comma-separated prefixes. Unset = every LEI (local
    dev). The hosted demo sets "DEMO" so Rijeka can sign for demo entities
    only: a visitor who books against a real bank's LEI gets "no key held",
    exactly as production would, instead of a signature nobody authorised.
    """
    raw = os.getenv("RIJEKA_CHAIN_DEV_LEI_PREFIX", "").strip()
    if not raw:
        return True
    return any(lei.upper().startswith(p.strip().upper()) for p in raw.split(",") if p.strip())


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
    if seed and _dev_key_allowed(lei):
        pk = keccak(text=f"rijeka-dev-party-key|{seed}|{lei}")
        acct = Account.from_key(pk)
        return PartyKey(lei, acct.address, acct.key, "dev")

    if seed:
        # Seed is set but this LEI is outside the demo scope: we can name
        # nobody for it, so the caller must obtain their signature.
        raise LookupError(
            f"No signing key held for legal entity {lei}: this Rijeka signs only for "
            f"demo entities (RIJEKA_CHAIN_DEV_LEI_PREFIX). Set {_env_key_name(lei)}, "
            f"or get the counterparty's signature over the request and countersign."
        )
    raise LookupError(
        f"No signing key for legal entity {lei}. Set {_env_key_name(lei)} "
        f"(or RIJEKA_CHAIN_DEV_SEED for a local demo)."
    )
