"""
demo.py — a workspace for anyone who signs in to the hosted demo.

Everything in Rijeka is per user: own legal entities, counterparties, market
data snapshots, vol surfaces, calibrations. A fresh sign-up therefore lands in
an empty workspace and can price nothing. On the hosted demo this route gives
each visitor, idempotently:

  * an own legal entity with a DEMO-prefixed LEI (20 chars, like a real LEI,
    never a real one), and a one-person firm so the messenger works;
  * RIJEKA DEMO BANK AG as a counterparty (VM+IM CSA, SIMM) — an entity whose
    signing key this Rijeka holds, so the visitor can take a trade all the
    way to the Sepolia registry alone. The attestation says bilateral:false
    and key_source "dev"; the UI says "demo, not bilateral";
  * a copy of the template user's latest market data, so the pricer, the
    curves workspace and XVA work immediately;
  * the trader role, so booking and confirming are allowed. Supabase keeps
    the role in the JWT, so the browser refreshes its session afterwards.

POST /api/demo/provision   idempotent; safe to call on every sign-in
GET  /api/demo/status      is provisioning on, what the banner should say

RIJEKA_DEMO_PROVISION=0 turns it off (a self-hosted instance where firms
are set up by hand). RIJEKA_DEMO_TEMPLATE_EMAIL names whose market data is
copied (default: the first ADMIN of the platform's own firm, else nobody).
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from db.models import Counterparty, Firm, FirmLei, FirmMember, LegalEntity
from middleware.auth import verify_token

log = logging.getLogger("rijeka.demo")
router = APIRouter(prefix="/api/demo", tags=["demo"])

DEMO_LEI_PREFIX   = "DEMO"
DEMO_BANK_NAME    = "RIJEKA DEMO BANK AG"
DEMO_BANK_LEI     = "DEMO0000RIJEKABANK01"      # 20 chars; not a real LEI
DEMO_BANK_FIRM    = "RIJEKA DEMO BANK AG"
WRITE_ROLE        = "trader"

# Per-user market data, copied from the template user. cap_sabr_params is
# left out: its unique key has no user_id, so it is effectively global.
_COPY_LATEST_PER = {
    "market_data_snapshots": ("curve_id",),
    "swaption_vol_skew":     (),
    "cap_vol_surface":       (),
    "sabr_params":           (),
    "xva_calibration":       ("curve_id", "model"),
}


def enabled() -> bool:
    return os.getenv("RIJEKA_DEMO_PROVISION", "1").strip().lower() not in ("0", "false", "no", "off")


def demo_lei_for(user_id: uuid.UUID) -> str:
    """DEMO + 16 hex chars of the user id: LEI-shaped, unique per visitor, obviously not real."""
    return DEMO_LEI_PREFIX + user_id.hex[:16].upper()


def _template_user_id(db: Session) -> Optional[uuid.UUID]:
    email = os.getenv("RIJEKA_DEMO_TEMPLATE_EMAIL", "").strip()
    if email:
        row = db.execute(text("SELECT id FROM auth.users WHERE lower(email) = lower(:e)"), {"e": email}).first()
        return row[0] if row else None
    row = db.execute(text("""
        SELECT m.user_id FROM firm_members m JOIN firms f ON f.id = m.firm_id
        WHERE m.role = 'ADMIN' AND f.kind = 'DEALER'
        ORDER BY m.created_at LIMIT 1""")).first()
    return row[0] if row else None


def _trader_id(db: Session, user: dict) -> str:
    row = db.execute(text("SELECT trader_id FROM profiles WHERE id = :id"), {"id": user["sub"]}).first()
    if row and row[0]:
        return row[0]
    return (user.get("email") or "TRADER").split("@")[0].upper()


def _columns(db: Session, table: str) -> list[str]:
    return [r[0] for r in db.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:t "
        "ORDER BY ordinal_position"), {"t": table})]


def _copy_market_data(db: Session, src: uuid.UUID, dst: uuid.UUID) -> dict[str, int]:
    """Latest valuation_date per key from src to dst; existing rows are left alone."""
    out = {}
    for table, keys in _COPY_LATEST_PER.items():
        cols = _columns(db, table)
        if "user_id" not in cols or "valuation_date" not in cols:
            continue
        cols = [c for c in cols if c != "id"]      # id: let the table default decide (uuid or serial)
        sel = []
        for c in cols:
            if c == "user_id":
                sel.append(":dst")
            elif c == "created_by":
                sel.append(":dst")
            elif c == "created_at":
                sel.append("now()")
            else:
                sel.append(c)
        over = f"OVER (PARTITION BY {', '.join(keys)})" if keys else "OVER ()"
        no_test = "AND curve_id NOT LIKE 'TEST-%'" if "curve_id" in cols else ""
        latest = (f"SELECT * FROM (SELECT *, max(valuation_date) {over} AS _mx "
                  f"FROM {table} WHERE user_id = :src AND valuation_date <= current_date {no_test}) s "
                  f"WHERE valuation_date = _mx")
        sql = (f"INSERT INTO {table} ({', '.join(cols)}) SELECT {', '.join(sel)} FROM ({latest}) t "
               f"ON CONFLICT DO NOTHING")
        res = db.execute(text(sql), {"src": src, "dst": dst})
        out[table] = res.rowcount or 0
    return out


def _grant_write_role(db: Session, user_id: uuid.UUID, trader: str = "", email: str = "") -> bool:
    """
    Put role=trader in auth user metadata (the JWT claim _check_write_role
    reads) and profiles.role, creating the profile row if the sign-up
    trigger did not. Only upgrades: an admin stays an admin.
    Returns True when the JWT claim changed, so the client refreshes.
    """
    db.execute(text("""
        INSERT INTO profiles (id, trader_id, role, email)
        SELECT :id,
               CASE WHEN EXISTS (SELECT 1 FROM profiles WHERE trader_id = :tid) THEN :tid || '_' || :sfx ELSE :tid END,
               :r, :email
        ON CONFLICT (id) DO NOTHING"""),
        {"id": user_id, "tid": trader or "TRADER", "sfx": user_id.hex[:4].upper(), "r": WRITE_ROLE, "email": email or None})
    row = db.execute(text("SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = :id"), {"id": user_id}).first()
    current = (row[0] or "").lower() if row else ""
    changed = False
    if current not in ("trader", "admin"):
        db.execute(text("""
            UPDATE auth.users
               SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', :r)
             WHERE id = :id"""), {"id": user_id, "r": WRITE_ROLE})
        changed = True
    db.execute(text("UPDATE profiles SET role = :r WHERE id = :id AND coalesce(role,'') NOT IN ('trader','admin')"),
               {"id": user_id, "r": WRITE_ROLE})
    return changed


@router.get("/status")
def status(user: dict = Depends(verify_token)):
    return {
        "enabled": enabled(),
        "demo_lei_prefix": DEMO_LEI_PREFIX,
        "demo_counterparty": {"name": DEMO_BANK_NAME, "lei": DEMO_BANK_LEI},
        "explorer": os.getenv("RIJEKA_CHAIN_EXPLORER") or None,
        "anchoring": bool(os.getenv("RIJEKA_CHAIN_RPC") and os.getenv("RIJEKA_CHAIN_REGISTRY")),
        "banner": ("DEMO · Sepolia testnet · Rijeka holds the demo counterparty's key, so solo confirmations are "
                   "not bilateral · data may be reset") if enabled() else None,
    }


@router.post("/provision")
def provision(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if not enabled():
        return {"enabled": False}
    uid = uuid.UUID(user["sub"])
    trader = _trader_id(db, user)
    my_lei = demo_lei_for(uid)
    created = {}

    # 1. Own entity
    own = db.query(LegalEntity).filter(LegalEntity.user_id == uid, LegalEntity.lei == my_lei).first()
    if own is None:
        own = LegalEntity(id=uuid.uuid4(), lei=my_lei, name=f"{trader} DEMO", short_name=trader[:12],
                          home_currency="USD", jurisdiction="US", regulatory_regime=["UMR"], simm_version="2.6",
                          im_threshold_m=50, ois_curve_id="USD_SOFR", is_own_entity=True, is_active=True,
                          created_by=uid, user_id=uid)
        db.add(own); created["own_entity"] = True

    # 2. Demo counterparty (entity + counterparty row)
    bank = db.query(LegalEntity).filter(LegalEntity.user_id == uid, LegalEntity.lei == DEMO_BANK_LEI).first()
    if bank is None:
        bank = LegalEntity(id=uuid.uuid4(), lei=DEMO_BANK_LEI, name=DEMO_BANK_NAME, short_name="RJK DEMO BANK",
                           home_currency="USD", jurisdiction="CH", regulatory_regime=["UMR"], simm_version="2.6",
                           im_threshold_m=50, ois_curve_id="USD_SOFR", is_own_entity=False, is_active=True,
                           created_by=uid, user_id=uid)
        db.add(bank); created["demo_bank_entity"] = True
    db.flush()
    cp = db.query(Counterparty).filter(Counterparty.user_id == uid, Counterparty.legal_entity_id == bank.id).first()
    if cp is None:
        cp = Counterparty(id=uuid.uuid4(), legal_entity_id=bank.id, name=DEMO_BANK_NAME, isda_agreement="ISDA 2002 (demo)",
                          csa_type="VM_IM", csa_currency="USD", csa_threshold_m=0, csa_mta_k=500,
                          discount_curve_id="USD_SOFR", im_model="SIMM", is_active=True, created_by=uid, user_id=uid)
        db.add(cp); created["demo_bank_counterparty"] = True

    # 3. A firm of one, claiming the demo LEI, so rooms and trade cards work
    member = db.query(FirmMember).filter(FirmMember.user_id == uid).first()
    if member is None:
        name = f"{trader} (DEMO)"
        firm = db.query(Firm).filter(Firm.name == name).first()
        if firm is None:
            firm = Firm(name=name, kind="OTHER", coverage_tier="FREE")
            db.add(firm); db.flush()
        db.add(FirmMember(user_id=uid, firm_id=firm.id, role="ADMIN"))
        if db.get(FirmLei, my_lei) is None:
            db.add(FirmLei(lei=my_lei, firm_id=firm.id, verified=False))
        created["firm"] = True

    # 4. Market data
    copied = {}
    src = _template_user_id(db)
    if src and src != uid:
        copied = _copy_market_data(db, src, uid)

    # 5. Role
    role_changed = _grant_write_role(db, uid, trader, user.get("email") or "")
    db.commit()

    return {
        "enabled": True,
        "own_entity": {"id": str(own.id), "name": own.name, "lei": own.lei},
        "counterparty": {"id": str(cp.id), "name": cp.name, "lei": DEMO_BANK_LEI},
        "created": created,
        "market_data_copied": {k: v for k, v in copied.items() if v},
        "role": WRITE_ROLE if role_changed else ((user.get("user_metadata") or {}).get("role") or WRITE_ROLE),
        "role_changed": role_changed,
    }
