"""The cap on a request's body (middleware/body_limit.py): refused before the route reads it, by its declared length
or, for a chunked body, as soon as it passes the cap; what is under the cap arrives whole; a route that takes more
by design has its own cap; the refusal says what happened and, on the hosted demo, why and where to write."""
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from middleware import body_limit as B


def _app():
    app = FastAPI()

    @app.post("/echo")
    async def echo(request: Request):
        return {"bytes": len(await request.body())}

    @app.post("/api/risk/history/ingest")
    async def ingest(request: Request):
        return {"bytes": len(await request.body())}

    @app.get("/read")
    async def read():
        return {"ok": True}

    app.add_middleware(B.BodyLimit)
    return TestClient(app)


def _chunks(total, size=8192):
    sent = 0
    while sent < total:
        n = min(size, total - sent)
        sent += n
        yield b"x" * n


def test_a_body_under_the_cap_arrives_whole_and_one_over_it_is_refused_before_the_route(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    c = _app()
    assert c.post("/echo", content=b"x" * 1000).json() == {"bytes": 1000}
    assert c.post("/echo", content=b"x" * (256 * 1024)).json() == {"bytes": 256 * 1024}            # the cap itself is taken
    r = c.post("/echo", content=b"x" * (256 * 1024 + 1))
    assert r.status_code == 413
    assert r.json()["detail"] == "This request is about 256 kB; one request to this desk may carry 256 kB."
    big = c.post("/echo", content=b"x" * (5 * 1024 * 1024))
    assert big.status_code == 413 and "about 5,120 kB" in big.json()["detail"]
    assert c.get("/read").json() == {"ok": True}                                                    # a read carries no body


def test_a_chunked_body_is_counted_as_it_comes(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    c = _app()
    ok = c.post("/echo", content=_chunks(200 * 1024))                                               # no declared length
    assert ok.status_code == 200 and ok.json() == {"bytes": 200 * 1024}                             # handed on as it arrived
    over = c.post("/echo", content=_chunks(300 * 1024))
    # refused on the count: the size it names is what had arrived when it passed the cap, or "more than" the cap
    assert over.status_code == 413 and "one request to this desk may carry 256 kB." in over.json()["detail"]


def test_the_history_import_takes_more_from_the_scheduler_alone_and_the_setting_moves_the_rest(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "the-scheduler")
    c = _app()
    cron = {"X-Rijeka-Cron": "the-scheduler"}
    assert c.post("/api/risk/history/ingest", content=b"x" * (1024 * 1024), headers=cron).json() == {"bytes": 1024 * 1024}
    assert c.post("/api/risk/history/ingest", content=b"x" * (4096 * 1024 + 1), headers=cron).status_code == 413
    # anybody else is not read four megabytes of before the route refuses them: the ordinary cap
    assert c.post("/api/risk/history/ingest", content=b"x" * (1024 * 1024)).status_code == 413
    assert c.post("/api/risk/history/ingest", content=b"x" * (1024 * 1024), headers={"X-Rijeka-Cron": "a guess"}).status_code == 413
    hdr = [(b"x-rijeka-cron", b"the-scheduler")]
    assert B.cap_kb("/api/risk/history/ingest", hdr) == 4096 and B.cap_kb("/api/risk/history/ingest") == 256
    # the path itself, not what begins like it
    assert B.cap_kb("/api/risk/history/ingestX", hdr) == 256 and B.cap_kb("/api/risk/history/ingest/more", hdr) == 256
    assert B.cap_kb("/api/price/swaption", hdr) == 256
    monkeypatch.setenv("RIJEKA_MAX_BODY_KB", "1024")                                                # a self-hosted desk loading its own book
    assert c.post("/echo", content=b"x" * (800 * 1024)).json() == {"bytes": 800 * 1024}
    assert B.cap_kb("/echo") == 1024 and B.cap_kb("/api/risk/history/ingest", hdr) == 4096
    for bad, want in (("", 256), ("abc", 256), ("0", 16), ("-5", 256), ("1_0", 256), ("+5", 256), (" 512 ", 512)):   # never no cap
        monkeypatch.setenv("RIJEKA_MAX_BODY_KB", bad)
        assert B.cap_kb("/echo") == want, bad


def test_on_the_hosted_demo_the_refusal_says_why_and_where_to_write(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
    r = _app().post("/echo", content=b"x" * (300 * 1024))
    assert r.status_code == 413
    assert r.json()["detail"] == ("This request is about 300 kB; one request to this desk may carry 256 kB."
                                  " This is the demo desk: one small server shared by everyone trying it, not sized for heavy use."
                                  " To run Rijeka for your own desk, write to miko@rijeka.app.")


def test_too_many_heavy_runs_in_a_minute_are_refused_with_the_wait(monkeypatch):
    from api.routes import _limits as L
    from fastapi import HTTPException
    monkeypatch.setenv("RIJEKA_RATE_LIMITS", "1")
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
    L._buckets.clear()
    user = {"sub": "u-body-limit"}
    for _ in range(3):
        L.heavy(user, "exposure", 3)
    with pytest.raises(HTTPException) as e:
        L.heavy(user, "exposure", 3)
    assert e.value.status_code == 429
    wait = int(e.value.headers["Retry-After"])
    assert 55 <= wait <= 61
    assert e.value.detail.startswith("Too many exposure requests; wait a minute. The stored result is still available.")
    assert f"the next is taken in {wait} s." in e.value.detail and "To run Rijeka for your own desk, write to miko@rijeka.app." in e.value.detail
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    with pytest.raises(HTTPException) as e:
        L.heavy(user, "exposure", 3)
    assert "demo desk" not in e.value.detail and "miko@" not in e.value.detail                       # a firm's own desk is told only the wait
    L._buckets.clear()



# ── the layer driven by hand: what a test client cannot send ─────────────────

def _drive(headers, pieces, method="POST", path="/echo", read_seconds=None, stall_after=None):
    """Run the layer over a body given as pieces; returns (status, detail, what the app read)."""
    import asyncio
    import json as _json
    got = {"app": None}

    async def app(scope, receive, send):
        n = 0
        while True:
            m = await receive()
            if m["type"] != "http.request":
                got["app"] = "disconnect"
                break
            n += len(m.get("body") or b"")
            if not m.get("more_body"):
                got["app"] = n
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    queue = [{"type": "http.request", "body": p, "more_body": i < len(pieces) - 1} for i, p in enumerate(pieces)]
    sent = []

    async def receive():
        if stall_after is not None and len(pieces) - len(queue) >= stall_after:
            await asyncio.sleep(3600)
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    async def send(m):
        sent.append(m)

    if read_seconds is not None:
        B.READ_SECONDS, keep = read_seconds, B.READ_SECONDS
    try:
        asyncio.run(B.BodyLimit(app)({"type": "http", "method": method, "path": path, "headers": headers}, receive, send))
    finally:
        if read_seconds is not None:
            B.READ_SECONDS = keep
    status = sent[0]["status"]
    detail = _json.loads(sent[1]["body"]).get("detail") if status != 200 else None
    return status, detail, got["app"]


def test_a_small_declared_length_beside_chunked_does_not_let_a_large_body_through(monkeypatch):
    """The security reviewer, 18 November 2026: with Content-Length: 1 and Transfer-Encoding: chunked a server may
    frame the body by its chunks and still show the app the length header. The layer counts what arrives."""
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    both = [(b"content-length", b"1"), (b"transfer-encoding", b"chunked")]
    status, detail, app = _drive(both, [b"x" * 65536] * 8)                                          # 512 kB behind a length of one
    assert status == 413 and app is None and detail.startswith("This request is more than 256 kB;")
    # and a declared length the sender then outruns (a server holds a sender to it; the layer does not rest on that)
    status, _, app = _drive([(b"content-length", b"10")], [b"x" * 65536] * 8)
    assert status == 413 and app is None
    # a large length beside chunked is judged on what arrives, not on the header
    assert _drive([(b"content-length", b"999999999"), (b"transfer-encoding", b"chunked")], [b"x" * 100]) == (200, None, 100)


def test_the_cap_itself_is_taken_and_one_byte_more_is_not_whatever_the_request_says(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    cap = 256 * 1024
    assert _drive([(b"content-length", str(cap).encode())], [b"x" * cap]) == (200, None, cap)
    assert _drive([], [b"x" * (cap - 1), b"x"]) == (200, None, cap)                                 # in two pieces, no length said
    assert _drive([], [b"x" * cap, b"x"])[0] == 413
    assert _drive([(b"content-length", str(cap + 1).encode())], [])[0] == 413                       # by its own word: nothing was read
    for bad in (b"abc", b"-5", b"+5", b"1_0", b""):
        status, detail, app = _drive([(b"content-length", bad)], [b"x"])
        assert (status, detail, app) == (400, "This request's Content-Length is not a number.", None), bad


def test_a_read_carries_no_body_to_count_a_sender_who_leaves_is_passed_on_and_a_body_that_stalls_is_given_up(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    assert _drive([], [b"x" * (300 * 1024)], method="GET")[0] == 200                                # not this layer's: no route reads a body on a read
    assert _drive([], []) == (200, None, "disconnect")                                              # the sender went away before a byte: the app is told
    status, detail, app = _drive([], [b"x" * 10, b"x" * 10], read_seconds=0.05, stall_after=1)
    assert (status, app) == (408, None) and "stopped arriving" in detail


def test_a_browser_can_read_the_refusal():
    """The layer sits inside CORS (main.py adds CORS after it), so the 413 carries the header a browser needs."""
    from fastapi.middleware.cors import CORSMiddleware
    app = FastAPI()

    @app.post("/echo")
    async def echo(request: Request):
        return {"bytes": len(await request.body())}
    app.add_middleware(B.BodyLimit)
    app.add_middleware(CORSMiddleware, allow_origins=["https://app.rijeka.app"], allow_methods=["*"], allow_headers=["*"])
    r = TestClient(app).post("/echo", content=b"x" * (300 * 1024), headers={"Origin": "https://app.rijeka.app"})
    assert r.status_code == 413 and r.headers.get("access-control-allow-origin") == "https://app.rijeka.app"
    # and the real app stacks them that way
    import main
    names = [m.cls.__name__ for m in main.app.user_middleware]                                       # outermost first
    assert names.index("CORSMiddleware") < names.index("BodyLimit")
