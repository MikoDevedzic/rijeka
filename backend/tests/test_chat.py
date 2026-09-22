"""
Chat room logic that needs no database: @mentions, transcript -> model turns,
and the room toolbox boundary.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")

import pytest

from prometheus import rooms
from prometheus.tools import SourceToolbox


@pytest.mark.parametrize("body,expected", [
    ("@prometheus what is MPoR?", True),
    ("hey @Prometheus, quick one", True),
    ("ask prometheus later", False),
    ("mail me at x@prometheus.io", False),
    ("@prometheusbot hi", False),
])
def test_mentions(body, expected):
    assert rooms.mentions_prometheus(body) is expected


def _m(kind, body, name="Ana", firm="CONFLUENCE BANK AG"):
    return {"sender_kind": kind, "sender_name": name, "sender_firm": firm, "body": body}


def test_transcript_labels_speakers_and_alternates():
    turns = rooms.transcript_to_messages([
        _m("USER", "morning", "Miko", "RIJEKA CAPITAL"),
        _m("USER", "@prometheus what is MPoR?"),
        _m("PROMETHEUS", "10bd bilateral, 5bd on-chain.", "Prometheus", "Rijeka"),
        _m("USER", "@prometheus and SIMM?"),
    ])
    assert [t["role"] for t in turns] == ["user", "assistant", "user"]
    assert turns[0]["content"] == "[Miko · RIJEKA CAPITAL]: morning\n\n[Ana · CONFLUENCE BANK AG]: @prometheus what is MPoR?"
    assert turns[-1]["content"].endswith("@prometheus and SIMM?")


def test_transcript_starts_and_ends_on_user():
    turns = rooms.transcript_to_messages([
        _m("PROMETHEUS", "earlier answer", "Prometheus", "Rijeka"),
        _m("USER", "@prometheus hi"),
        _m("PROMETHEUS", "a reply that raced in", "Prometheus", "Rijeka"),
    ])
    assert turns == [{"role": "user", "content": "[Ana · CONFLUENCE BANK AG]: @prometheus hi"}]


def _capture(monkeypatch):
    seen = {}

    def fake_answer(messages, toolbox, context=None):
        seen["toolbox"], seen["context"] = toolbox, context
        return rooms.agent.Answer("ok", [])

    monkeypatch.setattr(rooms.agent, "answer", fake_answer)
    return seen


def test_support_room_gets_source_tools_only(monkeypatch):
    seen = _capture(monkeypatch)
    rooms.answer_in_room("SUPPORT", ["RIJEKA CAPITAL"], [_m("USER", "hi")])
    assert type(seen["toolbox"]) is SourceToolbox
    assert "cannot see any firm's trades" in seen["context"]


def test_two_party_room_adds_only_shared_confirmations(monkeypatch):
    seen = _capture(monkeypatch)
    shared = [{"trade_hash": "0xabc", "block_number": 1}]
    rooms.answer_in_room("GROUP", ["CONFLUENCE BANK AG", "RIJEKA CAPITAL"],
                         [_m("USER", "@prometheus how many confirmed?")], shared, "RATES TRADING / G10 RATES")
    tb = seen["toolbox"]
    assert set(tb.handlers) == {"list_source", "search_source", "read_source", "list_shared_confirmations"}
    assert {t["name"] for t in tb.tool_defs} == set(tb.handlers)
    out, is_error = tb.run("list_shared_confirmations", {})
    assert not is_error and '"count": 1' in out and "0xabc" in out
    assert "CONFLUENCE BANK AG, RIJEKA CAPITAL" in seen["context"]
    assert "only trade data you can see" in seen["context"]
    assert "RATES TRADING / G10 RATES" in seen["context"]


@pytest.mark.parametrize("firms,shared", [
    (["RIJEKA CAPITAL"], None),                                                  # colleagues only
    (["CONFLUENCE BANK AG", "GOLDMAN SACHS INTERNATIONAL", "RIJEKA CAPITAL"], None),  # a third firm
    (["CONFLUENCE BANK AG", "RIJEKA CAPITAL"], None),                            # caller computed no pair
])
def test_rooms_that_are_not_exactly_two_parties_get_no_trade_data(monkeypatch, firms, shared):
    seen = _capture(monkeypatch)
    rooms.answer_in_room("GROUP", firms, [_m("USER", "@prometheus hi")], shared)
    assert type(seen["toolbox"]) is SourceToolbox
    assert "cannot see any firm's trades" in seen["context"]
