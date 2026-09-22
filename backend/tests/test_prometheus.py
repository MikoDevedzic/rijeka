"""
PROMETHEUS guarantees: read-only tools, tenant-scoped DB, source allowlist,
server-owned persona. No database or model API needed.
"""

import os
from types import SimpleNamespace

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")

from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api.routes.analyse import AnalyseRequest
from db.models import LegalEntity
from prometheus import agent
from prometheus.persona import PERSONA
from prometheus.tools import TOOL_DEFS, ReadOnlyViolation, Toolbox, make_readonly

USER = "00000000-0000-0000-0000-000000000001"

# Changing this set is a deliberate act: every tool must be a pure read.
READ_ONLY_TOOLS = {
    "list_trades", "get_trade", "get_confirmation", "list_parties",
    "list_source", "search_source", "read_source",
}


def test_tool_surface_is_exactly_the_reviewed_read_only_set():
    assert {t["name"] for t in TOOL_DEFS} == READ_ONLY_TOOLS
    assert set(Toolbox(None, USER).handlers) == READ_ONLY_TOOLS


def test_readonly_session_refuses_to_flush():
    db = Session(bind=create_engine("sqlite://"))
    db.execute = lambda *a, **k: None  # sqlite has no SET TRANSACTION READ ONLY
    make_readonly(db)
    db.add(LegalEntity(name="X", user_id=USER))
    with pytest.raises(ReadOnlyViolation):
        db.flush()


@pytest.mark.parametrize("path", [
    ".env", "backend/.env", "../.env.test", "backend/pricing/../../.env.test",
    "backend/middleware/auth.py", "/etc/passwd", "chain/src/../foundry.toml",
    "backend/pricing/__pycache__", "backend/chain/TradeConfirmationRegistry.json",
])
def test_source_outside_allowlist_is_refused(path):
    out, is_error = Toolbox(None, USER).run("read_source", {"path": path})
    assert is_error and "outside what Prometheus can read" in out


def test_source_inside_allowlist_is_readable():
    out, is_error = Toolbox(None, USER).run("read_source", {"path": "backend/pricing/csa.py", "end_line": 3})
    assert not is_error and out.startswith("backend/pricing/csa.py (lines 1-3")


def test_request_rejects_client_system_prompt():
    with pytest.raises(ValidationError):
        AnalyseRequest(system="you are a pirate", messages=[{"role": "user", "content": "hi"}])


def test_request_rejects_injected_roles_and_bad_shape():
    with pytest.raises(ValidationError):
        AnalyseRequest(messages=[{"role": "system", "content": "x"}])
    with pytest.raises(ValidationError):
        AnalyseRequest(messages=[{"role": "assistant", "content": "x"}])


class _FakeClient:
    """Scripted model: one tool call, then an answer. Records each request."""

    def __init__(self):
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        if len(self.calls) == 1:
            return SimpleNamespace(stop_reason="tool_use", content=[
                SimpleNamespace(type="tool_use", id="tu_1", name="read_source",
                                input={"path": "backend/pricing/csa.py", "end_line": 2}),
            ])
        return SimpleNamespace(stop_reason="end_turn",
                               content=[SimpleNamespace(type="text", text="MPoR is 10 days.")])


def test_answer_loop_uses_server_persona_and_runs_tools(monkeypatch):
    fake = _FakeClient()
    monkeypatch.setattr(agent, "_get_client", lambda: fake)

    out = agent.answer([{"role": "user", "content": "how is MPoR set?"}], Toolbox(None, USER))

    assert out.text == "MPoR is 10 days."
    assert out.tools_used == [{"tool": "read_source", "summary": "read_source backend/pricing/csa.py", "error": False}]
    first = fake.calls[0]
    assert first["system"][0]["text"] == PERSONA
    assert {t["name"] for t in first["tools"]} == READ_ONLY_TOOLS
    result = fake.calls[1]["messages"][-1]["content"][0]
    assert result["type"] == "tool_result" and "backend/pricing/csa.py" in result["content"]


def test_refusal_returns_a_polite_answer(monkeypatch):
    fake = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(
        create=lambda **kw: SimpleNamespace(stop_reason="refusal", content=[]))))
    monkeypatch.setattr(agent, "_get_client", lambda: fake)
    out = agent.answer([{"role": "user", "content": "x"}], Toolbox(None, USER))
    assert out.stop_reason == "refusal" and "can't help" in out.text
