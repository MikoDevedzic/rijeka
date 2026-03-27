from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import OrgNode
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()


class OrgNodeCreate(BaseModel):
    name: str
    node_type: str
    parent_id: Optional[str] = None
    sort_order: int = 0


class OrgNodeUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


def serialize(n: OrgNode) -> dict:
    return {
        "id": str(n.id),
        "parent_id": str(n.parent_id) if n.parent_id else None,
        "name": n.name,
        "node_type": n.node_type,
        "is_active": n.is_active,
        "sort_order": n.sort_order,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/nodes")
def get_nodes(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    nodes = db.query(OrgNode).order_by(OrgNode.sort_order).all()
    return [serialize(n) for n in nodes]


@router.post("/nodes")
def create_node(body: OrgNodeCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    node = OrgNode(
        name=body.name,
        node_type=body.node_type,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        sort_order=body.sort_order,
        created_by=uuid.UUID(user["sub"]),
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return serialize(node)


@router.put("/nodes/{node_id}")
def update_node(
    node_id: str, body: OrgNodeUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    node = db.query(OrgNode).filter(OrgNode.id == uuid.UUID(node_id)).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(node, k, v)
    db.commit()
    return serialize(node)
