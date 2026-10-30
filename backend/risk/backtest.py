"""VaR backtesting: yesterday's VaR against today's P&L.

For every stored P&L date the VaR that was standing the evening before (the latest stored
risk report dated before it) is compared with the day's P&L. An exception is a day whose
loss exceeded that VaR. Three P&L measures:
    clean         market P&L of the positions held at the previous close (no new trades, no
                  unwinds): what the VaR claims to cover
    hypothetical  clean P&L without carry (theta, roll-down, accrual): pure market moves
    dirty         everything the book made or lost, trading included
Over a window the exception count is read against the Basel traffic light (the cumulative
binomial probability of that many exceptions or fewer under the stated confidence: green
below 95 %, yellow to 99.99 %, red beyond, which at 250 days and 99 % gives the familiar
0-4 / 5-9 / 10+) and Kupiec's proportion-of-failures test (LR_pof, chi-square with one
degree of freedom). The 95 % VaR is backtested alongside. Nothing is stored: the two daily
series already are, and the test is a read of them."""
from __future__ import annotations

import math
from datetime import date
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

MEASURES = ("clean", "hypothetical", "dirty")
WINDOW_DAYS = 250
MIN_DAYS = 60


def binom_cdf(k: int, n: int, p: float) -> float:
    """P(X ≤ k) for X ~ Binomial(n, p)."""
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))


def zone(exceptions: int, n: int, p: float) -> dict[str, Any]:
    """Basel traffic light: the cumulative probability of `exceptions` or fewer."""
    if n <= 0:
        return {"zone": "NONE", "cumulative": None}
    cum = binom_cdf(exceptions, n, p)
    if n < MIN_DAYS:                       # too short to colour: the binomial is computed, the verdict withheld
        return {"zone": "TOO FEW DAYS", "cumulative": cum}
    z = "GREEN" if cum < 0.95 else "YELLOW" if cum < 0.9999 else "RED"
    return {"zone": z, "cumulative": cum}


def kupiec(exceptions: int, n: int, p: float) -> dict[str, Any]:
    """Proportion-of-failures likelihood ratio and its chi-square(1) p-value."""
    if n <= 0:
        return {"lr": None, "p_value": None, "reject": None}
    x = exceptions
    if x == 0:
        lr = -2.0 * n * math.log(1 - p)
    elif x == n:
        lr = -2.0 * n * math.log(p)
    else:
        f = x / n
        lr = -2.0 * ((n - x) * math.log(1 - p) + x * math.log(p)) + 2.0 * ((n - x) * math.log(1 - f) + x * math.log(f))
    lr = max(0.0, lr)
    p_value = math.erfc(math.sqrt(lr / 2.0))            # survival function of chi-square with one degree of freedom
    return {"lr": lr, "p_value": p_value, "reject": p_value < 0.05}


def evaluate(series: list[dict], confidence: float, var_key: str, pnl_key: str = "pnl") -> dict[str, Any]:
    """series rows: {date, pnl, var99, var95, ...}; an exception is pnl < -var."""
    rows = [r for r in series if r.get(var_key) is not None and r.get(pnl_key) is not None]
    n = len(rows)
    p = 1.0 - confidence
    exc = [{"date": r["date"], "pnl": r[pnl_key], "var": r[var_key], "ratio": (-r[pnl_key] / r[var_key]) if r[var_key] else None}
           for r in rows if r[pnl_key] < -r[var_key]]
    out = {"confidence": confidence, "observations": n, "exceptions": len(exc), "expected": n * p, "exception_days": exc,
           "enough": n >= MIN_DAYS, "min_days": MIN_DAYS, **zone(len(exc), n, p), "kupiec": kupiec(len(exc), n, p)}
    if rows:
        out["worst_ratio"] = max((-r[pnl_key] / r[var_key]) for r in rows if r[var_key]) if any(r[var_key] for r in rows) else None
        out["mean_var"] = sum(r[var_key] for r in rows) / n
        out["mean_abs_pnl"] = sum(abs(r[pnl_key]) for r in rows) / n
    return out


def _pnl_series(db: Session, uid: str, days: int) -> dict[date, dict[str, float]]:
    rows = db.execute(text("""
        WITH d AS (
          SELECT pnl_date, sum(usd) AS dirty, sum(market_usd) AS clean
          FROM pnl_daily WHERE user_id = :u GROUP BY pnl_date),
        c AS (
          SELECT p.pnl_date, sum((e->>'usd')::numeric) AS carry
          FROM pnl_daily p, jsonb_array_elements(coalesce(p.rows, '[]'::jsonb)) e
          WHERE p.user_id = :u AND e->>'bucket' = 'CARRY' GROUP BY p.pnl_date)
        SELECT d.pnl_date, d.dirty, d.clean, coalesce(c.carry, 0) AS carry
        FROM d LEFT JOIN c ON c.pnl_date = d.pnl_date ORDER BY d.pnl_date DESC LIMIT :n"""), {"u": uid, "n": days}).all()
    return {r.pnl_date: {"dirty": float(r.dirty or 0), "clean": float(r.clean or 0), "hypothetical": float(r.clean or 0) - float(r.carry or 0)} for r in rows}


def _var_series(db: Session, uid: str) -> list[tuple[date, dict[str, Optional[float]]]]:
    rows = db.execute(text("""
        SELECT risk_date, var_1d, (report->'var'->>'var_1d_secondary')::float AS v95, (report->'var'->'linear'->>'var_1d')::float AS lin,
               (report->'var'->>'confidence')::float AS conf, (report->'var'->>'secondary_confidence')::float AS conf2
        FROM risk_daily WHERE user_id = :u AND var_1d IS NOT NULL ORDER BY risk_date"""), {"u": uid}).all()
    return [(r.risk_date, {"var99": float(r.var_1d), "var95": r.v95, "var_linear": r.lin, "confidence": r.conf, "secondary": r.conf2}) for r in rows]


def series(db: Session, uid: str, days: int = WINDOW_DAYS) -> list[dict[str, Any]]:
    """One row per P&L date that has a VaR standing before it: the VaR of the latest risk date < P&L date."""
    pnl = _pnl_series(db, uid, days)
    vars_ = _var_series(db, uid)
    out = []
    for d in sorted(pnl):
        standing = None
        for rd, v in vars_:
            if rd < d:
                standing = (rd, v)
            else:
                break
        if standing is None:
            continue
        rd, v = standing
        out.append({"date": d.isoformat(), "var_date": rd.isoformat(), **pnl[d], **{k: v[k] for k in ("var99", "var95", "var_linear")},
                    "confidence": v["confidence"] or 0.99, "secondary": v["secondary"] or 0.95})
    return out


def run(db: Session, uid: str, measure: str = "clean", days: int = WINDOW_DAYS) -> dict[str, Any]:
    measure = measure if measure in MEASURES else "clean"
    ser = series(db, uid, days)
    for r in ser:
        r["pnl"] = r[measure]
    conf = ser[-1]["confidence"] if ser else 0.99
    conf2 = ser[-1]["secondary"] if ser else 0.95
    return {"measure": measure, "measures": list(MEASURES), "window_days": days, "observations": len(ser),
            "from": ser[0]["date"] if ser else None, "to": ser[-1]["date"] if ser else None,
            "headline": evaluate(ser, conf, "var99"), "secondary": evaluate(ser, conf2, "var95"),
            "linear": evaluate(ser, conf, "var_linear") if any(r.get("var_linear") is not None for r in ser) else None,
            "series": ser, "note": None if len(ser) >= MIN_DAYS else f"{len(ser)} days of paired history; the traffic light needs {MIN_DAYS} to say anything and 250 to be read the usual way"}
