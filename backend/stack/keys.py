#!/usr/bin/env python3
"""
keys.py — an ES256 keypair for the local stack, and the JWKS the API verifies tokens against.

Writes into backend/stack/.local/ (git-ignored):
  signing_key.pem   the private key (PKCS8, unencrypted) stack/token.py signs with
  jwks.json         {"keys": [ public JWK ]}  — point RIJEKA_JWKS_FILE at it
  gotrue_keys.json  the same key as a private JWK in the list shape GoTrue reads from
                    GOTRUE_JWT_KEYS (docker-compose), so the self-hosted auth signs with
                    a key the API already trusts

Idempotent: an existing key is kept unless --rotate. Prints the paths.
"""
from __future__ import annotations

import os
import sys

# Run as `python stack/<name>.py`, the script directory is sys.path[0] and stack/token.py would shadow the
# standard library's `token` (tokenize imports it). Put backend/ there instead; `python -m stack.<name>` is the
# documented form and needs nothing.
_HERE = os.path.dirname(os.path.abspath(__file__))
if sys.path and os.path.abspath(sys.path[0] or os.getcwd()) == _HERE:
    sys.path[0] = os.path.dirname(_HERE)

import argparse
import base64
import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

LOCAL = Path(__file__).resolve().parent / ".local"
PEM = LOCAL / "signing_key.pem"
JWKS = LOCAL / "jwks.json"
GOTRUE = LOCAL / "gotrue_keys.json"


def _b64u(n: int, size: int = 32) -> str:
    return base64.urlsafe_b64encode(n.to_bytes(size, "big")).rstrip(b"=").decode()


def public_jwk(key: ec.EllipticCurvePrivateKey) -> dict:
    nums = key.public_key().public_numbers()
    x, y = _b64u(nums.x), _b64u(nums.y)
    kid = hashlib.sha256(f"{x}.{y}".encode()).hexdigest()[:16]
    return {"kty": "EC", "crv": "P-256", "x": x, "y": y, "kid": kid, "alg": "ES256", "use": "sig",
            "key_ops": ["verify"]}


def private_jwk(key: ec.EllipticCurvePrivateKey) -> dict:
    pub = public_jwk(key)
    return {**pub, "d": _b64u(key.private_numbers().private_value), "key_ops": ["sign", "verify"]}


def load() -> ec.EllipticCurvePrivateKey:
    key = serialization.load_pem_private_key(PEM.read_bytes(), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise SystemExit(f"{PEM} is not an EC key")
    return key


def generate(rotate: bool = False) -> dict:
    LOCAL.mkdir(parents=True, exist_ok=True)
    if PEM.exists() and not rotate:
        key = load()
        made = False
    else:
        key = ec.generate_private_key(ec.SECP256R1())
        PEM.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))
        PEM.chmod(0o600)
        made = True
    pub = public_jwk(key)
    JWKS.write_text(json.dumps({"keys": [pub]}, indent=2) + "\n")
    GOTRUE.write_text(json.dumps([private_jwk(key)]) + "\n")
    GOTRUE.chmod(0o600)
    return {"pem": str(PEM), "jwks": str(JWKS), "gotrue_keys": str(GOTRUE), "kid": pub["kid"], "generated": made}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rotate", action="store_true", help="replace an existing key")
    args = ap.parse_args(argv)
    info = generate(args.rotate)
    print(("generated" if info["generated"] else "kept") + f" ES256 key kid={info['kid']}")
    print(f"  private key : {info['pem']}")
    print(f"  JWKS        : {info['jwks']}   (RIJEKA_JWKS_FILE)")
    print(f"  GoTrue keys : {info['gotrue_keys']}   (GOTRUE_JWT_KEYS, docker-compose)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
