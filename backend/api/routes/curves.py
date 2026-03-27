from fastapi import APIRouter, Depends
from middleware.auth import verify_token

router = APIRouter()

CURVE_METADATA = {
    "total_curves": 54,
    "bootstrap_passes": 4,
    "pass_order": ["OIS", "BASIS", "XCCY", "FUNDING"],
    "note": "Full bootstrap engine — Sprint 3",
}


@router.get("/")
def get_curves_metadata(user: dict = Depends(verify_token)):
    return CURVE_METADATA


@router.get("/health")
def curves_health():
    return {"status": "ok", "curves": 54}
