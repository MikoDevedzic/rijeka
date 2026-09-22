"""
PROMETHEUS — Rijeka's read-only, explain-only assistant.

Read-only is enforced by construction, not by the prompt:
  - tools.py exposes lookups only; there is no tool that writes.
  - The DB session it runs on is SET TRANSACTION READ ONLY and refuses to
    flush, so a bug in a tool still cannot change a row.
  - Every lookup is scoped to the asking user's tenant.
  - The persona (system prompt) lives on the server; clients send only the
    conversation.
"""
