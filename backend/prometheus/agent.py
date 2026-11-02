"""
The PROMETHEUS answer loop: model <-> read-only tools until it answers.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

import anthropic

from prometheus.persona import PERSONA
from prometheus.tools import SourceToolbox, _rel, _resolve_source

log = logging.getLogger("rijeka.prometheus")

MODEL = os.getenv("PROMETHEUS_MODEL", "claude-opus-5")
MAX_TOOL_ROUNDS = 12

# Source links point at the public repo, pinned to the deployed commit so a
# link shows exactly the code that produced the answer. Render sets
# RENDER_GIT_COMMIT; elsewhere links fall back to main.
SOURCE_REPO_URL = os.getenv("RIJEKA_SOURCE_URL", "https://github.com/MikoDevedzic/rijeka").rstrip("/")
SOURCE_REF = os.getenv("RENDER_GIT_COMMIT") or "main"

# Server-side refusal fallback: a declined request is re-run on Anthropic's
# recommended fallback model inside the same call.
_BETAS = ["server-side-fallback-2026-07-01"]

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        # ANTHROPIC_API_KEY from env. A bounded wait: a request thread is held for the whole exchange.
        _client = anthropic.Anthropic(timeout=180.0, max_retries=1)
    return _client


# A daily token allowance per account (input + output, every round), in process: one demo account
# cannot run the bill. Reset at UTC midnight; RIJEKA_PROMETHEUS_DAILY_TOKENS sets the size.
DAILY_TOKENS = int(os.getenv("RIJEKA_PROMETHEUS_DAILY_TOKENS", "400000"))
_budget: dict[str, tuple[str, int]] = {}


class BudgetExceeded(Exception):
    pass


def _today() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).date().isoformat()


def tokens_used(sub: str) -> int:
    day, n = _budget.get(sub, (None, 0))
    return n if day == _today() else 0


def charge(sub: str, usage) -> int:
    """Adds a response's usage to the account's day; returns the day's total."""
    n = int(getattr(usage, "input_tokens", 0) or 0) + int(getattr(usage, "output_tokens", 0) or 0)
    total = tokens_used(sub) + n
    _budget[sub] = (_today(), total)
    if len(_budget) > 5000:
        for k in [k for k, (d, _) in _budget.items() if d != _today()]:
            _budget.pop(k, None)
    return total


@dataclass
class Answer:
    text: str
    tools_used: list[dict] = field(default_factory=list)
    stop_reason: str | None = None

    @property
    def sources(self) -> list[dict]:
        """Files Prometheus actually read, once each, as links to the public repo."""
        seen: list[str] = []
        for u in self.tools_used:
            if u["tool"] == "read_source" and not u["error"] and u.get("path") and u["path"] not in seen:
                seen.append(u["path"])
        return [{"path": p, "url": f"{SOURCE_REPO_URL}/blob/{SOURCE_REF}/{p}"} for p in seen]


def _describe(name: str, args: dict) -> str:
    """One-line, user-facing trace of what Prometheus looked at."""
    if name in ("read_source", "list_source"):
        return f"{name} {args.get('path') or '/'}"
    if name == "search_source":
        return f"search_source /{args.get('pattern')}/ {args.get('path') or ''}".strip()
    if name in ("get_trade", "get_confirmation"):
        return f"{name} {args.get('trade')}"
    return name


def _source_path(name: str, args: dict) -> str | None:
    """Canonical repo-relative path for a read_source call, else None."""
    if name != "read_source" or not args.get("path"):
        return None
    try:
        return _rel(_resolve_source(args["path"]))
    except ValueError:
        return None


def answer(messages: list[dict], toolbox: SourceToolbox, context: str | None = None, sub: str | None = None) -> Answer:
    system = [{"type": "text", "text": PERSONA, "cache_control": {"type": "ephemeral"}}]
    if context:
        # Server-built context (e.g. the trades open in Compare). After the
        # cache breakpoint so the persona prefix stays cacheable.
        system.append({"type": "text", "text": context})

    convo = list(messages)
    used: list[dict] = []
    client = _get_client()

    for _ in range(MAX_TOOL_ROUNDS + 1):
        if sub and tokens_used(sub) >= DAILY_TOKENS:
            raise BudgetExceeded(f"{sub[:8]} used its daily allowance")
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=system,
            tools=toolbox.tool_defs,
            messages=convo,
            betas=_BETAS,
            extra_body={"fallbacks": "default"},
        )

        if sub:
            charge(sub, getattr(resp, "usage", None))

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
                         "error": is_error, "path": _source_path(block.name, block.input or {})})
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
