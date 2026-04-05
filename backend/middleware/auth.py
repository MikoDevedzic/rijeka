import os, httpx
from fastapi import HTTPException, Header
from typing import Optional
from jose import jwt, JWTError

SUPABASE_URL = "https://upuewetohnocfshkhafg.supabase.co"
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
_jwks_cache = None

async def _get_jwks():
    global _jwks_cache
    if _jwks_cache: return _jwks_cache
    try:
        url = SUPABASE_URL + "/auth/v1/.well-known/jwks.json"
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(url)
            if r.status_code == 200:
                _jwks_cache = r.json()
                return _jwks_cache
    except Exception as e:
        print(f"[AUTH] JWKS error: {e}")
    return None

async def verify_token(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth")
    token = authorization.split(" ", 1)[1]
    try:
        header = jwt.get_unverified_header(token)
    except:
        raise HTTPException(status_code=401, detail="Bad token")
    if header.get("alg") == "ES256":
        jwks = await _get_jwks()
        if jwks:
            try:
                from jose import jwk
                kid = header.get("kid")
                key_data = next((k for k in jwks.get("keys",[]) if not kid or k.get("kid")==kid), None)
                if key_data:
                    payload = jwt.decode(token, jwk.construct(key_data), algorithms=["ES256"], options={"verify_aud":False})
                    print("[AUTH] ES256 OK, user: " + str(payload.get("sub",""))[:8] + "")
                    return payload
            except Exception as e:
                print(f"[AUTH] ES256 fail: {e}")
    if SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], options={"verify_aud":False})
            print("[AUTH] HS256 OK")
            return payload
        except Exception as e:
            print(f"[AUTH] HS256 fail: {e}")
    raise HTTPException(status_code=401, detail="Invalid token")

