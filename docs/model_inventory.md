# Model inventory

Every model in the engine, where it lives, where the methodology describes it, how it is checked and
what is open. Reference rows are the QuantLib comparisons in `backend/tests/reference/` that run on
every commit (424 in all; a row fails the build when its difference exceeds its tolerance). Open
findings carry the `validation` label on GitHub. Updated 2 November 2026.

| Model | Module | Methodology § | Reference rows | Excel replication | Independent validation | Open findings |
|---|---|---|---|---|---|---|
| OIS curve bootstrap (SOFR, €STR, SONIA, SARON, TONA, AONIA, CORRA) | `pricing/curve.py`, `pricing/bootstrap.py` | 2 | 86 (Curve) | every workbook's Curve sheet | Bloomberg SWPM, April 2026 (v0.4.2); QuantLib since 1 Nov 2026 | #35 conventions (gap fill) |
| Schedules, day counts, fixings | `pricing/schedule.py`, `pricing/day_count.py`, `pricing/calendars.py` | 3 | in the IRS rows | `irs`, `ois` | QuantLib | #35 (accrual vs payment dates) |
| IRS, OIS, basis swaps | `pricing/ir_swap.py` | 4 | 44 (IRS) | `irs`, `ois` | Bloomberg SWPM, April 2026 (38 tests); QuantLib | re-validation wanted on period-end discounting |
| Key-rate ladder | `risk/sensitivities.py` | 14 | 25 | the ticket's IR01 vs the workbook | QuantLib rebootstrap, 0.05 % of DV01 | none |
| European swaption (Bachelier) | `pricing/swaption.py` | 5 | 33 (Swaption) | `swaption` | Bloomberg delta USD 3 on USD 10m 5Y; QuantLib | none |
| β=0 SABR surface | `pricing/sabr.py` | 5.3 | 11 (FX smile is separate) | none | fit diagnostics only; **validator wanted** | none |
| Caps, floors, collars | `pricing/cap_floor.py` | 6 | 15 | `cap` | Bloomberg 0.1 % at matched vol; QuantLib | #31 cap vol has no P&L step; #35 cap expiry convention |
| Bermudan swaption (HW1F trinomial tree) | `pricing/bermudan_swaption.py` | 7 | 24 (Bermudan), 12 (European on the tree) | none | gate vs Bachelier; QuantLib tree; **validator wanted** | none |
| HW1F calibration | `pricing/calibration.py` | 8 | in the Bermudan and XVA rows | `xva_rates` Calibration sheet (closed-form model vol, RMSE grid) | Jamshidian check 0.01 %; **validator wanted** | #36 not yet in the reference table |
| Exposure, CSA, margin period of risk, SIMM, SA-CCR | `pricing/xva_engine.py`, `pricing/csa.py`, `pricing/hw1f_mc.py` | 9 | 31 (CCR paths: martingale, swaption and caplet on the paths) | `xva_rates` (the engine's draws rebuilt in cells, 86 checks) , `simm` trace | parity with the legacy loop; **validator wanted** | #36 |
| XVA waterfall (CVA, DVA, FVA, FBA, KVA, MVA) | `pricing/xva_engine.py`, `pnl/xva.py` | 10 | with the exposure rows | `xva_rates` Waterfall sheet | **validator wanted** | #36 |
| P&L attribution | `pnl/explain.py`, `pnl/valuation.py` | 11 | none (a convention, checked by its own tests) | none | rows sum by construction; **validator wanted** | #31 |
| FX spot, forwards, NDFs | `pricing/currency_forward.py` | 12 | 24 (FX forward) | `fx_forward` with the engine's NPV, FX01, IR01 | QuantLib; **validator wanted** | none |
| Crypto NDF | `pricing/crypto_forward.py` | 12 | 9 | `crypto_ndf` with CRY01, IR01, FUND01 | S1 finding 28 Oct 2026 fixed same day; QuantLib; **validator wanted** | none |
| FX option, European (Garman–Kohlhagen) | `pricing/fx_option.py`, `pricing/fx_vol.py` | 13 | 36 | `fx_option` | QuantLib | none |
| FX option styles (American, digital, barrier, double barrier, touch) | `pricing/fx_exotic.py` | 13 | 68 | `fx_option_styles` (every style but American) | QuantLib engines per style | #32 flat smile vol across the barrier; #33 grid monitoring on the paths |
| Crypto options (every style) | the FX option engine, funding rate as carry | 13 | 6 | `crypto_ndo`, `crypto_option_styles` | QuantLib at crypto parameters; **validator wanted** | #36 |
| Market risk: full-revaluation VaR, stress, backtesting | `risk/var_full.py`, `risk/var.py`, `risk/stress.py`, `risk/backtest.py` | 14 | the ladder rows | none | **validator wanted** | #36 (VaR statistics) |
| Counterparty credit: real-world paths, historical sampling, netting, PFE | `ccr/simulate.py`, `ccr/valuation.py`, `ccr/options.py` | 15 | 31 (CCR paths) | none yet (next after the rates XVA book) | QuantLib for the options on the paths; **validator wanted** | #33 |
| Canonical record, EIP-712, registry | `chain/canonical.py`, `chain/signing.py`, `chain/src/` | 16 | 16 Foundry tests | the public verifier | no external audit yet | #34 option trades booked before 2 Nov 2026 carry no option terms |

Demo market data (the public-source curves, synthetic vol surfaces scaled by realised vol, the policy
path) is described in `docs/market_risk.md` and the README's market-data table; it is data, not a
model, and is labelled on every screen.
