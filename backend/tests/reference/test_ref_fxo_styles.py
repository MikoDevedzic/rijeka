"""FX option styles against QuantLib: American, digital, single barrier, double barrier, touch.

All on one Garman–Kohlhagen process (spot 1.1650, flat continuous USD 3.85 % and EUR 2.00 %, flat vol),
settlement at expiry so QuantLib's expiry discounting and Rijeka's settlement discounting coincide:
  American       CRR tree (800 steps) against QuantLib's QdFpAmericanEngine (the accurate benchmark) and
                 its own CRR engine at the same step count (the method, not the limit)
  Digital        closed forms against AnalyticEuropeanEngine with CashOrNothingPayoff / AssetOrNothingPayoff
  Barrier        survival-density integral against AnalyticBarrierEngine (Reiner–Rubinstein), all eight
                 type × call/put cases, with and without a rebate
  Double barrier two-barrier image series against AnalyticDoubleBarrierEngine (Ikeda–Kunitomo)
  Touch          first-passage and survival forms against AnalyticBinaryBarrierEngine (paid at hit and at
                 expiry) and AnalyticDoubleBarrierBinaryEngine (double no-touch)
Values must agree to the integration's accuracy (replica); the American to the tree's convergence."""
from __future__ import annotations

import math
from datetime import date, timedelta

import QuantLib as ql

from pricing.fx_exotic import ExoticSpec, price_exotic
from tests.reference.refmarket import VAL, Row, assert_rows, qd, set_eval

N = 10_000_000.0
S0, R_Q, R_B = 1.1650, 0.0385, 0.0200
A365 = ql.Actual365Fixed()


def _process(vol: float):
    set_eval(VAL)
    spot = ql.QuoteHandle(ql.SimpleQuote(S0))
    rq = ql.YieldTermStructureHandle(ql.FlatForward(qd(VAL), R_Q, A365, ql.Continuous))
    rb = ql.YieldTermStructureHandle(ql.FlatForward(qd(VAL), R_B, A365, ql.Continuous))
    vs = ql.BlackVolTermStructureHandle(ql.BlackConstantVol(qd(VAL), ql.NullCalendar(), vol, A365))
    return ql.GarmanKohlagenProcess(spot, rb, rq, vs)


def _rijeka(spec: ExoticSpec, expiry: date, vol: float, buy=True):
    T = (expiry - VAL).days / 365.0
    return price_exotic(spec, base_notional=N, spot=S0, forward=S0 * math.exp((R_Q - R_B) * T), df_quote=math.exp(-R_Q * T), t_expiry=T, vol=vol,
                        direction="BUY" if buy else "SELL")


def american_rows() -> list[Row]:
    rows = []
    for months, call, k_off, vol in ((3, True, 0.0, 0.075), (6, False, 0.02, 0.08), (12, True, -0.03, 0.082), (12, False, 0.0, 0.09)):
        expiry = VAL + timedelta(days=int(round(months * 30.4375)))
        K = S0 + k_off
        spec = ExoticSpec("AMERICAN", "CALL" if call else "PUT", strike=K)
        r = _rijeka(spec, expiry, vol)
        opt = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if call else ql.Option.Put, K), ql.AmericanExercise(qd(VAL), qd(expiry)))
        proc = _process(vol)
        opt.setPricingEngine(ql.QdFpAmericanEngine(proc))
        case = f"American {months}M {'call' if call else 'put'} K={K:.4f}"
        rows.append(Row("FX option styles", case, "NPV vs QuantLib QD+ fixed point", r.npv, N * opt.NPV(), "bp of notional", 0.02, scale=1e4 / (N * S0),
                        kind="convention", cause="an 801-step Leisen–Reimer tree against a near-exact benchmark: tree convergence, 4e-5 of premium"))
        opt.setPricingEngine(ql.BinomialVanillaEngine(proc, "leisenreimer", 801))
        rows.append(Row("FX option styles", case, "NPV vs QuantLib Leisen–Reimer tree, 801 steps", r.npv, N * opt.NPV(), "bp of notional", 1e-5, scale=1e4 / (N * S0)))
        eur = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if call else ql.Option.Put, K), ql.EuropeanExercise(qd(expiry)))
        eur.setPricingEngine(ql.AnalyticEuropeanEngine(proc))
        assert r.npv >= N * eur.NPV() - 1e-6 * N                                   # early exercise is worth something, never less
    return rows


def digital_rows() -> list[Row]:
    rows = []
    expiry = VAL + timedelta(days=182)
    vol = 0.08
    proc = _process(vol)
    for call in (True, False):
        for K in (1.15, 1.18):
            cash = ExoticSpec("DIGITAL", "CALL" if call else "PUT", strike=K, payout=1_000_000.0, payout_currency="QUOTE")
            r = _rijeka(cash, expiry, vol)
            opt = ql.VanillaOption(ql.CashOrNothingPayoff(ql.Option.Call if call else ql.Option.Put, K, 1_000_000.0), ql.EuropeanExercise(qd(expiry)))
            opt.setPricingEngine(ql.AnalyticEuropeanEngine(proc))
            rows.append(Row("FX option styles", f"digital {'call' if call else 'put'} K={K} pays 1m USD", "NPV", r.npv, opt.NPV(), "bp of payout", 1e-6, scale=1e4 / 1e6))
            asset = ExoticSpec("DIGITAL", "CALL" if call else "PUT", strike=K, payout=1_000_000.0, payout_currency="BASE")
            r2 = _rijeka(asset, expiry, vol)
            opt2 = ql.VanillaOption(ql.AssetOrNothingPayoff(ql.Option.Call if call else ql.Option.Put, K), ql.EuropeanExercise(qd(expiry)))
            opt2.setPricingEngine(ql.AnalyticEuropeanEngine(proc))
            rows.append(Row("FX option styles", f"digital {'call' if call else 'put'} K={K} pays 1m EUR", "NPV", r2.npv, 1_000_000.0 * opt2.NPV(), "bp of payout",
                            1e-6, scale=1e4 / (1e6 * S0)))
    return rows


def barrier_rows() -> list[Row]:
    rows = []
    expiry = VAL + timedelta(days=273)
    vol = 0.085
    proc = _process(vol)
    qt = {"UP_IN": ql.Barrier.UpIn, "UP_OUT": ql.Barrier.UpOut, "DOWN_IN": ql.Barrier.DownIn, "DOWN_OUT": ql.Barrier.DownOut}
    for btype, H in (("UP_OUT", 1.25), ("UP_IN", 1.25), ("DOWN_OUT", 1.08), ("DOWN_IN", 1.08)):
        for call in (True, False):
            for K in (1.14, 1.19):
                for rebate in (0.0, 0.01):
                    spec = ExoticSpec("BARRIER", "CALL" if call else "PUT", strike=K, barrier_type=btype, barrier=H, rebate=rebate)
                    r = _rijeka(spec, expiry, vol)
                    opt = ql.BarrierOption(qt[btype], H, rebate, ql.PlainVanillaPayoff(ql.Option.Call if call else ql.Option.Put, K), ql.EuropeanExercise(qd(expiry)))
                    opt.setPricingEngine(ql.AnalyticBarrierEngine(proc))
                    rows.append(Row("FX option styles", f"{btype.lower().replace('_', '-and-')} {'call' if call else 'put'} K={K} H={H}" + (f" rebate {rebate}" if rebate else ""),
                                    "NPV vs QuantLib AnalyticBarrierEngine", r.npv, N * opt.NPV(), "bp of notional", 2e-3, scale=1e4 / (N * S0),
                                    cause="Simpson integration of the survival density against the closed form"))
    return rows


def double_barrier_rows() -> list[Row]:
    rows = []
    expiry = VAL + timedelta(days=182)
    vol = 0.09
    proc = _process(vol)
    for btype, qtype in (("KNOCK_OUT", ql.DoubleBarrier.KnockOut), ("KNOCK_IN", ql.DoubleBarrier.KnockIn)):
        for call in (True, False):
            for L, U in ((1.08, 1.25), (1.12, 1.21)):
                spec = ExoticSpec("DOUBLE_BARRIER", "CALL" if call else "PUT", strike=1.165, barrier_type=btype, lower=L, upper=U)
                r = _rijeka(spec, expiry, vol)
                opt = ql.DoubleBarrierOption(qtype, L, U, 0.0, ql.PlainVanillaPayoff(ql.Option.Call if call else ql.Option.Put, 1.165), ql.EuropeanExercise(qd(expiry)))
                opt.setPricingEngine(ql.AnalyticDoubleBarrierEngine(proc))
                rows.append(Row("FX option styles", f"double {btype.lower().replace('_', '-')} {'call' if call else 'put'} [{L}, {U}]",
                                "NPV vs QuantLib AnalyticDoubleBarrierEngine", r.npv, N * opt.NPV(), "bp of notional", 2e-3, scale=1e4 / (N * S0),
                                cause="Simpson integration of the two-barrier image density against the Ikeda–Kunitomo series"))
    return rows


def touch_rows() -> list[Row]:
    rows = []
    expiry = VAL + timedelta(days=182)
    vol = 0.085
    proc = _process(vol)
    Q = 1_000_000.0
    for H in (1.23, 1.10):
        up = H > S0
        # QuantLib prices Haug's American cash-or-nothing options: a call struck at H pays Q when spot first touches H
        # from below (paid at the hit, or at expiry per the exercise's payoffAtExpiry flag); the knock-out engine
        # pays Q at expiry if H was never touched
        payoff = ql.CashOrNothingPayoff(ql.Option.Call if up else ql.Option.Put, H, Q)
        for pay_at_hit in (True, False):
            r = _rijeka(ExoticSpec("TOUCH", payout=Q, touch_type="ONE_TOUCH", barrier=H, pay_at_hit=pay_at_hit), expiry, vol)
            opt = ql.VanillaOption(payoff, ql.AmericanExercise(qd(VAL), qd(expiry), not pay_at_hit))
            opt.setPricingEngine(ql.AnalyticDigitalAmericanEngine(proc))
            rows.append(Row("FX option styles", f"one-touch H={H} pays 1m USD {'at hit' if pay_at_hit else 'at expiry'}", "NPV vs QuantLib AnalyticDigitalAmericanEngine",
                            r.npv, opt.NPV(), "bp of payout", 2e-3, scale=1e4 / Q))
        nt = _rijeka(ExoticSpec("TOUCH", payout=Q, touch_type="NO_TOUCH", barrier=H), expiry, vol)
        opt2 = ql.VanillaOption(payoff, ql.AmericanExercise(qd(VAL), qd(expiry), True))
        opt2.setPricingEngine(ql.AnalyticDigitalAmericanKOEngine(proc))
        rows.append(Row("FX option styles", f"no-touch H={H} pays 1m USD at expiry", "NPV vs QuantLib AnalyticDigitalAmericanKOEngine", nt.npv, opt2.NPV(),
                        "bp of payout", 2e-3, scale=1e4 / Q))
        ot = _rijeka(ExoticSpec("TOUCH", payout=Q, touch_type="ONE_TOUCH", barrier=H), expiry, vol)
        T = (expiry - VAL).days / 365.0
        rows.append(Row("FX option styles", f"no-touch + one-touch at expiry, H={H}", "= payout × DF", nt.npv + ot.npv, Q * math.exp(-R_Q * T), "bp of payout", 1e-6, scale=1e4 / Q))
    for L, U in ((1.10, 1.23), (1.13, 1.20)):
        dnt = _rijeka(ExoticSpec("TOUCH", payout=Q, touch_type="DOUBLE_NO_TOUCH", lower=L, upper=U), expiry, vol)
        opt = ql.DoubleBarrierOption(ql.DoubleBarrier.KnockOut, L, U, 0.0, ql.CashOrNothingPayoff(ql.Option.Call, 0.0, Q), ql.EuropeanExercise(qd(expiry)))
        opt.setPricingEngine(ql.AnalyticDoubleBarrierBinaryEngine(proc))
        rows.append(Row("FX option styles", f"double no-touch [{L}, {U}] pays 1m USD", "NPV vs QuantLib AnalyticDoubleBarrierBinaryEngine", dnt.npv, opt.NPV(),
                        "bp of payout", 2e-3, scale=1e4 / Q))
        dot = _rijeka(ExoticSpec("TOUCH", payout=Q, touch_type="DOUBLE_ONE_TOUCH", lower=L, upper=U), expiry, vol)
        T = (expiry - VAL).days / 365.0
        rows.append(Row("FX option styles", f"double one-touch + double no-touch [{L}, {U}]", "= payout × DF", dnt.npv + dot.npv, Q * math.exp(-R_Q * T), "bp of payout", 1e-6, scale=1e4 / Q))
    return rows


# ── a digital asset: the same engines at crypto parameters ─────────────────
C_S0, C_R_B, C_VOL, C_N = 65_000.0, 0.03, 0.60, 10.0        # BTC/USD spot, funding rate as the base rate, vol, 10 BTC


def _crypto_process(vol: float):
    set_eval(VAL)
    spot = ql.QuoteHandle(ql.SimpleQuote(C_S0))
    rq = ql.YieldTermStructureHandle(ql.FlatForward(qd(VAL), R_Q, A365, ql.Continuous))
    rb = ql.YieldTermStructureHandle(ql.FlatForward(qd(VAL), C_R_B, A365, ql.Continuous))
    vs = ql.BlackVolTermStructureHandle(ql.BlackConstantVol(qd(VAL), ql.NullCalendar(), vol, A365))
    return ql.GarmanKohlagenProcess(spot, rb, rq, vs)


def crypto_rows() -> list[Row]:
    """BTC options through the FX engines: Black-76 with the funding rate as the carry (the digital-asset option is
    the FX option with its base rate renamed), a cash digital, an up-and-out call, a one-touch, a double no-touch."""
    rows = []
    expiry = VAL + timedelta(days=91)
    T = (expiry - VAL).days / 365.0
    F = C_S0 * math.exp((R_Q - C_R_B) * T)
    kw = dict(base_notional=C_N, spot=C_S0, forward=F, df_quote=math.exp(-R_Q * T), t_expiry=T, vol=C_VOL, direction="BUY")
    proc = _crypto_process(C_VOL)
    scale_n = 1e4 / (C_N * C_S0)
    for call, K in ((True, F), (False, 60_000.0)):
        r = price_exotic(ExoticSpec("EUROPEAN", "CALL" if call else "PUT", strike=K), **kw)
        opt = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if call else ql.Option.Put, K), ql.EuropeanExercise(qd(expiry)))
        opt.setPricingEngine(ql.AnalyticEuropeanEngine(proc))
        rows.append(Row("Crypto option", f"BTC 3M {'call' if call else 'put'} K={K:,.0f} (funding 3%, vol 60%)", "NPV (USD) vs Black-76 on the carry forward", r.npv, C_N * opt.NPV(), "bp of notional", 1e-6, scale=scale_n))
    r = price_exotic(ExoticSpec("DIGITAL", "CALL", strike=F, payout=100_000.0), **kw)
    opt = ql.VanillaOption(ql.CashOrNothingPayoff(ql.Option.Call, F, 100_000.0), ql.EuropeanExercise(qd(expiry)))
    opt.setPricingEngine(ql.AnalyticEuropeanEngine(proc))
    rows.append(Row("Crypto option", "BTC 3M cash digital call, pays USD 100k", "NPV vs QuantLib cash-or-nothing", r.npv, opt.NPV(), "bp of payout", 1e-6, scale=1e4 / 100_000.0))
    H = 80_000.0
    r = price_exotic(ExoticSpec("BARRIER", "CALL", strike=F, barrier_type="UP_OUT", barrier=H, rebate=100.0), **kw)
    opt = ql.BarrierOption(ql.Barrier.UpOut, H, 100.0, ql.PlainVanillaPayoff(ql.Option.Call, F), ql.EuropeanExercise(qd(expiry)))
    opt.setPricingEngine(ql.AnalyticBarrierEngine(proc))
    rows.append(Row("Crypto option", "BTC 3M up-and-out call at 80k, rebate USD 100 per BTC", "NPV vs QuantLib Reiner–Rubinstein", r.npv, C_N * opt.NPV(), "bp of notional", 2e-3, scale=scale_n))
    r = price_exotic(ExoticSpec("TOUCH", strike=None, payout=100_000.0, touch_type="ONE_TOUCH", barrier=H, pay_at_hit=True), **kw)
    opt = ql.VanillaOption(ql.CashOrNothingPayoff(ql.Option.Call, H, 100_000.0), ql.AmericanExercise(qd(VAL), qd(expiry), False))
    opt.setPricingEngine(ql.AnalyticDigitalAmericanEngine(proc))
    rows.append(Row("Crypto option", "BTC 3M one-touch at 80k, paid at the hit", "NPV vs QuantLib digital American", r.npv, opt.NPV(), "bp of payout", 2e-3, scale=1e4 / 100_000.0))
    r = price_exotic(ExoticSpec("TOUCH", strike=None, payout=100_000.0, touch_type="DOUBLE_NO_TOUCH", lower=55_000.0, upper=80_000.0), **kw)
    opt = ql.DoubleBarrierOption(ql.DoubleBarrier.KnockOut, 55_000.0, 80_000.0, 0.0, ql.CashOrNothingPayoff(ql.Option.Call, 0.0, 100_000.0), ql.EuropeanExercise(qd(expiry)))
    opt.setPricingEngine(ql.AnalyticDoubleBarrierBinaryEngine(proc))
    rows.append(Row("Crypto option", "BTC 3M double no-touch 55k–80k", "NPV vs QuantLib double-barrier binary", r.npv, opt.NPV(), "bp of payout", 2e-3, scale=1e4 / 100_000.0))
    return rows


def test_crypto_options_through_the_fx_engines():
    assert_rows(crypto_rows())


def all_rows() -> list[Row]:
    return american_rows() + digital_rows() + barrier_rows() + double_barrier_rows() + touch_rows() + crypto_rows()


def test_american_against_quantlib():
    assert_rows(american_rows())


def test_digitals_against_quantlib():
    assert_rows(digital_rows())


def test_barriers_against_quantlib():
    assert_rows(barrier_rows())


def test_double_barriers_against_quantlib():
    assert_rows(double_barrier_rows())


def test_touch_options_against_quantlib():
    assert_rows(touch_rows())
