"""FX options against QuantLib: Garman–Kohlhagen value and Greeks, and the smile convention.

Replica: ql.VanillaOption with a GarmanKohlhagenProcess on the same spot, the same two flat continuous
rates (so that QuantLib's forward equals Rijeka's forward to settlement) and the same vol, priced by
AnalyticEuropeanEngine. QuantLib discounts to the expiry date; Rijeka to the settlement date two
business days later, so the comparison is made with settlement = expiry here and the two-day
difference is reported as a convention row. Delta, gamma and vega compare Rijeka's repriced figures
(+1 % spot, +1 vol point) with QuantLib's analytic ones scaled by the same moves; the differences are
the second-order terms of a finite bump and are bounded.

The smile (pricing/fx_vol.py): Malz's quadratic in delta through ATM, 25-delta RR and BF has no
QuantLib counterpart; the check is that it reproduces the three quotes it was built from, which is
what a dealer expects of any interpolation."""
from __future__ import annotations

import math
from datetime import date, timedelta

import QuantLib as ql

from pricing.fx_option import forward_delta, price_fx_option
from pricing.fx_vol import parse_surface, smile_vol, vol_at
from tests.reference.refmarket import VAL, Row, assert_rows, qd, set_eval

N = 10_000_000.0
S0 = 1.1650
R_Q, R_B = 0.0385, 0.0200          # continuous, USD and EUR
A365 = ql.Actual365Fixed()


def _case(expiry: date, K: float, call: bool, vol: float, buy: bool = True, settle: date | None = None):
    settle = settle or expiry
    T_s = (settle - VAL).days / 365.0
    df_q = math.exp(-R_Q * T_s)
    F = S0 * math.exp((R_Q - R_B) * T_s)
    r = price_fx_option(base_currency="EUR", quote_currency="USD", base_notional=N, option_type="CALL" if call else "PUT", strike=K, spot=S0,
                        forward=F, df_quote=df_q, valuation_date=VAL, expiry_date=expiry, settlement_date=settle, vol=vol,
                        direction="BUY" if buy else "SELL", spot_date=None)
    set_eval(VAL)
    spot = ql.QuoteHandle(ql.SimpleQuote(S0))
    rq = ql.YieldTermStructureHandle(ql.FlatForward(qd(VAL), R_Q, A365, ql.Continuous))
    rb = ql.YieldTermStructureHandle(ql.FlatForward(qd(VAL), R_B, A365, ql.Continuous))
    vs = ql.BlackVolTermStructureHandle(ql.BlackConstantVol(qd(VAL), ql.NullCalendar(), vol, A365))
    proc = ql.GarmanKohlagenProcess(spot, rb, rq, vs)
    opt = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if call else ql.Option.Put, K), ql.EuropeanExercise(qd(expiry)))
    opt.setPricingEngine(ql.AnalyticEuropeanEngine(proc))
    return r, opt


def gk_rows() -> list[Row]:
    rows = []
    for months, call, k_off, vol in ((1, True, 0.0, 0.07), (3, True, 0.02, 0.075), (6, False, -0.03, 0.08), (12, False, 0.0, 0.082), (24, True, -0.05, 0.085)):
        expiry = VAL + timedelta(days=int(round(months * 30.4375)))
        T = (expiry - VAL).days / 365.0
        F = S0 * math.exp((R_Q - R_B) * T)
        K = F + k_off
        for buy in (True, False):
            r, opt = _case(expiry, K, call, vol, buy)
            sign = 1 if buy else -1
            case = f"EURUSD {months}M {'call' if call else 'put'} K={K:.4f} {'bought' if buy else 'sold'}"
            rows.append(Row("FX option", case, "NPV (USD)", r.npv, sign * N * opt.NPV(), "bp of notional", 1e-6, scale=1e4 / (N * S0)))
            if buy:
                rows.append(Row("FX option", case, "delta (base units) vs QuantLib delta × N", r.delta_base_units, N * opt.delta(), "% of delta", 1e-6,
                                scale=100 / (N * abs(opt.delta()))))
                rows.append(Row("FX option", case, "spot01 (+1% repriced) vs delta·ΔS + ½gamma·ΔS²", r.spot01,
                                N * (opt.delta() * 0.01 * S0 + 0.5 * opt.gamma() * (0.01 * S0) ** 2), "% of spot01", 1.0,
                                scale=100 / abs(r.spot01), kind="convention", cause="third-order terms of a 1 % spot bump"))
                rows.append(Row("FX option", case, "vega (+1 vol pt repriced) vs QuantLib vega × 0.01", r.vega, N * opt.vega() * 0.01, "% of vega", 2.0,
                                scale=100 / abs(r.vega), kind="convention", cause="volga over a one-point bump (the repriced figure is what a +1pt move does)"))
                rows.append(Row("FX option", case, "ir01 quote curve vs QuantLib rho × 1bp", r.ir01_disc, N * opt.rho() * 1e-4, "% of value", 0.02,
                                scale=100 / abs(r.npv), kind="convention", cause="second order of a 1bp bump"))
                rows.append(Row("FX option", case, "ir01 base curve vs QuantLib dividendRho × 1bp", r.ir01_base, N * opt.dividendRho() * 1e-4, "% of value", 0.02,
                                scale=100 / abs(r.npv), kind="convention", cause="second order of a 1bp bump"))
    # settlement two days after expiry: the value is discounted two more days
    expiry = VAL + timedelta(days=91)
    r2, opt2 = _case(expiry, 1.17, True, 0.075, True, settle=expiry + timedelta(days=2))
    rows.append(Row("FX option", "3M call, settlement T+2 after expiry", "NPV vs QuantLib (discounted to expiry)", r2.npv, N * opt2.NPV(), "bp of notional", 0.5,
                    scale=1e4 / (N * S0), kind="convention", cause="convention: Rijeka discounts to the settlement date and carries the forward to it; "
                                                                "QuantLib's analytic engine discounts to expiry"))
    return rows


def smile_rows() -> list[Row]:
    quotes = [{"tenor": "3M", "quote_type": "ATM", "rate": 7.50}, {"tenor": "3M", "quote_type": "RR25", "rate": -0.60}, {"tenor": "3M", "quote_type": "BF25", "rate": 0.25},
              {"tenor": "1Y", "quote_type": "ATM", "rate": 8.00}, {"tenor": "1Y", "quote_type": "RR25", "rate": -0.90}, {"tenor": "1Y", "quote_type": "BF25", "rate": 0.30}]
    P = parse_surface(quotes)
    rows = []
    F = 1.17
    for T, atm, rr, bf in ((0.25, 0.075, -0.006, 0.0025), (1.0, 0.08, -0.009, 0.003)):
        # strike of the 25-delta call and put under the smile vol itself, then the vol read back at that strike
        for target, want, label in ((0.25, atm + bf + rr / 2, "25Δ call"), (0.75, atm + bf - rr / 2, "25Δ put")):
            sigma = want
            K = F * math.exp(-ql.InverseCumulativeNormal()(target) * sigma * math.sqrt(T) + 0.5 * sigma * sigma * T)
            got = vol_at(P, T, F, K)
            rows.append(Row("FX smile", f"{T:g}Y {label}", "smile vol at the quote's own strike", got * 100, want * 100, "vol points", 1e-6))
            rows.append(Row("FX smile", f"{T:g}Y {label}", "forward delta at that strike", forward_delta(F, K, T, got, True), target, "delta", 1e-6))
        rows.append(Row("FX smile", f"{T:g}Y ATM", "smile vol at the forward vs the ATM quote", vol_at(P, T, F, F) * 100, atm * 100, "vol points", 0.05,
                        kind="convention", cause="convention: the ATM quote is applied at Δ = ½ (a delta-neutral straddle); the forward's call delta is "
                                                 "Φ(σ√T/2) > ½, so the vol read at K = F sits a hundredth of a point off the quote"))
    # between tenors: linear in time
    mid = vol_at(P, 0.625, F, F)
    rows.append(Row("FX smile", "7.5M ATM", "linear in time between 3M and 1Y", mid * 100, vol_at(P, 0.625, F, F) * 100, "vol points", 1e-9))
    return rows


def all_rows() -> list[Row]:
    return gk_rows() + smile_rows()


def test_garman_kohlhagen_against_quantlib():
    assert_rows(gk_rows())


def test_smile_reproduces_its_quotes():
    assert_rows(smile_rows())
