"""
GET /api/me/booking-defaults        {default_desk, default_book, role, desks, books}
PUT /api/me/booking-defaults        {default_desk, default_book}: the desk and book the ticket starts on

Kept in the auth user's metadata (the same place the role lives), read back from the
database so a change shows at once without a new token.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.models import OrgNode
from db.session import get_db
from middleware.auth import verify_token

router = APIRouter(prefix="/api/me", tags=["me"])


def metadata(db: Session, uid: str) -> dict:
    row = db.execute(text("SELECT raw_user_meta_data FROM auth.users WHERE id = :id"), {"id": uid}).first()
    return dict((row[0] or {}) if row else {})


def db_role(db: Session, uid: str) -> Optional[str]:
    """profiles.role is what the admin page edits; the JWT may lag it."""
    try:
        return db.execute(text("SELECT role FROM profiles WHERE id = :id"), {"id": uid}).scalar()
    except Exception:
        db.rollback(); return None


def _nodes(db: Session, uid: str) -> tuple[list[str], list[str]]:
    rows = db.query(OrgNode).filter(OrgNode.user_id == uid, OrgNode.is_active.isnot(False)).order_by(OrgNode.sort_order).all()
    return [n.name for n in rows if n.node_type == "desk"], [n.name for n in rows if n.node_type == "book"]


@router.get("/booking-defaults")
def get_defaults(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    uid = user["sub"]
    md = metadata(db, uid)
    desks, books = _nodes(db, uid)
    return {"default_desk": md.get("default_desk"), "default_book": md.get("default_book"),
            "role": db_role(db, uid) or (user.get("user_metadata") or {}).get("role") or "viewer", "desks": desks, "books": books}


class DefaultsBody(BaseModel):
    default_desk: Optional[str] = None
    default_book: Optional[str] = None


@router.put("/booking-defaults")
def put_defaults(body: DefaultsBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    uid = user["sub"]
    desks, books = _nodes(db, uid)
    if body.default_desk and body.default_desk not in desks:
        raise HTTPException(status_code=422, detail=f"No desk named {body.default_desk!r} in your hierarchy.")
    if body.default_book and body.default_book not in books:
        raise HTTPException(status_code=422, detail=f"No book named {body.default_book!r} in your hierarchy.")
    db.execute(text("UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || "
                    "jsonb_build_object('default_desk', CAST(:d AS text), 'default_book', CAST(:b AS text)) WHERE id = :id"),
               {"d": body.default_desk or None, "b": body.default_book or None, "id": uid})
    db.commit()
    return get_defaults(db, user)


SELF_ROLES = ("trader", "controller", "risk", "management")      # never admin: that is the Users page, by an admin


class RoleBody(BaseModel):
    role: str


@router.get("/role")
def get_role(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    from api.routes.demo import enabled as demo_enabled
    return {"role": db_role(db, user["sub"]) or (user.get("user_metadata") or {}).get("role") or "viewer",
            "self_service": bool(demo_enabled()), "roles": list(SELF_ROLES)}


@router.put("/role")
def put_role(body: RoleBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Switch your own role. On the hosted demo every workspace is its own firm, so the
    person wearing the hat is whoever is at the desk; in a firm deployment the admin
    assigns roles on the Users page and this is off."""
    from api.routes.demo import enabled as demo_enabled
    role = body.role.strip().lower()
    if role not in SELF_ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {', '.join(SELF_ROLES)}")
    current = db_role(db, user["sub"]) or (user.get("user_metadata") or {}).get("role") or "viewer"
    if not demo_enabled() and current != "admin":
        raise HTTPException(status_code=403, detail="Roles are assigned by your firm's admin.")
    uid = user["sub"]
    db.execute(text("UPDATE profiles SET role = :r WHERE id = :id"), {"r": role, "id": uid})
    db.execute(text("UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', :r) WHERE id = :id"),
               {"r": role, "id": uid})
    db.commit()
    from middleware.auth import forget_role
    forget_role(uid)
    return {"role": role, "changed": role != current, "note": "refresh the session so the token carries the new role"}
