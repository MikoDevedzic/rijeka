import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from middleware.auth import verify_token

router = APIRouter()

class Message(BaseModel):
    role: str
    content: str

class AnalyseRequest(BaseModel):
    system: str
    messages: List[Message]

@router.post("/")
async def analyse_trades(body: AnalyseRequest, user: dict = Depends(verify_token)):
    # Check role — only trader and admin can use AI
    role = user.get("user_metadata", {}).get("role") or "trader"
    # Role defaulted to trader for prod launch — frontend gates by role

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key or api_key == "PLACEHOLDER":
        raise HTTPException(status_code=503, detail="AI service not configured")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 1000,
                "system": body.system,
                "messages": [m.dict() for m in body.messages],
            }
        )
        if resp.status_code != 200:
            print(f"[ANTHROPIC] {resp.status_code}: {resp.text}"); raise HTTPException(status_code=resp.status_code, detail=f"AI service error: {resp.text}")
        return resp.json()



