"""Module switches per firm: which parts of the desk a firm runs.

A switch hides the module's pages and tabs, skips its batches and relaxes its gates (no IPV: the official P&L is
the flash plus XVA); it never deletes anything, and switching back on resumes with history intact. Null on the
firm (or the column missing: a deploy ahead of docs/migrations/2026-11-04_firm_modules.sql) means every module
on in the firm's row. Every change is a module_events row with who, when, before and after.

What a user is answered is the firm's row less what the instance holds for the admin role (`held()`:
RIJEKA_HELD_MODULES, capital by default; `locked`): that is decided here and nowhere else."""
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
    {"key": "COLLATERAL", "label": "Collateral", "effects": "Risk → Collateral (schedules, requirements, what is held, carry, the book under regimes) and the firm's collateral instruments under Configurations (the collateral block on the ticket's XVA tab is part of XVA and stays)"},
    {"key": "XVA_RESERVES", "label": "XVA reserves", "effects": "the reserve book under P&L: levels per counterparty and component, day on day"},
    {"key": "IPV", "label": "Independent price verification", "effects": "the IPV tab under P&L and the flash → official gate"},
]
KEYS = tuple(m["key"] for m in MODULES)
PLANNED = tuple(m["key"] for m in MODULES if m.get("planned"))

PRESETS: dict[str, dict[str, Any]] = {
    "LAUNCH":    {"label": "Launch", "desc": "book, value, the XVA charge and its saving on chain, confirm; everything else is one switch away",
                  "off": ("PNL", "MARKET_RISK", "COUNTERPARTY_CREDIT", "CAPITAL", "COLLATERAL", "XVA_RESERVES", "IPV")},
    "DEALER":    {"label": "Dealer", "desc": "everything on", "off": ()},
    "CORPORATE": {"label": "Corporate treasury", "desc": "book, confirm, P&L, the charge on the ticket; no risk desk, no capital",
                  "off": ("MARKET_RISK", "COUNTERPARTY_CREDIT", "CAPITAL", "COLLATERAL", "IPV", "XVA_RESERVES")},
    "FUND":      {"label": "Fund", "desc": "the desk without regulatory capital", "off": ("CAPITAL",)},
    "CLASSROOM": {"label": "Classroom", "desc": "everything on; the chain stays on the test network (a deployment setting)", "off": ()},
}

# Modules a demo keeps for the admin role (9 November 2026: capital is out of the Phase 1 demo). Where every
# sign-in gets its own sandbox workspace (RIJEKA_DEMO_PROVISION on, which is also what an unset variable means),
# nobody but a profile admin is answered these as on, whatever the firm's row says, and nobody else can switch
# them on (set_for_firm; a save that cannot read the row is turned away rather than trusted); the MODULES page shows them as available on request, with CONTACT. An instance with
# RIJEKA_DEMO_PROVISION=0 holds nothing back. Like every switch this hides pages and tabs; it is not an
# entitlement, and the module's API routes stay callable.
# A request is met on a self-hosted desk, or by a grant per firm that does not exist yet (backlog 60). It is never
# met by handing out the admin role: that role also opens the Users page, platform usage and the ops detail.
# RIJEKA_HELD_MODULES names them for an instance that keeps sandboxes and wants something else (held()): unset is
# ON_REQUEST, NONE (or empty) holds nothing back, a list of module keys holds those.
ON_REQUEST: tuple[str, ...] = ("CAPITAL",)
CONTACT = "miko@rijeka.app"


def held() -> tuple[str, ...]:
    """The modules this instance keeps for the admin role where sign-ins get a sandbox: RIJEKA_HELD_MODULES, or
    ON_REQUEST when it is unset. NONE or empty holds nothing. A name that is not a module key is a mistake, and a
    mistake never releases anything: the default is then held as well as whatever the list does name."""
    import os
    raw = os.getenv("RIJEKA_HELD_MODULES")
    if raw is None:
        return ON_REQUEST
    names = {x.strip().upper() for x in raw.split(",")} - {"", "NONE"}
    mistyped = bool(names - set(KEYS))
    return tuple(k for k in KEYS if k in names or (mistyped and k in ON_REQUEST))

_PRESENT: dict[str, bool] = {}


def signup_preset() -> Optional[str]:
    """The preset a newly provisioned workspace starts on: RIJEKA_SIGNUP_PRESET, LAUNCH by default. Empty, NONE or
    an unknown name leaves a new firm as every firm was before: nothing chosen, every module on in its row."""
    import os
    name = os.getenv("RIJEKA_SIGNUP_PRESET", "LAUNCH").strip().upper()
    return name if name in PRESETS else None


def may_edit(db, user: dict) -> bool:
    """Who may switch a firm's modules: a profile admin anywhere; and, where every sign-in gets its own sandbox firm
    (demo provisioning on), the ADMIN member of a firm of one, who is the person the sandbox was made for. A firm
    with colleagues in it is not a sandbox: there only the admin role switches modules for everyone."""
    from api.routes._roles import role_of
    if role_of(db, user) == "admin":
        return True
    from api.routes.demo import enabled as demo_enabled
    if not demo_enabled():
        return False
    try:
        return db.execute(text("""
            SELECT 1 FROM firm_members m WHERE m.user_id = :u AND m.role = 'ADMIN'
              AND (SELECT count(*) FROM firm_members o WHERE o.firm_id = m.firm_id) = 1 LIMIT 1"""), {"u": str(user["sub"])}).first() is not None
    except Exception:          # noqa: BLE001
        db.rollback()
        return False


def locked(db, user: dict) -> tuple[str, ...]:
    """The modules this user cannot have on: held(), where sign-ins get a sandbox, for everyone but the admin role."""
    from api.routes.demo import enabled as demo_enabled
    keys = held()
    if not keys or not demo_enabled():
        return ()
    from api.routes._roles import role_of
    return () if role_of(db, user) == "admin" else keys


def without(mods: dict[str, bool], keys) -> dict[str, bool]:
    """The switches with `keys` off."""
    return {k: bool(v) and k not in keys for k, v in mods.items()}


def all_on() -> dict[str, bool]:
    return {k: True for k in KEYS}


def columns_present(db) -> bool:
    if "present" not in _PRESENT:
        try:
            n = db.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'firms' AND column_name IN ('modules', 'modules_preset')")).scalar()
            if int(n or 0) != 2:
                return False                      # re-checked until the migration lands
            _PRESENT["present"] = True
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


def for_firm(db, firm_id, strict: bool = False) -> dict[str, Any]:
    """{"modules": {key: bool}, "preset": str|None, "source": "firm"|"default"}. A read that fails answers every
    module on, which is right for showing pages and wrong as the "before" of a write that must not switch a held
    module on: `strict` lets that failure through instead."""
    if firm_id is None or not columns_present(db):
        return {"modules": all_on(), "preset": None, "source": "default"}
    try:
        row = db.execute(text("SELECT modules, modules_preset FROM firms WHERE id = :f"), {"f": str(firm_id)}).first()
    except Exception:          # noqa: BLE001
        db.rollback()
        if strict:
            raise
        return {"modules": all_on(), "preset": None, "source": "default"}
    if not row or row[0] is None:
        return {"modules": all_on(), "preset": row[1] if row else None, "source": "default"}
    mods = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return {"modules": normalise(mods), "preset": row[1], "source": "firm"}


def view_for_firm(db, firm_id) -> str:
    """'launch' or 'full': which shape of the app the firm sees (the home, the XVA tab's default, the roadmap
    placeholders). It follows the last PRESET the firm chose, not the current switches: a launch workspace that
    switches one module on is CUSTOM by name and still a launch workspace, until its owner picks a full preset."""
    if firm_id is None or not columns_present(db):
        return "full"
    try:
        row = db.execute(text("SELECT preset FROM module_events WHERE firm_id = :f AND preset <> 'CUSTOM' ORDER BY at DESC LIMIT 1"), {"f": str(firm_id)}).first()
    except Exception:          # noqa: BLE001
        db.rollback()
        return "full"
    return "launch" if row and row[0] == "LAUNCH" else "full"


def firm_of_user(db, uid: str):
    from risk.report import firm_of
    try:
        return firm_of(db, uid)
    except Exception:          # noqa: BLE001
        db.rollback()
        return None


def for_user(db, uid: str) -> dict[str, Any]:
    """The switches of the user's firm, as the row has them (what the user is answered: is_on, or the route's view)."""
    return for_firm(db, firm_of_user(db, uid))


def is_on(db, uid: str, key: str) -> bool:
    """Whether this user has the module: on in the firm's row and, for a module the instance holds for the admin
    role, not held from this user. The role is read only for those modules, so the nightly ticks (which ask about
    P&L, market risk and counterparty credit) cost what they did."""
    if not for_user(db, uid)["modules"].get(key, True):
        return False
    return key not in held() or key not in locked(db, {"sub": str(uid)})


def set_for_firm(db, firm_id, uid: str, modules: Optional[dict] = None, preset: Optional[str] = None, note: Optional[str] = None,
                 locked: tuple[str, ...] = ()) -> dict[str, Any]:
    """Write the switches (from a preset, or an explicit map) and the audit row; the caller commits. `locked` are
    the modules held from the writer (modules.locked), who can never switch one on. A map keeps what the row says
    about them (the page sends them off because that is how they were answered, which is not a choice). A preset
    that has one off switches it off, as the preset's name promises; a preset that has one on leaves the row's
    value. So the row is on only where it was on before and no preset its owner chose said otherwise."""
    if not columns_present(db):
        raise RuntimeError("firm modules need docs/migrations/2026-11-04_firm_modules.sql applied first")
    before = for_firm(db, firm_id, strict=bool(locked))      # held modules are kept from it: a failed read must not pass for "on"
    if preset:
        after = preset_modules(preset)
        pname = preset.upper()
    else:
        after = normalise(modules)
        pname = "CUSTOM"
    after = {**after, **{k: before["modules"][k] and (after[k] if preset else True) for k in locked}}
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


def catalogue(locked: tuple[str, ...] = ()) -> dict[str, Any]:
    """The modules and the presets as this reader can have them: a module in `locked` is marked on_request and is
    off in every preset, so the page compares the firm's switches with what a preset would actually give, and every
    preset says so in its description (LAUNCH's "everything else is one switch away" is not true of a held module)."""
    held = ", ".join(m["label"].lower() for m in MODULES if m["key"] in locked)

    def desc(name: str) -> str:
        return PRESETS[name]["desc"] + (f" ({held} on request)" if held else "")
    return {"definitions": [{**m, "on_request": True} if m["key"] in locked else m for m in MODULES],
            "presets": {k: {"label": v["label"], "desc": desc(k), "modules": without(preset_modules(k), locked)} for k, v in PRESETS.items()}}
