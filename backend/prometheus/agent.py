"""
The PROMETHEUS answer loop: model <-> read-only tools until it answers.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

import anthropic

from prometheus.persona import PERSONA
from prometheus.tools import TOOL_DEFS, Toolbox

log = logging.getLogger("rijeka.prometheus")

MODEL = os.getenv("PROMETHEUS_MODEL", "claude-opus-5")
MAX_TOOL_ROUNDS = 12

# Server-side refusal fallback: a declined request is re-run on Anthropic's
# recommended fallback model inside the same call.
_BETAS = ["server-side-fallback-2026-07-01"]

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from env
    return _client


@dataclass
class Answer:
    text: str
    tools_used: list[dict] = field(default_factory=list)
    stop_reason: str | None = None


def _describe(name: str, args: dict) -> str:
    """One-line, user-facing trace of what Prometheus looked at."""
    if name in ("read_source", "list_source"):
        return f"{name} {args.get('path') or '/'}"
    if name == "search_source":
        return f"search_source /{args.get('pattern')}/ {args.get('path') or ''}".strip()
    if name in ("get_trade", "get_confirmation"):
        return f"{name} {args.get('trade')}"
    return name


def answer(messages: list[dict], toolbox: Toolbox, context: str | None = None) -> Answer:
    system = [{"type": "text", "text": PERSONA, "cache_control": {"type": "ephemeral"}}]
    if context:
        # Server-built context (e.g. the trades open in Compare). After the
        # cache breakpoint so the persona prefix stays cacheable.
        system.append({"type": "text", "text": context})

    convo = list(messages)
    used: list[dict] = []
    client = _get_client()

    for _ in range(MAX_TOOL_ROUNDS + 1):
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=system,
            tools=TOOL_DEFS,
            messages=convo,
            betas=_BETAS,
            extra_body={"fallbacks": "default"},
        )

        if resp.stop_reason == "refusal":
            return Answer(
                "I can't help with that one. Ask me about your trades, how Rijeka prices "
                "and confirms them, or how to model a risk.",
                used, resp.stop_reason,
            )

        if resp.stop_reason != "tool_use":
            text = "\n\n".join(b.text for b in resp.content if b.type == "text").strip()
            if resp.stop_reason == "max_tokens":
                text += "\n\n[Answer cut short — ask me to continue.]"
            return Answer(text or "No answer.", used, resp.stop_reason)

        convo.append({"role": "assistant", "content": resp.content})
        results = []
        for block in resp.content:
            if block.type != "tool_use":
                continue
            content, is_error = toolbox.run(block.name, block.input)
            used.append({"tool": block.name, "summary": _describe(block.name, block.input or {}),
                         "error": is_error})
            results.append({
                "type": "tool_result", "tool_use_id": block.id,
                "content": content[:100_000], "is_error": is_error,
            })
        convo.append({"role": "user", "content": results})

    log.warning("prometheus: tool round limit hit")
    return Answer(
        "That needed more digging than I allow in one answer. Try narrowing the question "
        "(one trade, one model, one file).",
        used, "tool_round_limit",
    )
