"""Two measures, two parameter sets, one engine.

RISK_NEUTRAL  prices: Hull-White a and sigma from the latest swaption calibration (or the
              desk defaults), spot vols from the desk's flat vols, drift from the curve.
REAL_WORLD    exposure: everything from the observed history on the template account:
              sigma of the short rate from daily changes (annualised), mean reversion from
              an AR(1) fit of the short-rate level, drift zero by default (the forward slope
              is a risk-neutral artefact, not a forecast), spot vols from log returns, and
              the correlation matrix of all factor shocks, which the risk-neutral run never
              needs. Every number carries where it came from."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from risk import history as H

RN_DEFAULT_A, RN_DEFAULT_SIGMA = 0.03, 0.0100        # HW1F fallbacks (sigma in rate units)
RW_A_BOUNDS = (0.01, 0.50)
RW_A_POLICY = 0.05                                      # real-world mean reversion: a stated policy, not a two-year estimate
SHORT_TENORS = ("3M", "1M", "1W", "ON")                 # the short-rate proxy: 3M first, which carries the policy path without
                                                        # the overnight fixing's quarter-end noise; then shorter if a curve lacks it
CURVE_OF = {"USD": "USD_SOFR", "EUR": "EUR_ESTR", "GBP": "GBP_SONIA", "JPY": "JPY_TONAR", "CHF": "CHF_SARON", "AUD": "AUD_AONIA", "CAD": "CAD_CORRA"}


@dataclass
class Factor:
    key: str                 # "RATES:USD_SOFR" or "SPOT:EURUSD"
    kind: str                # RATES | SPOT
    a: float = 0.0           # mean reversion (rates)
    sigma: float = 0.0       # annualised: rate units for rates, log for spots
    drift: float = 0.0       # annualised drift applied in the real-world run (rates: per year in rate units; spots: log)
    source: str = ""
    observations: int = 0


@dataclass
class Calibration:
    measure: str
    factors: dict[str, Factor]
    corr: np.ndarray                      # over factors in `order`
    order: list[str]
    drift_mode: str = "forward"           # forward | zero | historical
    window: Optional[tuple[date, date]] = None
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"measure": self.measure, "drift_mode": self.drift_mode, "order": self.order,
                "window": [d.isoformat() for d in self.window] if self.window else None, "notes": self.notes,
                "factors": {k: {"kind": f.kind, "a": f.a, "sigma": f.sigma, "drift": f.drift, "source": f.source, "observations": f.observations} for k, f in self.factors.items()},
                "corr": [[round(float(x), 4) for x in row] for row in self.corr.tolist()]}


def _short_series(db: Session, tpl, curve_id: str, start: date, end: date) -> list[tuple[date, float]]:
    out = []
    for d, q in H.series(db, tpl, curve_id, start, end):
        for t in SHORT_TENORS:
            if t in q:
                out.append((d, q[t] / 100.0)); break
    return out


def _spot_series(db: Session, tpl, pair: str, start: date, end: date) -> list[tuple[date, float]]:
    return [(d, q["SPOT"]) for d, q in H.series(db, tpl, f"{pair}_SPOT", start, end) if q.get("SPOT")]


def _ar1(levels: list[float], dt: float = 1 / 250) -> tuple[float, float, float]:
    """a, sigma (annualised, rate units), drift per year from x_{t+1} = c + phi x_t + e."""
    x = np.asarray(levels)
    if len(x) < 30:
        return RN_DEFAULT_A, float(np.std(np.diff(x)) * math.sqrt(250)) if len(x) > 2 else RN_DEFAULT_SIGMA, 0.0
    x0, x1 = x[:-1], x[1:]
    A = np.vstack([x0, np.ones_like(x0)]).T
    (phi, c), *_ = np.linalg.lstsq(A, x1, rcond=None)
    phi = float(min(max(phi, 1e-6), 0.99999))
    a = float(min(max(-math.log(phi) / dt, RW_A_BOUNDS[0]), RW_A_BOUNDS[1]))
    resid = x1 - (c + phi * x0)
    sigma = float(np.std(resid) * math.sqrt(250))
    drift = float(np.mean(np.diff(x)) * 250)
    return a, sigma, drift


def real_world(db: Session, tpl, currencies: list[str], pairs: list[str], asof: date, window_days: int = 730, drift_mode: str = "zero") -> Calibration:
    start = asof - timedelta(days=window_days)
    factors: dict[str, Factor] = {}
    shocks: dict[str, dict[date, float]] = {}
    notes: list[str] = []
    for ccy in currencies:
        cid = CURVE_OF.get(ccy, f"{ccy}_OIS")
        ser = _short_series(db, tpl, cid, start, asof)
        key = f"RATES:{cid}"
        if len(ser) >= 30:
            a_est, sigma, drift = _ar1([v for _, v in ser])
            # Two years of daily data identify the volatility well and the mean reversion badly
            # (the AR(1) estimate sits on a bound); the speed is policy, the vol is measured.
            factors[key] = Factor(key, "RATES", a=RW_A_POLICY, sigma=sigma, drift=drift if drift_mode == "historical" else 0.0,
                                  source=f"sigma from daily changes of the {cid} 3M rate, {len(ser)} days; a = {RW_A_POLICY} by policy (AR(1) estimate {a_est:.2f})", observations=len(ser))
            shocks[key] = {d1: v1 - v0 for (d0, v0), (d1, v1) in zip(ser, ser[1:])}
        else:
            factors[key] = Factor(key, "RATES", a=RN_DEFAULT_A, sigma=RN_DEFAULT_SIGMA, source="no history: desk defaults", observations=len(ser))
            notes.append(f"{cid}: no history, defaults used")
    for pair in pairs:
        ser = _spot_series(db, tpl, pair, start, asof)
        key = f"SPOT:{pair}"
        if len(ser) >= 30:
            rets = [math.log(v1 / v0) for (_, v0), (_, v1) in zip(ser, ser[1:]) if v0 > 0 and v1 > 0]
            sigma = float(np.std(rets) * math.sqrt(250))
            mu = float(np.mean(rets) * 250)
            factors[key] = Factor(key, "SPOT", sigma=sigma, drift=mu if drift_mode == "historical" else 0.0,
                                  source=f"log returns of {pair}, {len(ser)} days", observations=len(ser))
            shocks[key] = {d1: math.log(v1 / v0) for (d0, v0), (d1, v1) in zip(ser, ser[1:]) if v0 > 0 and v1 > 0}
        else:
            from pricing.fx_xva import default_vol_pct
            factors[key] = Factor(key, "SPOT", sigma=default_vol_pct(pair) / 100.0, source="no history: desk flat vol", observations=len(ser))
            notes.append(f"{pair}: no history, desk vol used")
    order = list(factors)
    corr = _correlation(order, shocks)
    return Calibration("REAL_WORLD", factors, corr, order, drift_mode=drift_mode, window=(start, asof), notes=notes)


def _correlation(order: list[str], shocks: dict[str, dict[date, float]]) -> np.ndarray:
    n = len(order)
    corr = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = shocks.get(order[i]), shocks.get(order[j])
            if not a or not b:
                continue
            common = sorted(set(a) & set(b))
            if len(common) < 30:
                continue
            x, y = np.array([a[d] for d in common]), np.array([b[d] for d in common])
            if np.std(x) > 0 and np.std(y) > 0:
                corr[i, j] = corr[j, i] = float(np.corrcoef(x, y)[0, 1])
    # nearest PSD, in case of gaps between series
    w, v = np.linalg.eigh(corr)
    w = np.clip(w, 1e-6, None)
    c = v @ np.diag(w) @ v.T
    d = np.sqrt(np.diag(c))
    return c / np.outer(d, d)


def risk_neutral(db: Session, user_id: str, currencies: list[str], pairs: list[str]) -> Calibration:
    factors: dict[str, Factor] = {}
    a, sigma, src = RN_DEFAULT_A, RN_DEFAULT_SIGMA, "desk defaults"
    try:
        row = db.execute(text("SELECT a, sigma_bp, valuation_date FROM xva_calibration WHERE curve_id = 'USD_SWVOL_ATM' AND model = 'HW1F' AND user_id = :u "
                              "ORDER BY valuation_date DESC, created_at DESC LIMIT 1"), {"u": user_id}).first()
        if row and row.a and row.sigma_bp:
            a, sigma, src = float(row.a), float(row.sigma_bp) / 1e4, f"HW1F calibrated to the swaption surface, {row.valuation_date}"
    except Exception:
        db.rollback()
    for ccy in currencies:
        cid = CURVE_OF.get(ccy, f"{ccy}_OIS")
        factors[f"RATES:{cid}"] = Factor(f"RATES:{cid}", "RATES", a=a, sigma=sigma, source=src if ccy == "USD" else f"{src} (USD parameters applied to {ccy})")
    from pricing.fx_xva import default_vol_pct
    for pair in pairs:
        factors[f"SPOT:{pair}"] = Factor(f"SPOT:{pair}", "SPOT", sigma=default_vol_pct(pair) / 100.0, source="desk flat vol (no public vol surface)")
    order = list(factors)
    return Calibration("RISK_NEUTRAL", factors, np.eye(len(order)), order, drift_mode="forward",
                       notes=["independent factors: pricing uses the curve's forwards and the desk vols; correlation is a real-world input"])
