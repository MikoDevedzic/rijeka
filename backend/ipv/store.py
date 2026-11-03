"""The IPV tables: tolerance rules, runs, overrides, independent marks. Every function tolerates the tables being
absent (a deploy ahead of docs/migrations/2026-11-05_ipv.sql): reads return nothing, writes raise RuntimeError."""
from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any, Optional

from sqlalchemy import text

_tables: dict[str, Any] = {}


def tables_present(db) -> bool:
    if "present" not in _tables:
        try:
            n = db.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('ipv_tolerances', 'ipv_runs', 'ipv_overrides', 'ipv_independent_marks')")).scalar()
            _tables["present"] = int(n or 0) == 4
        except Exception:          # noqa: BLE001
            db.rollback()
            return False
    return _tables["present"]


def _need(db) -> None:
    if not tables_present(db):
        raise RuntimeError("IPV needs docs/migrations/2026-11-05_ipv.sql applied first")


def _j(v):
    return v if isinstance(v, (dict, list)) or v is None else json.loads(v)


# ── tolerances ───────────────────────────────────────────────────────────────

def list_tolerances(db, firm_id) -> list[dict]:
    if firm_id is None or not tables_present(db):
        return []
    rows = db.execute(text("SELECT id, input_pattern, pillar_pattern, tol, unit, materiality_usd, note, set_by_name, created_at FROM ipv_tolerances "
                           "WHERE firm_id = :f ORDER BY created_at"), {"f": str(firm_id)}).all()
    return [{"id": str(r.id), "input_pattern": r.input_pattern, "pillar_pattern": r.pillar_pattern, "tol": float(r.tol), "unit": r.unit,
             "materiality_usd": float(r.materiality_usd or 0), "note": r.note, "set_by_name": r.set_by_name, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


def add_tolerance(db, firm_id, input_pattern: str, pillar_pattern: str, tol: float, unit: str, materiality_usd: float, note: str, set_by: str, set_by_name: str) -> str:
    _need(db)
    tid = str(uuid.uuid4())
    db.execute(text("INSERT INTO ipv_tolerances (id, firm_id, input_pattern, pillar_pattern, tol, unit, materiality_usd, note, set_by, set_by_name) "
                    "VALUES (:id, :f, :ip, :pp, :t, :u, :m, :n, :b, :bn)"),
               {"id": tid, "f": str(firm_id), "ip": input_pattern, "pp": pillar_pattern or "*", "t": tol, "u": unit, "m": materiality_usd, "n": note, "b": str(set_by), "bn": set_by_name})
    return tid


def remove_tolerance(db, firm_id, tid: str) -> int:
    _need(db)
    return db.execute(text("DELETE FROM ipv_tolerances WHERE id = :id AND firm_id = :f"), {"id": tid, "f": str(firm_id)}).rowcount


# ── independent marks ────────────────────────────────────────────────────────

def independent_quotes(db, uid: str, curve_id: str, upto: date) -> Optional[dict]:
    if not tables_present(db):
        return None
    r = db.execute(text("SELECT valuation_date, quotes, source FROM ipv_independent_marks WHERE user_id = :u AND curve_id = :c AND valuation_date <= :d "
                        "ORDER BY valuation_date DESC LIMIT 1"), {"u": uid, "c": curve_id, "d": upto}).first()
    if r is None:
        return None
    return {"date": r.valuation_date.isoformat(), "quotes": _j(r.quotes) or [], "source": r.source}


def put_independent(db, uid: str, curve_id: str, d: date, quotes: list[dict], source: str, created_by: str) -> None:
    _need(db)
    db.execute(text("INSERT INTO ipv_independent_marks (id, user_id, curve_id, valuation_date, quotes, source, created_by) "
                    "VALUES (:id, :u, :c, :d, CAST(:q AS jsonb), :s, :b) ON CONFLICT (user_id, curve_id, valuation_date) DO UPDATE SET "
                    "quotes = EXCLUDED.quotes, source = EXCLUDED.source, created_by = EXCLUDED.created_by, created_at = now()"),
               {"id": str(uuid.uuid4()), "u": uid, "c": curve_id, "d": d, "q": json.dumps(quotes), "s": source, "b": str(created_by)})


# ── overrides ────────────────────────────────────────────────────────────────

def overrides(db, uid: str, d: date, scope_key: str) -> list[dict]:
    if not tables_present(db):
        return []
    rows = db.execute(text("SELECT id, curve_id, pillar, desk_value, override_value, reason, author_name, created_at FROM ipv_overrides "
                           "WHERE user_id = :u AND run_date = :d AND scope_key = :s AND withdrawn_at IS NULL ORDER BY created_at"), {"u": uid, "d": d, "s": scope_key}).all()
    return [{"id": str(r.id), "curve_id": r.curve_id, "pillar": r.pillar, "desk_value": float(r.desk_value) if r.desk_value is not None else None,
             "override_value": float(r.override_value), "reason": r.reason, "author_name": r.author_name, "at": r.created_at.isoformat() if r.created_at else None} for r in rows]


def put_override(db, uid: str, d: date, scope_key: str, curve_id: str, pillar: str, desk_value: Optional[float], value: float, reason: str, author: str, author_name: str) -> str:
    _need(db)
    db.execute(text("UPDATE ipv_overrides SET withdrawn_at = now() WHERE user_id = :u AND run_date = :d AND scope_key = :s AND curve_id = :c AND pillar = :p AND withdrawn_at IS NULL"),
               {"u": uid, "d": d, "s": scope_key, "c": curve_id, "p": pillar})
    oid = str(uuid.uuid4())
    db.execute(text("INSERT INTO ipv_overrides (id, user_id, run_date, scope_key, curve_id, pillar, desk_value, override_value, reason, author_user_id, author_name) "
                    "VALUES (:id, :u, :d, :s, :c, :p, :dv, :v, :r, :a, :an)"),
               {"id": oid, "u": uid, "d": d, "s": scope_key, "c": curve_id, "p": pillar, "dv": desk_value, "v": value, "r": reason, "a": str(author), "an": author_name})
    return oid


def withdraw_override(db, uid: str, oid: str) -> int:
    _need(db)
    return db.execute(text("UPDATE ipv_overrides SET withdrawn_at = now() WHERE id = :id AND user_id = :u AND withdrawn_at IS NULL"), {"id": oid, "u": uid}).rowcount


# ── runs ─────────────────────────────────────────────────────────────────────

def get_run(db, uid: str, d: date, scope_key: str) -> Optional[dict]:
    if not tables_present(db):
        return None
    r = db.execute(text("SELECT id, status, flash_usd, first_order_usd, second_order_usd, xva_usd, official_usd, inputs, unvalued, scope, applied_at, signed_at, signed_name, created_at "
                        "FROM ipv_runs WHERE user_id = :u AND run_date = :d AND scope_key = :s"), {"u": uid, "d": d, "s": scope_key}).first()
    if r is None:
        return None
    f = lambda x: float(x) if x is not None else None
    return {"id": str(r.id), "status": r.status, "flash_usd": f(r.flash_usd), "first_order_usd": f(r.first_order_usd), "second_order_usd": f(r.second_order_usd),
            "xva_usd": f(r.xva_usd), "official_usd": f(r.official_usd), "inputs": _j(r.inputs) or [], "unvalued": _j(r.unvalued) or [], "scope": _j(r.scope) or {},
            "applied_at": r.applied_at.isoformat() if r.applied_at else None, "signed_at": r.signed_at.isoformat() if r.signed_at else None, "signed_name": r.signed_name,
            "created_at": r.created_at.isoformat() if r.created_at else None}


def put_run(db, uid: str, d: date, scope_key: str, run: dict) -> None:
    _need(db)
    db.execute(text("INSERT INTO ipv_runs (id, user_id, run_date, scope_key, scope, status, flash_usd, first_order_usd, second_order_usd, xva_usd, official_usd, inputs, unvalued, applied_at) "
                    "VALUES (:id, :u, :d, :s, CAST(:sc AS jsonb), :st, :fl, :fo, :so, :x, :of, CAST(:inp AS jsonb), CAST(:un AS jsonb), :ap) "
                    "ON CONFLICT (user_id, run_date, scope_key) DO UPDATE SET scope = EXCLUDED.scope, flash_usd = EXCLUDED.flash_usd, first_order_usd = EXCLUDED.first_order_usd, "
                    "second_order_usd = EXCLUDED.second_order_usd, xva_usd = EXCLUDED.xva_usd, official_usd = EXCLUDED.official_usd, inputs = EXCLUDED.inputs, unvalued = EXCLUDED.unvalued, "
                    "applied_at = EXCLUDED.applied_at, created_at = now()"),
               {"id": str(uuid.uuid4()), "u": uid, "d": d, "s": scope_key, "sc": json.dumps(run.get("scope") or {}), "st": run.get("status") or "OPEN",
                "fl": run.get("flash_usd"), "fo": run.get("first_order_usd"), "so": run.get("second_order_usd"), "x": run.get("xva_usd"), "of": run.get("official_usd"),
                "inp": json.dumps(run.get("inputs") or []), "un": json.dumps(run.get("unvalued") or []), "ap": run.get("applied_at")})


def mark_signed(db, uid: str, d: date, scope_key: str, signer: str, signer_name: str) -> None:
    _need(db)
    db.execute(text("UPDATE ipv_runs SET status = 'SIGNED', signed_at = now(), signed_by = :b, signed_name = :n WHERE user_id = :u AND run_date = :d AND scope_key = :s"),
               {"b": str(signer), "n": signer_name, "u": uid, "d": d, "s": scope_key})


def latest_signed(db, uid: str, d: date) -> Optional[dict]:
    """The signed GLOBAL run for the date, for the trading P&L's OFFICIAL figure."""
    r = get_run(db, uid, d, "GLOBAL")
    return r if r and r["status"] == "SIGNED" else None
