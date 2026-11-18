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
    assert over.status_code == 413 and over.json()["detail"].startswith("This request is more than 256 kB;")


def test_a_route_that_takes_a_history_has_its_own_cap_and_the_setting_moves_the_rest(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    c = _app()
    assert c.post("/api/risk/history/ingest", content=b"x" * (1024 * 1024)).json() == {"bytes": 1024 * 1024}
    assert c.post("/api/risk/history/ingest", content=b"x" * (4096 * 1024 + 1)).status_code == 413
    assert B.cap_kb("/api/risk/history/ingest") == 4096 and B.cap_kb("/api/price/swaption") == 256
    monkeypatch.setenv("RIJEKA_MAX_BODY_KB", "1024")                                                # a self-hosted desk loading its own book
    assert c.post("/echo", content=b"x" * (800 * 1024)).json() == {"bytes": 800 * 1024}
    assert B.cap_kb("/echo") == 1024 and B.cap_kb("/api/risk/history/ingest") == 4096
    for bad in ("", "abc", "0", "-5"):                                                              # nonsense is the default or the floor, never no cap
        monkeypatch.setenv("RIJEKA_MAX_BODY_KB", bad)
        assert B.cap_kb("/echo") in (256, 16), bad


def test_on_the_hosted_demo_the_refusal_says_why_and_where_to_write(monkeypatch):
    monkeypatch.delenv("RIJEKA_MAX_BODY_KB", raising=False)
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
    r = _app().post("/echo", content=b"x" * (300 * 1024))
    assert r.status_code == 413
    assert r.json()["detail"] == ("This request is about 300 kB; one request to this desk may carry 256 kB."
                                  " This is the demo desk: one small server shared by everyone trying it, not sized for heavy use."
                                  " For commercial use write to miko@rijeka.app.")


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
    assert f"the next is taken in {wait} s." in e.value.detail and "For commercial use write to miko@rijeka.app." in e.value.detail
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    with pytest.raises(HTTPException) as e:
        L.heavy(user, "exposure", 3)
    assert "demo desk" not in e.value.detail and "miko@" not in e.value.detail                       # a firm's own desk is told only the wait
    L._buckets.clear()
