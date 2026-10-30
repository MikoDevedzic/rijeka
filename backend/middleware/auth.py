"""Supabase JWT verification, asymmetric only.

Every token for this project is signed with the ES256 key published at
/auth/v1/.well-known/jwks.json. Verification is by that public key through PyJWT: the
algorithm is pinned to ES256, expiry is enforced, the audience claim is not checked
(Supabase sets aud to "authenticated"; roles come from the database, not the token).
There is no shared-secret (HS256) path: a shared secret is one value that, once leaked,
mints a token for any user, and the legacy secret for this project was committed to the
public repository in March 2026 (commit 3025de4). SUPABASE_JWT_SECRET is not read.
The JWKS is cached and refetched once on a key id the cache does not know (rotation).

Roles: the token's user_metadata.role is written by the client at sign-up and can be
rewritten by the client, so it is not trusted on its own. After verification the caller's
profiles.role is read from the database (one primary-key query, cached 30 s per user) and
placed into the user dict, both as user["role"] and over user_metadata.role, so every
route that reads the role reads the database's answer. The claim is used only when no
profile row exists."""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx
import jwt
from fastapi import Header, HTTPException
from jwt import PyJWK, PyJWTError

log = logging.getLogger("rijeka.auth")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://upuewetohnocfshkhafg.supabase.co").rstrip("/")
JWKS_TTL = 3600.0
_jwks: dict = {"at": 0.0, "keys": None}
ROLE_TTL = 30.0
_roles: dict[str, tuple[float, Optional[str]]] = {}


def db_role_for(sub: str) -> Optional[str]:
    """profiles.role for a user id, cached briefly; None when there is no row or the DB is unreachable."""
    hit = _roles.get(sub)
    now = time.time()
    if hit and now - hit[0] < ROLE_TTL:
        return hit[1]
    role = None
    try:
        from sqlalchemy import text
        from db.session import SessionLocal
        db = SessionLocal()
        try:
            r = db.execute(text("SELECT role FROM profiles WHERE id = :id"), {"id": sub}).scalar()
            role = str(r).lower() if r else None
        finally:
            db.close()
    except Exception as e:                  # noqa: BLE001 — the claim is the fallback, the failure is logged
        log.warning("role lookup failed: %s", type(e).__name__)
    if len(_roles) > 5000:
        _roles.clear()
    _roles[sub] = (now, role)
    return role


def forget_role(sub: str) -> None:
    """Call after changing a user's role so the next request sees it."""
    _roles.pop(sub, None)


async def _get_jwks(force: bool = False) -> Optional[dict]:
    if not force and _jwks["keys"] is not None and time.time() - _jwks["at"] < JWKS_TTL:
        return _jwks["keys"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
            if r.status_code == 200:
                _jwks.update(at=time.time(), keys=r.json())
                return _jwks["keys"]
            log.warning("JWKS fetch returned %s", r.status_code)
    except Exception as e:                  # noqa: BLE001
        log.warning("JWKS fetch failed: %s", e)
    return _jwks["keys"]


def _key_for(jwks: dict, kid: Optional[str]) -> Optional[PyJWK]:
    for k in (jwks or {}).get("keys", []):
        if k.get("alg", "ES256") == "ES256" and (not kid or k.get("kid") == kid):
            return PyJWK.from_dict(k)
    return None


async def optional_token(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """None when no Authorization header is present; otherwise the verified user (401 on a bad token).
    For routes that accept either the cron secret or a signed-in user."""
    if not authorization:
        return None
    return await verify_token(authorization)


async def verify_token(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth")
    token = authorization.split(" ", 1)[1].strip()
    try:
        header = jwt.get_unverified_header(token)
    except PyJWTError:
        raise HTTPException(status_code=401, detail="Bad token")
    if header.get("alg") != "ES256":
        raise HTTPException(status_code=401, detail="Invalid token")
    kid = header.get("kid")
    key = _key_for(await _get_jwks(), kid)
    if key is None:
        key = _key_for(await _get_jwks(force=True), kid)       # a rotated key: refetch once
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        payload = dict(jwt.decode(token, key.key, algorithms=["ES256"], options={"verify_aud": False, "require": ["exp", "sub"]}))
    except PyJWTError as e:
        log.info("token rejected: %s", type(e).__name__)
        raise HTTPException(status_code=401, detail="Invalid token")
    meta = dict(payload.get("user_metadata") or {})
    role = db_role_for(str(payload["sub"])) or (str(meta.get("role") or "viewer").lower())
    meta["role"] = role
    payload["user_metadata"] = meta
    payload["role"] = role
    return payload
