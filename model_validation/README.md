# Model validation

What is current and what is history.

**Current evidence.** Every product is repriced in QuantLib on every commit: `backend/tests/reference/`
(424 comparisons, each with a tolerance that fails the build when exceeded), summarised in the
methodology's Independent reference section. The validation charter, the per-product status and the
open findings are in [`docs/VALIDATION.md`](../docs/VALIDATION.md); the one-table view is
[`docs/model_inventory.md`](../docs/model_inventory.md).

**History.** `v0.4.2_Sprint6B/` is the April 2026 comparison of IRS and OIS pricing against Bloomberg
SWPM (38 tests) and the XVA waterfall trace. It describes the engine as it was then; conventions
corrected since (period-end discounting, the spot lag on FX, the bond formula on the exposure paths)
are listed in the methodology's known-limitations section and in `docs/VALIDATION.md`. Reports for
later versions were not produced as separate documents; the reference suite replaced them.

**Independent validators** are wanted for the rows marked so in `docs/VALIDATION.md` and are named
on the report.
