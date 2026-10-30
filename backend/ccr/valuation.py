"""Every trade of a netting set valued on the shared paths, analytically under Hull-White.

Swaps: fixed leg Σ N·c·τ·P(t,T_j) over the remaining coupons; OIS float leg N·(P(t,T_s) − P(t,T_N))
with T_s the start of the current period (1 once inside it), plus any spread as a fixed
annuity. Pay/receive from the leg direction. Forwards (FX, digital assets):
±N·(S_t·DF_base/DF_quote − K)·DF_quote with the path's spot and bonds. Caps and floors
embedded in a leg, and European swaptions, are valued on the paths with Bachelier on the
path's forward and today's ATM vol held flat (ccr/options.py). Anything else is listed as
not simulated, never silently valued at zero."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

import numpy as np

from ccr import options as O
from ccr.calibration import CURVE_OF
from ccr.simulate import Paths, bond
from pnl.valuation import _currency_terms

log = logging.getLogger("rijeka.ccr")
SWAPS = ("IR_SWAP", "OIS", "OIS_SWAP", "BASIS_SWAP")
FORWARDS = ("FX_SPOT", "FX_FORWARD", "NDF", "CRYPTO_FORWARD")


def years(asof: date, d: date) -> float:
    return (d - asof).days / 365.25


def leg_schedule(leg: dict, asof: date):
    """[(start, end, pay, τ)] from the pricer's leg dict, using the production schedule generator."""
    from pricing.schedule import generate_schedule
    eff = date.fromisoformat(str(leg["effective_date"])[:10]); mat = date.fromisoformat(str(leg["maturity_date"])[:10])
    freq = leg.get("payment_frequency") or ("ANNUAL" if str(leg.get("leg_type", "")).upper() == "FIXED" else "QUARTERLY")
    periods = generate_schedule(eff, mat, freq, leg.get("day_count") or "ACT/360", Decimal(str(leg.get("notional") or 0)),
                                bdc=leg.get("bdc") or "MOD_FOLLOWING", payment_lag=int(leg.get("payment_lag") or 0),
                                stub_type=leg.get("stub_type") or "SHORT_FRONT", is_float=str(leg.get("leg_type", "")).upper() == "FLOAT")
    return [(p.period_start, p.period_end, p.payment_date, float(p.dcf)) for p in periods]


class NettingSet:
    """Trades prepared for path valuation: what each needs is resolved once."""

    def __init__(self, db, user: dict, trades: list, asof: date, mkt=None):
        self.asof = asof
        self.items: list[dict] = []
        self.skipped: list[dict] = []
        self.currencies: set[str] = set()
        self.pairs: set[str] = set()
        self.options: list[dict] = []           # what was valued as an option, and with which vol
        uid = user.get("sub")
        from api.routes.pricer import TradeLeg, _leg_to_dict
        for t in trades:
            itype = str(t.instrument_type or "").upper()
            try:
                if itype in SWAPS or itype in O.SWAPTIONS:
                    legs = [_leg_to_dict(l) for l in db.query(TradeLeg).filter(TradeLeg.trade_id == t.id).order_by(TradeLeg.leg_seq).all()]
                    if not legs:
                        raise ValueError("no legs")
                    ccy = (legs[0].get("currency") or t.notional_ccy or "USD").upper()
                    for lg in legs:
                        lg.setdefault("effective_date", None); lg.setdefault("maturity_date", None)
                        lg["effective_date"] = lg["effective_date"] or str(t.effective_date); lg["maturity_date"] = lg["maturity_date"] or str(t.maturity_date)
                    if itype in O.SWAPTIONS:
                        self.items.append(self._swaption(t, legs, ccy, mkt)); self.currencies.add(ccy)
                        continue
                    scheds = [(lg, leg_schedule(lg, asof)) for lg in legs]
                    item = {"trade": t, "kind": "SWAP", "ccy": ccy, "legs": scheds, "maturity": max(s[-1][1] for _, s in scheds if s), "caplets": []}
                    for lg, sched in scheds:
                        if str(lg.get("leg_type", "")).upper() != "FLOAT" or not sched:
                            continue
                        has = (lg.get("embedded_options") or lg.get("cap_rate") is not None or lg.get("floor_rate") is not None)
                        if not has:
                            continue
                        tenor_y = max(0.25, years(sched[0][0], sched[-1][1]))
                        vol, src = O.cap_vol_bp(db, uid, tenor_y)
                        cps = O.caplets_of(lg, sched, 1.0, vol, src)
                        item["caplets"].extend(cps)
                        for c in cps:
                            self.options.append({"trade_ref": t.trade_ref, "kind": c["type"], "strike": c["K"], "vol_bp": vol, "vol_source": src, "side": "LONG" if c["sign"] > 0 else "SHORT"})
                    self.items.append(item)
                    self.currencies.add(ccy)
                elif itype in FORWARDS:
                    pair, terms = _currency_terms(t)
                    base, quote = pair[:3], pair[3:]
                    self.items.append({"trade": t, "kind": "FORWARD", "ccy": quote, "pair": pair, "base": base, "quote": quote, "terms": terms, "maturity": terms["settle"]})
                    self.pairs.add(pair); self.currencies.add(quote)
                    if base in CURVE_OF:
                        self.currencies.add(base)
                else:
                    self.skipped.append({"trade_ref": t.trade_ref, "reason": f"{itype} not simulated yet"})
            except Exception as e:          # noqa: BLE001
                self.skipped.append({"trade_ref": t.trade_ref, "reason": str(e)[:120]})
        self.max_maturity = max([it["maturity"] for it in self.items], default=asof)

    def _swaption(self, t, legs: list[dict], ccy: str, mkt) -> dict:
        """A European swaption as an item: the underlying's legs re-dated to start at expiry, struck at K."""
        terms = O.swaption_terms(t, legs, self.asof)
        expiry = terms["expiry"]
        if expiry is None:
            raise ValueError("swaption without an expiry")
        eff = min(date.fromisoformat(str(lg["effective_date"])[:10]) for lg in legs)
        shift = (expiry - eff).days if expiry > eff else 0
        under = []
        for lg in legs:
            d = dict(lg)
            e = date.fromisoformat(str(lg["effective_date"])[:10]); m = date.fromisoformat(str(lg["maturity_date"])[:10])
            d["effective_date"] = (e + timedelta(days=shift)).isoformat(); d["maturity_date"] = (m + timedelta(days=shift)).isoformat()
            if str(d.get("leg_type", "")).upper() == "FIXED":
                d["fixed_rate"] = terms["K"]; d["direction"] = "PAY" if terms["is_payer"] else "RECEIVE"
            else:
                d["direction"] = "RECEIVE" if terms["is_payer"] else "PAY"
            under.append(d)
        scheds = [(lg, leg_schedule(lg, self.asof)) for lg in under]
        fixed_sched = next((s for lg, s in scheds if str(lg.get("leg_type", "")).upper() == "FIXED"), None) or scheds[0][1]
        start = fixed_sched[0][0]; maturity = max(s[-1][1] for _, s in scheds if s)
        tenor_y = max(0.25, years(start, maturity)); expiry_y = max(1 / 12, years(self.asof, expiry))
        vol, src = O.swaption_vol_bp(mkt, ccy, expiry_y, tenor_y)
        N = max(float(lg.get("notional") or 0.0) for lg in under)
        self.options.append({"trade_ref": t.trade_ref, "kind": "PAYER SWAPTION" if terms["is_payer"] else "RECEIVER SWAPTION", "strike": terms["K"],
                             "expiry": expiry.isoformat(), "vol_bp": vol, "vol_source": src, "side": "LONG"})
        return {"trade": t, "kind": "SWAPTION", "ccy": ccy, "legs": scheds, "fixed_sched": fixed_sched, "start": start, "maturity": maturity,
                "expiry": expiry, "K": terms["K"], "is_payer": terms["is_payer"], "N": N, "vol": vol / 1e4}

    @property
    def months(self) -> int:
        m = (self.max_maturity.year - self.asof.year) * 12 + (self.max_maturity.month - self.asof.month) + 1
        return int(min(max(m, 1), 480))


def value_swap(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float]) -> np.ndarray:
    asof = paths.grid[0]; t_i = float(paths.t[i])
    key = f"RATES:{CURVE_OF.get(item['ccy'], item['ccy'] + '_OIS')}"
    v = np.zeros(paths.n_paths)
    for lg, sched in item["legs"]:
        sign = -1.0 if str(lg.get("direction", "")).upper().startswith("PAY") else 1.0
        N = float(lg.get("notional") or 0.0)
        kind = str(lg.get("leg_type", "")).upper()
        future = [(ps, pe, pay, tau) for (ps, pe, pay, tau) in sched if years(asof, pay) > t_i + 1e-9]
        if not future:
            continue
        if kind == "FIXED":
            c = float(lg.get("fixed_rate") or 0.0)
            pv = sum(N * c * tau * bond(paths, key, i, years(asof, pay)) for (_, _, pay, tau) in future)
        else:
            ps0 = future[0][0]
            p_start = bond(paths, key, i, years(asof, ps0)) if years(asof, ps0) > t_i else np.ones(paths.n_paths)
            p_end = bond(paths, key, i, years(asof, future[-1][2]))
            pv = N * (p_start - p_end)
            spread = float(lg.get("spread") or 0.0)
            if spread:
                pv = pv + sum(N * spread * tau * bond(paths, key, i, years(asof, pay)) for (_, _, pay, tau) in future)
        v = v + sign * pv
    return v * fx_to_usd.get(item["ccy"], 1.0)


def value_forward(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float], flat_base: dict[str, float]) -> np.ndarray:
    asof = paths.grid[0]; t_i = float(paths.t[i]); T = years(asof, item["maturity"])
    if T <= t_i + 1e-9:
        return np.zeros(paths.n_paths)
    terms = item["terms"]
    qkey = f"RATES:{CURVE_OF.get(item['quote'], item['quote'] + '_OIS')}"
    dfq = bond(paths, qkey, i, T)
    bkey = f"RATES:{CURVE_OF.get(item['base'])}" if item["base"] in CURVE_OF else None
    if bkey and bkey in paths.x:
        dfb = bond(paths, bkey, i, T)
    else:
        dfb = np.full(paths.n_paths, np.exp(-flat_base.get(item["pair"], 0.0) * (T - t_i)))
    S = paths.s[f"SPOT:{item['pair']}"][:, i]
    F = S * dfb / dfq
    K = terms["K"] if terms.get("K") is not None else float(F.mean())
    sign = 1.0 if str(terms.get("direction", "BUY")).upper() == "BUY" else -1.0
    return sign * terms["notional"] * (F - K) * dfq * fx_to_usd.get(item["quote"], 1.0)


def flows_per_step(ns: NettingSet, paths: Paths, fx_to_usd: dict[str, float]) -> np.ndarray:
    """Net trade flow we pay in (t_{i−1}, t_i], per grid step, as the jump it makes in our value
    (paying a coupon raises V, receiving one lowers it). Fixed coupons and float spreads: the
    flows that jump the valued V (the OIS float leg, valued as N·(P_s − P_N), does not jump at a
    reset). The exposure step uses it so a payment between grid points is margined, not smeared
    into the margin period of risk by the bridge."""
    asof = paths.grid[0]
    out = np.zeros(len(paths.grid))
    for it in ns.items:
        if it["kind"] != "SWAP":
            continue
        key = f"RATES:{CURVE_OF.get(it['ccy'], it['ccy'] + '_OIS')}"
        pf = paths.p0.get(key)
        k = fx_to_usd.get(it["ccy"], 1.0)
        for lg, sched in it["legs"]:
            pay_sign = 1.0 if str(lg.get("direction", "")).upper().startswith("PAY") else -1.0
            N = float(lg.get("notional") or 0.0)
            for (ps, pe, pay, tau) in sched:
                tp = years(asof, pay)
                if tp <= 0:
                    continue
                if str(lg.get("leg_type", "")).upper() == "FIXED":
                    amt = N * float(lg.get("fixed_rate") or 0.0) * tau
                else:
                    # the OIS float leg is valued as N·(P(t,T_s) − P(t,T_N)), which does not jump at a
                    # coupon (the reset offsets the payment); only a spread paid on it does
                    amt = N * float(lg.get("spread") or 0.0) * tau
                    if amt == 0.0:
                        continue
                for i in range(1, len(paths.t)):
                    if float(paths.t[i - 1]) < tp <= float(paths.t[i]) + 1e-9:
                        out[i] += pay_sign * amt * k
    return out


def netted_paths(ns: NettingSet, paths: Paths, fx_to_usd: dict[str, float], flat_base: dict[str, float]) -> tuple[np.ndarray, list[dict]]:
    """(paths × T+1) netted value in USD, and per-trade value today."""
    T1 = len(paths.grid)
    V = np.zeros((paths.n_paths, T1))
    today = []
    swap_at = lambda item, p, j: value_swap(item, p, j, fx_to_usd)
    for it in ns.items:
        for i in range(T1):
            if it["kind"] == "SWAP":
                v = value_swap(it, paths, i, fx_to_usd)
                if it.get("caplets"):
                    v = v + O.value_caplets(it, paths, i, fx_to_usd)
            elif it["kind"] == "SWAPTION":
                v = O.value_swaption(it, paths, i, fx_to_usd, swap_at)
            else:
                v = value_forward(it, paths, i, fx_to_usd, flat_base)
            V[:, i] += v
            if i == 0:
                today.append({"trade_ref": it["trade"].trade_ref, "kind": it["kind"], "mtm_usd": float(v.mean()), "maturity": it["maturity"].isoformat()})
    return V, today
