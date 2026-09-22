"""
PROMETHEUS tools — lookups only.

Every handler reads; none writes. The session they run on is read-only at the
database (see readonly_session), and every query filters on the asking
user's tenant. Source access is confined to an allowlist of engineering
files under the repo root.

Adding a tool: it must be a pure read, scoped by self.user_id. Anything that
changes state belongs in the product UI, not here.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import desc, event, text
from sqlalchemy.orm import Session

from db.models import Counterparty, LegalEntity, Trade, TradeEvent, TradeLeg


# ── Read-only session ────────────────────────────────────────────────────────

class ReadOnlyViolation(RuntimeError):
    pass


def _refuse_flush(session, flush_context, instances):
    raise ReadOnlyViolation("PROMETHEUS sessions are read-only")


def make_readonly(db: Session) -> Session:
    """
    Two independent guards: the ORM refuses to flush, and Postgres refuses any
    write in the transaction. Caller must rollback/close when done.
    """
    event.listen(db, "before_flush", _refuse_flush)
    db.execute(text("SET TRANSACTION READ ONLY"))
    return db


# ── Serialisation ────────────────────────────────────────────────────────────

# Internal plumbing that explains nothing to a user.
_HIDDEN_COLUMNS = {"user_id", "created_by", "last_modified_by", "latest_event_id", "snapshot_id"}


def _jsonable(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    return v


def _row(obj) -> dict:
    return {
        c.name: _jsonable(getattr(obj, c.key))
        for c in obj.__table__.columns
        if c.name not in _HIDDEN_COLUMNS and getattr(obj, c.key) is not None
    }


# ── Source allowlist ─────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]

# Directories and files Prometheus may read to explain how Rijeka is built.
# Deliberately excludes middleware/ (auth), .env*, tests, build output.
_SOURCE_ROOTS = [
    "backend/pricing",
    "backend/chain",
    "backend/api/routes",
    "backend/projections",
    "backend/db/models.py",
    "chain/src",
    "chain/tools",
    "chain/script",
    "chain/README.md",
    "docs",
    "_docs",
    "model_validation",
    "README.md",
    "ARCHITECTURE_v36.md",
]
_SOURCE_EXTS = {".py", ".sol", ".md", ".tex", ".sql", ".txt"}
_MAX_READ_LINES = 400
_MAX_SEARCH_HITS = 60


def _allowed_roots() -> list[Path]:
    return [(REPO_ROOT / r).resolve() for r in _SOURCE_ROOTS if (REPO_ROOT / r).exists()]


def _is_allowed(p: Path) -> bool:
    try:
        p = p.resolve()
    except OSError:
        return False
    if not p.is_relative_to(REPO_ROOT):
        return False
    # Dotfiles (.env, .git) and bytecode are never readable, even inside a root.
    if any(part.startswith(".") or part == "__pycache__" for part in p.relative_to(REPO_ROOT).parts):
        return False
    for root in _allowed_roots():
        if p == root or p.is_relative_to(root):
            return p.is_dir() or p.suffix.lower() in _SOURCE_EXTS
    return False


def _resolve_source(path: str) -> Path:
    p = (REPO_ROOT / path.strip().lstrip("/")).resolve()
    if not _is_allowed(p):
        raise ValueError(
            f"'{path}' is outside what Prometheus can read. Start from list_source() "
            "with no path to see the readable roots."
        )
    return p


def _rel(p: Path) -> str:
    return str(p.relative_to(REPO_ROOT))


# ── Tool definitions ─────────────────────────────────────────────────────────

def _schema(props: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": props,
        "required": required or [],
        "additionalProperties": False,
    }


TOOL_DEFS: list[dict] = [
    {
        "name": "list_trades",
        "description": (
            "List the user's trades, newest first: ref, status, instrument, counterparty, "
            "notional, dates. Use to find a trade before get_trade, or to answer questions "
            "about the book as a whole."
        ),
        "input_schema": _schema({
            "status": {"type": "string", "description": "Filter, e.g. PENDING, LIVE, CONFIRMED, CANCELLED."},
            "asset_class": {"type": "string", "description": "Filter, e.g. RATES, FX, CREDIT."},
            "counterparty": {"type": "string", "description": "Case-insensitive substring of counterparty name."},
            "limit": {"type": "integer", "description": "Max rows, default 50, max 200."},
        }),
    },
    {
        "name": "get_trade",
        "description": (
            "Full detail for one of the user's trades: trade-level fields and terms, every leg "
            "(rates, spreads, day counts, frequencies, embedded options), both parties with CSA "
            "terms, and the event history (booked, amended, confirmed...)."
        ),
        "input_schema": _schema({
            "trade": {"type": "string", "description": "Trade id (UUID) or trade_ref."},
        }, ["trade"]),
    },
    {
        "name": "get_confirmation",
        "description": (
            "On-chain confirmation state for one of the user's trades: the canonical record that "
            "is hashed, its keccak256 hash, whether the stored hash still matches the current "
            "booking, the stored attestation (signatures, EIP-712 domain, tx, block) and the "
            "live registry record when a chain is configured."
        ),
        "input_schema": _schema({
            "trade": {"type": "string", "description": "Trade id (UUID) or trade_ref."},
        }, ["trade"]),
    },
    {
        "name": "list_parties",
        "description": (
            "The user's own legal entities and their counterparties, with LEIs, ISDA/CSA terms "
            "(type, currency, threshold, MTA) and IM model."
        ),
        "input_schema": _schema({}),
    },
    {
        "name": "list_source",
        "description": (
            "List readable Rijeka source and methodology files. No path lists the readable "
            "roots (pricing engine, XVA, chain confirmation, API routes, docs). Use to find "
            "where something is implemented."
        ),
        "input_schema": _schema({
            "path": {"type": "string", "description": "Repo-relative directory, e.g. backend/pricing."},
        }),
    },
    {
        "name": "search_source",
        "description": (
            "Regex search (case-insensitive) across readable Rijeka source and docs. Returns "
            "file:line matches. Use to locate a function, formula or concept before reading it."
        ),
        "input_schema": _schema({
            "pattern": {"type": "string", "description": "Python regex, e.g. 'def simm|mpor'."},
            "path": {"type": "string", "description": "Optional repo-relative directory or file to limit the search."},
        }, ["pattern"]),
    },
    {
        "name": "read_source",
        "description": (
            f"Read a readable Rijeka source or doc file with line numbers, up to "
            f"{_MAX_READ_LINES} lines per call. Cite the path when you explain from it."
        ),
        "input_schema": _schema({
            "path": {"type": "string", "description": "Repo-relative file path, e.g. backend/pricing/csa.py."},
            "start_line": {"type": "integer", "description": "1-based first line, default 1."},
            "end_line": {"type": "integer", "description": "Last line, inclusive."},
        }, ["path"]),
    },
]


# ── Handlers ─────────────────────────────────────────────────────────────────

class Toolbox:
    """All lookups for one request, bound to one user's tenant."""

    def __init__(self, db: Session, user_id: str):
        self.db = db
        self.user_id = uuid.UUID(user_id)
        self.handlers: dict[str, Callable[..., Any]] = {
            "list_trades": self.list_trades,
            "get_trade": self.get_trade,
            "get_confirmation": self.get_confirmation,
            "list_parties": self.list_parties,
            "list_source": self.list_source,
            "search_source": self.search_source,
            "read_source": self.read_source,
        }

    def run(self, name: str, args: dict) -> tuple[str, bool]:
        """Returns (content, is_error)."""
        fn = self.handlers.get(name)
        if fn is None:
            return f"Unknown tool: {name}", True
        try:
            out = fn(**(args or {}))
        except ReadOnlyViolation:
            raise
        except (ValueError, LookupError, TypeError) as e:
            return str(e), True
        return out if isinstance(out, str) else json.dumps(out, default=_jsonable), False

    # trades

    def _trade(self, ref: str) -> Trade:
        q = self.db.query(Trade).filter(Trade.user_id == self.user_id)
        try:
            tid = uuid.UUID(ref)
            t = q.filter(Trade.id == tid).first()
        except ValueError:
            t = q.filter(Trade.trade_ref == ref.strip()).first()
        if t is None:
            raise LookupError(f"No trade '{ref}' in this user's book.")
        return t

    def list_trades(self, status=None, asset_class=None, counterparty=None, limit=50):
        limit = max(1, min(int(limit or 50), 200))
        q = (self.db.query(Trade, Counterparty.name)
             .outerjoin(Counterparty, Counterparty.id == Trade.counterparty_id)
             .filter(Trade.user_id == self.user_id))
        if status:
            q = q.filter(Trade.status == status.upper())
        if asset_class:
            q = q.filter(Trade.asset_class == asset_class.upper())
        if counterparty:
            q = q.filter(Counterparty.name.ilike(f"%{counterparty}%"))
        rows = q.order_by(desc(Trade.trade_date), desc(Trade.created_at)).limit(limit).all()
        return [
            {
                "id": str(t.id), "trade_ref": t.trade_ref, "status": t.status,
                "asset_class": t.asset_class, "instrument_type": t.instrument_type,
                "structure": t.structure, "counterparty": cp_name,
                "notional": _jsonable(t.notional), "notional_ccy": t.notional_ccy,
                "trade_date": _jsonable(t.trade_date), "maturity_date": _jsonable(t.maturity_date),
                "desk": t.desk, "book": t.book,
            }
            for t, cp_name in rows
        ]

    def get_trade(self, trade: str):
        t = self._trade(trade)
        legs = (self.db.query(TradeLeg)
                .filter(TradeLeg.trade_id == t.id, TradeLeg.user_id == self.user_id)
                .order_by(TradeLeg.leg_seq).all())
        events = (self.db.query(TradeEvent)
                  .filter(TradeEvent.trade_id == t.id, TradeEvent.user_id == self.user_id)
                  .order_by(desc(TradeEvent.event_seq)).limit(50).all())
        own = self._entity(t.own_legal_entity_id)
        cp = self._counterparty(t.counterparty_id)
        return {
            "trade": _row(t),
            "own_entity": _row(own) if own else None,
            "counterparty": _row(cp) if cp else None,
            "legs": [_row(l) for l in legs],
            "events": [_row(e) for e in events],
        }

    def _entity(self, eid):
        if eid is None:
            return None
        return self.db.query(LegalEntity).filter(
            LegalEntity.id == eid, LegalEntity.user_id == self.user_id).first()

    def _counterparty(self, cid):
        if cid is None:
            return None
        return self.db.query(Counterparty).filter(
            Counterparty.id == cid, Counterparty.user_id == self.user_id).first()

    def get_confirmation(self, trade: str):
        # Imported here: chain routes pull in web3, which we only need on this path.
        from api.routes.chain import _canonical_for, _latest_confirmed_event
        from chain.attestation import get_backend
        from fastapi import HTTPException

        t = self._trade(trade)
        out: dict[str, Any] = {"trade_id": str(t.id), "trade_ref": t.trade_ref, "status": t.status}
        try:
            payload, h = _canonical_for(self.db, t)
            out["canonical_record"] = payload
            out["current_hash"] = "0x" + h.hex()
        except HTTPException as e:
            out["canonical_record"] = None
            out["canonical_error"] = e.detail
            h = None

        ev = _latest_confirmed_event(self.db, t.id)
        att = (ev.payload or {}).get("attestation") if ev else None
        out["attestation"] = att
        if not att:
            out["summary"] = "Not confirmed on-chain."
            return out

        stored = att.get("trade_hash")
        out["hash_matches_current_booking"] = (h is not None and stored == "0x" + h.hex())
        be = get_backend()
        out["chain_backend_anchored"] = bool(be.anchored)
        if be.anchored and stored:
            try:
                rec = be.get(bytes.fromhex(stored[2:]))
                out["on_chain"] = rec.__dict__ if rec else None
            except Exception as e:  # network read; report, don't fail the answer
                out["on_chain_error"] = f"registry read failed: {e}"
        return out

    def list_parties(self):
        ents = (self.db.query(LegalEntity)
                .filter(LegalEntity.user_id == self.user_id).order_by(LegalEntity.name).all())
        cps = (self.db.query(Counterparty)
               .filter(Counterparty.user_id == self.user_id).order_by(Counterparty.name).all())
        return {
            "own_entities": [_row(e) for e in ents if e.is_own_entity],
            "other_legal_entities": [_row(e) for e in ents if not e.is_own_entity],
            "counterparties": [_row(c) for c in cps],
        }

    # source

    def list_source(self, path=None):
        if not path:
            return {"readable_roots": [_rel(r) for r in _allowed_roots()]}
        p = _resolve_source(path)
        if p.is_file():
            return {"file": _rel(p), "lines": sum(1 for _ in p.open(errors="replace"))}
        entries = []
        for c in sorted(p.iterdir()):
            if _is_allowed(c):
                entries.append(_rel(c) + ("/" if c.is_dir() else ""))
        return {"path": _rel(p), "entries": entries}

    def search_source(self, pattern: str, path=None):
        try:
            rx = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            raise ValueError(f"Bad regex: {e}")
        bases = [_resolve_source(path)] if path else _allowed_roots()
        hits: list[str] = []
        for base in bases:
            files = [base] if base.is_file() else sorted(base.rglob("*"))
            for f in files:
                if not f.is_file() or not _is_allowed(f):
                    continue
                try:
                    for i, line in enumerate(f.open(errors="replace"), 1):
                        if rx.search(line):
                            hits.append(f"{_rel(f)}:{i}: {line.strip()[:200]}")
                            if len(hits) >= _MAX_SEARCH_HITS:
                                return "\n".join(hits) + f"\n… stopped at {_MAX_SEARCH_HITS} matches; narrow the pattern or path."
                except OSError:
                    continue
        return "\n".join(hits) if hits else "No matches."

    def read_source(self, path: str, start_line=1, end_line=None):
        p = _resolve_source(path)
        if not p.is_file():
            raise ValueError(f"'{path}' is a directory; use list_source.")
        lines = p.read_text(errors="replace").splitlines()
        start = max(1, int(start_line or 1))
        end = min(len(lines), int(end_line) if end_line else start + _MAX_READ_LINES - 1,
                  start + _MAX_READ_LINES - 1)
        body = "\n".join(f"{n:>5}  {lines[n - 1]}" for n in range(start, end + 1))
        more = f"\n… file has {len(lines)} lines; continue with start_line={end + 1}." if end < len(lines) else ""
        return f"{_rel(p)} (lines {start}-{end} of {len(lines)})\n{body}{more}"
