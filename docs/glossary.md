# Glossary: the names on every screen

One set of names, SIMM-aligned, used by the ticket, the ladder, the P&L explain, the limits
catalogue, the methodology and the Excel replications. Keys are what the API returns; labels are
what the app shows.

## Sensitivities

| Key | Label | Meaning |
|---|---|---|
| `npv` | NPV | Present value in the trade's settlement currency (reports convert at the close). |
| `ir01` | IR01 | PV change for +1 bp on every rate curve the trade is valued on. On a digital asset: the discounting curve alone. |
| `ir01_disc` | IR01 DISC | +1 bp on the discount curve only. |
| `ir01_base` | IR01 BASE | +1 bp on the base-currency curve of a currency pair. |
| `fund01` | FUND01 | +1 bp on a digital asset's funding rate; reported beside IR01, never summed into it. |
| `spot01` | FX01 / CRY01 | PV for +1 % spot: FX01 on a currency pair, CRY01 on a digital asset. `SPOT01:<asset>` in the limits catalogue. |
| `vega` | VEGA | PV for +1 vol point (FX, digital assets) or +1 bp of normal vol (swaptions, caps), by surface and bucket on the ladder. |
| `theta` | THETA | One calendar day's carry. |
| `gamma` | GAMMA | Dollar convexity to ±1 bp (rates) or spot gamma (options). |
| `kr01` | KR01 | Key-rate IR01 by curve and tenor bucket (0-1Y, 1-5Y, 5-10Y, 10Y+). |

Not used: DV01, PV01, delta-in-notional on the ladder.

## P&L explain steps (in order)

CARRY, CASH, one row per curve and bucket (discount, forecast, base), SPOT, POINTS, VOL (one row per
surface the trade is valued on), AMEND (terms changed in the window), RESIDUAL (shown, never spread).

## Products

| Key | Label | Where it prices |
|---|---|---|
| `IR_SWAP` | IR SWAP | `pricing/ir_swap.py` (structure VANILLA, OIS, BASIS, ZERO_COUPON, STEP_UP, AMORTIZING, ACCRETING) |
| `IR_SWAPTION` | SWAPTION | `pricing/swaption.py` (European), `pricing/bermudan_swaption.py` |
| `INTEREST_RATE_CAP` / `_FLOOR` / `_COLLAR` | CAP / FLOOR / COLLAR | `pricing/cap_floor.py` as a zero-participation float leg with embedded caplets |
| `FX_SPOT`, `FX_FORWARD`, `NDF` | FX SPOT / FX FORWARD / NDF | `pricing/currency_forward.py` |
| `CRYPTO_FORWARD` | CRYPTO NDF | `pricing/crypto_forward.py` |
| `FX_OPTION` | FX OPTION | `pricing/fx_option.py`, `pricing/fx_exotic.py`; structure = style (EUROPEAN, AMERICAN, DIGITAL, BARRIER, DOUBLE_BARRIER, TOUCH) |
| `CRYPTO_OPTION` | CRYPTO OPTION | the FX option engine with the funding rate as the carry, cash-settled |

## Measures

| Term | Meaning |
|---|---|
| EE, ENE | Expected (negative) exposure per date, mean over paths of max(V − C − IM, 0). |
| PFE_q | The q-quantile of the exposure over paths (95, 97.5, 99 %). |
| EPE | Time average of EE over the first year. |
| EAD | SA-CCR exposure at default. |
| CVA, DVA, FVA, FBA, KVA, MVA | The waterfall: credit, debit, funding cost and benefit, capital, margin valuation adjustments; costs negative, benefits positive. |
| VaR, ES | Historical-simulation loss quantile and the mean loss beyond it, one day, 99 % (95 % secondary). |
| MPoR | Margin period of risk: 10 business days bilateral, 5 on chain. |
