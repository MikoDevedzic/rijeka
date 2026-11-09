# Changes to the pinned sample book

`golden_book.json` holds the figures `test_golden_book.py` compares against. A line here for every update: the
date, what moved, by how much, and why. No line, no update (the test refuses).

| Date | What moved | Size | Why |
|---|---|---|---|
| 2026-11-08 | Everything (first pin) | — | The book is pinned for the first time: a 5Y pay-fixed swap at 3.75 %, its par rate, its XVA under no CSA, bilateral and on-chain settlement and with the margin held in USDC, a EURUSD and a BTCUSD forward, the EURUSD forward's XVA, and the swap's capital stock under cash and government paper, a stablecoin and a tokenised sovereign. Market and valuation date 2 November 2026, seeds fixed. |
| 2026-11-09 | Nothing in `golden_book.json` (it has no digital-asset option). The pinned crypto-option figures in `tests/test_settlement_fixings.py` (BEFORE_THE_RULE, two option rows) | npv unchanged; ir01 11.9406 → 12.1142, fund01 −15.2723 → −15.4459, theta −643.030 → −642.832 on the 2 November row (one day's carry) | 0.16.0: a digital asset's spot date is T+0 everywhere (the pairs answer said T+1, the pricer carried from T+0, the tenors counted from today). `crybasis01` (= −fund01) pinned beside them. Emmy checked the convention; the reference suite and the golden book are green |
