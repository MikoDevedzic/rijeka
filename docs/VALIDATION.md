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

## How a finding is filed

Open a [validation finding](https://github.com/MikoDevedzic/rijeka/issues/new?template=validation_finding.yml).
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
| Crypto NDF (BTC/ETH/SOL) | `pricing/crypto_forward.py` | S1 finding 2026-10-28: the first Excel replication had the discount-factor ratio inverted (forward below spot at positive USD rates); the engine's parity test caught it, workbook, engine and methodology corrected the same day. Open for independent re-validation; **validator wanted** |
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
