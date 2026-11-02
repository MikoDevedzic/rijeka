# Brief: digital-asset options (2026-11-02)

Written before building, so the build has one target. Miko's ask: extend the FX option work to
crypto options, same modelling for pricing and risk, the desk's sensitivity taxonomy throughout
(FX01 for a currency pair, CRY01 for a digital asset, in line with IR01), IR01 on a digital-asset
trade meaning the discounting curve only, everything wired into every module, Excel replications
and the methodology included.

## Product

`CRYPTO_OPTION` on BTC, ETH, SOL against USD: cash-settled (a non-deliverable option, NDO, in the
ISDA Digital Asset Derivatives Definitions' vocabulary), styles EUROPEAN, AMERICAN, DIGITAL,
BARRIER, DOUBLE_BARRIER, TOUCH. One engine with FX options: `pricing/fx_option.py` and
`pricing/fx_exotic.py` on the forward to settlement, with the digital asset's funding rate as the
base-currency rate (b = r_USD − r_funding), the quote currency USD discounting to settlement.
Settlement default: expiry + 1 day (the digital asset's spot lag). Expiry time 08:00 UTC (the
venue convention), settlement price source the pair's fixing default (CME CF reference rates).

## Market data

`{ASSET}USD_VOL` surfaces in the same shape as FX (ATM / RR25 / BF25 per tenor; Malz smile in
delta). No public source quotes crypto implied vols the demo can rely on from a US cloud address,
so the demo's surfaces are synthetic in shape (crypto-typical levels: ATM 55–90 %, calls bid,
fat wings) and market-driven in level, scaled by the realised vol of the Coinbase spot series
exactly as the FX surfaces are (`risk/vols.py`); the backfill writes two years, the daily rebuild
continues the series. Labelled. A Deribit-implied surface (DVOL, chain marks) is the next step
and is said so in the methodology and the roadmap.

## Taxonomy

- Delta: `FX01` on a currency pair, `CRY01` on a digital asset (PV for +1 % spot). The payload key
  stays `spot01`; every label changes: ticket footer and analytics, scenario tab, risk page card,
  command centre, P&L page.
- Rates: on a digital-asset trade `IR01` is the discounting curve's sensitivity (`ir01 = ir01_disc`);
  the funding-rate sensitivity is `FUND01` (the ticket's forward already names it so). The ladder
  keeps `{ASSET}_FUNDING` out of the IR01 totals and reports it as FUND01.
- Vega per vol point, theta per calendar day: unchanged.

## Modules

Ticket (option mode for CRYPTO_OPTION, cash-settled only, payout in USD or coin), booking
(terms per the canonical record), canonical record (NDO with the style fields and the FX option's
style checks), blotter (structure = style), chat cards (product block), P&L (VOL step via the
surface), ladder (vega; FUND01), VaR (surface as a factor), stress (VOL scenarios with a crypto
shock size), CCR (on the paths like the FX option, funding as the base rate), Excel replications
(European with the engine's values; the styles workbook parametrised by pair), QuantLib reference
rows at crypto parameters, methodology, docs, roadmap.

## Tests

Route pricing on a mocked market; parity with the FX engine at the same inputs; IR01/FUND01
semantics; booked valuation; canonical both sides hash; trade_curves; stress CRYPTO key; vols
surfaces for crypto pairs; replication workbook build and closed-form parity; reference rows.

## Outcome

Built the same day on branch `crypto-options`; see the PR for the file list. The QuantLib table carries the crypto rows; the four option workbooks were evaluated with a spreadsheet engine against the engine's values (worst 4e-6 relative, the closed forms against the numerical integration).
