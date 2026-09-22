#!/usr/bin/env python3
"""
countersign.py — counterparty-side reference implementation.

Run this as the RECEIVING party of a trade confirmation request. It has no
dependency on Rijeka: it reads a request file, recomputes the canonical hash
from the terms in it, shows you what you are about to agree to, and signs.

    pip install eth-account eth-utils
    export RIJEKA_SIGNING_KEY=0x...          # or use --key-file / an HSM
    python countersign.py request.json

    # If you keep your own record of the trade, check against it first:
    python countersign.py request.json --expect-hash 0x3551d3...

What it does NOT do: trust the request. The hash is recomputed from the
canonical record in the file, and you are shown the economics before anything
is signed. If your own booking of this trade produces a different hash, the
two sides disagree — that is a confirmation break, and you should resolve it
rather than sign.

The canonical form is: JSON, keys sorted at every level, separators ',' and
':', no whitespace, UTF-8, then keccak256. Roughly 15 lines to reimplement in
any language — see canonical_bytes() below.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:
    from eth_account import Account
    from eth_account.messages import encode_typed_data, _hash_eip191_message
    from eth_utils import keccak, to_checksum_address
except ImportError:
    sys.exit("pip install eth-account eth-utils")


# ── Canonical form (the only thing that must match byte for byte) ────────────

def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def trade_hash(payload: dict) -> bytes:
    return keccak(canonical_bytes(payload))


# ── EIP-712 ─────────────────────────────────────────────────────────────────

def typed_data(eip712: dict, hash_hex: str, counterparty: str) -> dict:
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TradeConfirmation": [
                {"name": "tradeHash", "type": "bytes32"},
                {"name": "counterparty", "type": "address"},
            ],
        },
        "primaryType": "TradeConfirmation",
        "domain": {
            "name": eip712["name"],
            "version": eip712["version"],
            "chainId": int(eip712["chain_id"]),
            "verifyingContract": to_checksum_address(eip712["verifying_contract"]),
        },
        "message": {
            "tradeHash": bytes.fromhex(hash_hex[2:]),
            "counterparty": to_checksum_address(counterparty),
        },
    }


# ── Presentation ────────────────────────────────────────────────────────────

def summarise(req: dict) -> None:
    c = req["canonical"]
    t = c["trade"]
    p = c.get("parties", {})
    w = 22
    print("\n  ── TRADE ─────────────────────────────────────────────")
    for k in ("trade_ref", "instrument_type", "structure", "notional", "notional_ccy",
              "trade_date", "effective_date", "maturity_date"):
        if t.get(k) is not None:
            print(f"  {k:<{w}} {t[k]}")
    for leg in c.get("legs", []):
        print(f"\n  ── LEG {leg.get('leg_ref')} ({leg.get('leg_type')}) ─────────────────────")
        for k in ("direction", "currency", "notional", "fixed_rate", "spread",
                  "day_count", "payment_frequency", "reset_frequency", "bdc"):
            if leg.get(k) not in (None, ""):
                print(f"  {k:<{w}} {leg[k]}")
    print("\n  ── PARTIES ───────────────────────────────────────────")
    print(f"  {'requesting':<{w}} {p.get('own',{}).get('name')}  [{p.get('own',{}).get('lei')}]")
    print(f"  {'you':<{w}} {p.get('counterparty',{}).get('name')}  [{p.get('counterparty',{}).get('lei')}]")
    print()


def main() -> int:
    ap = argparse.ArgumentParser(description="Countersign a Rijeka trade confirmation request.")
    ap.add_argument("request", help="the confirmation request JSON")
    ap.add_argument("--expect-hash", help="hash computed from YOUR OWN booking; refuses to sign on mismatch")
    ap.add_argument("--key-file", help="file containing the hex private key (default: $RIJEKA_SIGNING_KEY)")
    ap.add_argument("--out", help="write the signature JSON here instead of stdout")
    ap.add_argument("--yes", action="store_true", help="skip the interactive confirmation")
    a = ap.parse_args()

    req = json.load(open(a.request))
    if req.get("format") != "rijeka-confirmation-request":
        return _fail(f"not a confirmation request (format={req.get('format')!r})")

    # 1 — recompute the hash from the terms in the request
    computed = "0x" + trade_hash(req["canonical"]).hex()
    claimed = req["trade_hash"]
    print(f"\n  recomputed hash  {computed}")
    print(f"  request says     {claimed}")
    if computed.lower() != claimed.lower():
        return _fail("the request's own hash does not match its canonical record. Do not sign.")
    print("  ✔ the request is internally consistent")

    # 2 — compare against the counterparty's own booking, when given
    if a.expect_hash:
        if computed.lower() != a.expect_hash.lower():
            return _fail("YOUR booking hashes differently. The two sides disagree on the terms.\n"
                         "     This is a confirmation break — resolve it before signing.")
        print("  ✔ matches the hash from your own booking")
    else:
        print("  ! no --expect-hash given: you are trusting the terms printed below")

    summarise(req)

    # 3 — the digest, checked against the one supplied
    eip = req["eip712"]
    td = typed_data(eip, computed, req["from"]["address"])
    digest = "0x" + _hash_eip191_message(encode_typed_data(full_message=td)).hex()
    supplied = req.get("to", {}).get("digest_to_sign")
    if supplied and supplied.lower() != digest.lower():
        return _fail(f"digest mismatch: we compute {digest}, the request says {supplied}")
    print(f"  digest to sign   {digest}")
    print(f"  chain            {eip['chain_id']} · registry {eip['verifying_contract']}")

    # 4 — sign
    key = open(a.key_file).read().strip() if a.key_file else os.getenv("RIJEKA_SIGNING_KEY")
    if not key:
        return _fail("no signing key. Set RIJEKA_SIGNING_KEY or pass --key-file.")
    acct = Account.from_key(key)
    expected = req.get("to", {}).get("address")
    if expected and acct.address.lower() != expected.lower():
        return _fail(f"this key is {acct.address}, but the request is addressed to {expected}")

    if not a.yes:
        print(f"  signing as       {acct.address}")
        if input("\n  Sign these terms? [y/N] ").strip().lower() not in ("y", "yes"):
            print("  not signed.")
            return 1

    sig = Account.sign_message(encode_typed_data(full_message=td), private_key=acct.key).signature
    out = {
        "format": "rijeka-confirmation-countersignature",
        "format_version": 1,
        "trade_id": req.get("trade_id"),
        "trade_hash": computed,
        "address": acct.address,
        "signature": "0x" + sig.hex(),
    }
    text = json.dumps(out, indent=2)
    if a.out:
        open(a.out, "w").write(text + "\n")
        print(f"\n  ✔ signed — written to {a.out}")
    else:
        print("\n  ✔ signed\n")
        print(text)
    print("\n  Return this to the requesting party, or call confirm() on the registry yourself:")
    print(f"    confirm({computed},\n            {req['from']['address']},\n            {acct.address},\n"
          f"            {req['from']['signature']},\n            0x{sig.hex()})\n")
    return 0


def _fail(msg: str) -> int:
    print(f"\n  ✘ {msg}\n", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
