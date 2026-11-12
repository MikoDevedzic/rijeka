#!/usr/bin/env python3
"""watch.py — production, looked at from the outside, with nothing but its public addresses.

    python3 .github/scripts/watch.py                         # every check; exit 1 and a list when one fails
    python3 .github/scripts/watch.py --api-commit <sha>      # also: the API reports this commit (after a deploy)
    python3 .github/scripts/watch.py --app-commit <sha>      # also: the web app was built from this commit

What it reads (GET only, no sign-in, no secret, nothing written):

  the API      /api/ops/health          every batch current, no scheduler step failed, the scheduler's loop alive,
                                        no migration in trouble, browser errors under a ceiling
               /api/public/pulse        the chain node answers and names the registry; a curve is published;
                                        the app's and the site's origins are allowed to read it (CORS)
               /api/public/confirmations  every row is the shape the register promises and carries no markup
  the app      /, /version.json         the page, every script and stylesheet it names (a missing one is answered with
               the methodology PDF      the page itself by the host, so the type is read, not only the status)
  the site     /, /about, /verify/, /confirmations/   / sends a visitor to the app; the others open; the verifier lists the registry the API anchors to

The workflow `watch` runs it on GitHub's schedule and by hand; GitHub mails a failed run. GitHub's schedule is
best-effort (a half-hourly workflow here has run every five to eight hours), so this is the deep check a few times a
day and after every deploy, not a minute-by-minute alarm: docs/ops/monitoring.md says what covers the minutes.
Standard library only, so it runs anywhere Python does.
"""
from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Callable, NamedTuple, Optional

API = "https://rijeka-api.onrender.com"
APP = "https://app.rijeka.app"
SITE = "https://rijeka.app"

LOOP_MAX_AGE_S = 30 * 60          # the scheduler passes its loop every minute; a pass with the daily batches in it is longer
STARTING_S = 25 * 60              # a new process waits, may wait on its own release (up to 15 minutes), then makes its first pass
BODY_MAX = 20_000_000             # bytes read of one answer (the app's largest script is a few million)
ANSWER_MAX_S = 90.0               # one answer, start to end, however slowly it is sent
RUN_BUDGET_S = 6 * 60             # after this a run stops trying again and waits less, so it ends with its report
REGISTER_ROWS = 100               # the size the public register page itself asks for: the same cached answer, not another
_budget_ends: Optional[float] = None
CLIENT_ERRORS_MAX = 25            # errors the browsers reported in 24 hours
CHAINS = {1: "https://etherscan.io/", 11155111: "https://sepolia.etherscan.io/"}

HASH = re.compile(r"0x[0-9a-fA-F]{64}")
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
LEI = re.compile(r"[A-Z0-9]{20}")
WORD = re.compile(r"[A-Za-z0-9_ ·./+-]{1,48}")      # as the register's own rule (api/routes/public.py _WORD)
COMMIT = re.compile(r"[0-9a-f]{40}")


class Answer(NamedTuple):
    status: int                   # 0: no answer at all
    type: str
    body: bytes
    headers: dict

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    def json(self):
        try:
            return json.loads(self.body)
        except ValueError:
            return None

    @property
    def said(self) -> str:
        """How it answered, for a line of the report: its status, or why there was none."""
        return f"HTTP {self.status}" if self.status else f"no answer ({self.text[:140]})"


def _tls() -> ssl.SSLContext:
    """Certificates are always verified. A Python with no certificate store of its own (python.org's on a Mac)
    takes the bundle `certifi` ships, where that package is installed."""
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except ImportError:
        pass
    return ctx


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is not followed: the answer read is the named host's own, or it is a failure (HTTP 301, 302…)."""

    def redirect_request(self, *a, **k):
        return None


def _read(r, deadline: float) -> bytes:
    """The body, to BODY_MAX and to the deadline: an answer that is too long or too slow is no answer."""
    chunks, size = [], 0
    while True:
        chunk = r.read(65536)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        size += len(chunk)
        if size > BODY_MAX:
            raise ValueError(f"the answer is longer than {BODY_MAX} bytes")
        if time.monotonic() > deadline:
            raise TimeoutError(f"the answer took longer than {ANSWER_MAX_S:.0f} seconds")


def get(url: str, headers: Optional[dict] = None, tries: int = 3, wait_s: float = 8.0, timeout: float = 30.0) -> Answer:
    """One GET, tried again on no answer or a 5xx (a deploy in progress, a node restarting)."""
    last = Answer(0, "", b"", {})
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=_tls()), _NoRedirect)
    if _budget_ends is not None and time.monotonic() > _budget_ends:      # a run that is already long: one try, a short wait
        tries, timeout = 1, min(timeout, 10.0)
    for attempt in range(tries):
        if attempt:
            if _budget_ends is not None and time.monotonic() > _budget_ends:
                break
            time.sleep(wait_s)
        req = urllib.request.Request(url, headers={"User-Agent": "rijeka-watch", **(headers or {})})
        try:
            with opener.open(req, timeout=timeout) as r:
                return Answer(r.status, r.headers.get_content_type(), _read(r, time.monotonic() + ANSWER_MAX_S), {k.lower(): v for k, v in r.headers.items()})
        except urllib.error.HTTPError as e:
            last = Answer(e.code, e.headers.get_content_type() if e.headers else "", e.read() or b"", {k.lower(): v for k, v in (e.headers.items() if e.headers else [])})
            if e.code < 500:
                return last
        except Exception as e:                       # noqa: BLE001  (refused, timed out, DNS, TLS: all "no answer")
            last = Answer(0, "", str(e).encode(), {})
            if isinstance(getattr(e, "reason", e), ssl.SSLCertVerificationError):
                return last                          # a certificate that does not verify will not verify on a second try
    return last


def _is(rx: re.Pattern, v) -> bool:
    return isinstance(v, str) and rx.fullmatch(v) is not None


def _when(v) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── the checks: each takes what was read and returns the list of what is wrong (empty: nothing) ──────────────────

def check_health(a: Answer, now: datetime, api_commit: Optional[str] = None) -> list[str]:
    d = a.json()
    if a.status != 200 or not isinstance(d, dict):
        return [f"health: {a.said}"]
    out = []
    checks = d.get("checks")
    if not isinstance(checks, dict) or not checks:
        out.append("health: no batch checks in the answer")
    else:
        for name, c in checks.items():
            if not (isinstance(c, dict) and c.get("ok") is True):
                c = c if isinstance(c, dict) else {}
                out.append(f"batch stale: {name} (last {c.get('last')}, expected {c.get('rule')}; feeds {c.get('feeds')})")
    if d.get("ok") is not True and not out:
        out.append("health: ok is not true")
    sch = d.get("scheduler") if isinstance(d.get("scheduler"), dict) else {}
    if sch.get("enabled") is not True:
        out.append("scheduler: not enabled")
    else:
        last, started = _when(sch.get("last_cycle")), _when(sch.get("started_at"))
        starting = started is not None and (now - started).total_seconds() <= STARTING_S      # just deployed or restarted
        if last is None:
            if not starting:
                out.append(f"scheduler: started at {sch.get('started_at')} and has not passed its loop once")
        elif (now - last).total_seconds() > LOOP_MAX_AGE_S:
            out.append(f"scheduler: its loop last passed at {sch.get('last_cycle')} (more than {LOOP_MAX_AGE_S // 60} minutes ago)")
        steps = sch.get("steps") if isinstance(sch.get("steps"), dict) else {}
        for name, s in steps.items():
            if isinstance(s, dict) and s.get("ok") is False:
                out.append(f"scheduler step failed: {name} at {s.get('at')}: {str(s.get('detail'))[:200]}")
    mig = d.get("migrations") if isinstance(d.get("migrations"), dict) else {}
    if mig.get("problems"):
        out.append(f"migrations: {mig.get('problems')} in trouble (approved {mig.get('approved')}, applied {mig.get('applied')})")
    errs = (d.get("client_errors") or {}).get("last_24h") if isinstance(d.get("client_errors"), dict) else None
    if isinstance(errs, int) and errs > CLIENT_ERRORS_MAX:
        out.append(f"browser errors: {errs} reported in 24 hours (ceiling {CLIENT_ERRORS_MAX})")
    if not _is(COMMIT, d.get("commit")):
        out.append("health: no commit reported")
    elif api_commit and not d["commit"].startswith(api_commit):
        out.append(f"the API runs {d['commit'][:7]}, not {api_commit[:7]}")
    return out


def check_pulse(a: Answer) -> list[str]:
    d = a.json()
    if a.status != 200 or not isinstance(d, dict):
        return [f"pulse: {a.said}"]
    out = []
    chain = d.get("chain") if isinstance(d.get("chain"), dict) else {}
    if chain.get("anchored") is not True:
        out.append("chain: the API has no chain to anchor to (confirmations would be signed and not anchored)")
    else:
        if not _is(ADDRESS, chain.get("registry")):
            out.append("chain: no registry address")
        if chain.get("chain_id") not in CHAINS:
            out.append(f"chain: unexpected chain id {chain.get('chain_id')}")
        if not (isinstance(chain.get("latest_block"), int) and chain["latest_block"] > 0):
            out.append("chain: the node did not answer with a block")
    curve = d.get("curve") if isinstance(d.get("curve"), dict) else {}
    if not curve.get("quotes"):
        out.append("pulse: no curve published")
    return out


def check_cors(a: Answer, origin: str) -> list[str]:
    allowed = a.headers.get("access-control-allow-origin")
    return [] if allowed in (origin, "*") else [f"CORS: {origin} is not allowed to read the API (answered {allowed!r})"]


def check_register(a: Answer) -> list[str]:
    d = a.json()
    if a.status != 200 or not isinstance(d, dict) or not isinstance(d.get("confirmations"), list):
        return [f"register: {a.said}"]
    out = []
    if "<" in a.text or ">" in a.text:
        out.append("register: the answer carries markup (a < or a >)")
    rows = d["confirmations"]
    if not (isinstance(d.get("total"), int) and d["total"] >= len(rows)):
        out.append(f"register: total {d.get('total')} is less than its {len(rows)} rows")
    for i, r in enumerate(rows):
        bad = _row_problems(r) if isinstance(r, dict) else ["not a record"]
        if bad:
            out.append(f"register row {i} ({str(r.get('trade_hash') if isinstance(r, dict) else r)[:18]}): " + "; ".join(bad))
        if len(out) >= 8:
            out.append("register: further rows not listed")
            break
    return out


def _row_problems(r: dict) -> list[str]:
    bad = []
    if not _is(HASH, r.get("trade_hash")):
        bad.append("hash")
    # a record the registry already held when its transaction was retried is anchored with no transaction of its own
    # (chain/attestation.py _recorded): no hash, and the link is to the registry
    tx = r.get("tx_hash")
    if tx is not None and not _is(HASH, tx):
        bad.append("transaction")
    if not _is(ADDRESS, r.get("registry")):
        bad.append("registry")
    if not (isinstance(r.get("block_number"), int) and r["block_number"] > 0):
        bad.append("block")
    explorer = CHAINS.get(r.get("chain_id"))
    if explorer is None:
        bad.append(f"chain {r.get('chain_id')}")
    links = {f"{explorer}tx/{tx}"} if tx else {f"{explorer}address/{r.get('registry')}"}
    if r.get("explorer_tx") is not None and not (explorer and r["explorer_tx"] in links):
        bad.append("explorer link")
    parties = r.get("parties")
    if not (isinstance(parties, list) and len(parties) <= 2 and all(_is(LEI, p) for p in parties)):
        bad.append("parties")
    for k in ("asset_class", "instrument_type", "structure"):
        if r.get(k) is not None and not _is(WORD, r[k]):
            bad.append(k)
    if not isinstance(r.get("bilateral"), bool):
        bad.append("bilateral")
    return bad


class _Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found: list[str] = []
        self.root = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id") == "root":
            self.root = True
        ref = a.get("src") if tag == "script" else a.get("href") if tag == "link" and a.get("rel") in ("stylesheet", "modulepreload") else None
        if ref and ref.startswith("/") and not ref.startswith("//") and ref not in self.found:
            self.found.append(ref)


ASSET_TYPES = {".js": ("javascript",), ".css": ("css",)}


def check_app(page: Answer, fetch: Callable[[str], Answer], app_commit: Optional[str] = None) -> list[str]:
    if page.status != 200 or page.type != "text/html":
        return [f"app: {page.said} ({page.type or 'no type'})"]
    p = _Assets()
    p.feed(page.text)
    out = []
    if not p.root:
        out.append("app: the page has no root to draw in")
    if not any(ref.endswith(".js") for ref in p.found):
        out.append("app: the page names no script")
    for ref in p.found:
        want = next((v for k, v in ASSET_TYPES.items() if ref.endswith(k)), None)
        if want is None:
            continue
        a = fetch(ref)
        if a.status != 200 or not any(w in a.type for w in want) or not a.body:
            out.append(f"app: {ref}: {a.said} as {a.type or 'no type'} (the page would not start)")
    v = fetch("/version.json")
    commit = (v.json() or {}).get("commit") if isinstance(v.json(), dict) else None
    if v.status != 200 or not _is(COMMIT, commit):
        out.append(f"app: version.json: {v.said}, without a commit")
    elif app_commit and not commit.startswith(app_commit):
        out.append(f"the app was built from {commit[:7]}, not {app_commit[:7]}")
    pdf = fetch("/methodology/rijeka_methodology.pdf")
    if pdf.status != 200 or pdf.type != "application/pdf" or not pdf.body.startswith(b"%PDF"):
        out.append(f"app: the methodology PDF: {pdf.said} as {pdf.type or 'no type'}")
    return out


def check_site(fetch: Callable[[str], Answer], registry: Optional[str]) -> list[str]:
    out = []
    # rijeka.app is the door (since 12 November 2026): it sends a visitor to the app's sign-in, and the landing is /about
    door = fetch("/")
    to = door.headers.get("location", "")
    try:                                                 # the app's own host and nothing that only begins like it
        at = urllib.parse.urlsplit(to)
        app = at.scheme == "https" and at.netloc == urllib.parse.urlsplit(APP).netloc
    except ValueError:
        app = False
    if door.status not in (301, 302, 307, 308) or not app:
        out.append(f"site: the front door: {door.said}{' to ' + to if to else ''}, not a redirect to {APP}")
    home = fetch("/about")
    if home.status != 200 or "Rijeka" not in home.text:
        out.append(f"site: the landing page (/about): {home.said}")
    verify = fetch("/verify/")
    if verify.status != 200:
        out.append(f"site: the verifier: {verify.said}")
    elif registry and registry.lower() not in verify.text.lower():
        out.append(f"site: the verifier does not list the registry the API anchors to ({registry})")
    register = fetch("/confirmations/")
    if register.status != 200 or API.split("//")[1] not in register.text:
        out.append(f"site: the register page: {register.said}" if register.status != 200 else "site: the register page no longer reads the API")
    return out


# ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────

def run(api_commit: Optional[str] = None, app_commit: Optional[str] = None, get_: Callable[..., Answer] = get,
        now: Optional[datetime] = None, pause_s: float = 65.0) -> list[tuple[str, list[str]]]:
    """[(what was looked at, what is wrong with it)], in the order looked at."""
    results = []
    health = get_(f"{API}/api/ops/health")
    results.append(("API health", check_health(health, now or datetime.now(timezone.utc), api_commit)))

    pulse = get_(f"{API}/api/public/pulse", headers={"Origin": APP})
    found = check_pulse(pulse)
    if any(f.startswith("chain:") for f in found):              # the pulse is cached a minute: one slow node is not an outage
        time.sleep(pause_s)
        pulse = get_(f"{API}/api/public/pulse", headers={"Origin": APP})
        found = check_pulse(pulse)
    results.append(("chain and published market", found))
    cors = check_cors(pulse, APP) if pulse.status == 200 else []
    from_site = get_(f"{API}/api/public/confirmations?limit={REGISTER_ROWS}", headers={"Origin": SITE})
    if from_site.status == 200:
        cors += check_cors(from_site, SITE)
    results.append(("the app and the site may read the API", cors))
    results.append(("public register", check_register(from_site)))

    results.append(("web app", check_app(get_(f"{APP}/"), lambda path: get_(f"{APP}{path}"), app_commit)))
    registry = ((pulse.json() or {}).get("chain") or {}).get("registry") if isinstance(pulse.json(), dict) else None
    results.append(("public site", check_site(lambda path: get_(f"{SITE}{path}"), registry if _is(ADDRESS, registry) else None)))
    return results


def plain(line: str, limit: int = 400) -> str:
    """A line of the report, safe to print in a public log: what production sent is in it, so only printable ASCII
    is kept, its length is bounded, and it cannot hold the `::` that begins a command to the workflow runner."""
    kept = "".join(c if 32 <= ord(c) < 127 else "?" for c in str(line))
    return kept.replace("::", ": :")[:limit]


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Production, looked at from the outside. Exit 1 when a check fails.")
    p.add_argument("--api-commit", help="the commit the API must report (a prefix is enough)")
    p.add_argument("--app-commit", help="the commit the web app must have been built from (a prefix is enough)")
    a = p.parse_args(argv)
    global _budget_ends
    _budget_ends = time.monotonic() + RUN_BUDGET_S
    results = run(a.api_commit, a.app_commit)
    failed = 0
    for what, problems in results:
        print(("FAIL  " if problems else "ok    ") + what)
        for line in problems:
            failed += 1
            print("        " + plain(line))
    print(f"\n{failed} problem(s)" if failed else "\nnothing wrong")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
