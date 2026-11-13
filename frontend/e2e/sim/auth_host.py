"""auth_host.py — what Playwright stands in for in the journeys, as a server, so a browser Playwright does not drive
(Safari in the iPhone simulator, a phone on the same network) can run the app on the local stack.

The journeys build the app against an auth host that does not exist (http://stack.local) and answer for it inside
the browser (e2e/fixtures.js). This serves the same answers on a port:

    /auth/v1/token      a sign-in or a refresh: the session e2e/serve.sh minted for that email (any password; the
                        stack has no passwords), 400 for an email the stack does not know
    /auth/v1/user       the user of the token presented
    /auth/v1/logout     nothing
    /rest/v1/*          passed to the stack's PostgREST with the caller's own token, so row-level security applies
    /realtime/v1/*      a socket that acknowledges joins and heartbeats and sends nothing
    /enter?as=USER.A    straight into the app as that seeded user (the way a sign-in link arrives), so nothing has to
                        be typed on the simulator's keyboard: open http://127.0.0.1:3020/enter in its Safari

    cd frontend && bash e2e/sim/serve.sh            # starts the stack with this in front of it

It reads only e2e/.out/session.json and talks only to 127.0.0.1. Local only: it signs anyone in as a seeded user.
"""
from __future__ import annotations

import json
import os
import pathlib

import httpx
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

REST = os.environ.get("RIJEKA_SIM_REST", "http://127.0.0.1:3010")
WEB = os.environ.get("RIJEKA_SIM_WEB", "http://127.0.0.1:4174")
SESSIONS = pathlib.Path(os.environ.get("RIJEKA_SIM_SESSIONS", pathlib.Path(__file__).resolve().parent.parent / ".out" / "session.json"))

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://(127\.0\.0\.1|localhost)(:\d+)?", allow_methods=["*"], allow_headers=["*"], expose_headers=["*"])


def sessions() -> dict:
    return json.loads(SESSIONS.read_text())


def by_email(email: str):
    return next((s for s in sessions().values() if s["user"]["email"].lower() == str(email or "").lower()), None)


def by_token(request: Request):
    tok = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    return next((s for s in sessions().values() if s["access_token"] == tok), None)


@app.post("/auth/v1/token")
async def token(request: Request):
    body = await request.json()
    if request.query_params.get("grant_type") == "refresh_token":
        s = next((x for x in sessions().values()), None) if not by_token(request) else by_token(request)
    else:
        s = by_email(body.get("email"))
    if s is None:
        return Response(json.dumps({"error": "invalid_grant", "error_description": "Invalid login credentials", "msg": "Invalid login credentials"}), status_code=400, media_type="application/json")
    return s


@app.get("/auth/v1/user")
async def user(request: Request):
    s = by_token(request)
    if s is None:
        return Response(json.dumps({"msg": "no session"}), status_code=401, media_type="application/json")
    return s["user"]


@app.get("/enter")
async def enter(request: Request):
    from urllib.parse import urlencode
    all_ = sessions()
    s = all_.get(request.query_params.get("as") or next(iter(all_)))
    if s is None:
        return Response("no such seeded user", status_code=404)
    frag = urlencode({"access_token": s["access_token"], "refresh_token": s["refresh_token"], "expires_in": s["expires_in"], "expires_at": s["expires_at"], "token_type": "bearer", "type": "magiclink"})
    return Response(status_code=302, headers={"location": f"{WEB}/#{frag}"})


@app.post("/auth/v1/logout")
async def logout():
    return Response(status_code=204)


@app.api_route("/rest/v1/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"])
async def rest(path: str, request: Request):
    keep = {k: v for k, v in request.headers.items() if k.lower() in ("authorization", "content-type", "prefer", "accept", "range", "accept-profile", "content-profile")}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(request.method, f"{REST}/{path}", params=request.query_params, headers=keep, content=await request.body())
    out = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "content-range", "preference-applied", "location")}
    return Response(r.content, status_code=r.status_code, headers=out)


@app.websocket("/realtime/v1/websocket")
async def realtime(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            m = json.loads(await ws.receive_text())
            if isinstance(m, dict) and m.get("event") in ("phx_join", "heartbeat", "access_token"):
                await ws.send_text(json.dumps({"topic": m.get("topic"), "event": "phx_reply", "ref": m.get("ref"), "payload": {"status": "ok", "response": {}}}))
    except (WebSocketDisconnect, ValueError):
        return
