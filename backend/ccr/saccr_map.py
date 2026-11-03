"""The credit engine's netting set as SA-CCR rows (pricing/sa_ccr.py): asset class, hedging set, adjusted
notional in USD, the dates S and E, the remaining maturity M and the supervisory delta, per CRE52.32–52.40
and SCO60.98 for digital assets. Every approximation is returned as a note."""
from __future__ import annotations

from datetime import date
from typing import Callable, Optional

from ccr.valuation import NettingSet, years
from pricing.sa_ccr import SUPERVISORY, SaccrTrade, supervisory_delta

try:
    from pricing.fx_xva import G10
except Exception:          # pragma: no cover
    G10 = {"USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "SEK", "NOK"}


def _is_crypto(base: str) -> bool:
    return base.upper() not in G10


def par_rate(fixed_sched: list, asof: date, df: Callable[[float], float]) -> Optional[float]:
    """The forward par rate of the fixed schedule: (P(start) − P(end)) / Σ τ P(pay)."""
    if not fixed_sched:
        return None
    start, end = fixed_sched[0][0], fixed_sched[-1][1]
    ann = sum(float(tau) * df(years(asof, pay)) for (_ps, _pe, pay, tau) in fixed_sched if years(asof, pay) > 0)
    if ann <= 0:
        return None
    return (df(max(years(asof, start), 0.0)) - df(years(asof, end))) / ann


def _ir_shift(P: float, K: float) -> float:
    """CRE52.40: λ so that P + λ and K + λ are positive, as low as possible."""
    m = min(P, K)
    return 0.0 if m > 0 else (-m + 1e-4)


def from_netting_set(ns: NettingSet, mkt, fx_to_usd: dict[str, float], asof: date,
                     dfs: Optional[dict[str, Callable[[float], float]]] = None) -> tuple[list[SaccrTrade], list[str]]:
    rows, notes = [], []
    for it in ns.items:
        t = it["trade"]
        ref = str(getattr(t, "trade_ref", "") or "")
        kind = it["kind"]
        try:
            if kind == "SWAP":
                ccy = it["ccy"]
                k = fx_to_usd.get(ccy, 1.0) or 1.0
                legs = it["legs"]
                N = max(float(lg.get("notional") or 0.0) for lg, _s in legs) * k
                starts = [s[0][0] for _lg, s in legs if s]
                S = max(years(asof, min(starts)), 0.0) if starts else 0.0
                E = max(years(asof, it["maturity"]), 0.0)
                fixed = next((lg for lg, _s in legs if str(lg.get("leg_type", "")).upper() == "FIXED"), None)
                if fixed is not None:
                    delta = 1.0 if str(fixed.get("direction", "")).upper().startswith("PAY") else -1.0
                else:
                    delta = 1.0
                    notes.append(f"{ref}: two floating legs; δ = +1 by the first leg (a basis set would halve the factor, CRE52.46)")
                if it.get("caplets"):
                    notes.append(f"{ref}: caps and floors on the float leg enter at the swap's δ (the option delta of each caplet is not applied)")
                rows.append(SaccrTrade("IR", ccy, N, S, E, E, delta, trade_ref=ref))
            elif kind == "SWAPTION":
                ccy = it["ccy"]
                k = fx_to_usd.get(ccy, 1.0) or 1.0
                N = float(it["N"]) * k
                S = max(years(asof, it["start"]), 0.0)
                E = max(years(asof, it["maturity"]), 0.0)
                T_e = max(years(asof, it["expiry"]), 1.0 / 365.0)
                K = float(it["K"])
                P = par_rate(it.get("fixed_sched") or [], asof, dfs[ccy]) if dfs and ccy in dfs else None
                if P is None:
                    P = K
                    notes.append(f"{ref}: no curve for the forward swap rate; the option delta is taken at the money")
                bought = float(it.get("sign", 1.0)) > 0
                # a payer swaption is a call on the rate (long the risk factor), a receiver a put
                delta = supervisory_delta("CALL" if it["is_payer"] else "PUT", bought, P, K, T_e, SUPERVISORY["IR"]["vol"], _ir_shift(P, K))
                rows.append(SaccrTrade("IR", ccy, N, S, E, E, delta, trade_ref=ref))      # physically settled: active to the underlying's end (CRE52.32)
            elif kind in ("FORWARD", "FX_OPTION"):
                pair, base, quote = it["pair"], it["base"], it["quote"]
                spot = mkt.spot(pair) if mkt is not None else None
                if not spot:
                    spot = float(it["terms"].get("K") or 0.0) or float(it.get("K") or 0.0) or 1.0
                    notes.append(f"{ref}: no spot for {pair}; the contract rate stands in for it")
                kq = fx_to_usd.get(quote, 1.0) or 1.0
                ac = "CRYPTO" if _is_crypto(base) else "FX"
                if kind == "FORWARD":
                    N = float(it["terms"]["notional"]) * float(spot) * kq               # the foreign leg in the domestic currency (CRE52.35)
                    E = max(years(asof, it["maturity"]), 0.0)
                    delta = 1.0 if str(it["terms"].get("direction", "BUY")).upper() == "BUY" else -1.0
                    rows.append(SaccrTrade(ac, pair, N, 0.0, E, E, delta, trade_ref=ref))
                else:
                    N = float(it["N"]) * float(spot) * kq
                    T_e = max(years(asof, it["expiry"]), 1.0 / 365.0)
                    M = max(years(asof, it["maturity"]), T_e)
                    K = float(it.get("K") or 0.0)
                    bought = float(it.get("sign", 1.0)) > 0
                    spec = it.get("spec")
                    style = getattr(spec, "style", "EUROPEAN")
                    if K <= 0:
                        delta = 1.0 if bought else -1.0
                        notes.append(f"{ref}: {style} without a strike; δ = ±1")
                    else:
                        delta = supervisory_delta(it.get("option_type", "CALL"), bought, float(spot), K, T_e, SUPERVISORY[ac]["vol"])
                        if style not in ("EUROPEAN", "AMERICAN"):
                            notes.append(f"{ref}: {style} enters at the vanilla supervisory delta of its strike")
                    rows.append(SaccrTrade(ac, pair, N, 0.0, M, M, delta, trade_ref=ref))
            else:
                notes.append(f"{ref}: {kind} is not mapped to an SA-CCR asset class")
        except Exception as e:          # noqa: BLE001
            notes.append(f"{ref}: not mapped ({str(e)[:80]})")
    return rows, notes
