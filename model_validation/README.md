# Model validation

Where the evidence is.

**Current evidence.** Every product is repriced in QuantLib on every commit: `backend/tests/reference/`
(424 comparisons, each with a tolerance that fails the build when exceeded), summarised in the
methodology's Independent reference section. The validation charter, the per-product status and the
open findings are in [`docs/VALIDATION.md`](../docs/VALIDATION.md); the one-table view is
[`docs/model_inventory.md`](../docs/model_inventory.md).

**Reports.** No separate validation report is kept here: the reference suite is the evidence, and it
runs on every commit. An independent validator's report, when there is one, is filed in this folder
under its version. Conventions corrected along the way (period-end discounting, the spot lag on FX,
the bond formula on the exposure paths, a swap between coupon dates in the credit engine) are listed
in the methodology's known-limitations section and in `docs/VALIDATION.md`.

**Independent validators** are wanted for the rows marked so in `docs/VALIDATION.md` and are named
on the report.
