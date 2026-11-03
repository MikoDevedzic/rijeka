"""The firm's tolerance rules: how far an independent mark may sit from the desk's before a pillar needs review,
and below what first-order impact an input is immaterial and passes as WAIVED.

Rules match by glob on the input and the pillar; the most specific rule wins (an exact input before a pattern,
an exact pillar before `*`). Defaults per kind apply when the firm has none."""
from __future__ import annotations

import fnmatch
from typing import Any, Optional

from ipv.inputs import kind_of, unit_of

DEFAULTS = {"RATES": 1.0, "FUNDING": 2.0, "SWAPTION_VOL": 1.5, "FX_VOL": 0.25, "SPOT": 0.10}      # in the kind's unit
DEFAULT_MATERIALITY_USD = 1_000.0


def _specificity(rule: dict, curve_id: str, pillar: str) -> tuple[int, int]:
    ip, pp = str(rule.get("input_pattern") or "*"), str(rule.get("pillar_pattern") or "*")
    return (2 if ip.upper() == curve_id.upper() else 1 if ip != "*" else 0, 2 if pp.upper() == pillar.upper() else 1 if pp != "*" else 0)


def rule_for(rules: list[dict], curve_id: str, pillar: str = "*") -> dict[str, Any]:
    """{tol, unit, materiality_usd, source} for the input and pillar."""
    matches = [r for r in rules or []
               if fnmatch.fnmatchcase(curve_id.upper(), str(r.get("input_pattern") or "*").upper())
               and fnmatch.fnmatchcase(pillar.upper(), str(r.get("pillar_pattern") or "*").upper())]
    if matches:
        best = max(matches, key=lambda r: _specificity(r, curve_id, pillar))
        return {"tol": float(best["tol"]), "unit": str(best.get("unit") or unit_of(curve_id)), "materiality_usd": float(best.get("materiality_usd") or 0.0),
                "source": f"rule {best.get('input_pattern')} / {best.get('pillar_pattern') or '*'}", "rule_id": best.get("id")}
    return {"tol": DEFAULTS[kind_of(curve_id)], "unit": unit_of(curve_id), "materiality_usd": DEFAULT_MATERIALITY_USD, "source": "default", "rule_id": None}


def pillar_status(gap: Optional[float], tol: float, overridden: bool, approved: bool = False) -> str:
    """OVERRIDDEN when the controller set a value; REVIEW when the independent mark sits beyond tolerance;
    OK within it (APPROVED once the input is approved as marked); UNVERIFIED without an independent mark."""
    if overridden:
        return "OVERRIDDEN"
    if gap is None:
        return "APPROVED" if approved else "UNVERIFIED"
    if abs(gap) > tol:
        return "REVIEW"
    return "APPROVED" if approved else "OK"


def material(sensitivity_usd: float, tol: float, materiality_usd: float) -> bool:
    """An input's pillar is material when a move of one tolerance would change P&L by at least the threshold."""
    return abs(sensitivity_usd) * tol >= materiality_usd
