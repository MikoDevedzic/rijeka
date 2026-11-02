"""Who may see platform-wide numbers: the admin role from profiles.role (the JWT claim as the
fallback when the table is unreachable), the same lookup the admin page edits."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session


def role_of(db: Session, user: dict) -> str:
    from api.routes.me import db_role
    return str(db_role(db, user["sub"]) or (user.get("user_metadata") or {}).get("role") or "viewer").lower()


def require_admin(db: Session, user: dict) -> None:
    if role_of(db, user) != "admin":
        raise HTTPException(status_code=403, detail="This view needs the admin role.")
