> **Archived reference (April 2026 design document, last edited 2 November 2026).** Published because the
> code's comments cite it by section (`PRODUCT_TAXONOMY §1.11`, migrations 007–009). Where it differs
> from the live documentation, the live documentation wins: the product keys and labels are in
> `docs/glossary.md`, the structure rules in `backend/api/routes/trades.py::validated_structure`, the
> roadmap in the app. §9's "AI Hedge Advisor" framing is superseded: Prometheus is the read-only
> assistant described in the README and the privacy notice; it gives no advice.

# Rijeka Product Taxonomy — v2

**Status:** v2 (promoted Apr 22, 2026; Sprint 13 Patch 1 edits applied Apr 23, 2026; Prometheus addition Apr 28, 2026)
**Supersedes:** v1 (Apr 20, 2026)
**Companion docs:** `CORRECTNESS_CHARTER.md`, `ARCHITECTURE.md`, `SENSITIVITIES.md`, `DESIGN_TOKENS.md`, `KNOWN_LEGACY_BUGS.md`, `FILE_INDEX.md`

**What changed v1 → v2:**
- Added `CAPPED_FLOATER` and `FLOORED_FLOATER` structures to `IR_SWAP` (§1.1)
- Clarified the pricer-dispatch principle: pricer branches on leg-column data, **not** on `Trade.structure` (§0.1)
- Replaced the v1 §4 big-bang migration with a scoped, sprint-aligned migration ladder. Migration 007 ships CAPPED_FLOATER/FLOORED_FLOATER enforcement for `IR_SWAP` only; legacy rename + full NOT NULL + other instrument types gated to later migrations (§4)
- Logged v1 §4 ambiguity as **L20** in `KNOWN_LEGACY_BUGS.md` — v1 claimed DB-level enforcement that never actually shipped (migration 002 CHECK constraint does not exist in prod, verified Apr 22)

**Sprint 13 Patch 1 edits (Apr 23, 2026):**
- §1.11 extended with collar-as-composition decision and MTM_RESET XCCY note
- §1.11.1 added — IR_SWAPTION on underlying with `embedded_options` is schema-supported but Phase 1 pricing is gated (explicit `NotImplementedError`)
- §1.5.1 added — standalone `IR_CAP`/`IR_FLOOR`/`IR_COLLAR` future refactor into `embedded_options` model, deferred
- §4 migration ladder updated: 008 split into 008a (additive) + 008b (destructive); legacy rename renumbered to 009

**Apr 28, 2026 edits:**
- §9 added — Public tools and advisor surfaces. Catalogues Prometheus (AI Hedge Advisor) as a named product line, distinct from per-instrument pricers. Establishes that **Prometheus** is the brand for Rijeka's AI advisor layer (previously an internal codename, now a visible product entity).

---

## §0 Purpose

Canonical hierarchy of every instrument Rijeka prices, books, and risks. Three layers:

1. **Asset class** — the broadest classification (RATES, FX, CREDIT, EQUITY, COMMODITY)
2. **Instrument type** — the tradeable product within an asset class (`IR_SWAP`, `IR_SWAPTION`, `FX_FORWARD`, `CDS`, etc.)
3. **Structure** — the specific shape within an instrument type (`VANILLA`, `OIS`, `BASIS`, `EUROPEAN`, `BERMUDAN`, `CAPPED_FLOATER`, etc.)

**Core rule:** Every trade has all three. **No instrument ever has a blank structure.** `VANILLA` or `STANDARD` is the default for each product where no other variation applies.

Enforced incrementally at the database level via per-instrument-type CHECK constraints, one per migration. See §4 for the migration ladder.

---

## §0.1 Classification principle

**Instrument type = pricing model family. Structure = schedule/payoff variation within a family.**

`IR_SWAP` and `CALLABLE_SWAP` are separate instrument types because the former prices via deterministic DCF and the latter requires Monte Carlo + LSM (or a short-rate tree). `STEP_UP` and `AMORTIZING` are structures of `IR_SWAP` because they use the same DCF engine with different schedules.

**Pricer-dispatch principle (v2 clarification):** The pricer branches on **leg-column data**, not on `Trade.structure`. `AMORTIZING` is detected by the float leg carrying a populated `notional_schedule`; `STEP_UP` is detected by the fixed leg carrying a populated `fixed_rate_schedule`. `Trade.structure` is a display/taxonomy/validation marker, not a pricer input. New structures that fit this pattern (any schedule- or payoff-variation on existing legs) compose cleanly with existing pricer code and do not require new dispatch branches at the trade level.

**Embedded-optionality principle (v2 addition):** Embedded vanilla optionality on a cashflow leg (caps, floors) is a structure of the host instrument when the pricer decomposes cleanly into host + option strip using engines already resident in the platform. `CAPPED_FLOATER` and `FLOORED_FLOATER` qualify: they decompose into `IR_SWAP` DCF + caplet/floorlet strip, both of which already exist in `pricing/ir_swap.py` and `pricing/cap_floor.py` respectively.

If a new product needs a **new pricer family**, it's a new instrument type. If it **reuses an existing pricer** with a schedule, payoff, or decomposition tweak, it's a structure.

Cross-currency (`XCCY_SWAP`), constant-maturity (`CMS_SWAP`), and inflation (`INFLATION_SWAP`) remain separate instrument types because each requires a distinct pricing model.

**Payer/receiver is a trade-direction attribute, not a structure.** No `PAYER_VANILLA` / `RECEIVER_VANILLA`.

---

## §1 Phase 1 — RATES (current scope)

### §1.1 `IR_SWAP`

Single-currency swap priced by deterministic DCF. Fixed-for-floating or floating-for-floating cashflows on a notional, with optional embedded per-period cap or floor on the floating leg.

| Structure | Description | Status |
|---|---|---|
| `VANILLA` | Fixed-vs-float. Default. | LIVE |
| `OIS` | Fixed-vs-OIS. Discount = forecast. | LIVE |
| `BASIS` | Float-vs-float (e.g., SOFR vs Term SOFR). | LIVE |
| `ZERO_COUPON` | Single payment at maturity. | LIVE (pricer has one residual bug — see CHARTER §9.1) |
| `STEP_UP` | Rate schedule (rate changes by period) via `fixed_rate_schedule`. | LIVE (pricer) / SCOPED (UI passthrough — Sprint 12 item 5+6) |
| `AMORTIZING` | Notional schedule (notional decreases) via `notional_schedule`. | LIVE (pricer) / SCOPED (UI surface — L16) |
| `ACCRETING` | Notional schedule (notional increases). | SCOPED Sprint 13 |
| `CAPPED_FLOATER` | Float leg with per-period cap schedule via `cap_strike_schedule`. Decomposes: DCF swap + signed short-caplet strip. Supports `notional_schedule`. | SCOPED Sprint 12 Patch C/D |
| `FLOORED_FLOATER` | Float leg with per-period floor schedule via `floor_strike_schedule`. Decomposes: DCF swap + signed long-floorlet strip. Supports `notional_schedule`. | SCOPED Sprint 12 Patch C/D |
| `COLLARED_FLOATER` | Float leg with both embedded cap (short) and floor (long). See §1.11 — this structure is placeholder scaffolding; the leg-level refactor supersedes it. | Phase 1.5 — deferred pending leg-level refactor |

**CAPPED_FLOATER / FLOORED_FLOATER conventions:**
- Two-leg swap only (fixed vs floating-with-embedded-optionality). Single-leg floater-note shape is out of scope — that's a bond, belongs in a different instrument type.
- Strike schedule is **rate-level** (applied to the raw floating rate before spread). Spread `s` stays additive: effective coupon = `min(L_i, K_i) + s_i` for capped, `max(L_i, K_i) + s_i` for floored.
- Per-period strike schedule mirrors `fixed_rate_schedule` JSONB shape: list of `{date, strike}` or dict `{date_str: strike}`. Period fallback uses the scalar `cap_rate` / `floor_rate` fields on the leg (same pattern as `fixed_rate` / `fixed_rate_schedule`).
- Sign convention (pricer-internal): `sign = -1` for PAY, `+1` for RECEIVE per `ir_swap.py`. Caplet-strip contribution to leg PV = `-sign * strip_npv` (capped). Floorlet-strip contribution = `+sign * strip_npv` (floored). Invariant tests: "capped floater NPV ≤ vanilla when book short cap" and "floored floater NPV ≥ vanilla when book long floor" live under Sprint 12 item 12.
- UI surface: DETAILS tab, same pattern as AMORTIZING / STEP_UP per-period overrides.

### §1.11 Leg-level embedded optionality (Sprint 13 refactor)

**Architectural note — logged Sprint 12 close.**

The `CAPPED_FLOATER` and `FLOORED_FLOATER` structures shipped in Sprint 12 are **transitional scaffolding**, not the target model. Embedded optionality — caps, floors, collars, and future modifiers (digitals, barriers, range-accrual accrual-caps) — is a **leg-level feature**, not a trade-level structure.

**The wrong model we shipped:**

| Axis | Encoding | Consequence |
|---|---|---|
| Trade structure | `CAPPED_FLOATER` / `FLOORED_FLOATER` | Only available when `instrument_type = IR_SWAP`. |
| Leg columns | `cap_strike_schedule`, `floor_strike_schedule` | Pricer correctly dispatches on these columns. |
| Booking validator | `structure == CAPPED_FLOATER` requires exactly one FLOAT leg with `cap_strike_schedule` | Couples two axes that should be orthogonal. |

**The target model (Sprint 13):**

| Axis | Encoding |
|---|---|
| Trade structure | Topology only — `VANILLA`, `OIS`, `BASIS`, `AMORTIZING`, ..., `MTM_RESET` (XCCY), ... |
| Leg column | `trade_legs.embedded_options` JSONB array |
| Example | `[{type: "CAP", direction: "SELL", strike_schedule: {...}}, {type: "FLOOR", direction: "BUY", ...}]` |

**Why this generalizes:**

- A **capped OIS swap** is just `structure=OIS + leg.embedded_options=[{type:CAP,...}]`. No new structure enum.
- A **floored basis swap** is `structure=BASIS + leg2.embedded_options=[{type:FLOOR,...}]`.
- A **collared XCCY swap** is `structure=FIXED_FLOAT + leg.embedded_options=[CAP, FLOOR]`.
- A **digital cap on a swaption underlying** is the same shape with `type=DIGITAL_CAP`.
- A **range accrual** reuses the pattern with `type=RANGE`.

N instrument types × M option modifiers → one JSONB column, not N×M structures.

**Pricer dispatch stays column-data-driven** (§0.1 principle). `price_leg` iterates `leg.embedded_options` and dispatches to the appropriate option pricer per entry. No per-structure logic anywhere below `ir_swap.py`.

**UI: the "+" pattern.** On the DETAILS tab (or a per-leg panel on TRADE), each FLOAT leg gains an "ADD OPTIONALITY" button. Clicking expands a subsection offering CAP, FLOOR, DIGITAL, BARRIER, RANGE_ACCRUAL (as each is shipped). Multiple options stack on the same leg. No structure coupling.

**Sprint 13 migration path:**

1. **Migration 008a** — add `trade_legs.embedded_options` JSONB column (additive). Backfill from the two dedicated Sprint 12 columns. Legacy columns retained during Patches 2–4 rollout.
2. **Pricer refactor** — `price_leg` reads `leg.embedded_options` instead of the two dedicated columns. ~30 LOC rewrite. Sign convention and per-caplet vol lookup unchanged.
3. **Validator refactor** — `booking.py::validate_structure_leg_consistency` is deleted outright. Replaced with a per-option-type validator on each array entry.
4. **UI refactor** — product-terms.jsx drops the `structure === 'CAPPED_FLOATER'` conditional. A new shared `<LegEmbeddedOptions legRef=... />` component renders per FLOAT leg, mountable under IR_SWAP, XCCY_SWAP, IR_SWAPTION, and any future instrument with float legs.
5. **Migration 008b** — drop legacy columns (`cap_strike_schedule`, `floor_strike_schedule`, `cap_rate`, `floor_rate`); remove `CAPPED_FLOATER` + `FLOORED_FLOATER` from `chk_trades_ir_swap_structure_valid` allowlist.

Logged as **L23** in `KNOWN_LEGACY_BUGS.md` for tracking.

Until Migration 008b lands, `CAPPED_FLOATER` / `FLOORED_FLOATER` remain bookable on IR_SWAP because the machinery beneath them is correct — only the naming and gating are on the wrong axis. Migration 008a (Sprint 13 Patch 1) adds the `embedded_options` column additively; Patches 2–4 migrate the pricer, validator, and UI to the new shape; Migration 008b then drops the legacy columns and removes `CAPPED_FLOATER` / `FLOORED_FLOATER` from the IR_SWAP structure allowlist.

**Collar as composition, not as a structure.** Under the leg-level model, a collar is simply two `embedded_options` entries on the same float leg — one CAP (typically SELL) and one FLOOR (typically BUY). The platform has no "collar" object. There is no trade-level COLLARED_FLOATER structure, no collar-specific validator, no collar-specific pricer path. The blotter MAY render a "COLLARED" badge as a display-time derivation (`if leg has CAP and FLOOR → badge`), but that derivation is UI-only and stores nothing.

The UI exposes one affordance per float leg: an "ADD OPTIONALITY +" button. A user wanting a collar clicks it twice, once for each option. Multiple entries compose freely. This preserves the §0.1 classification principle (no coupling between trade-level structure and leg-level option composition) and matches how sophisticated users think about structured trades — as explicit decompositions, not as opaque named bundles.

**Note on MTM_RESET XCCY:** for `MTM_RESET` XCCY structures (Sprint 15) carrying non-empty `embedded_options`, the caplet/floorlet notional evolves with FX resets. The leg-level shape is unchanged; the XCCY pricer handles notional resolution per reset date. The embedded option strip is re-valued with the reset notional at each coupon period. Covered in Sprint 15 scope — no architectural change required, only pricer logic in the XCCY engine.

### §1.11.1 Gate: `IR_SWAPTION` on underlying with `embedded_options`

**Status:** Schema-supported, pricing deferred to Phase 2.

The leg-level `embedded_options` model is uniform across instrument types — any instrument whose legs sit in `trade_legs` inherits the column for free. This includes `IR_SWAPTION.underlying_legs[]`, meaning the schema after Migration 008a admits swaptions whose underlying swap is a capped, floored, or collared swap.

**Phase 1 pricer behavior: explicit rejection, not silent fallback.**

If `trade.trade_type == 'IR_SWAPTION'` and any `underlying_legs[i].embedded_options` is non-empty, `pricer.py` raises `NotImplementedError` with message:

> Swaptions on capped, floored, or collared underlyings are scoped for Phase 2. The instrument is schema-valid but pricing is not yet validated against market. Contact hello@rijeka.app for pre-release access. See PRODUCT_TAXONOMY.md §1.11.1.

The booking path accepts the shape — a trade can be entered and stored — but no price, risk, or XVA number is ever produced on the Phase 1 surface. This preserves schema forward-compatibility (no migration needed when Phase 2 ships) while enforcing the charter-level commitment that no published number is ever model-wrong. Unit test in Patch 2 locks this behavior in.

**Why this is gated, not shipped:**

1. **Model dispatch.** The current `IR_SWAPTION` engine (SABR / Bachelier on swap rate) assumes the underlying PV at expiry is a function of a single swap rate. A capped underlying breaks this assumption — its PV depends on the full curve shape at expiry via per-caplet forward rates. Correct pricing requires HW1F (or G2++ / LGM) with a dispatcher that forces this route when `embedded_options` is present on the underlying.

2. **Calibration.** The Sprint 6A/6B HW1F calibration fits the swaption grid only (0.23bp RMSE on swaption Black vols). It says nothing about cap vol fit. Pricing a capped-swaption under this calibration misfits the cap leg by the HW1F-vs-market-smile gap — meaningful at OTM strikes. Joint calibration to swaption + cap grids is required and is itself a Phase 2 work item.

3. **Analytic decomposition.** Jamshidian decomposition of the expiry payoff `max(PV_capped_swap(T), 0)` requires PV monotonicity in `r(T)`. Monotonicity holds for some direction / side combinations (e.g., receiver on capped floater, payer on floored floater with BUY floor) and fails for others (e.g., payer on floored floater with SELL floor in deep-ITM regime). The pricer needs a monotonicity check with MC fallback.

4. **Validation.** No Bloomberg benchmark fixtures exist for this instrument class. Phase 2 pricing ships only after at least three fixtures land (ATM payer on capped floater, OTM receiver on floored floater, ITM payer on collared swap) and pass within tolerance.

5. **Methodology disclosure.** Phase 2 launch is gated on a one-page methodology note on `rijeka.app` stating: model family, calibration source, Jamshidian-vs-MC dispatch rule, known gap vs market cap smile, and tolerance bands against Bloomberg.

**Forward compatibility:**

Migration 008a adds `trade_legs.embedded_options`. That column is visible to every instrument type that uses `trade_legs`, including `IR_SWAPTION`. No further migration is needed when Phase 2 lifts the gate — only the pricer-dispatch change, joint HW1F calibration engine, monotonicity-checked Jamshidian / MC pricer, Bloomberg fixtures, and methodology note.

Logged as a gate condition on L23 resolution; does not open a new L-bug.

---

### §1.2 `IR_SWAPTION`

Option to enter a swap at a future date. Structure = exercise style.

| Structure | Description | Status |
|---|---|---|
| `EUROPEAN` | Single exercise at expiry. Default. | LIVE |
| `BERMUDAN` | Multiple discrete exercise dates. | SCOPED Sprint 13 |
| `AMERICAN` | Continuous exercise. | SCOPED Sprint 13 |

### §1.3 `IR_CAP`

Option on a floating rate — pays when rate exceeds strike. Strip of caplets.

| Structure | Description | Status |
|---|---|---|
| `STANDARD` | Each caplet is a Bachelier option on a period's floating rate. Default. | LIVE |
| `DIGITAL` | Pays fixed amount when in the money. | Phase 2 |
| `BARRIER` | Activation/deactivation at a level. | Phase 2 |

Note: frontend product key is currently `RATES_CAP` (L21 candidate — taxonomy requires `IR_CAP` code-wide rename, deferred).

### §1.4 `IR_FLOOR`

Option on a floating rate — pays when rate falls below strike. Strip of floorlets.

| Structure | Description | Status |
|---|---|---|
| `STANDARD` | Strip of floorlets. Default. | LIVE |
| `DIGITAL` | Pays fixed amount when in the money. | Phase 2 |
| `BARRIER` | Activation/deactivation at a level. | Phase 2 |

### §1.5 `IR_COLLAR`

Simultaneous purchase of cap and sale of floor (or vice versa).

| Structure | Description | Status |
|---|---|---|
| `STANDARD` | Arbitrary strikes on cap and floor. Default. | LIVE |
| `ZERO_COST` | Strikes chosen so cap premium equals floor premium. | LIVE |
| `PARTICIPATING` | Asymmetric notionals (partial downside protection). | SCOPED Sprint 13+ |

### §1.5.1 Future refactor: standalone caps / floors / collars in the `embedded_options` model

**Status:** Documented, not Sprint 13 scope.

Once Sprint 13 Part A lands, `IR_CAP`, `IR_FLOOR`, and `IR_COLLAR` standalone instruments can be re-expressed using the same `embedded_options` leg-level pattern. A standalone cap becomes an `IR_CAP` trade with one float leg carrying one `embedded_options` CAP entry (direction = BUY for a long cap, SELL for a short cap). Similarly for floors and collars.

This simplifies the pricer to a **single cap/floor code path** for both standalone and embedded use. It also moves standalone caps onto the same architecture as capped floaters, eliminating a maintenance axis where today the two products have parallel (but drifting) implementations.

Standalone caps / floors / collars are still first-class instruments — they have different economics from embedded optionality (premium-paying, NPV ≠ 0 at inception, option-dominated Greeks vs swap-dominated Greeks). The refactor is purely internal representation; the product surface, structures, and external API stay unchanged.

Deferred pending a later migration slot; not blocking any Phase 1 work. Logged for tracking.

### §1.6 `CALLABLE_SWAP`

Swap with embedded option for one party to terminate early. Priced with Monte Carlo + LSM (or short-rate tree).

| Structure | Description | Status |
|---|---|---|
| `ISSUER_CALLABLE` | Issuer holds the option. Default. | SCOPED Sprint 13 |
| `INVESTOR_CALLABLE` | Investor holds the option. | SCOPED Sprint 13 |

### §1.7 `CANCELLABLE_SWAP`

Swap that can be cancelled at one or more dates. Same pricer family as `CALLABLE_SWAP`.

| Structure | Description | Status |
|---|---|---|
| `SINGLE_CANCEL` | One cancel date. Default. | SCOPED Sprint 13 |
| `MULTI_CANCEL` | Multiple cancel dates (Bermudan-style). | SCOPED Sprint 13 |

### §1.8 `FRA`

Forward Rate Agreement. Single-period, single settlement at period start (discounted to PV).

| Structure | Description | Status |
|---|---|---|
| `STANDARD` | Single-period discounted forward rate. Default. | SCOPED Sprint 14 |

### §1.9 `XCCY_SWAP`

Cross-currency swap. Two currencies, two discount curves, optional FX resets, notional exchanges. Distinct pricer from `IR_SWAP` (per §0.1).

| Structure | Description | Status |
|---|---|---|
| `FIXED_FLOAT` | One fixed leg, one floating leg. Default. | SCOPED Sprint 15 |
| `FLOAT_FLOAT` | Two floating legs (cross-currency basis). | SCOPED Sprint 15 |
| `MTM_RESET` | Mark-to-market notional reset. | SCOPED Sprint 15+ |

Note: `rates.js` legacy listing of `XCCY` as an `IR_SWAP` structure is incorrect (L15 candidate) and will be removed in Patch E of the CAPPED_FLOATER sprint work.

---

## §2 Phase 2 — Other asset classes

Stubbed for the taxonomy. Each instrument's structure table is finalized in the sprint that ships it. The classification principle in §0.1 governs all future additions.

### §2.1 RATES (Phase 2 extensions)

| Instrument | Structures (planned) |
|---|---|
| `CMS_SWAP` | `STANDARD`, `SPREAD` |
| `CMS_CAP` | `STANDARD` |
| `CMS_FLOOR` | `STANDARD` |
| `CMS_SPREAD_OPTION` | `STANDARD` |
| `INFLATION_SWAP` | `ZERO_COUPON`, `YEAR_ON_YEAR` |
| `RANGE_ACCRUAL` | `STANDARD` |

### §2.2 FX

| Instrument | Structures (planned) |
|---|---|
| `FX_SPOT` | `STANDARD` |
| `FX_FORWARD` | `OUTRIGHT`, `NDF` |
| `FX_SWAP` | `STANDARD` |
| `FX_OPTION` | `EUROPEAN`, `AMERICAN`, `DIGITAL`, `BARRIER`, `DOUBLE_BARRIER`, `TOUCH` — LIVE 2026-11-02. Structure = style, as for `IR_SWAPTION`: the ticket books it from the style it priced, the backend derives it from `terms.style` when the booking leaves it blank or says `VANILLA`, and rows booked before this rule are displayed from their terms (`api/routes/trades.py::display_structure`). |

### §2.3 CREDIT

| Instrument | Structures (planned) |
|---|---|
| `CDS` | `SINGLE_NAME`, `INDEX` |
| `CDS_OPTION` | `EUROPEAN`, `AMERICAN` |

### §2.4 EQUITY

| Instrument | Structures (planned) |
|---|---|
| `EQUITY_FORWARD` | `STANDARD`, `TRS` |
| `EQUITY_OPTION` | `EUROPEAN`, `AMERICAN`, `BARRIER` |
| `VARIANCE_SWAP` | `STANDARD` |

### §2.5 COMMODITY

| Instrument | Structures (planned) |
|---|---|
| `COMMODITY_FORWARD` | `STANDARD` |
| `COMMODITY_SWAP` | `FIXED_FLOAT`, `BASIS` |
| `COMMODITY_OPTION` | `EUROPEAN`, `AMERICAN`, `ASIAN`, `BARRIER` |

Deferred from Phase 1 consideration: `STIR_FUTURE`, `BOND_FUTURE`, `BOND_OPTION`. STIR futures belong in rates eventually; bond futures/options carry CTD-option complexity and are Phase 2+.

---

## §3 Display rules

Structure must always display. Never blank.

| Context | Display |
|---|---|
| Blotter row | Structure value as-is (e.g., `VANILLA`, `EUROPEAN`, `STANDARD`, `CAPPED_FLOATER`). |
| Trade window title | `{instrument} · {structure}` (e.g., `IR_SWAP · CAPPED_FLOATER`) |
| Trade window footer `STRUCTURE` indicator | Structure value as-is. |
| Drop-down / chip selector | Default highlighted; all available structures listed. |

Legacy rows with NULL structure (pre-migration-007) render as the default for their instrument type per §7. Migration 007 backfills IR_SWAP rows; other instrument types get backfilled by their own per-instrument migrations as they ship.

---

## §4 Database enforcement — migration ladder

v1 proposed a single big-bang migration 002 covering rename + backfill + NOT NULL + CHECK for all instrument types. That migration never ran in prod (verified Apr 22, 2026 — `chk_trades_structure_valid` does not exist in `pg_constraint`). v2 replaces it with a per-instrument migration ladder, one constraint per migration as each instrument's sprint ships.

| Migration | Scope | Status |
|---|---|---|
| 002 | (proposed v1 big-bang) | Superseded — see L20 |
| 007 | Add `cap_strike_schedule` + `floor_strike_schedule` JSONB columns to `trade_legs`; backfill NULL `IR_SWAP` structures to `VANILLA`; add targeted CHECK constraint `chk_trades_ir_swap_structure_valid` (IR_SWAP only) | APPLIED Apr 22, 2026 |
| 008a | Add `trade_legs.embedded_options` JSONB column (additive); shape CHECK; backfill from Sprint 12 columns (no-op on current DB) | SCOPED Sprint 13 Patch 1 |
| 008b | Drop `cap_strike_schedule`, `floor_strike_schedule`, `cap_rate`, `floor_rate` from `trade_legs`; remove `CAPPED_FLOATER` + `FLOORED_FLOATER` from `chk_trades_ir_swap_structure_valid` allowlist | SCOPED Sprint 13 post-Patch-4 |
| 009 | `INTEREST_RATE_*` → `IR_*` rename across `trades` and `trade_legs`, coupled with frontend L21 rename | Deferred |
| 010 | `trades.structure` NOT NULL enforcement across all instrument types, after full legacy audit | Deferred |
| 011+ | Per-instrument-type CHECK constraints for `IR_SWAPTION`, `IR_CAP`, `IR_FLOOR`, `IR_COLLAR`, `CALLABLE_SWAP`, `CANCELLABLE_SWAP`, `FRA`, `XCCY_SWAP` | Added sprint-by-sprint as each product's structures move LIVE |

Migration SQL and notes live in `_docs/migrations/`:
- `migration_007.sql` + `migration_007_notes.md` — applied Apr 22, 2026
- `migration_008a.sql` + `migration_008a_notes.md` — Sprint 13 Patch 1
- `migration_008b.sql` + `migration_008b_notes.md` — Sprint 13 post-Patch-4 (not yet drafted)

---

## §5 Application enforcement

- **Backend** (`TradeCreate` schema in `trades.py`): `structure` is a field; application-layer validator enforces: (a) structure valid for instrument_type per this doc; (b) if `structure = CAPPED_FLOATER`, exactly one FLOAT leg has `cap_strike_schedule` populated; (c) if `structure = FLOORED_FLOATER`, exactly one FLOAT leg has `floor_strike_schedule` populated; (d) strike schedules absent for all other structures.
- **Frontend** (`TradeBookingWindow.jsx` + `TradeWindow.jsx`): structure chip row always has one selected; default chip pre-selected on instrument switch; booking payload always includes `structure` field (L22 fix in Patch E).
- **Blotter** (`BlotterShell.jsx`): structure renders as-is.
- **Code-wide rename (deferred to migration 009):** `INTEREST_RATE_CAP`/`FLOOR`/`COLLAR` → `IR_CAP`/`IR_FLOOR`/`IR_COLLAR` across backend and frontend, including `rates.js` product keys (`RATES_CAP` → `IR_CAP`, etc.). Tracked as L21.

---

## §6 Legacy data migration — notes

Migration 007 handles the IR_SWAP slice atomically:

1. Add two JSONB columns (`cap_strike_schedule`, `floor_strike_schedule`) to `trade_legs`.
2. Backfill `structure` on IR_SWAP rows with NULL structure (36 rows as of Apr 22 pre-check) to `VANILLA` per §7.
3. Add CHECK constraint `chk_trades_ir_swap_structure_valid` scoped to `instrument_type = 'IR_SWAP'` only.

Non-IR_SWAP rows (including legacy `INTEREST_RATE_*`) are unaffected by migration 007.

---

## §7 Default structure map

When booking a new trade and no explicit structure is chosen:

| Instrument | Default Structure |
|---|---|
| `IR_SWAP` | `VANILLA` |
| `IR_SWAPTION` | `EUROPEAN` |
| `IR_CAP` | `STANDARD` |
| `IR_FLOOR` | `STANDARD` |
| `IR_COLLAR` | `STANDARD` |
| `CALLABLE_SWAP` | `ISSUER_CALLABLE` |
| `CANCELLABLE_SWAP` | `SINGLE_CANCEL` |
| `FRA` | `STANDARD` |
| `XCCY_SWAP` | `FIXED_FLOAT` |
| `FX_OPTION` | the style in `terms.style` (`EUROPEAN` when absent) |
| `CRYPTO_OPTION` | the style in `terms.style` (`EUROPEAN` when absent); same six styles as `FX_OPTION`, live 2026-11-02 |

`CAPPED_FLOATER` and `FLOORED_FLOATER` are never defaulted — user must select them explicitly (the strike schedule is required economic input, not a boilerplate variation).

Shared by backend (`TradeCreate` default resolver) and frontend (chip pre-selection on instrument switch). Single source of truth — any change here propagates to both.

---

## §8 Future work

- **Phase 2 structure finalization** — §2 tables are placeholders. Each gets a line-review pass before its sprint ships.
- **Heterogeneous structure axis** — "structure" currently spans schedule shape, exercise style, option holder, payoff type, and now embedded-optionality shape. Acceptable through Phase 1 but worth revisiting if a product ever needs two orthogonal structure dimensions (e.g., a Bermudan cap with digital payoff, or a CAPPED_FLOATER that is also AMORTIZING — currently expressible via column data alone, no taxonomy strain).
- **CAPPED_AMORTIZING / FLOORED_AMORTIZING combinations** — currently work by populating both `notional_schedule` and a strike schedule on the same leg. Taxonomy-wise these remain `CAPPED_FLOATER` or `FLOORED_FLOATER`; the amortization is column-state, not a separate structure. Confirm display convention when first booked.
- **Per-product spec cards** — each instrument gets a `docs/products/<instrument>.md` card per CORRECTNESS_CHARTER §5.2. Templates drop in as each product reaches LIVE status.

---

## §9 Public tools and advisor surfaces

This section catalogues public-facing surfaces that are **not per-instrument pricers** but ship under the Rijeka brand. Per-instrument pricer tools (IRS Pricer, XVA Simulator, XVA Waterfall, Vol Surface, P&L Attribution, Bermudan Swaption) are the externalisation of §1 instruments and live in `FILE_INDEX.md` §11. Advisor / pedagogical / cross-instrument surfaces live here.

### §9.1 Prometheus · AI Hedge Advisor (`/promtool.html`)

**Status:** LIVE (deployed Apr 28, 2026)
**Type:** Educational / advisory tool, not a pricer
**Asset class:** Rates (interest rate swaps, swaptions)
**Brand identity:** Amber/coral fire palette (`#F5C842` core, `#FF6B6B` glow, `✦` spark glyph). Visible name plate `PROMETHEUS · AI HEDGE ADVISOR`. See `DESIGN_TOKENS.md` §2.6 for the full brand-token spec.

**What it does:** Three-level convexity hedging chess puzzle. Each level introduces one foundational concept of rates risk management, with Prometheus walking the user through every step.
- **Level 1** — Linear hedge with one swap (IR01 only)
- **Level 2** — Convexity hedge with one swaption (IR Gamma + the gamma/vega trade-off)
- **Level 3** — Mortgage servicer book with two swaptions (IR01 + IR Gamma simultaneously, with the vega-flip lesson)

**Risk taxonomy used:** IR01, IR Gamma, Vega (Rijeka standard, per `SENSITIVITIES.md`).

**Pedagogical positioning:** Beginner → desk-grade. Defines every term inline. Walks user through every UI interaction. Assumes zero rates background. Ends with the "no free hedge" lesson.

**Why this matters for the product line:** Prometheus is now a named character / brand. Future tools should consider whether to integrate the same advisor pattern (pill at top, full chat panel, contextual hints). The advisor's voice = teacher, not desk colleague.

### §9.2 Future Prometheus deployments (planned, not built)

Prometheus is intended to appear across the platform with consistent visual identity and teacher voice:

- Advisor pill in the Bermudan tool, IRS Pricer, XVA Simulator, etc. — same character, different context
- Portfolio-level hedge advisor on the platform side
- Term-sheet parser for callable / structured trades
- Vol-cube-aware suggestion engine on real positions

These should all share the Prometheus visual identity (§DESIGN_TOKENS §2.6) and the teacher voice (define every term inline, walk through every interaction, assume zero rates background).

---

**End of PRODUCT_TAXONOMY.md v2.**

### §2.1 Digital assets (added 2026-09-29)

| Instrument | Structures | Notes |
|---|---|---|
| `CRYPTO_OPTION` | `EUROPEAN` | Non-deliverable option on BTC/ETH, cash-settled. Terms in `trade.terms`; canonical record `product` block, ISDA Digital Asset Derivatives Definitions vocabulary. Confirmation-only for now — no pricer. |
| `CRYPTO_FORWARD` | `NDF` | Non-deliverable forward on BTC/ETH. Same. |

`asset_class = CRYPTO`. `notional` is an amount of the digital asset and `notional_ccy` names it (`BTC`, `ETH`); `settlement_currency` is in `terms`. Booker states `terms.direction` as `BUY`/`SELL`; the signed record names buyer and seller by LEI.
