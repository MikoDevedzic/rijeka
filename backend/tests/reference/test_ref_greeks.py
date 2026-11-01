"""Rate sensitivities two ways.

Key-rate ladder (risk/sensitivities.py): each tenor bucket of the curve's quotes is bumped +1bp
(pnl.explain.BUCKETS, the same buckets as the P&L explain), the curve rebootstrapped and the trade
repriced. QuantLib does the same with its own bootstrap (market conventions, no payment lag, so the
comparison isolates the bootstrap's response to a quote move) and its own swap. KR01 per bucket must
agree to a fraction of a percent of the trade's DV01.

Two definitions of a parallel DV01 coexist and are both correct: the ticket's IR01 bumps every pillar's
continuously compounded zero rate by 1bp (pricing/curve.py shifted); the ladder's total bumps every par
quote by 1bp. Par and zero moves differ, so the ladder total is about 2% below the ticket IR01 on these
swaps; the row reports it so nobody reads one as an error in the other.

DV01 by bump against QuantLib on the same bump is in test_ref_swaps.py; swaption analytic delta against
a curve bump is in test_ref_options.py."""
from __future__ import annotations

from pnl.explain import BUCKETS, tenor_years
from pricing.bootstrap import bootstrap_curve
from tests.reference import test_ref_swaps as S
from tests.reference.refmarket import USD_SOFR, VAL, Row, assert_rows, market_curve, rijeka_quotes, set_eval

CASES = [c for c in S.CASES if c[0].split(",")[0] in ("5Y IRS spot", "10Y OIS spot", "30Y OIS spot", "1Y x 5Y forward start",
                                                         "5Y amortising")]


def ladder_rows() -> list[Row]:
    set_eval(VAL)
    base_m = market_curve(payment_lag=0)
    rows = []
    for name, legs in CASES:
        r0 = S._rijeka(legs)
        q0 = S.ql_swap(legs, base_m, market=True).NPV()
        dv01 = abs(sum(l.ir01 for l in r0.legs))
        tot_r = tot_q = 0.0
        for b, lo, hi in BUCKETS:
            bump = {t: 0.01 for t, _ in USD_SOFR if lo <= tenor_years(t) < hi}
            kr = S._rijeka(legs, curve=bootstrap_curve(VAL, rijeka_quotes(bump=bump))).npv - r0.npv
            kq = S.ql_swap(legs, market_curve([(t, r + bump.get(t, 0.0)) for t, r in USD_SOFR], payment_lag=0), market=True).NPV() - q0
            tot_r += kr
            tot_q += kq
            rows.append(Row("Key-rate ladder", f"{name}, bucket {b}", "KR01 (+1bp quotes, rebootstrap)", kr, kq, "% of DV01", 0.5,
                            scale=100 / dv01, kind="convention",
                            cause="market accrual conventions in QuantLib's helpers and swap; Rijeka's gap fill beyond 10Y"))
        ir01 = sum(l.ir01 for l in r0.legs)
        rows.append(Row("Key-rate ladder", name, "ladder total (par +1bp) vs ticket IR01 (zero +1bp)", tot_r, ir01, "% of DV01", 3.5,
                        kind="convention", scale=100 / dv01,
                        cause="definition: a 1bp par-quote move is a slightly smaller zero move; both totals are published, labelled"))
    return rows


def all_rows() -> list[Row]:
    return ladder_rows()


def test_key_rate_ladder_against_quantlib_rebootstrap():
    assert_rows(ladder_rows())
