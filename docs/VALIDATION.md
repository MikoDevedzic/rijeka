# Independent model validation

Rijeka's numbers are only worth what an outsider can reproduce. This page is the
standing invitation to reproduce them, and the record of what has been found.

## What a validator does

Pick a product. Rebuild its default trade **independently** — your own code, a
spreadsheet, QuantLib, anything that is not Rijeka — from the same market data
(the Excel export on the Methodology tab carries the snapshot and the
bootstrapped discount factors) and compare with the engine's value and risk.
Then try to break it: off-market strikes, stubs, step-ups, negative rates,
weekends, long tenors. File what you find.

The methodology you are testing against is written down in
[`docs/methodology/rijeka_methodology.pdf`](methodology/rijeka_methodology.pdf),
with the module named in every section.

## Reference checks

Before an outsider does it, QuantLib does. `backend/tests/reference/` reprices every product in
[QuantLib](https://www.quantlib.org) (pinned in `backend/requirements-dev.txt`) on a frozen USD SOFR
snapshot, on every commit, in CI:

- **Replica:** QuantLib on Rijeka's own discount factors and stated conventions (QuantLib's own
  schedule generator, an overnight index that compounds exactly like Rijeka's projection, the same
  Hull-White parameters). These must agree to rounding: curve repricing, swaps (spot, forward, amortising,
  step-up, stubs, month-end roll, payment lag over a holiday, zero coupon), FX and crypto forwards,
  European swaptions, caps and floors, FX options (Garman-Kohlhagen and the smile; American, digital, barrier, double barrier and touch against their QuantLib engines), Bermudans on the Hull-White tree, the Jamshidian closed form,
  exposure paths (martingale, swaption and caplet at expiry), DV01.
- **Convention:** QuantLib's own bootstrap and market SOFR conventions, its compounded-SOFR caplet
  pricer, and alternative definitions of a sensitivity. Reported with the cause, bounded by a tolerance.

Every comparison has a tolerance; a difference that grows past it fails the build. Run it and print the table:

```bash
cd backend && pip install -r requirements-dev.txt
python -m pytest tests/reference -q
python -m tests.reference.report --summary
```

The table, the tolerances and the conventions behind every non-zero difference are in the methodology,
section "Independent reference: QuantLib". The inputs are a public-data curve rebuild and synthetic
vols: a clean comparison says the engine computes what the methodology says, not that the demo market
is a live mark. A reference check that fails is a finding like any other, and is filed the same way.

## How a finding is filed

Open a [validation finding](https://github.com/MikoDevedzic/rijeka/issues/new?template=validation_finding.yml). The findings of the November 2026 QuantLib validation that are still open are issues [#31](https://github.com/MikoDevedzic/rijeka/issues/31) to [#36](https://github.com/MikoDevedzic/rijeka/issues/36), with the `validation` label.
The template asks for the product, the test, the expected value and how you got
it, the observed value, and a severity:

| Severity | Meaning |
|---|---|
| **S1** | Wrong sign, wrong order of magnitude, or a formula that is not what the methodology says |
| **S2** | Material difference (more than 1bp of rate or 0.5% of premium) with a clear cause |
| **S3** | Small difference traceable to a convention (day count, roll, interpolation) |
| **S4** | Documentation gap: the code is right but the document does not say what it does |

Every finding is answered in public. A confirmed finding is fixed with a test
that pins it, or recorded as a known limitation in the methodology document,
and the issue is closed with a link to the commit. The open and closed list is
shown on the Methodology tab of the application.

## What a validator gets

- Named sign-off in the product's validation report and in the methodology
  document's acknowledgements, if you want it.
- Co-authorship of the next validation report for a product you validated end
  to end.
- For a confirmed S1 or S2 pricing finding, a bounty of USD 250, paid on fix.

Validators are never paid for a *result*. There is no payment for a clean bill
of health, and sponsors have no say over validation. The two are kept apart on
purpose.

## Current status by product

| Product | Engine | Independent validation |
|---|---|---|
| IRS / OIS | `pricing/ir_swap.py` | v0.4.2 report, 38 tests vs Bloomberg; open for re-validation on the period-end discounting item |
| European swaption | `pricing/swaption.py` | Bloomberg delta USD 3 on USD 10m 5Y; open |
| Cap / floor | `pricing/cap_floor.py` | 0.1% at matched vol; open |
| SABR surface | `pricing/sabr.py` | internal fit diagnostics only; **validator wanted** |
| Bermudan (HW1F tree) | `pricing/bermudan_swaption.py` | gate vs Bachelier; **validator wanted** |
| HW1F calibration | `pricing/calibration.py` | Jamshidian check 0.01%; **validator wanted** |
| XVA under CSA | `pricing/xva_engine.py`, `pricing/csa.py` | parity with legacy loop; **validator wanted** |
| FX spot / forward / NDF (G10) | `pricing/currency_forward.py` | interest-rate parity, each currency on its own OIS curve; demo accounts discount non-USD currencies flat at a policy rate and say so; EURUSD Excel replication; **validator wanted** |
| Crypto NDF (BTC/ETH/SOL) | `pricing/crypto_forward.py` | S1 finding 2026-10-28: the first Excel replication had the discount-factor ratio inverted (forward below spot at positive USD rates); the engine's parity test caught it, workbook, engine and methodology corrected the same day. Open for independent re-validation; **validator wanted** |
| FX option (European) | `pricing/fx_option.py`, `pricing/fx_vol.py` | QuantLib replica rows for value and delta, repriced Greeks bounded against the analytic ones; the smile reproduces its quotes; Excel replication; **validator wanted** |
| FX option styles (American, digital, barrier, double barrier, touch) | `pricing/fx_exotic.py` | each against its QuantLib engine (QD+ and Leisen–Reimer, analytic digital, barrier, double barrier, digital-American and double-barrier-binary); Excel replications for every style but American; open findings [#32](https://github.com/MikoDevedzic/rijeka/issues/32) flat smile vol across the barrier, [#33](https://github.com/MikoDevedzic/rijeka/issues/33) grid monitoring on the exposure paths |
| Crypto option (BTC/ETH/SOL, every style) | `pricing/fx_option.py`, `pricing/fx_exotic.py` | the FX option engine with the funding rate as the carry; QuantLib rows at crypto parameters (vanilla, cash digital, up-and-out with rebate, one-touch, double no-touch); Excel replications (European with the engine's values; the styles); **validator wanted** |
| Market risk: VaR, stress, backtest | `risk/var_full.py`, `risk/stress.py` | historical simulation by full revaluation; vol surfaces as factors since 2 Nov 2026 ([#30](https://github.com/MikoDevedzic/rijeka/issues/30) closed); backtest reads the stored series; **validator wanted** |
| SIMM IM / SA-CCR | `pricing/xva_engine.py` | trace workbook; **validator wanted** |
| Crypto NDF / NDO | `methodology/replicate.py` | formulas only; **validator wanted** |
| Registry contract | `chain/src/TradeConfirmationRegistry.sol` | 16 Foundry tests, Sourcify-verified; **external audit wanted before mainnet** |

## Work with us

Specific asks get answers, so here are the specific asks. Write to
**miko@rijeka.app** with the word in the subject.

- **VALIDATE** — any row above marked *validator wanted*. Start with the issue
  for that product.
- **AUDIT** — a Solidity reviewer for the registry contract before mainnet.
- **QUANT** — FX options and CDS for Phase 2, each a bounded piece of work with
  its own validation report.
- **PILOT** — a bank, asset manager or corporate treasury willing to run the
  confirmation flow with a real counterparty on Sepolia, then mainnet.
- **TEACH** — a university or graduate programme that wants the cohort labs;
  we set up the firms and the market data.
- **DATA** — an openly licensed curve and vol set for teaching, so no classroom
  depends on a Bloomberg seat.
- **SPONSOR** — two concrete items: the external audit of the registry
  contract, and a year of hosting for university cohorts. Sponsors are named
  on the project page; they do not direct validation.

Nothing here is an offer of employment or equity.
