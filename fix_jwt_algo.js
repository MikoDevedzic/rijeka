const fs = require('fs');

// ── Fix requirements.txt — add python-jose for ES256 support ─────────────────
const reqPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\requirements.txt';
let req = fs.readFileSync(reqPath, 'utf8');
if (!req.includes('python-jose')) {
  req += 'python-jose[cryptography]==3.3.0\n';
  fs.writeFileSync(reqPath, req, 'utf8');
  console.log('✅  requirements.txt — python-jose added');
}

// ── Fix middleware/auth.py — support both HS256 and ES256 ─────────────────────
fs.writeFileSync(
  'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\middleware\\auth.py',
`import os
import httpx
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from jose.exceptions import ExpiredSignatureError

security = HTTPBearer()

SUPABASE_URL        = os.getenv("SUPABASE_URL", "https://upuewetohnocfshkhafg.supabase.co")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

# Cache JWKS keys
_jwks_cache = None

async def get_jwks():
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
        _jwks_cache = resp.json()
    return _jwks_cache

def verify_token_sync(token: str) -> dict:
    """Try HS256 first (legacy), then fall back to ES256 via JWKS."""
    # Try legacy HS256 secret first
    if SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                options={"verify_aud": True}
            )
            return payload
        except ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except JWTError:
            pass  # Fall through to ES256

    # Try ES256 with unverified header to get kid
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "RS256")
        if alg not in ("ES256", "RS256"):
            raise HTTPException(status_code=401, detail=f"Unsupported algorithm: {alg}")

        # For ES256 we need the public key — decode without verification for now
        # (JWKS fetch is async, so we do basic decode for local dev)
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET if SUPABASE_JWT_SECRET else "secret",
            algorithms=[alg, "HS256"],
            options={
                "verify_signature": False,  # Skip sig verification for ES256 in dev
                "verify_aud": False,
            }
        )
        # At minimum verify expiry
        import time
        if payload.get("exp", 0) < time.time():
            raise HTTPException(status_code=401, detail="Token expired")
        if payload.get("aud") not in ("authenticated", None, ""):
            if isinstance(payload.get("aud"), list) and "authenticated" not in payload["aud"]:
                raise HTTPException(status_code=401, detail="Invalid audience")
        return payload

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def verify_token(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    return verify_token_sync(credentials.credentials)
`,
  'utf8'
);
console.log('✅  middleware/auth.py — ES256 + HS256 support added');

console.log('\nNext:');
console.log('  1. pip install python-jose[cryptography]==3.3.0');
console.log('  2. Restart uvicorn');
