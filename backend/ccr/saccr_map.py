"""The credit engine's netting set as SA-CCR rows (pricing/sa_ccr.py): asset class, hedging set, adjusted
notional in USD, the dates S and E, the remaining maturity M and the supervisory delta, per CRE52.32–52.40
and SCO60.98 for digital assets. Every approximation is returned as a note."""
from __future__ import annotations

from datetime import date
from typing import Callable, Optional

from ccr import options as O
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
            if kind == "SWAP" and str(getattr(t, "instrument_type", "") or "").upper() in O.CAPS:
                # A cap, a floor or a collar (in the set since 0.60.0): one row per option on its leg, as an option
                # on the rate with the supervisory delta of CRE52.40 and its own side: a cap is a call on the rate, a
                # floor a put; bought, the cap is long the rate and the floor short it. P is the forward of the
                # strip's own periods, T the start of its last period (its latest exercise). The option is one row,
                # not a row per caplet. (It reached this function as a swap with no fixed leg and would have been
                # given δ = +1 whichever way it faced: a sold cap or a bought floor would have added to a hedging
                # set it offsets. Found in review before it shipped.)
                ccy = it["ccy"]
                k = fx_to_usd.get(ccy, 1.0) or 1.0
                E = max(years(asof, it["maturity"]), 0.0)
                df = dfs[ccy] if dfs and ccy in dfs else None
                for c in it.get("caplets") or []:
                    live = [(ps, pe, pay, tau) for (ps, pe, pay, tau) in c["periods"] if years(asof, pay) > 0 and tau > 0]
                    if not live:
                        continue
                    K = float(c["K"])
                    P = None
                    if df is not None:
                        ahead = [(ps, pe, pay, tau) for (ps, pe, pay, tau) in live if years(asof, ps) >= 0]
                        den = sum(tau * df(years(asof, pay)) for (_ps, _pe, pay, tau) in ahead)
                        if den > 0:
                            P = sum((df(years(asof, ps)) / df(years(asof, pe)) - 1.0) * df(years(asof, pay)) for (ps, pe, pay, _tau) in ahead) / den
                    if P is None:
                        P = K
                        notes.append(f"{ref}: no curve for the strip's forward rate; the option delta is taken at the money")
                    S_ = max(years(asof, live[0][0]), 0.0)
                    T_e = max(years(asof, live[-1][0]), 1.0 / 365.0)
                    delta = supervisory_delta("CALL" if c["type"] == "CAP" else "PUT", float(c["sign"]) > 0, P, K, T_e, SUPERVISORY["IR"]["vol"], _ir_shift(P, K))
                    rows.append(SaccrTrade("IR", ccy, float(c["N"]) * k, S_, E, E, delta, trade_ref=ref))
                    notes.append(f"{ref}: a {c['type'].lower()} enters as one option on its strip's forward rate, exercised at its last period's start (not a row per caplet)")
            elif kind == "SWAP":
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
                if ac == "CRYPTO" and base.upper() not in ("BTC", "ETH"):
                    # the ticket's default for this asset is Group 2b (pricing/fx_xva.crypto_group_of); the book-level
                    # report has no Group 2b treatment yet (SCO60.99 splits the netting set) and says so
                    note = f"{base} is run in SA-CCR's cryptoasset class here (Group 2a, 32 %); the ticket's default for it is Group 2b (50 % of gross notional, SCO60.99), which this report does not apply yet"
                    if note not in notes:
                        notes.append(note)
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


def rows_of_paths(P: dict, mkt, asof: date) -> tuple[list[SaccrTrade], list[str]]:
    """The SA-CCR rows of a set from what ccr.report.netting_set_paths returns: each currency's own discount
    function (for a swaption's par rate), then from_netting_set. One place for the capital report and the
    counterparty report, so the two charge capital on the same rows."""
    from ccr import calibration as C
    from ccr.simulate import df_fn
    dfs = {}
    for c in P["currencies"]:
        key = f"RATES:{C.CURVE_OF.get(c, c + '_OIS')}"
        if key in P["curves"]:
            dfs[c] = df_fn(P["curves"][key], asof)
    return from_netting_set(P["ns"], mkt, P["fx"], asof, dfs)

