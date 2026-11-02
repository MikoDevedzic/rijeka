> **Archived reference (April 2026 draft).** Published because the code and the correctness tests cite
> it. It is a draft with open `[CONFIRM]` markers and several items it calls planned have since
> shipped (bucketed IR01 is the key-rate ladder, stress scenarios, FX01 / CRY01, vega by bucket, full
> VaR). The live names and definitions are `docs/glossary.md`; the methods are `docs/market_risk.md`
> and the methodology document. Kept for the design principles (§1) and the aggregation rules (§9),
> which still hold.

# Rijeka Risk Sensitivity Framework — v1 (DRAFT)

**Status:** Draft for line review
**Authors:** Miko Devedzic + Claude (Apr 19, 2026)
**Supersedes:** nothing (first version)
**Companion documents:** `CORRECTNESS_CHARTER.md` (§1.3 unit invariants), `ARCHITECTURE.md` (v38 current)

---

## §0 Purpose and Scope

This document defines every risk sensitivity Rijeka computes: its mathematical definition, unit, numerical method, aggregation rule, and implementation status. It is the authoritative specification for how sensitivities are named, separated, and surfaced across the platform.

**This document is:**
- The source of truth for sensitivity naming and unit conventions
- The reference that every pricer and every risk report must conform to
- The roadmap for cross-asset sensitivity coverage as the platform expands beyond rates

**This document is not:**
- A pricing methodology document (see per-product spec cards under `docs/products/`)
- A user-facing documentation page (see Rijeka docs for that)
- A list of features on the roadmap (see charter §6)

**Scope of v1:** Phase 1 rates sensitivities, as currently built. Cross-asset sensitivities (FX, Credit, Equity, Commodity, Inflation) are sketched in §8 as forward commitments; detailed specs added when each phase lands.

---

## §1 Design Principles

The following principles govern every sensitivity the platform computes. Violations are correctness bugs, not stylistic preferences.

### §1.1 Typed objects

Every sensitivity carries metadata: `{name, unit, method, risk_factor, instrument, currency}`. No sensitivity is persisted, aggregated, or displayed without all six fields resolved. Loss of any field in transit is a CI failure.

### §1.2 Named separation over collapsed numbers

Where two independent risk factors produce two independent sensitivities, the platform reports both separately. Summing is the user's explicit choice, not the pricer's default. The canonical example: DV01 (forecast curve + discount curve bumped together, returned as a scalar) is banned. IR01 and IR01_DISC are computed, stored, and displayed independently. See §2.

### §1.3 Full revaluation over Taylor approximation

Where the platform offers scenario analytics, the default is full revaluation. Taylor-expansion approximations (linear, quadratic) are available for comparison but never the primary report. This choice is intentional: convexity, cross-gamma, and higher-order effects are free byproducts of full reval and lost under Taylor truncation.

### §1.4 Units are enforced

Cross-currency aggregation requires explicit FX conversion. Cross-model volatility aggregation (Bachelier normal bp ↔ Black lognormal %) requires explicit unit resolution at the current forward and strike. The platform refuses silent unit coercion.

### §1.5 Reproducibility

Given identical trade terms, identical market data snapshot, and identical valuation date, every sensitivity is deterministic (ties to charter §1.1). Monte Carlo sensitivities expose their RNG seed. Replaying an event stream reproduces every sensitivity byte-identically on the same build.

---

## §2 First-Order Rate Sensitivities

### §2.1 IR01

- **Definition:** ∂NPV / ∂r_forecast, measured per +1bp parallel shift of the forecast curve.
- **Unit:** USD/bp (per 1 basis point of forecast rate).
- **Risk factor:** Forecast curve (e.g., USD SOFR forward curve for SOFR-indexed instruments).
- **Method:** Central finite difference with ±0.5bp parallel bump. `IR01 = (NPV(+0.5bp) − NPV(−0.5bp)) / 1bp`.
- **Bump convention:** Parallel shift applied pre-bootstrap to the par rate inputs, curve re-bootstrapped per bump. `[CONFIRM: is this the current implementation, or is the bump applied to zero rates post-bootstrap?]`
- **Instruments supported:** IR_SWAP (all structures: VANILLA, OIS, BASIS, STEP_UP, AMORTIZING, ZERO_COUPON), IR_SWAPTION (Phase 1.5), RATES_CAP, RATES_FLOOR, RATES_COLLAR.
- **Status:** ✓ Shipped. Separated from IR01_DISC in Sprint 4 after discovering discount and forecast curves were being bumped together.

### §2.2 IR01_DISC

- **Definition:** ∂NPV / ∂r_discount, measured per +1bp parallel shift of the discount curve, holding the forecast curve fixed.
- **Unit:** USD/bp (per 1 basis point of discount rate).
- **Risk factor:** Discount curve (currency-specific OIS: USD SOFR, EUR €STR, GBP SONIA, JPY TONA).
- **Method:** Central finite difference with ±0.5bp parallel bump on the discount curve only.
- **Identity:** For a par vanilla swap, `IR01_DISC ≈ 0` exactly (the PV is zero at par, and shifting the discount curve scales zero). For off-par positions, `IR01_DISC ≠ 0` and its magnitude grows with moneyness.
- **Instruments supported:** Same as IR01.
- **Status:** ✓ Shipped Sprint 4. This is the platform's defining departure from industry-standard DV01 reporting. Rationale documented in the DV01 ban (architecture §7, operational rules; charter §1.2 invariant).

### §2.3 Why IR01 + IR01_DISC is strictly more informative than DV01

`DV01 = IR01 + IR01_DISC` by construction (both are linear approximations to the same functional, bumped on orthogonal curves). The sum is always computable from the decomposition; the decomposition is never computable from the sum.

Post-2008, the forecast and discount curves are separately observable inputs that respond to different market forces (forecast tracks rate expectations and term premium; discount tracks funding and collateral regime). Reporting a single DV01 number conflates two independently hedgeable exposures, collapses hedge ratios that a trader needs (futures hedge forecast-curve risk; OIS hedges discount-curve risk), and makes P&L attribution impossible.

Rijeka reports both; the sum is a derived view available on request.

### §2.4 Roadmap: bucketed IR01

Per-tenor IR01 (e.g., 2Y, 5Y, 10Y, 30Y bucket sensitivities) is planned but not yet shipped. Required for DV01-neutral curve trades and for key-rate duration reports requested by external users. ☐ Planned.

---

## §3 Volatility Sensitivities

### §3.1 Vega (rates)

- **Definition:** ∂NPV / ∂σ, measured per +1bp parallel shift of the Bachelier normal volatility surface.
- **Unit:** USD / bp_vol (per 1 basis point of normal vol).
- **Risk factor:** Rates volatility surface (SABR Normal calibrated to swaptions / caps, Hagan 2002).
- **Method:** `[CONFIRM: finite difference bump of the calibrated SABR surface (all four SABR parameters shifted coherently)? Analytical Bachelier vega × chain rule through SABR? Something else?]`
- **Sign convention:** Long option positions have positive vega; short positions have negative vega.
- **Instruments supported:** IR_SWAPTION, RATES_CAP, RATES_FLOOR, RATES_COLLAR, CALLABLE_SWAP, CANCELLABLE_SWAP (the last two inherit vega through the embedded Bermudan).
- **Status:** ✓ Shipped Sprint 8 (SABR surface live on Vol Surface tab; joint rate+vol scenario engine with 4-parallel-call P&L decomposition in CURVE SCENARIO tab).

### §3.2 Bucketed vega (by expiry / tenor)

Per-expiry and per-tenor vega across the swaption grid. Required for vol-curve trades and vega-neutral positioning. ☐ Planned Sprint 13+.

### §3.3 Phase 2 volatility sensitivities

FX vega, equity vega, commodity vega each require their own spec when the phase lands. Each uses a different vol model convention (FX/equity typically Black-Scholes lognormal %; commodity mixed; rates Bachelier normal bp). Cross-asset vega aggregation is blocked by design — see §9.

---

## §4 Time Decay

### §4.1 Theta

- **Definition:** ∂NPV / ∂t, measured as the change in NPV from one calendar day of aging with all market data held constant.
- **Unit:** USD / day.
- **Risk factor:** Calendar time.
- **Method:** `[CONFIRM: T+1 full revaluation with valuation date rolled forward one calendar day, market data snapshot held at T? Or analytical partial from the pricer?]`
- **Sign convention:** Long option positions typically have negative theta (time decay); swap theta is driven by carry and pull-to-par.
- **Instruments supported:** All Phase 1 rates products.
- **Status:** ✓ Shipped. `[CONFIRM: documented method.]`

### §4.2 Roll

Theta decomposition into time-decay-only (holding curve constant) vs curve-rolling (holding forwards fixed, letting time pass) is a useful refinement for structured positions. ☐ Not yet separated in the platform.

---

## §5 Second-Order Sensitivities

### §5.1 Gamma (rates)

- **Definition:** ∂²NPV / ∂r_forecast², measured as the second finite difference of NPV under parallel forecast-curve bumps.
- **Unit:** USD / bp².
- **Method:** `[CONFIRM: is `valuations.gamma` populated today for any product, or reserved for Sprint 13+? If populated, what's the bump-size convention?]`
- **Status:** ◐ Schema field exists (charter §3.2 `valuations.gamma`); population status per product TBD.

### §5.2 Convexity via full scenario revaluation

For any instrument, the platform's CURVE SCENARIO tab (Sprint 5) produces full-reval P&L across user-specified parallel and non-parallel curve shocks. The Sprint 8 extension adds joint rate+vol scenarios via a 4-parallel-call P&L decomposition. Convexity is implicit in every scenario result — the gap between linear IR01 estimate and full-reval P&L is the scenario's convexity contribution.

This is the platform's preferred way to surface convexity to users: as an observable difference between two numbers the pricer already computes, not as a Taylor correction term that requires its own invariant discipline.

### §5.3 Volga, vanna, cross-gamma

Not yet surfaced. These are natural products of the joint rate+vol scenario engine but are not currently extracted as labeled Greeks. ☐ Planned for Phase 2 / vega bucket expansion.

---

## §6 Scenario Analytics

### §6.1 Curve scenario (rates)

- Draggable yield curve with Gaussian ripple propagation around the drag point (Sprint 5 design).
- Full revaluation under the scenario curve; reported P&L is the difference between scenario NPV and base NPV.
- Scenario curve stored alongside the base snapshot for reproducibility.

### §6.2 Joint rate + vol scenario

- Simultaneous parallel rate shift and parallel vol shift (or user-specified non-parallel).
- 4-parallel-call decomposition: base, rate-only, vol-only, rate-and-vol. Cross-term isolates the rate × vol interaction effect.
- Shipped Sprint 8 on CURVE SCENARIO tab.

### §6.3 Stress scenarios (roadmap)

Historical stress scenarios (2008, 2020, 2022 rate shock) and hypothetical stress scenarios (Fed cut 100bp, curve steepener, vol spike) as pre-packaged shocks. ☐ Not yet built.

---

## §7 XVA Sensitivity Suite

From Sprint 6–6B deliveries. Each XVA component is a sensitivity of NPV to a specific risk factor, computed via Monte Carlo.

| Component | Risk factor | Method | Sign (for payer swap, long credit risk) | Status |
|---|---|---|---|---|
| CVA | Counterparty default + exposure | MC EE × (1 − recovery) × PD from CDS term structure | Negative (reduces NPV) | ✓ Shipped Sprint 6B |
| DVA | Own default + negative exposure | Symmetric to CVA, own credit curve | Positive (reduces liability) | ✓ Shipped |
| FVA | Funding cost on expected exposure | EE discounted at funding spread | Negative for uncollateralized net-asset positions | ✓ Shipped |
| ColVA | Collateral asymmetry | Difference between CSA-implied and actual funding | Signed by CSA direction | ✓ Shipped |
| MVA | Initial margin funding | `[CONFIRM: SIMM path simulation live (Sprint 7 scope), or static IM?]` | Negative | ◐ Partial |
| KVA | Regulatory capital cost | Lifetime capital × cost of capital × EAD | Negative | ✓ Shipped |

**Calibration infrastructure:**
- HW1F short-rate model. Calibration via Andersen-Piterbarg closed-form. Current fit: 0.23bp RMSE, mean reversion a=0.0151, vol σ=30.6bp.
- CDS hazard rate term structure (not flat). Hazard rate formula corrected in Sprint 6B (LGD previously inside survival exponent, causing 2.5× CVA overstatement and division-by-zero at LGD=0).
- Monte Carlo Q-measure paths. Configurable path count (500 shown on landing page; 5000 on Pro tier per charter §10.1).
- PAY/RECEIVE direction flip integrated in Monte Carlo (Sprint 6B).

**XVA first-order sensitivities** (sensitivities of the sensitivities — second-generation Greeks):
- ∂CVA / ∂r (CVA delta) — how CVA moves with rates
- ∂CVA / ∂σ (CVA vega) — how CVA moves with vol
- ∂CVA / ∂spread (CS01 on counterparty credit)
- Analogous for each other XVA component

`[CONFIRM: which of these are currently extracted and displayed, vs. computable on request?]` ◐ Partial; aggregation path to portfolio-level XVA risk not yet built.

---

## §8 Cross-Asset Sensitivity Taxonomy (Phase 2 Preview)

This section is a forward commitment, not a current implementation. Each row becomes its own spec when the phase lands.

### §8.1 FX

| Greek | Unit | Method | Phase |
|---|---|---|---|
| FX Delta / FX01 | USD / % of spot | FD bump of spot rate, ±1% | Phase 2 |
| FX Vega | USD / vol pt (lognormal %) | FD bump of FX vol surface | Phase 2 |
| IR01_DISC (both legs) | USD/bp per ccy | Standard IR01_DISC on each currency's discount curve | Inherits from §2 |

### §8.2 Credit

| Greek | Unit | Method | Phase |
|---|---|---|---|
| CS01 | USD / bp of credit spread | FD bump of CDS curve | Phase 2 (implicit in CVA today; explicit exposure planned) |
| Rec01 | USD / % recovery | FD bump of recovery rate | Phase 2 |
| Jump-to-default | USD | Instantaneous default simulation | Phase 2+ |

### §8.3 Equity

| Greek | Unit | Method | Phase |
|---|---|---|---|
| Equity Delta | USD / $ of spot | FD bump | Phase 2 |
| Equity Vega | USD / vol pt (lognormal %) | FD bump | Phase 2 |
| Div01 | USD / bp of dividend yield | FD bump | Phase 2 |

### §8.4 Commodity

| Greek | Unit | Method | Phase |
|---|---|---|---|
| Commodity01 | USD / $ of forward | FD bump of forward curve | Phase 2 |
| Commodity Vega | USD / vol pt (convention varies) | FD bump of vol surface | Phase 2 |

### §8.5 Inflation

| Greek | Unit | Method | Phase |
|---|---|---|---|
| IE01 | USD / bp of breakeven inflation | FD bump of inflation curve | Phase 2 |
| Seasonality01 | USD / seasonal factor | FD bump | Phase 2 |

---

## §9 Aggregation Rules

### §9.1 Intra-asset-class, same-currency

Greeks on the same risk factor, same currency, same instrument family are summed freely. `IR01(Trade A, USD) + IR01(Trade B, USD) = IR01(Portfolio, USD)`.

### §9.2 Cross-currency

Cross-currency Greek aggregation requires explicit FX conversion to a reporting currency. The conversion uses the snapshot's spot rate as of the valuation date. Conversion rate is recorded in the aggregation metadata.

### §9.3 Forecast + discount IR01 combined view

The platform offers `IR01_TOTAL = IR01 + IR01_DISC` as a derived view for users who want a single rate-sensitivity number. This view is opt-in, labeled clearly, and never the default. It is not called DV01.

### §9.4 Cross-model vega (blocked by design)

Vega on Bachelier normal surfaces (rates) cannot be summed with vega on Black lognormal surfaces (FX, equity) without explicit unit conversion at the forward and strike. The platform refuses silent coercion and surfaces this as an aggregation error. See charter §1.4.

Conversion formula: `σ_normal ≈ σ_lognormal × F` at the ATM strike (for small vol). Non-ATM and non-small-vol cases require caplet-by-caplet conversion at each strike. The platform provides the conversion utility; the user chooses when to apply it.

### §9.5 Portfolio-level aggregation

Portfolio aggregation buckets Greeks by `(asset_class, currency, risk_factor, vol_model)`. Within a bucket, Greeks sum. Across buckets, Greeks are reported side-by-side, never summed. ☐ Portfolio aggregation UI not yet built (Sprint 16 per charter §6.1).

---

## §10 Invariants (ties to Charter §1)

Every sensitivity computation must uphold these invariants. CI blocks any PR that breaks them.

### §10.1 Reproducibility
- Same trade, same snapshot, same date ⇒ same sensitivity value within 1e-12 relative tolerance (same-build, same-hardware).
- Replaying a trade's event stream reproduces every sensitivity.

### §10.2 Direction symmetry
- `Greek(Trade, direction=PAY) = −Greek(Trade, direction=RECEIVE)` for every vanilla product, every Greek.

### §10.3 Par identity
- `IR01_DISC(par vanilla swap) = 0` within $0.01 tolerance.

### §10.4 IR01 self-consistency
- Analytical IR01 (where available) matches finite-difference IR01 to declared tolerance.
- Finite-difference IR01 at bump size `h` and `h/2` agrees to second order.

### §10.5 Unit metadata preserved through pipeline
- Every sensitivity carried in the API response includes `{unit, method, risk_factor}`.
- Stripping metadata anywhere between pricer and UI is a CI failure.

### §10.6 XVA conservation
- `NPV_with_XVA = NPV_base + CVA + DVA + FVA + ColVA + MVA + KVA` to floating-point precision.
- Removing any XVA component reproduces the base NPV of that partial adjustment.

---

## §11 Implementation Status Matrix

| Sensitivity | IR_SWAP | Cap/Floor | Swaption | Callable/Cancellable | XCCY | Notes |
|---|---|---|---|---|---|---|
| NPV | ✓ | ✓ | ◐ | ☐ | ☐ | Swaption pricer validated in Sprint 13 |
| IR01 | ✓ | ✓ | ◐ | ☐ | ☐ | |
| IR01_DISC | ✓ | ✓ | ◐ | ☐ | ☐ | |
| Vega | — | ✓ | ✓ | ☐ | — | |
| Theta | ✓ | ✓ | ◐ | ☐ | ☐ | `[CONFIRM per-product]` |
| Gamma | ◐ | ◐ | ◐ | ☐ | ☐ | Schema field exists; population `[CONFIRM]` |
| CVA | ✓ | ✓ | ◐ | ☐ | ☐ | |
| DVA | ✓ | ✓ | ◐ | ☐ | ☐ | |
| FVA | ✓ | ✓ | ◐ | ☐ | ☐ | |
| ColVA | ✓ | ✓ | ◐ | ☐ | ☐ | |
| MVA | ◐ | ◐ | ☐ | ☐ | ☐ | SIMM path simulation `[CONFIRM]` |
| KVA | ✓ | ✓ | ◐ | ☐ | ☐ | |
| Bucketed IR01 | ☐ | ☐ | ☐ | ☐ | ☐ | Planned |
| Bucketed Vega | — | ☐ | ☐ | ☐ | — | Planned Sprint 13+ |
| Volga / Vanna | — | ☐ | ☐ | ☐ | — | Phase 2 |

Legend: ✓ shipped · ◐ partial · ☐ planned · — not applicable

---

## Appendix A: Open Questions (Pre-v1-Final Confirmations)

Miko to confirm before promoting this doc from DRAFT to v1 final:

1. **IR01 bump application** — Are IR01 and IR01_DISC bumps applied to par rate inputs pre-bootstrap (with curve re-bootstrapping) or to zero rates post-bootstrap? The two give slightly different answers for steep curves.
2. **Vega numerical method** — Analytical from SABR closed-form (with chain rule through SABR parameters), or finite-difference bump of the calibrated surface (all four SABR parameters shifted to maintain the surface shape)?
3. **Theta method** — T+1 full revaluation with market held at T, or analytical partial from the pricer?
4. **Gamma population** — Is `valuations.gamma` computed and populated today for any Phase 1 product? If so, what's the bump convention (±1bp, ±10bp, logarithmic)?
5. **MVA path simulation** — Was Sprint 7's SIMM MVA path simulation completed, or is MVA currently static IM × funding spread?
6. **XVA-of-XVA Greeks** — Which of CVA-delta, CVA-vega, CVA-CS01 etc. are currently extracted? Are any displayed in the XVA tab today?
7. **Hedge-flip detection** — Does the platform automatically detect sign flips in Greeks across scenarios and surface them, or is that on roadmap?

---

## Appendix B: Unit Conventions Cheat Sheet

| Greek family | Canonical unit | Alternate units seen in industry | Rijeka convention |
|---|---|---|---|
| Rate delta | USD / bp | USD / $ of NPV (not preferred) | USD / bp |
| Rate gamma | USD / bp² | — | USD / bp² |
| Vol delta (rates) | USD / bp_normal_vol | USD / vol pt (lognormal) | USD / bp (normal) |
| Vol delta (FX/eq) | USD / vol pt (lognormal %) | — | USD / vol pt (Phase 2) |
| Time decay | USD / day | USD / year (annualized) | USD / day |
| Spot delta | USD / $ spot | USD / % spot | Varies by asset class (see §8) |
| Credit spread delta | USD / bp spread | — | USD / bp |

Industry ambiguity to avoid: "vega" with no model qualifier. Rijeka always says "Bachelier normal vega" or "lognormal vega" — never just "vega" — in any cross-asset context.

---

## Appendix C: Numerical Method Reference

### Finite difference bump sizes

| Greek | Default bump | Rationale |
|---|---|---|
| IR01, IR01_DISC | ±0.5bp (central) | Small enough to stay in the linear regime; large enough to avoid floating-point noise |
| Gamma | ±1bp (central, second difference) | Balance of signal vs noise for typical swap PV magnitudes |
| Vega | ±1bp normal vol (central) | `[CONFIRM]` |
| Theta | +1 day (forward) | Calendar time is discrete; central difference not meaningful |

### Bump conventions

- **Parallel curve shift** applied as a constant addition to every pillar's rate.
- **Non-parallel** curve shift via the CURVE SCENARIO tab; not a Greek, a scenario.
- **Coherent surface bump** for vega: all SABR parameters shifted such that the surface rises by the target amount at every strike/expiry point; not a single-parameter bump. `[CONFIRM]`

### Monte Carlo conventions

- **Seed exposure:** every MC Greek records its seed in the output payload for reproducibility.
- **Path count convention:** 500 paths default (free tier), 5,000 paths on Pro tier. Convergence tests run at 500, 2,000, 10,000, 50,000 as invariant checks.
- **Antithetic variates:** `[CONFIRM: enabled by default on CVA / XVA MC?]`
- **Variance reduction:** `[CONFIRM: control variates on EE computation?]`

---

**End of SENSITIVITIES.md v1 draft.**

Review checklist for Miko (in Appendix A order): numbered 1–7. Once each is resolved, the `[CONFIRM]` markers in the body are either filled in or removed, and the document promotes to v1 final.
