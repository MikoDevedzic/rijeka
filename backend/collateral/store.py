"""The collateral tables: a firm's own instruments (overriding or adding to the seed) and the schedule versions per
counterparty. Every read tolerates the tables being absent (a deploy ahead of docs/migrations/2026-11-05_collateral.sql):
reads return the seed and no schedule, writes raise RuntimeError. A negative presence answer is never cached."""
from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any, Optional

from sqlalchemy import text

from pricing import collateral as COL

_tables: dict[str, Any] = {}
TABLES = ("collateral_instruments", "collateral_schedules")


def tables_present(db) -> bool:
    if "present" not in _tables:
        try:
            n = db.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('collateral_instruments', 'collateral_schedules')")).scalar()
            if int(n or 0) != len(TABLES):
                return False
            _tables["present"] = True
        except Exception:          # noqa: BLE001
            db.rollback()
            return False
    return _tables["present"]


def _need(db) -> None:
    if not tables_present(db):
        raise RuntimeError("Collateral instruments and schedules need docs/migrations/2026-11-05_collateral.sql applied first")


def _j(v):
    return v if isinstance(v, (dict, list)) or v is None else json.loads(v)


# ── instruments ──────────────────────────────────────────────────────────────

_COLS = "code, name, cls, currency, issuer, rail, yield_kind, yield_ref, yield_bp, chain_id, token_address, csa_haircut_pct, active, note"


def firm_rows(db, scope_id) -> list[COL.Instrument]:
    if scope_id is None or not tables_present(db):
        return []
    rows = db.execute(text(f"SELECT {_COLS} FROM collateral_instruments WHERE firm_id = :f ORDER BY code"), {"f": str(scope_id)}).mappings().all()
    out = []
    for r in rows:
        try:
            out.append(COL.instrument_from_row(dict(r), firm=True))
        except ValueError:
            continue            # a row whose class the catalogue no longer knows is skipped, not fatal
    return out


def instruments(db, scope_id, include_inactive: bool = False) -> dict[str, COL.Instrument]:
    """The seed with the firm's rows laid over it (a firm row with a seed's code replaces that seed entry)."""
    out = dict(COL.SEED)
    for inst in firm_rows(db, scope_id):
        out[inst.code] = inst
    if not include_inactive:
        out = {k: v for k, v in out.items() if v.active}
    return out


def put_instrument(db, scope_id, inst: COL.Instrument, by) -> None:
    _need(db)
    db.execute(text("INSERT INTO collateral_instruments (id, firm_id, code, name, cls, currency, issuer, rail, yield_kind, yield_ref, yield_bp, chain_id, token_address, "
                    "csa_haircut_pct, active, note, created_by) VALUES (:id, :f, :code, :name, :cls, :ccy, :iss, :rail, :yk, :yr, :yb, :ch, :tok, :hc, :act, :note, :by) "
                    "ON CONFLICT (firm_id, code) DO UPDATE SET name = EXCLUDED.name, cls = EXCLUDED.cls, currency = EXCLUDED.currency, issuer = EXCLUDED.issuer, "
                    "rail = EXCLUDED.rail, yield_kind = EXCLUDED.yield_kind, yield_ref = EXCLUDED.yield_ref, yield_bp = EXCLUDED.yield_bp, chain_id = EXCLUDED.chain_id, "
                    "token_address = EXCLUDED.token_address, csa_haircut_pct = EXCLUDED.csa_haircut_pct, active = EXCLUDED.active, note = EXCLUDED.note, "
                    "created_by = EXCLUDED.created_by, created_at = now()"),
               {"id": str(uuid.uuid4()), "f": str(scope_id), "code": inst.code, "name": inst.name, "cls": inst.cls, "ccy": inst.currency, "iss": inst.issuer, "rail": inst.rail,
                "yk": inst.yield_kind, "yr": inst.yield_ref, "yb": inst.yield_bp, "ch": inst.chain_id, "tok": inst.token_address, "hc": inst.csa_haircut_pct,
                "act": inst.active, "note": inst.note, "by": str(by)})


def remove_instrument(db, scope_id, code: str) -> int:
    """Removes the firm's own row; a seed entry cannot be removed, only overridden (deactivated) by a firm row."""
    _need(db)
    return db.execute(text("DELETE FROM collateral_instruments WHERE firm_id = :f AND code = :c"), {"f": str(scope_id), "c": code}).rowcount


# ── schedules ────────────────────────────────────────────────────────────────

def _row_to_schedule(r) -> COL.Schedule:
    return COL.Schedule(_j(r.eligible) or [], _j(r.posted) or {}, _j(r.received) or {}, r.rail or "bilateral",
                        r.effective_from.isoformat() if r.effective_from else None, r.note or "")


def schedule(db, cp_id, upto: Optional[date] = None) -> Optional[COL.Schedule]:
    """The schedule in force on the date (the latest version with effective_from on or before it)."""
    if cp_id is None or not tables_present(db):
        return None
    r = db.execute(text("SELECT eligible, posted, received, rail, effective_from, note FROM collateral_schedules WHERE counterparty_id = :c AND effective_from <= :d "
                        "ORDER BY effective_from DESC, created_at DESC LIMIT 1"), {"c": str(cp_id), "d": upto or date.today()}).first()
    return _row_to_schedule(r) if r else None


def schedules(db, cp_ids: list) -> dict[str, Optional[COL.Schedule]]:
    """{counterparty id: schedule in force today} for many counterparties in one query."""
    out = {str(i): None for i in cp_ids}
    if not cp_ids or not tables_present(db):
        return out
    rows = db.execute(text("SELECT DISTINCT ON (counterparty_id) counterparty_id, eligible, posted, received, rail, effective_from, note FROM collateral_schedules "
                           "WHERE counterparty_id = ANY(:ids) AND effective_from <= :d ORDER BY counterparty_id, effective_from DESC, created_at DESC"),
                      {"ids": [uuid.UUID(str(i)) for i in cp_ids], "d": date.today()}).all()
    for r in rows:
        out[str(r.counterparty_id)] = _row_to_schedule(r)
    return out


def history(db, cp_id) -> list[dict]:
    if cp_id is None or not tables_present(db):
        return []
    rows = db.execute(text("SELECT eligible, posted, received, rail, effective_from, note, created_by_name, created_at FROM collateral_schedules "
                           "WHERE counterparty_id = :c ORDER BY effective_from DESC, created_at DESC"), {"c": str(cp_id)}).all()
    return [{**_row_to_schedule(r).to_dict(), "created_by_name": r.created_by_name, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


def put_schedule(db, cp_id, uid, sched: COL.Schedule, by, by_name: str) -> None:
    """A new version (one per counterparty and effective date; the same date replaces)."""
    _need(db)
    eff = date.fromisoformat(sched.effective_from) if sched.effective_from else date.today()
    db.execute(text("INSERT INTO collateral_schedules (id, counterparty_id, user_id, effective_from, eligible, posted, received, rail, note, created_by, created_by_name) "
                    "VALUES (:id, :c, :u, :d, CAST(:e AS jsonb), CAST(:p AS jsonb), CAST(:r AS jsonb), :rail, :n, :by, :bn) "
                    "ON CONFLICT (counterparty_id, effective_from) DO UPDATE SET eligible = EXCLUDED.eligible, posted = EXCLUDED.posted, received = EXCLUDED.received, "
                    "rail = EXCLUDED.rail, note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_by_name = EXCLUDED.created_by_name, created_at = now()"),
               {"id": str(uuid.uuid4()), "c": str(cp_id), "u": str(uid), "d": eff, "e": json.dumps(sched.eligible), "p": json.dumps(sched.posted),
                "r": json.dumps(sched.received), "rail": sched.rail, "n": sched.note, "by": str(by), "bn": by_name})
