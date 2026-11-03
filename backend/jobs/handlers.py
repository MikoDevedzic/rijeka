"""What a job of each kind does. A handler takes the worker's session, the job row and a `report`
callable that merges a progress patch into the row; it returns the result stored on the row.

    ccr_run        the counterparty-credit run for one account (api/routes/ccr.py POST /run)
    risk_backfill  public-source risk-factor history for the template account (POST /api/risk/history/backfill)
    capital_run    the book's capital under collateral regimes (POST /api/capital/portfolio)

Neither sends a chain transaction: the relayer nonce belongs to the API process only."""
from __future__ import annotations

from typing import Any, Callable


class Progress(dict):
    """A dict the engines already accept as `progress=`: every update is also written to the job row."""
    def __init__(self, report: Callable[[dict], None]):
        super().__init__()
        self._report = report

    def update(self, *a, **kw):          # noqa: D102
        super().update(*a, **kw)
        patch = dict(*a, **kw)
        try:
            self._report(patch)
        except Exception:                # noqa: BLE001 — progress is advisory
            pass


def ccr_run(db, job: dict, report: Callable[[dict], None]) -> dict[str, Any]:
    from ccr import report as R
    p = job.get("params") or {}
    ctx, counterparty = p["ctx"], p.get("counterparty")
    prog = Progress(report)
    rep = R.report(db, ctx, None, only_counterparty=counterparty, progress=prog)
    out = R.store(db, ctx, rep)
    return {"counterparties": len(rep["counterparties"]), **out, "seconds": sum(c.get("seconds", 0) for c in rep["counterparties"])}


def risk_backfill(db, job: dict, report: Callable[[dict], None]) -> dict[str, Any]:
    from risk import history as H
    p = job.get("params") or {}
    return H.backfill(db, p["template"], years=float(p.get("years", 2.0)), overwrite=bool(p.get("overwrite", False)))


def capital_run(db, job: dict, report: Callable[[dict], None]) -> dict[str, Any]:
    """The book's capital under regimes (ccr/capital_report.py): the result is the report itself."""
    from ccr import capital_report as CR
    p = job.get("params") or {}
    prog = Progress(report)
    return CR.report(db, p["ctx"], progress=prog, hurdle=float(p.get("hurdle", 0.12)), yield_bp=p.get("yield_bp"), n_paths=p.get("n_paths"))


HANDLERS: dict[str, Callable[..., Any]] = {"ccr_run": ccr_run, "risk_backfill": risk_backfill, "capital_run": capital_run}
