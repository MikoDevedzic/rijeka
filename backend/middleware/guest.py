"""A guest: a visitor with no account, who may price a trade and read, and nothing else.

A guest never holds a Supabase session, so the database's own interface never sees one as a signed-in role. The
API gives the browser a pass of its own (`POST /api/public/guest`): a token signed HS256 with a secret this process
makes for itself, half an hour long, written nowhere. Every guest acts as ONE account, the guest desk (RIJEKA_GUEST_EMAIL: an
ordinary demo account its owner signed up once, holding its entity, the demo counterparty and market data, and no
trades), with the role of a viewer. Nothing is stored per guest but the count the usage panel keeps of any
visitor (that a guest came in, and that one priced: the day and a daily-rotating hash, api/routes/usage.py).

Three rules hold the design up, and `tests/test_guest.py` holds them:

  1. The two kinds of token never meet. A pass is recognised by its unverified header (`alg` HS256 and `kid`
     "guest", both exactly) and is then verified with the guest secret and HS256 only; it is never tried against
     the key set. Every other token takes the ES256 path of middleware/auth.py, which refuses HS256 as it always did.
  2. Deny by default. A guest's request is answered only when its method and path are on ALLOWED; a route added
     tomorrow refuses a guest without anyone remembering to close it. No request to look at is a refusal.
  3. Nothing on ALLOWED writes for its caller. All guests are one account: a route that stored a calibration, a
     snapshot or a cashflow for "the caller" would let one guest change another's prices. Such routes stay off the
     list by name (NEVER).

Volume is held by ceilings for all guests together (pricings, passes, and the routes that burn the CPU), which do
not depend on who is asking, and by counts by address, which are as good as the address the host's proxy passes on
(see `address`). Guests are off until the
guest desk is named (RIJEKA_GUEST_EMAIL) and its account exists."""
from __future__ import annotations

import ipaddress
import logging
import os
import re
import secrets
import time
from typing import Optional

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWTError

log = logging.getLogger("rijeka.guest")

ALG = "HS256"
KID = "guest"
ISSUER = "rijeka-guest"
AUDIENCE = "rijeka-guest"
KIND = "guest"
TTL = 1800                      # seconds a pass lasts; the app asks for another when it has run out
MIN_SECRET = 32                 # bytes
ACCOUNT_TTL = 300.0             # how long the guest desk's id is remembered once found (a miss is never remembered)

PER_MINUTE = 120                # a guest address's requests a minute, all allowed routes together
PRICINGS_PER_MINUTE = 60        # of which the ones that price (the POSTs): a person dragging a scenario, not a script
ALL_PRICINGS_PER_MINUTE = 300   # every guest together: the one CPU is the accounts' too
PASSES_PER_HOUR = 20            # passes one address may take in an hour
ALL_PASSES_PER_HOUR = 1200      # and every address together
MAX_PATHS = 2000                # the ticket's own default: a guest's simulation is no larger

ASK = "A guest can price a trade and read. To book, confirm or export, create an account: it is free."

# What a guest may call: (method, route as the router declares it). Reads the ticket and the two document pages
# need, and the routes that price what is in the request and store nothing.
ALLOWED: frozenset[tuple[str, str]] = frozenset({
    ("GET", "/api/demo/status"),
    ("GET", "/api/modules"),
    ("GET", "/api/me/role"),
    ("GET", "/api/me/booking-defaults"),
    ("GET", "/api/counterparties/"),
    ("GET", "/api/legal-entities/"),
    ("GET", "/nodes"),                                  # the desks and books the ticket offers (the guest desk's own)
    ("GET", "/api/currency/pairs"),
    ("GET", "/api/crypto/spot"),
    ("GET", "/api/market-data/demo/sources"),
    ("GET", "/api/market-data/snapshots/{curve_id}/latest"),
    ("GET", "/api/market-data/vol-skew/latest"),
    ("GET", "/api/price/swaption/vol"),
    ("GET", "/api/xva/calibration/latest"),
    ("GET", "/api/collateral/instruments"),
    ("GET", "/api/collateral/schedule/{cp_id}"),
    ("GET", "/api/methodology/products"),
    ("POST", "/api/me/activity"),                       # only to say that PRICE was pressed, for the usage panel's count; nothing goes on an account's record
    ("POST", "/price/preview"),
    ("POST", "/api/price/swaption"),
    ("POST", "/api/price/cap"),
    ("POST", "/api/price/floor"),
    ("POST", "/api/price/collar"),
    ("POST", "/api/price/par-rate"),
    ("POST", "/api/price/fees"),
    ("POST", "/api/schedules/preview"),
    ("POST", "/api/schedules/advance-date"),
    ("POST", "/api/currency/forward/price"),
    ("POST", "/api/currency/forward/scenario"),
    ("POST", "/api/currency/option/price"),
    ("POST", "/api/currency/option/scenario"),
    ("POST", "/api/crypto/forward/price"),
    ("POST", "/api/xva/simulate"),
    ("POST", "/api/xva/incremental"),
    ("POST", "/api/xva/currency"),
    ("POST", "/api/xva/currency-option"),
    ("POST", "/api/xva/currency-package"),
})

# Routes that write for their caller, or spend the desk's money, or hand out a file: named here so that a test can
# say none of them is ever allowed, whatever is added to the list above.
NEVER: frozenset[tuple[str, str]] = frozenset({
    ("POST", "/api/xva/calibrate"),
    ("POST", "/api/crypto/spot/snap"), ("POST", "/api/crypto/funding"),
    ("POST", "/api/currency/spot/snap"), ("POST", "/api/currency/fixings"), ("POST", "/api/currency/vol-surface"),
    ("POST", "/api/currency/forward-curve"),
    ("POST", "/api/market-data/snapshots"), ("POST", "/api/market-data/vol-skew"), ("POST", "/api/market-data/cap-vol"),
    ("POST", "/api/demo/provision"),
    ("PUT", "/api/me/role"), ("PUT", "/api/me/booking-defaults"), ("PUT", "/api/modules"),
    ("POST", "/api/trades/"), ("POST", "/api/book/trade"), ("POST", "/api/book/package"),
    ("POST", "/api/analyse/"), ("GET", "/api/prometheus/brief"),
    ("GET", "/api/methodology/{product}/replication.xlsx"),
    ("POST", "/api/counterparties/"), ("POST", "/api/legal-entities/"),
})


# ── settings ─────────────────────────────────────────────────────────────────
# The secret a pass is signed with is this process's own, made when it starts and held nowhere else: there is nothing
# to set, nothing to leak from a settings page, and a restart ends every pass (the app then takes another, lib/guest.js).
# One process serves the API (render.yaml: one instance, one uvicorn). Where several do, a pass signed by one would
# be refused by the next: RIJEKA_GUEST_SECRET then gives them one secret, and a value under 32 bytes is no secret.
_PROCESS_SECRET = secrets.token_bytes(48)


def _secret() -> Optional[bytes]:
    if "RIJEKA_GUEST_SECRET" not in os.environ:
        return _PROCESS_SECRET
    s = os.environ.get("RIJEKA_GUEST_SECRET", "").strip().encode()
    return s if len(s) >= MIN_SECRET else None


def _email() -> str:
    return os.environ.get("RIJEKA_GUEST_EMAIL", "").strip()


def enabled() -> bool:
    """Whether this instance is set to take guests: the guest desk is named (and a secret that was set is a real one).
    The desk's account is looked for when a pass is asked for or used."""
    return _secret() is not None and bool(_email())


_account: dict = {"at": 0.0, "id": None}


def account_id() -> Optional[str]:
    """The guest desk's account id, found by its sign-in address. None when there is no such account (or the
    database did not answer): that is asked again on the next request, never remembered."""
    now = time.time()
    if _account["id"] and now - _account["at"] < ACCOUNT_TTL:
        return _account["id"]
    email = _email()
    if not email:
        return None
    try:
        from sqlalchemy import text
        from db.session import SessionLocal
        db = SessionLocal()
        try:
            row = db.execute(text("SELECT u.id, lower(coalesce(p.role, '')) FROM auth.users u LEFT JOIN profiles p ON p.id = u.id "
                                  "WHERE lower(u.email) = lower(:e)"), {"e": email}).first()
        finally:
            db.close()
    except Exception as e:                  # noqa: BLE001 — no guests for this request; the failure is logged
        log.warning("guest desk lookup failed: %s", type(e).__name__)
        return None
    if not row:
        return None
    if row[1] == "admin":
        # every guest acts as this account: it is an ordinary one, never the instance's administrator
        log.error("the guest desk's account is an administrator: guests are refused until it is not")
        return None
    _account.update(at=now, id=str(row[0]))
    return _account["id"]


def forget_account() -> None:
    _account.update(at=0.0, id=None)


# ── the pass ─────────────────────────────────────────────────────────────────
def mint(now: Optional[float] = None) -> tuple[str, int]:
    """A pass and the second it ends. Raises LookupError when guests are off."""
    key = _secret()
    if key is None or not _email():
        raise LookupError("guests are off")
    iat = int(now if now is not None else time.time())
    exp = iat + TTL
    token = jwt.encode({"iss": ISSUER, "aud": AUDIENCE, "kind": KIND, "jti": secrets.token_urlsafe(12), "iat": iat, "exp": exp},
                       key, algorithm=ALG, headers={"kid": KID, "typ": "rijeka-guest+jwt"})
    return token, exp


def _token_of(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization.split(" ", 1)[1].strip() or None


def is_pass(authorization: Optional[str]) -> bool:
    """Whether this bearer SAYS it is a guest's pass (its unverified header). True sends it to `user` below and
    nowhere else; False leaves it to the ES256 path, which refuses HS256 by itself."""
    token = _token_of(authorization)
    if not token:
        return False
    try:
        header = jwt.get_unverified_header(token)
    except PyJWTError:
        return False
    return header.get("alg") == ALG and header.get("kid") == KID


def _claims(token: str) -> dict:
    key = _secret()
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        claims = jwt.decode(token, key, algorithms=[ALG], audience=AUDIENCE, issuer=ISSUER,
                            options={"require": ["exp", "iat", "iss", "aud", "jti"]})
    except PyJWTError as e:
        log.info("guest pass rejected: %s", type(e).__name__)
        raise HTTPException(status_code=401, detail="Invalid token")
    if claims.get("kind") != KIND:
        raise HTTPException(status_code=401, detail="Invalid token")
    return dict(claims)


# ── volume ───────────────────────────────────────────────────────────────────
# Two kinds of count, and they are not equally strong. The ceilings for ALL guests together (pricings a minute, passes
# an hour, and the heavy routes' in api/routes/_limits.py) do not depend on knowing who is asking: they are what
# keeps guests from taking the CPU the accounts share, whatever a guest sends. The counts BY ADDRESS keep one guest
# from using up the others' share, and are only as good as the address this process is given. Behind a host's proxy
# that is a header: the edge's own (CF-Connecting-IP) when it is there and is an address, else what the server read
# from the forwarded headers. Nothing here relies on the address being right: a guest with a wrong one meets the
# ceilings. `address_source` says which of the two this process has been reading, for the operator's health page.
_source = {"last": None}


def client_address(request) -> tuple[str, str]:
    """(address, where it was read from) for a request: the edge's own header when it is there and is an address
    ("cf-connecting-ip"), else what the server read from the forwarded headers ("proxy"). Also what the usage beacon
    makes its visitor from (api/routes/usage.py), so that a guest and a visitor are the same person to the panel."""
    if request is None:
        return "unknown", "none"
    cf = (request.headers.get("cf-connecting-ip") or "").strip() if hasattr(request, "headers") else ""
    if cf:
        try:
            return str(ipaddress.ip_address(cf)), "cf-connecting-ip"
        except ValueError:
            pass                                    # not an address: not the edge's, and not used
    client = getattr(request, "client", None)
    return (client.host if client else "unknown")[:64], "proxy"


def address(request: Optional[Request]) -> str:
    addr, source = client_address(request)
    if source != "none":
        _source["last"] = source
    return addr


def address_source() -> Optional[str]:
    """Where the last guest's address came from: "cf-connecting-ip", "proxy" (uvicorn's reading of the forwarded
    header) or None when no guest has asked yet."""
    return _source["last"]


def take_pass(request: Optional[Request]) -> None:
    """Counts a pass against its address and against every address together."""
    from api.routes._limits import take_all
    take_all([(f"guest:pass:{address(request)}", 3600.0, PASSES_PER_HOUR, "guest sessions from this address"),
              ("guest:passes", 3600.0, ALL_PASSES_PER_HOUR, "guest sessions")])


# ── the wall ─────────────────────────────────────────────────────────────────
def _pattern(template: str) -> re.Pattern[str]:
    """The paths a route's template takes: each {name} is one segment, everything else is itself."""
    return re.compile("^" + "".join("[^/]+" if part.startswith("{") else re.escape(part)
                                    for part in re.split(r"(\{[^}]+\})", template)) + "$")


_PATTERNS: tuple = tuple((m, _pattern(t)) for m, t in sorted(ALLOWED))


def allowed(method: str, path: Optional[str]) -> bool:
    """Whether a guest may call this: the request's own path against the list. Not the matched route's name: a router
    included under a prefix knows its routes by their short path ("/" for a dozen of them), so only the path the
    request came in on says which route it is. A path that differs by a slash is another path, and is refused."""
    if not path:
        return False
    m = method.upper()
    return any(mm == m and pat.match(path) for mm, pat in _PATTERNS)


def user(authorization: Optional[str], request: Optional[Request]) -> dict:
    """The verified guest of this request, as the routes see a user: the guest desk's id, a viewer, `is_guest`.
    401 for a pass that does not verify; 403 for anything a guest may not call; 429 past the address's limit;
    503 when the guest desk's account is not there."""
    claims = _claims(_token_of(authorization) or "")
    if request is None:
        raise HTTPException(status_code=403, detail=ASK)
    path = request.scope.get("path")
    if not allowed(request.method, path):
        log.info("guest refused: %s %s", request.method, str(path)[:120])
        raise HTTPException(status_code=403, detail=ASK)
    addr = address(request)
    from api.routes._limits import take_all
    counts = [(f"guest:req:{addr}", 60.0, PER_MINUTE, "requests from this address")]
    if request.method == "POST":
        counts += [(f"guest:price:{addr}", 60.0, PRICINGS_PER_MINUTE, "pricing requests from this address"),
                   ("guest:prices", 60.0, ALL_PRICINGS_PER_MINUTE, "pricing requests by guests")]
    take_all(counts)
    desk = account_id()
    if desk is None:
        raise HTTPException(status_code=503, detail="The guest desk is not set up on this instance.")
    # (the activity record keeps what `request.state.rijeka_account` names, which verify_token sets for an account
    # and nothing sets for a guest: a guest is not on it)
    return {"sub": desk, "role": "viewer", "user_metadata": {"role": "viewer"}, "email": None,
            "is_guest": True, "guest_address": addr, "jti": claims.get("jti"), "exp": claims.get("exp")}


def size(user_: Optional[dict], body) -> None:
    """A guest's simulation is no larger than the ticket's default. An account's own cap is the route's."""
    if not is_guest(user_):
        return
    n = getattr(body, "paths", None) or getattr(body, "n_paths", None) or 0
    if n > MAX_PATHS:
        raise HTTPException(status_code=403, detail=f"A guest's simulation runs up to {MAX_PATHS:,} paths. For more, create an account: it is free.")


def paths(user_: Optional[dict], n: int) -> int:
    """The number of paths a run uses: for a guest never above MAX_PATHS, also where it comes from a setting and
    not from the request (the counterparty run takes the firm's)."""
    return min(int(n), MAX_PATHS) if is_guest(user_) else int(n)


_priced: set = set()


def first_priced(jti: Optional[str]) -> bool:
    """Whether this is the first time this pass says its guest pressed PRICE: True once for a pass. For the usage
    panel's count (api/routes/usage.py), so a guest who prices twenty times is one guest who priced, and one row.
    Held in this process: after a restart a pass may be counted again, and the panel counts the person, not the row."""
    if not jti or jti in _priced:
        return False
    if len(_priced) > 20000:
        _priced.clear()
    _priced.add(jti)
    return True


def is_guest(user_: Optional[dict]) -> bool:
    return bool((user_ or {}).get("is_guest"))
