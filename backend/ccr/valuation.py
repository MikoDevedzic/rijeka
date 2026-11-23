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
from functools import partial
from decimal import Decimal
from typing import Optional

import numpy as np

from ccr import options as O
from ccr.calibration import CURVE_OF
from ccr.simulate import Paths, bond, growth
from pnl.valuation import _currency_terms

log = logging.getLogger("rijeka.ccr")
SWAPS = ("IR_SWAP", "OIS", "OIS_SWAP", "BASIS_SWAP")
FORWARDS = ("FX_SPOT", "FX_FORWARD", "NDF", "CRYPTO_FORWARD")
FX_OPTIONS = ("FX_OPTION", "CRYPTO_OPTION")      # one model: the digital asset's funding rate is its base rate


def years(asof: date, d: date) -> float:
    return (d - asof).days / 365.25


def leg_schedule(leg: dict, asof: date):
    """[(start, end, pay, τ)] from the pricer's leg dict, using the production schedule generator."""
    from pricing.schedule import generate_schedule
    from pricing.calendars import leg_calendar
    eff = date.fromisoformat(str(leg["effective_date"])[:10]); mat = date.fromisoformat(str(leg["maturity_date"])[:10])
    freq = leg.get("payment_frequency") or ("ANNUAL" if str(leg.get("leg_type", "")).upper() == "FIXED" else "QUARTERLY")
    periods = generate_schedule(eff, mat, freq, leg.get("day_count") or "ACT/360", Decimal(str(leg.get("notional") or 0)),
                                bdc=leg.get("bdc") or "MOD_FOLLOWING", payment_lag=int(leg.get("payment_lag") or 0),
                                stub_type=leg.get("stub_type") or "SHORT_FRONT", is_float=str(leg.get("leg_type", "")).upper() == "FLOAT",
                                calendar=leg_calendar(leg))
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
                if itype in SWAPS or itype in O.SWAPTIONS or itype in O.CAPS:
                    # a hypothetical trade (the ticket's incremental XVA) carries its legs; a stored one has them in the table
                    own = getattr(t, "_legs", None)
                    legs = [dict(l) for l in own] if own is not None else \
                        [_leg_to_dict(l) for l in db.query(TradeLeg).filter(TradeLeg.trade_id == t.id).order_by(TradeLeg.leg_seq).all()]
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
                        # The market's vol for each strip is the one its ticket prices at (the surface at the strike and
                        # the remaining life), reported beside the vol the paths' model implies; the strip is valued on
                        # the paths at the model's own variance (ccr/options.py value_caplets), not at either.
                        # (Here: the at-the-money vol of the nearest quoted maturity, a label for the set's report. A
                        # ticket's own run sets the strike's vol as its price reads it: api/routes/xva.py _trade_paths.)
                        tenor_y = max(0.25, years(sched[0][0], sched[-1][1]))
                        vol, src = O.cap_vol_bp(db, uid, tenor_y)
                        cps = O.caplets_of(lg, sched, 1.0, vol, src)
                        for c in cps:
                            opt = {"trade_ref": t.trade_ref, "kind": c["type"], "strike": c["K"], "vol_bp": vol, "vol_source": src, "side": "LONG" if c["sign"] > 0 else "SHORT"}
                            c["_reported"] = opt
                            self.options.append(opt)
                        item["caplets"].extend(cps)
                    self.items.append(item)
                    self.currencies.add(ccy)
                elif itype in FORWARDS:
                    pair, terms = _currency_terms(t)
                    base, quote = pair[:3], pair[3:]
                    self.items.append({"trade": t, "kind": "FORWARD", "ccy": quote, "pair": pair, "base": base, "quote": quote, "terms": terms, "maturity": terms["settle"]})
                    self.pairs.add(pair); self.currencies.add(quote)
                    if base in CURVE_OF:
                        self.currencies.add(base)
                elif itype in FX_OPTIONS:
                    self.items.append(self._fx_option(t, mkt)); self.pairs.add(self.items[-1]["pair"]); self.currencies.add(self.items[-1]["quote"])
                    if self.items[-1]["base"] in CURVE_OF:
                        self.currencies.add(self.items[-1]["base"])
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
                             "expiry": expiry.isoformat(), "vol_bp": vol, "vol_source": src, "side": "LONG" if terms["sign"] > 0 else "SHORT"})
        return {"trade": t, "kind": "SWAPTION", "ccy": ccy, "legs": scheds, "fixed_sched": fixed_sched, "start": start, "maturity": maturity,
                "expiry": expiry, "K": terms["K"], "is_payer": terms["is_payer"], "N": N, "vol": vol / 1e4, "sign": terms["sign"]}

    def _fx_option(self, t, mkt) -> dict:
        """A European FX option as an item: the strike, expiry and settlement from the terms, the vol from the
        day's {PAIR}_VOL surface at the option's own expiry and strike (desk default when there is none)."""
        from api.routes.currencies import spec_from
        from pricing.fx_vol import lookup_vol
        pair, terms = _currency_terms(t)
        base, quote = pair[:3], pair[3:]
        S = mkt.spot(pair) if mkt is not None else None
        T_e = max(years(self.asof, terms["expiry"]), 1 / 365)
        spec = spec_from(terms.get("style_fields") or {}, terms["option_type"], terms["K"])
        if spec.strike is None and spec.style != "TOUCH":
            spec.strike = S or 1.0
        K = spec.strike if spec.strike is not None else (S or 1.0)
        F = S or K                                                  # the smile is read at the strike against today's level
        vol, tier, note = lookup_vol(mkt.quotes(f"{pair}_VOL") if mkt is not None else None, pair, T_e, F, K, None)
        sign = 1.0 if str(terms.get("direction", "BUY")).upper() == "BUY" else -1.0
        cls = "CRYPTO" if str(t.instrument_type or "").upper() == "CRYPTO_OPTION" else "FX"
        label = f"{cls} {spec.option_type} {pair}" if spec.style in ("EUROPEAN", "AMERICAN") else f"{cls} {spec.style.replace('_', ' ')} {pair}"
        if spec.style == "AMERICAN":
            label = f"{cls} AMERICAN {spec.option_type} {pair}"
        detail = (f"{spec.barrier_type} at {spec.barrier:g}" if spec.style == "BARRIER" else f"{spec.barrier_type} [{spec.lower:g}, {spec.upper:g}]" if spec.style == "DOUBLE_BARRIER"
                  else f"{spec.touch_type} {'at ' + format(spec.barrier, 'g') if spec.barrier else '[' + format(spec.lower, 'g') + ', ' + format(spec.upper, 'g') + ']'}, pays {spec.payout:g} {quote if spec.payout_currency == 'QUOTE' else base}" if spec.style == "TOUCH"
                  else f"pays {spec.payout:g} {quote if spec.payout_currency == 'QUOTE' else base}" if spec.style == "DIGITAL" else "")
        self.options.append({"trade_ref": t.trade_ref, "kind": label, "strike": K, "strike_text": (f"{K:g} {quote} per {base}" if spec.style != "TOUCH" else "—") + (f" · {detail}" if detail else ""),
                             "expiry": terms["expiry"].isoformat(), "vol_bp": vol * 1e4, "vol_pct": round(vol * 100, 3), "vol_source": f"{tier}: {note}",
                             "side": "LONG" if sign > 0 else "SHORT"})
        from pricing.fx_vol import parse_surface
        pillars = parse_surface(mkt.quotes(f"{pair}_VOL")) if mkt is not None else None
        return {"trade": t, "kind": "FX_OPTION", "ccy": quote, "pair": pair, "base": base, "quote": quote, "terms": terms, "K": K, "spec": spec,
                "option_type": spec.option_type, "expiry": terms["expiry"], "settle": terms["settle"], "N": terms["notional"], "vol": vol,
                "sign": sign, "maturity": terms["settle"], "pillars": pillars or None}

    @property
    def months(self) -> int:
        m = (self.max_maturity.year - self.asof.year) * 12 + (self.max_maturity.month - self.asof.month) + 1
        return int(min(max(m, 1), 480))


def _bond_once(seen: dict, paths: Paths, key: str, i: int, T: float) -> np.ndarray:
    if T not in seen:
        seen[T] = bond(paths, key, i, T)
    return seen[T]


_grid_bond, _grid_bond_once = bond, _bond_once


def value_swap(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float], at: Optional[float] = None) -> np.ndarray:
    """The swap's value on every path at grid date i; or, with `at` (years from as-of), at that time inside a
    step, from the state the path passed through there (ccr.simulate.rate_between): what a swaption's holder
    looks at on the expiry when the expiry is not a grid date."""
    asof = paths.grid[0]; t_i = float(paths.t[i])
    key = f"RATES:{CURVE_OF.get(item['ccy'], item['ccy'] + '_OIS')}"
    if at is not None:
        from ccr.simulate import bond_at, rate_between
        t_i = float(at)
        x_at = rate_between(paths, key, t_i)
        bond = lambda _p, _k, _i, T: bond_at(paths, key, t_i, x_at, T)             # noqa: E731  this call's bonds, from that state
        _bond_once = lambda seen, _p, _k, _i, T: seen[T] if T in seen else seen.setdefault(T, bond_at(paths, key, t_i, x_at, T))   # noqa: E731
    else:
        bond, _bond_once = _grid_bond, _grid_bond_once
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
            # The floating coupons not yet paid (0.51.0), each on its own dates. A period [s, e] paid at p pays
            # N·(growth of one unit over [s, e] − 1):
            #   ended, waiting for its payment date   its amount is known on the path: N·(G(s, e) − 1)·P(t, p)
            #   running                               N·(G(s, t) / P(t, e) − 1)·P(t, p)
            #   not begun                             N·(P(t, s) / P(t, e) − 1)·P(t, p)
            # With p = e the last two are N·(G(s, t) − P(t, e)) and N·(P(t, s) − P(t, e)): the old telescoped form.
            # Until 0.51.0 the whole leg was N·(P(t, start) − P(t, last PAYMENT date)) with the start read as today
            # once the period had begun: the interest accrued since its start was left out, so a swap whose two
            # legs pay on the same dates showed the fixed coupon building up with nothing against it, a whole
            # coupon before each payment (found reconciling the XVA runs, 17 November 2026); and the last payment
            # date in place of the last period end overvalued a leg with a two-day lag by about N·(1 − e^(−r·lag)), 2,319
            # on 10M (the model validator and the independent reviewer, the same day).
            lev = 1.0 if lg.get("leverage") is None else float(lg.get("leverage"))
            spread = float(lg.get("spread") or 0.0)
            pv = np.zeros(paths.n_paths)
            seen: dict[float, np.ndarray] = {}                # one period's end is the next one's start: priced once
            P = partial(_bond_once, seen, paths, key, i)
            for (ps, pe, pay, _tau) in future:
                ts, te, tp = years(asof, ps), years(asof, pe), years(asof, pay)
                if te <= t_i + 1e-9:
                    pv = pv + lev * N * (growth(paths, key, ts, te) - 1.0) * P(tp)
                    continue
                grown = growth(paths, key, ts, t_i) if ts <= t_i + 1e-9 else P(ts)
                pv = pv + lev * N * ((grown - P(te)) if tp == te else (grown / P(te) - 1.0) * P(tp))
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
    """Net trade flow we pay in (t_{i−1}, t_i] on each path, shape (paths, T+1), as the jump it makes in our value
    (paying a coupon raises V, receiving one lowers it). Fixed coupons, float spreads and, since 0.51.0, the
    floating coupon itself: a period carries its accrued interest in V until it is paid, so V jumps at the payment.
    The floating amount is the path's own, N·(growth over the period − 1), as value_swap has it. (One number per
    step from today's curve nets to almost nothing against the fixed coupon and left the margined exposure about
    5 % high on average and 25 to 45 % at payment dates: the model validator, 17 November 2026.) The exposure step
    uses it so a payment between grid points is margined, not smeared into the margin period of risk by the bridge."""
    asof = paths.grid[0]
    out = np.zeros((paths.n_paths, len(paths.grid)))
    for it in ns.items:
        if it["kind"] not in ("SWAP", "SWAPTION"):
            continue
        k = fx_to_usd.get(it["ccy"], 1.0)
        key = f"RATES:{CURVE_OF.get(it['ccy'], it['ccy'] + '_OIS')}"
        # A swaption pays its swap's coupons on the paths where it was exercised (physical settlement), from our
        # side of the option: the same payments, times the exercise on the path and the option's sign. (Until
        # 0.52.0 a swaption had no flows here, so a margined run drew the exercised swap's coupons as market moves,
        # the error 0.51.0 mended for a swap: the model validator, 17 November 2026.)
        weight = 1.0
        if it["kind"] == "SWAPTION":
            t_exp = years(asof, it["expiry"])
            i_exp = min((j for j in range(len(paths.t)) if float(paths.t[j]) >= t_exp - 1e-9), default=None)
            if i_exp is None:
                continue
            mask = O.exercised(it, paths, lambda item, p, j: value_swap(item, p, j, fx_to_usd))
            weight = float(it.get("sign", 1.0)) * mask.astype(float)
        for lg, sched in it["legs"]:
            pay_sign = 1.0 if str(lg.get("direction", "")).upper().startswith("PAY") else -1.0
            N = float(lg.get("notional") or 0.0)
            fixed = str(lg.get("leg_type", "")).upper() == "FIXED"
            lev = 1.0 if lg.get("leverage") is None else float(lg.get("leverage"))
            for (ps, pe, pay, tau) in sched:
                tp = years(asof, pay)
                if tp <= 0:
                    continue
                step = next((i for i in range(1, len(paths.t)) if float(paths.t[i - 1]) < tp <= float(paths.t[i]) + 1e-9), None)
                if step is None:
                    continue
                if fixed:
                    amt = N * float(lg.get("fixed_rate") or 0.0) * tau
                else:
                    amt = lev * N * (growth(paths, key, years(asof, ps), years(asof, pe)) - 1.0) + N * float(lg.get("spread") or 0.0) * tau
                out[:, step] += pay_sign * amt * k * weight
        # what the leg's caps and floors pay, on the path (a cap, a floor, a collar; a capped leg of a swap)
        if it["kind"] == "SWAP" and it.get("caplets"):
            out += O.caplet_flows(it, paths, fx_to_usd)
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
            elif it["kind"] == "FX_OPTION":
                v = O.value_fx_option(it, paths, i, fx_to_usd, flat_base)
            else:
                v = value_forward(it, paths, i, fx_to_usd, flat_base)
            V[:, i] += v
            if i == 0:
                # a cap, a floor and a collar are valued as their leg is (kind SWAP) and named as what they are
                itype = str(getattr(it["trade"], "instrument_type", "") or "").upper()
                named = {"IR_CAP": "CAP", "INTEREST_RATE_CAP": "CAP", "IR_FLOOR": "FLOOR", "INTEREST_RATE_FLOOR": "FLOOR", "IR_COLLAR": "COLLAR", "INTEREST_RATE_COLLAR": "COLLAR"}.get(itype, it["kind"])
                today.append({"trade_ref": it["trade"].trade_ref, "kind": named, "mtm_usd": float(v.mean()), "maturity": it["maturity"].isoformat()})
    return V, today
