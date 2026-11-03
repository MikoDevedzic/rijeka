"""Module switches per firm: which parts of the desk a firm runs.

A switch hides the module's pages and tabs, skips its batches and relaxes its gates (no IPV: the official P&L is
the flash plus XVA); it never deletes anything, and switching back on resumes with history intact. Null on the
firm (or the column missing: a deploy ahead of docs/migrations/2026-11-04_firm_modules.sql) means every module
on, which is today's behaviour. Every change is a module_events row with who, when, before and after."""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from sqlalchemy import text

# key, label, what it switches, planned (the module does not exist yet: shown, not switchable)
MODULES: list[dict[str, Any]] = [
    {"key": "CHAIN_CONFIRM", "label": "On-chain confirmation", "effects": "the CONFIRM tab and the registry anchor; off, a trade is confirmed by the counterparty's countersign only"},
    {"key": "PNL", "label": "P&L and sign-off", "effects": "the P&L page, the end-of-day batch, the sign-off flow"},
    {"key": "XVA", "label": "XVA on the ticket", "effects": "the XVA tab: stand-alone and incremental charges"},
    {"key": "MARKET_RISK", "label": "Market risk", "effects": "Risk → Market risk, the nightly ladder, VaR, stress and limits batch"},
    {"key": "COUNTERPARTY_CREDIT", "label": "Counterparty credit", "effects": "Risk → Counterparty credit, the nightly netting-set run and credit limits"},
    {"key": "CAPITAL", "label": "Capital", "effects": "Risk → Capital and the ticket's CAPITAL tab"},
    {"key": "PROMETHEUS", "label": "Prometheus", "effects": "the read-only assistant and the book brief"},
    {"key": "NEWS", "label": "News room", "effects": "the news feed and its summaries"},
    {"key": "COLLATERAL", "label": "Collateral", "effects": "agreements, margin, inventory, regimes", "planned": True},
    {"key": "XVA_RESERVES", "label": "XVA reserves", "effects": "the reserve book under P&L: levels, explain, sign-off", "planned": True},
    {"key": "IPV", "label": "Independent price verification", "effects": "the IPV tab under P&L and the flash → official gate", "planned": True},
]
KEYS = tuple(m["key"] for m in MODULES)
PLANNED = tuple(m["key"] for m in MODULES if m.get("planned"))

PRESETS: dict[str, dict[str, Any]] = {
    "DEALER":    {"label": "Dealer", "desc": "everything on", "off": ()},
    "CORPORATE": {"label": "Corporate treasury", "desc": "book, confirm, P&L, the charge on the ticket; no risk desk, no capital",
                  "off": ("MARKET_RISK", "COUNTERPARTY_CREDIT", "CAPITAL", "COLLATERAL", "IPV", "XVA_RESERVES")},
    "FUND":      {"label": "Fund", "desc": "the desk without regulatory capital", "off": ("CAPITAL",)},
    "CLASSROOM": {"label": "Classroom", "desc": "everything on; the chain stays on the test network (a deployment setting)", "off": ()},
}

_PRESENT: dict[str, bool] = {}


def all_on() -> dict[str, bool]:
    return {k: True for k in KEYS}


def columns_present(db) -> bool:
    if "present" not in _PRESENT:
        try:
            n = db.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'firms' AND column_name IN ('modules', 'modules_preset')")).scalar()
            _PRESENT["present"] = int(n or 0) == 2
        except Exception:          # noqa: BLE001
            db.rollback()
            return False
    return _PRESENT["present"]


def preset_modules(name: str) -> dict[str, bool]:
    p = PRESETS[name.upper()]
    return {k: (k not in p["off"]) for k in KEYS}


def normalise(d: Optional[dict]) -> dict[str, bool]:
    out = all_on()
    for k, v in (d or {}).items():
        if k in out:
            out[k] = bool(v)
    return out


def for_firm(db, firm_id) -> dict[str, Any]:
    """{"modules": {key: bool}, "preset": str|None, "source": "firm"|"default"}."""
    if firm_id is None or not columns_present(db):
        return {"modules": all_on(), "preset": None, "source": "default"}
    try:
        row = db.execute(text("SELECT modules, modules_preset FROM firms WHERE id = :f"), {"f": str(firm_id)}).first()
    except Exception:          # noqa: BLE001
        db.rollback()
        return {"modules": all_on(), "preset": None, "source": "default"}
    if not row or row[0] is None:
        return {"modules": all_on(), "preset": row[1] if row else None, "source": "default"}
    mods = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return {"modules": normalise(mods), "preset": row[1], "source": "firm"}


def firm_of_user(db, uid: str):
    from risk.report import firm_of
    try:
        return firm_of(db, uid)
    except Exception:          # noqa: BLE001
        db.rollback()
        return None


def for_user(db, uid: str) -> dict[str, Any]:
    return for_firm(db, firm_of_user(db, uid))


def is_on(db, uid: str, key: str) -> bool:
    return bool(for_user(db, uid)["modules"].get(key, True))


def set_for_firm(db, firm_id, uid: str, modules: Optional[dict] = None, preset: Optional[str] = None, note: Optional[str] = None) -> dict[str, Any]:
    """Write the switches (from a preset, or an explicit map) and the audit row; the caller commits."""
    if not columns_present(db):
        raise RuntimeError("firm modules need docs/migrations/2026-11-04_firm_modules.sql applied first")
    before = for_firm(db, firm_id)
    if preset:
        after = preset_modules(preset)
        pname = preset.upper()
    else:
        after = normalise(modules)
        pname = "CUSTOM"
    db.execute(text("UPDATE firms SET modules = CAST(:m AS jsonb), modules_preset = :p WHERE id = :f"), {"m": json.dumps(after), "p": pname, "f": str(firm_id)})
    db.execute(text("INSERT INTO module_events (id, firm_id, user_id, preset, before, after, note) VALUES (:id, :f, :u, :p, CAST(:b AS jsonb), CAST(:a AS jsonb), :n)"),
               {"id": str(uuid.uuid4()), "f": str(firm_id), "u": str(uid), "p": pname, "b": json.dumps(before["modules"]) if before["source"] == "firm" else None,
                "a": json.dumps(after), "n": note})
    return {"modules": after, "preset": pname, "source": "firm"}


def events(db, firm_id, limit: int = 20) -> list[dict]:
    if firm_id is None or not columns_present(db):
        return []
    try:
        rows = db.execute(text("SELECT e.at, e.user_id, p.email, e.preset, e.before, e.after, e.note FROM module_events e LEFT JOIN profiles p ON p.id = e.user_id "
                               "WHERE e.firm_id = :f ORDER BY e.at DESC LIMIT :n"), {"f": str(firm_id), "n": limit}).all()
    except Exception:          # noqa: BLE001
        db.rollback()
        return []
    out = []
    for at, u, email, preset, before, after, note in rows:
        b = before if isinstance(before, dict) or before is None else json.loads(before)
        a = after if isinstance(after, dict) else json.loads(after)
        changed = sorted(k for k in KEYS if (b or all_on()).get(k, True) != a.get(k, True))
        out.append({"at": at.isoformat() if hasattr(at, "isoformat") else str(at), "user_id": str(u), "email": email, "preset": preset,
                    "changed": changed, "after": a, "note": note})
    return out


def catalogue() -> dict[str, Any]:
    return {"definitions": MODULES, "presets": {k: {"label": v["label"], "desc": v["desc"], "modules": preset_modules(k)} for k, v in PRESETS.items()}}
