#!/usr/bin/env bash
# Opens one "[validation] <product>" issue per product on GitHub (labels: validation, help wanted).
# Run once, from anywhere, with gh authenticated:  backend/scripts/seed_validation_issues.sh
set -euo pipefail
BODY_TMPL='**Module:** `%s`

**Status:** %s

**How to take this:** read [docs/VALIDATION.md](https://github.com/MikoDevedzic/rijeka/blob/main/docs/VALIDATION.md), export the Excel replication for the product from the Methodology tab (or build the default trade yourself from [the methodology document](https://github.com/MikoDevedzic/rijeka/blob/main/docs/methodology/rijeka_methodology.pdf)), rebuild the number independently, and file each difference as a separate **validation finding** with a severity. Comment here to say you are on it, so two people do not duplicate the work.

Confirmed S1/S2 pricing findings carry a USD 250 bounty. Validators are named on the report.'
while IFS='|' read -r name mod st; do
  [ -z "$name" ] && continue
  gh issue create --repo MikoDevedzic/rijeka --title "[validation] $name" --label validation --label "help wanted" \
     --body "$(printf "$BODY_TMPL" "$mod" "$st")"
done <<'ROWS'
IRS / OIS|pricing/ir_swap.py|v0.4.2 report (38 tests vs Bloomberg). Re-validation wanted on the period-end vs payment-date discounting item (methodology §3).
European swaption|pricing/swaption.py|Bloomberg delta USD 3 on USD 10m 5Y at matched vol. Open for independent replication, including off-market strikes via SABR.
Cap / floor / collar|pricing/cap_floor.py, pricing/cap_vol_strip.py|0.1% at matched vol. Open for independent replication of the caplet strip and the collar.
SABR surface (β=0 normal)|pricing/sabr.py|Internal fit diagnostics only. First independent validator wanted: refit the quoted smiles and compare parameters and RMSE.
Bermudan swaption (HW1F trinomial tree)|pricing/bermudan_swaption.py|Gate vs Bachelier (0.5% ATM, 1% wings). First independent validator wanted: tree convergence, early-exercise boundary, comparison with another implementation.
HW1F calibration for exposure|pricing/calibration.py|Jamshidian check 0.01%. First independent validator wanted: calibrated (a, σ) against another library on the 5Y column.
XVA under a CSA|pricing/xva_engine.py, pricing/csa.py|Parity with the legacy loop at 1e-12; Brownian-bridge MPoR lag. First independent validator wanted: EE/ENE profiles and the waterfall terms against an independent Monte Carlo.
SIMM IM and SA-CCR|pricing/xva_engine.py|Trace workbook on rijeka.app. First independent validator wanted: IM against an ISDA SIMM reference implementation; SA-CCR EAD against the BCBS worked examples.
Crypto NDF / NDO|methodology/replicate.py, chain/canonical.py|Formulas only (parity forward, Black-76). First independent validator wanted before the engine implementation.
Registry contract and verifier|chain/src/TradeConfirmationRegistry.sol, chain/verify/index.html|16 Foundry tests, Sourcify-verified. External review wanted before mainnet: signature malleability, replay across chains/registries, amend/terminate state machine.
ROWS
echo "done — see https://github.com/MikoDevedzic/rijeka/issues?q=label%3Avalidation"
