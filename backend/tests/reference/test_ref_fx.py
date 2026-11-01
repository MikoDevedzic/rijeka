"""Currency and digital-asset forwards against QuantLib's FxForward and DiscountingFxForwardEngine.

Rijeka (pricing/currency_forward.py, and crypto_forward.py on top of it) values a forward on
BASE/QUOTE by covered interest parity from the valuation date: F = S·DF_b(T)/DF_q(T),
NPV = dir·N·(F − K)·DF_q(T), in the quote currency. QuantLib's FxForward with zero settlement days
is the same contract; its NPV in the target currency must agree, and so must the forward, the
+1 % spot delta and the +1bp curve sensitivities (both sides bump the continuously compounded
ACT/365F zero rate).

A digital asset has no currency in QuantLib; a placeholder currency on a flat curve at the funding
rate is exactly the model Rijeka states (DF_A = exp(−r_A·T)).

Spot date: a quoted FX spot settles T+2 business days in both currencies, so the forward carries
from there: F = S·[DF_b(T)/DF_b(spot)]/[DF_q(T)/DF_q(spot)]. Rijeka is given the spot date
(api/routes/currencies.spot_date with the pair) and must match QuantLib with two settlement days
on the joint calendar. Before 2026-11 Rijeka applied the spot quote from the valuation date, which
dropped the carry over the spot lag: up to 3.7bp of notional (5.6 pips on 6M USDJPY from a Friday);
the 'no spot date' rows keep that difference visible."""
from __future__ import annotations

from datetime import date

import QuantLib as ql

from pricing.crypto_forward import price_crypto_forward
from pricing.currency_forward import price_currency_forward
from pricing.curve import Curve
from tests.reference.refmarket import VAL, Row, assert_rows, pd_, qd, replica_handle, rijeka_curve, set_eval

A365 = ql.Actual365Fixed()


def _flat(rate: float):
    return Curve(VAL, flat_rate=rate), ql.YieldTermStructureHandle(ql.FlatForward(qd(VAL), rate, A365, ql.Continuous))


def _spread(h, bp: float):
    return ql.YieldTermStructureHandle(ql.ZeroSpreadedTermStructure(h, ql.QuoteHandle(ql.SimpleQuote(bp * 1e-4)), ql.Continuous,
                                                                     ql.NoFrequency, A365))


def _ql_npv(N, base_ccy, quote_ccy, K, mat, buy, base_h, quote_h, S, settle_days=0, cal=ql.NullCalendar()):
    fx = ql.FxForward(N, base_ccy, quote_ccy, K, qd(mat), not buy, settle_days, cal)
    fx.setPricingEngine(ql.DiscountingFxForwardEngine(base_h, quote_h, ql.QuoteHandle(ql.SimpleQuote(S))))
    return fx


# name, base ccy, quote ccy, N (base units), S, K, settlement, BUY?, base: ('curve', rate) | ('usd',), quote: ('usd',) | ('curve', rate)
CASES = [
    ("EURUSD 1Y buy EUR", ql.EURCurrency(), ql.USDCurrency(), 10e6, 1.1650, 1.1800, date(2027, 11, 3), True, ("flat", 0.0200), ("usd",)),
    ("USDJPY 6M sell USD", ql.USDCurrency(), ql.JPYCurrency(), 10e6, 152.40, 150.10, date(2027, 5, 4), False, ("usd",), ("flat", 0.0050)),
    ("GBPUSD 2Y buy GBP", ql.GBPCurrency(), ql.USDCurrency(), 5e6, 1.3000, 1.2950, date(2028, 11, 3), True, ("flat", 0.0375), ("usd",)),
]
CRYPTO = [
    ("BTC 3M NDF buy, funding 3.0%", 25.0, 108_000.0, 109_500.0, date(2027, 1, 29), True, 0.030),
    ("ETH 6M NDF sell, funding 2.5%", 400.0, 3_900.0, 3_975.0, date(2027, 4, 30), False, 0.025),
    ("SOL 1Y NDF buy, staking 6.5%", 20_000.0, 185.0, 178.0, date(2027, 10, 29), True, 0.065),
]


FEDCAL = ql.UnitedStates(ql.UnitedStates.FederalReserve)
JOINT = {("EUR", "USD"): ql.JointCalendar(ql.TARGET(), FEDCAL), ("USD", "JPY"): ql.JointCalendar(FEDCAL, ql.Japan()),
         ("GBP", "USD"): ql.JointCalendar(ql.UnitedKingdom(), FEDCAL)}


def _side(spec):
    if spec[0] == "usd":
        c = rijeka_curve()
        return c, replica_handle(c)
    return _flat(spec[1])


def fx_rows() -> list[Row]:
    set_eval(VAL)
    rows = []
    for name, bccy, qccy, N, S, K, mat, buy, bspec, qspec in CASES:
        (bc, bh), (qc, qh) = _side(bspec), _side(qspec)
        r = price_currency_forward(base_currency=bccy.code(), quote_currency=qccy.code(), base_notional=N, forward_rate=K, spot=S,
                                   valuation_date=VAL, settlement_date=mat, quote_curve=qc, base_curve=bc, direction="BUY" if buy else "SELL")
        fx = _ql_npv(N, bccy, qccy, K, mat, buy, bh, qh, S)
        notional_q = N * S
        rows.append(Row("FX forward", name, "forward rate", r.forward, fx.fairForwardRate(), "pips", 1e-6, scale=1e4 if S < 20 else 100))
        rows.append(Row("FX forward", name, "NPV (quote ccy)", r.npv, fx.npvTargetCurrency(), "bp of notional", 1e-6, scale=1e4 / notional_q))
        up = _ql_npv(N, bccy, qccy, K, mat, buy, bh, qh, S * 1.01).npvTargetCurrency() - fx.npvTargetCurrency()
        rows.append(Row("FX forward", name, "spot01 (+1% spot)", r.spot01, up, "% of value", 1e-6, scale=100 / abs(up)))
        dq = _ql_npv(N, bccy, qccy, K, mat, buy, bh, _spread(qh, 1.0), S).npvTargetCurrency() - fx.npvTargetCurrency()
        db = _ql_npv(N, bccy, qccy, K, mat, buy, _spread(bh, 1.0), qh, S).npvTargetCurrency() - fx.npvTargetCurrency()
        rows.append(Row("FX forward", name, "IR01 quote curve", r.ir01_disc, dq, "% of value", 1e-6, scale=100 / abs(dq)))
        rows.append(Row("FX forward", name, "IR01 base curve", r.ir01_base, db, "% of value", 1e-6, scale=100 / abs(db)))
        # spot date: T+2 on both currencies' calendars, the forward carried from there
        from api.routes.currencies import spot_date
        sd = spot_date(VAL, False, bccy.code(), qccy.code())
        rs = price_currency_forward(base_currency=bccy.code(), quote_currency=qccy.code(), base_notional=N, forward_rate=K, spot=S,
                                    valuation_date=VAL, settlement_date=mat, quote_curve=qc, base_curve=bc,
                                    direction="BUY" if buy else "SELL", spot_date=sd)
        mk = _ql_npv(N, bccy, qccy, K, mat, buy, bh, qh, S, settle_days=2, cal=JOINT[(bccy.code(), qccy.code())])
        assert pd_(mk.settlementDate()) == sd, (name, mk.settlementDate(), sd)
        rows.append(Row("FX forward", name, "forward from the spot date", rs.forward, mk.fairForwardRate(), "pips", 1e-6,
                        scale=1e4 if S < 20 else 100))
        rows.append(Row("FX forward", name, "NPV, spot date T+2 (joint calendar)", rs.npv, mk.npvTargetCurrency(),
                        "bp of notional", 1e-6, scale=1e4 / notional_q))
        rows.append(Row("FX forward", name, "NPV with no spot date vs T+2 market", r.npv, mk.npvTargetCurrency(),
                        "bp of notional", 5.0, kind="convention", scale=1e4 / notional_q,
                        cause="finding (fixed): the quoted spot applied from the valuation date drops the carry to the spot date"))
    return rows


def crypto_rows() -> list[Row]:
    set_eval(VAL)
    usd = rijeka_curve()
    uh = replica_handle(usd)
    rows = []
    for name, N, S, K, mat, buy, rate in CRYPTO:
        r = price_crypto_forward(digital_asset=name.split()[0], notional_amount=N, forward_price=K, spot=S, valuation_date=VAL,
                                 settlement_date=mat, usd_curve=usd, asset_rate=rate, direction="BUY" if buy else "SELL")
        _, ah = _flat(rate)
        fx = _ql_npv(N, ql.CHFCurrency(), ql.USDCurrency(), K, mat, buy, ah, uh, S)      # CHF stands in for the asset
        notional_usd = N * S
        rows.append(Row("Crypto NDF", name, "forward price", r.forward, fx.fairForwardRate(), "USD", 1e-6))
        rows.append(Row("Crypto NDF", name, "NPV (USD)", r.npv, fx.npvTargetCurrency(), "bp of notional", 1e-6, scale=1e4 / notional_usd))
        # first principles, independent of either engine: buy N units for delivery at T against K·N USD;
        # the asset leg is worth N·S·exp(−r_A·T) today, the USD leg K·N·DF_USD(T)
        T = (mat - VAL).days / 365.0
        import math
        fp = (1 if buy else -1) * N * (S * math.exp(-rate * T) - K * uh.discount(qd(mat)))
        rows.append(Row("Crypto NDF", name, "NPV vs replication by hand", r.npv, fp, "bp of notional", 1e-6, scale=1e4 / notional_usd))
    return rows


def all_rows() -> list[Row]:
    return fx_rows() + crypto_rows()


def test_fx_forwards_against_quantlib():
    assert_rows(fx_rows())


def test_crypto_forwards_against_quantlib_and_replication():
    assert_rows(crypto_rows())
