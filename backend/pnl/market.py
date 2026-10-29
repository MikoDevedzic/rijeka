"""The market as of a date. Every saved curve, spot and funding row is a snapshot keyed by
curve_id and valuation_date; the market for date d is, per curve_id, the latest row at or
before d. Overrides let the explain replace one curve (or part of one) at a time."""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

DATE_CURVE = "USD_SOFR"          # the curve whose snapshot dates define the desk's market dates


class Market:
    def __init__(self, db: Session, user_id: str, as_of: date, overrides: Optional[dict] = None, cache: Optional[dict] = None):
        self.db, self.user_id, self.as_of = db, str(user_id), as_of
        self.overrides: dict[str, list[dict]] = dict(overrides or {})
        self._cache: dict[str, Any] = cache if cache is not None else {}

    # ── reads ────────────────────────────────────────────────────────────────
    def snapshot(self, curve_id: str):
        key = f"{curve_id}@{self.as_of}"
        if key not in self._cache:
            self._cache[key] = self.db.execute(text(
                "SELECT valuation_date, quotes, source FROM market_data_snapshots "
                "WHERE user_id = :u AND curve_id = :c AND valuation_date <= :d "
                "ORDER BY valuation_date DESC, created_at DESC LIMIT 1"),
                {"u": self.user_id, "c": curve_id, "d": self.as_of}).first()
        return self._cache[key]

    def quotes(self, curve_id: str) -> Optional[list[dict]]:
        if curve_id in self.overrides:
            return self.overrides[curve_id]
        row = self.snapshot(curve_id)
        if row is None:
            return None
        return [q for q in (row.quotes or []) if q.get("enabled", True) and q.get("rate") is not None]

    def snapshot_date(self, curve_id: str) -> Optional[date]:
        row = self.snapshot(curve_id)
        return row.valuation_date if row is not None else None

    def single(self, curve_id: str, tenor: str) -> Optional[float]:
        for q in self.quotes(curve_id) or []:
            if q.get("tenor") == tenor:
                return float(q["rate"])
        return None

    def spot(self, pair: str) -> Optional[float]:
        return self.single(f"{pair}_SPOT", "SPOT")

    # ── overrides (new Market, same cache) ──────────────────────────────────
    def override(self, curve_id: str, quotes: list[dict]) -> "Market":
        return Market(self.db, self.user_id, self.as_of, {**self.overrides, curve_id: quotes}, self._cache)

    def with_single(self, curve_id: str, tenor: str, rate: float) -> "Market":
        return self.override(curve_id, [{"tenor": tenor, "rate": rate, "quote_type": "SPOT" if tenor == "SPOT" else "FLAT", "enabled": True}])

    def signature(self) -> str:
        """Cache key for a valuation on this market."""
        return f"{self.as_of}|" + "|".join(f"{k}={hash(str(v))}" for k, v in sorted(self.overrides.items()))

    # ── dates ────────────────────────────────────────────────────────────────
    @staticmethod
    def dates(db: Session, user_id: str, upto: Optional[date] = None) -> list[date]:
        """The desk's market dates: every date with a saved benchmark curve, oldest first."""
        rows = db.execute(text("SELECT DISTINCT valuation_date FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c "
                               + ("AND valuation_date <= :d " if upto else "") + "ORDER BY valuation_date"),
                          {"u": str(user_id), "c": DATE_CURVE, **({"d": upto} if upto else {})}).all()
        return [r.valuation_date for r in rows]


def quote_differs(a: Optional[list[dict]], b: Optional[list[dict]]) -> bool:
    if a is None or b is None:
        return False
    ka = {q.get("tenor"): float(q["rate"]) for q in a}
    kb = {q.get("tenor"): float(q["rate"]) for q in b}
    return ka != kb
