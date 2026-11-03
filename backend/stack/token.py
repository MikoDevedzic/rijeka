#!/usr/bin/env python3
"""
token.py — mint a Supabase-shaped ES256 access token signed with the stack's local key.

    from stack.token import mint
    mint(user_id, email, role)                      -> str (a JWT)
    mint(user_id, email, role, expires_in=-60)      -> an already-expired token, for the 401 tests

Claims follow what Supabase Auth issues: sub, email, aud "authenticated", role "authenticated",
user_metadata {role}, app_metadata {provider}, iat, exp, iss; header kid = the JWKS key id, so
middleware/auth.py (with RIJEKA_JWKS_FILE) picks the key the way it would from the hosted JWKS.

CLI:  python stack/token.py <user_id> <email> [role]   prints the token
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

import time
import uuid

import jwt

from stack import keys


def mint(user_id, email: str, role: str = "trader", *, expires_in: int = 3600, issuer: str = "http://stack.local/auth/v1") -> str:
    key = keys.load()
    kid = keys.public_jwk(key)["kid"]
    now = int(time.time())
    claims = {
        "iss": issuer,
        "sub": str(user_id),
        "aud": "authenticated",
        "exp": now + int(expires_in),
        "iat": now,
        "email": email,
        "phone": "",
        "app_metadata": {"provider": "email", "providers": ["email"]},
        "user_metadata": {"role": role, "email": email},
        "role": "authenticated",
        "aal": "aal1",
        "amr": [{"method": "password", "timestamp": now}],
        "session_id": str(uuid.uuid4()),
        "is_anonymous": False,
    }
    return jwt.encode(claims, key, algorithm="ES256", headers={"kid": kid, "typ": "JWT"})


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    print(mint(argv[0], argv[1], argv[2] if len(argv) > 2 else "trader"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
