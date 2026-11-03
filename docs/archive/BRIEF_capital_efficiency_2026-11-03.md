# Brief: collateral regimes, counterparty capital and the portfolio exercise

Date: 3 November 2026. Status: proposal, not started. Built from the public regulatory texts (Basel
CRE20, CRE22, CRE52, MAR50, SCO60; BCBS 238; ISDA SIMM; CFTC §23.156) and the Rijeka code as of
16ea9e5. No third-party material, instrument or calibration enters this design.

## 1. The question

A firm with a non-cleared OTC book wants to know: *what does each trade, and the book, cost in initial
margin, exposure at default, risk-weighted assets, CVA capital and funding, under the collateral posted
today versus the collateral that could be posted, against the counterparties actually faced?* Rijeka
should answer that for any book, any eligible-collateral schedule and any counterparty mix, with every
number traceable to a formula, a regulatory paragraph and a reproducible simulation.

Rijeka is placed to do this structurally rather than by assumption: the CSA object already turns a
margined netting set into an unmargined one by changing the maturity factor and the replacement cost,
and the simulation already produces the exposure profile. The effect of a collateral regime is then an
*output* of the engine, which is the open-box promise.

## 2. What Rijeka already has

| Need | Have today | Where |
|---|---|---|
| Exposure simulation per trade and per netting set | Hull-White 1F for rates, lognormal forwards with the pair's surface along the paths, every FX/crypto option style valued on the paths; risk-neutral and real-world measures | `pricing/xva_engine.py`, `pricing/fx_xva.py`, `ccr/` |
| CSA: VM with threshold, MTA, margin period of risk; IM exchanged; three presets incl. on-chain 5bd MPoR | yes | `pricing/csa.py` |
| SA-CCR EAD | interest-rate add-on only (SF 0.5 %, supervisory duration, margined/unmargined MF, multiplier, RC with NICA), per trade, along the path for KVA | `xva_engine.run_waterfall` |
| SIMM IM | IR delta weight on IR01 (MPoR-scaled); FX delta weight 7.4 % on FX01; a labelled assumption for digital assets; single risk class, no cross-class aggregation | `xva_engine.simm_ir_risk_weight`, `fx_xva.im_risk_weight` |
| KVA, MVA | KVA = hurdle × 8 % × RW × EAD(t) along the path, CCR capital only; MVA = IM funded at ftp less a yield pickup on the collateral | `run_waterfall` |
| Incremental XVA on the ticket | netting set with and without the trade, common random numbers | `POST /api/xva/incremental` |
| Counterparty record | name, ISDA, `csa_type` (NO_CSA, VM_ONLY, VM_IM), threshold, MTA, IM model | `counterparties` table, `ccr.exposure.csa_from_counterparty` |
| Per-counterparty daily run, stored | EE, PFE quantiles, EPE, peak, CVA, limits; a worker tier for RUN NOW | `ccr/report.py`, `ccr_daily`, `jobs` |
| Sensitivities per bucket | IR01 ladder per curve and bucket, vega, FUND01, FX01 | `risk/sensitivities.trade_ladder` |
| Replication and validation | Excel workbooks with engine draws, QuantLib reference suite, methodology PDF | `methodology/`, `tests/reference` |

What is missing, in the order it matters:

1. **Collateral eligibility is not modelled.** The CSA knows *whether* collateral is exchanged, not
   *what* it is. Haircuts, recognition under the credit-risk-mitigation rules, IM eligibility under the
   margin rules, liquidity classification and the yield the collateral earns are all absent (the one
   hook is `im_yield_pickup_bp`).
2. **SA-CCR covers one asset class.** FX forwards and crypto are run through the interest-rate
   supervisory factor (a stated limit in `docs/xva.md`). There is no hedging-set aggregation, no
   supervisory delta for options, no portfolio-level EAD.
3. **CVA capital is absent.** KVA carries CCR capital only; the BA-CVA component, often the larger leg
   for a margined investment-grade book, is not computed.
4. **Counterparty type and rating do not exist.** The risk weight is a free parameter
   (`counterparty_rw`, default 100 %); there is no CRE20 mapping, no MAR50 supervisory weight, no UMR
   scope flag.
5. **No portfolio view of capital.** The credit page shows exposure per counterparty; nothing sums RWA,
   leverage exposure or IM across the book, and nothing answers "what if this netting set were
   collateralised differently".
6. **SIMM is single-class.** No aggregation across IR, FX and (prospectively) crypto, so no
   incremental-IM or consolidation arithmetic.

## 3. Do we need a collateral and margin module?

Two different things hide under that name.

**A collateral eligibility model: yes, and it is small.** A catalogue of collateral asset classes with
their attributes under each framework, and a CSA that carries an eligible-collateral schedule and an
assumed composition of what is posted. Static data, a few hundred lines, no operations. It is the
missing input to everything in §2 and it is what the capital exercise needs.

**A margin operations module (daily VM and IM calls, disputes, settlement, inventory): not for this.**
It is on the roadmap (DESK MODULES: "COLLATERAL tab") and it will later feed *actual* balances into the
same model, but the capital analysis runs on the CSA's terms and an assumed composition. Building ops
first would delay the analysis by a month for no gain in its numbers.

So: build the eligibility model now, design it so the ops module can populate it later.

## 4. The model

### 4.1 Collateral asset classes and regimes

`pricing/collateral.py`: a catalogue of asset *classes*, each with the attributes the frameworks read.
A specific instrument is a row a firm adds, with its own legal findings on each attribute.

| Attribute | Classes | Framework |
|---|---|---|
| `crm_recognised` | cash, government securities, qualifying sovereign debt: yes; payment stablecoins: no; tokenised fund shares: look-through to the underlying | CRE22.34–22.45 |
| `haircut` (supervisory, by residual maturity) | cash 0 %; government securities 0.5 / 2 / 4 %; fund shares by portfolio maturity | CRE22.45; CFTC §23.156(a)(3) as amended 13 July 2026 |
| `im_eligible`, `vm_eligible` | cash, government securities, enumerated funds: both; a tokenised sovereign claim: VM where documented, IM as a conditional state; stablecoins: neither | CFTC §23.156 and the 24 Sept 2026 FAQ |
| `hqla_level` | cash, government securities: L1; a tokenised sovereign claim: L2A floor / L1 ceiling as two states; stablecoins: none | BCBS 238, LCR20–30 |
| `sco60_group` | BTC, ETH, XRP, SOL, DOGE: 2a; other tokens: 2b; tokenised traditional assets: 1a/1b | SCO60 |
| `yield_bp` | cash rebate, the security's coupon | the MVA carry line |
| `settlement` | `bilateral` (T+1 fiat or depository), `on_chain` (atomic) | the CSA's MPoR argument we already make |

A **regime** is a CSA plus an eligible-collateral set plus three assumptions exposed as switches:
`netting_enforceable` (whether the posted collateral survives close-out under the perfection and
safe-harbour tests), `im_eligibility_state` (pre / post the margin-rule schedule), `mpor_state` (10bd
floor / 1bd on-chain, forward-looking). Four presets ship: cash and government securities; plus payment
stablecoins; plus tokenised fund shares; plus a tokenised sovereign claim. A firm composes its own from
the catalogue.

### 4.2 Two CSAs from one regime

The engine derives two views from one regime:

- **Regulatory CSA** (feeds SA-CCR, BA-CVA, leverage exposure): keeps only `crm_recognised` collateral,
  applies supervisory haircuts to the collateral value C, uses the margined MF only when the netting
  set is recognised as margined, treats unrecognised collateral as absent (RC = max(V, 0), MF
  unmargined). The unmargined-to-margined EAD ratio is *computed* from MF 1.0 against 0.300 and the
  replacement cost, never asserted.
- **Economic CSA** (feeds CVA, DVA, FVA, FBA, MVA): what is actually exchanged, with haircuts, and with
  the enforceability assumption applied as a switch: if the netting set is not enforceable in close-out,
  collateral is ignored and exposure is gross; if it is, posted collateral reduces exposure economically
  even where capital does not recognise it. Both states are shown; the conservative one is the default
  and is labelled.

MVA then carries the carry line by construction: funding spread less the collateral's own yield
(`yield_bp`, today `im_yield_pickup_bp`), per asset posted. The double-funding case (holding an
ineligible asset *and* sourcing eligible IM separately) falls out of the eligibility flags.

### 4.3 SA-CCR done properly

`pricing/sa_ccr.py`, netting-set level, the CRE52 text and nothing else:

- asset classes IR (hedging set per currency, three maturity buckets with the 100 / 70 / 30 %
  correlations), FX (per pair, SF 4 %), **crypto** (SCO60.98: SF 32 %, no supervisory duration, a
  hedging set per asset–fiat pair, summed), credit later;
- supervisory delta: ±1 for linear trades, the Black delta with the supervisory volatility for options
  (50 % IR, 15 % FX, 120 % crypto), so swaptions, caps and every FX/crypto option style enter with the
  right sign and size;
- RC margined: max(V − C, TH + MTA − NICA, 0); unmargined: max(V − C, 0); C haircut-adjusted from the
  regulatory CSA; the multiplier; α = 1.4; MF margined 1.5√(MPoR/250) with the floors, unmargined
  √(min(M, 1));
- the result per netting set and per trade (standalone and incremental), at t = 0 for the regulatory
  snapshot, and along the simulated path for KVA (the existing path-wise loop calls the same functions
  with the simulated V(t), so the two cannot diverge).

Reference tests: the Basel Committee's published SA-CCR worked examples (the interest-rate netting
set, the credit set, the margined mixed set), reproduced to the dollar, since the inputs are
supervisory constants.

### 4.4 Capital, leverage, liquidity

`pricing/capital.py`:

- **Counterparty risk weight** from the counterparty record: type (bank, broker-dealer, corporate,
  fund, sovereign, crypto-native) and rating bucket → CRE20 standardised weight (banks and corporates
  by grade, unrated 100 %), with an explicit override on the record. RWA = RW × EAD; capital = 8 % of it.
- **BA-CVA reduced** (MAR50.13–50.16): SCVA_c = (1/α) × S_c × M_c × EAD_c × DF_c with the supervisory
  weight S_c by sector and grade, M_c the effective maturity, DF the supervisory discount; book
  aggregation K = √((ρ Σ SCVA)² + (1 − ρ²) Σ SCVA²), ρ = 50 %. KVA gains the CVA-capital leg beside
  the CCR leg, each scaling on its own counterparty dimension.
- **Leverage exposure** = α (RC + PFE add-on) with no collateral benefit except qualifying cash VM
  (CRR Art. 429c conditions as flags on the asset). Reported per netting set and summed.
- **LCR view**: HQLA value of the collateral inventory and of IM posted/received by level and haircut,
  under each HQLA state; the stock, not the full ratio (the denominator is a treasury input).
- **Inventory capital** (SCO60): capital on the dealer's own holding of a collateral asset, by group,
  reported separately so it is never double-counted with the per-trade channel.
- **Quote advantage**: Δcost between two regimes amortised over the trade's annuity (running bp) or at
  the front (upfront bp), per product convention; the number a salesperson can put on a ticket.

### 4.5 SIMM across risk classes

`pricing/simm.py`: delta margin per risk class from the ladder (IR per currency and bucket with the
intra-bucket correlations, FX, prospectively crypto with the Federal Reserve staff weights **labelled
prospective**), aggregated with the ISDA cross-class correlations; vega and curvature when the vega
ladder is in (the ladder already carries vega per bucket). Then:

- IM(S ∪ T) − IM(S): incremental IM on the ticket, zero against an empty set, cross-class offset visible;
- consolidation: fragmented (netting sets as they are) vs unified (one set, one collateral), with the
  two mechanisms reported separately, because they are different: the IM saving is diversification
  (SIMM is invariant to collateral, so collateral does not enter), the EAD saving is eligibility
  (SA-CCR sums add-ons without correlation, so netting topology does not enter).

### 4.6 Counterparty record

`counterparties` gains: `counterparty_type`, `rating_bucket` (or an explicit `risk_weight_override`),
`umr_in_scope` (buy-side under the uncleared margin rules, with the operational cost of IM
segregation as an explicit, labelled line with a default), `eligible_collateral` (jsonb: asset codes
with per-asset haircut overrides), `posted_composition` and `received_composition` (assumed, until the
ops module supplies actual balances), `cds_bp` (already on the roadmap). One migration, backward
compatible: every new column nullable with the current behaviour as the default.

## 5. API

- `GET /api/capital/collateral` — the catalogue with every attribute and its citation.
- `POST /api/capital/trade` — the ticket's incremental capital: `{trade, counterparty_id, regimes:[…],
  counterparty_types:[…]}` → for each regime × type: standalone and incremental ΔIM, ΔEAD, ΔRWA,
  ΔK_CCR, ΔK_CVA, ΔKVA, ΔMVA, Δleverage exposure, HQLA effect, quote advantage vs the first regime;
  the two-CSA derivation and the simulated profiles alongside, on the same common random numbers as
  `/api/xva/incremental`.
- `POST /api/capital/portfolio` — the book: per counterparty and netting set under its own regime, then
  what-ifs: re-collateralise set g under regime ρ, unify sets, change a counterparty's type; totals for
  IM, EAD, RWA, CVA capital, leverage exposure, HQLA. Enqueued on the worker (`kind=capital_run`), the
  same job table as the credit run; stored like `ccr_daily`.
- `POST /api/capital/import` — a CSV of trades with counterparty and CSA columns for a client
  exercise: today only cashflows have a bulk route, and a client's book arrives as a spreadsheet.
  Booked as PENDING into a scratch firm, never confirmed, deletable in one call.

## 6. UI

- **Trade window: CAPITAL tab** beside XVA, the same skeleton (sliders, model badge, proof expander):
  a grid of regimes (columns) × metrics (rows: SIMM IM, SA-CCR EAD, RWA, K_CCR, K_CVA, KVA, MVA,
  leverage exposure), a counterparty-type switch, STANDALONE / INCREMENTAL toggle, the quote-advantage
  line per column, and a "how this cell was computed" drawer with the formula, the inputs and the
  paragraph, generated from the engine's own trace.
- **Risk → CAPITAL page**: counterparty rows with netting sets, current regime, IM, EAD, RWA, CVA
  capital, leverage exposure; what-if columns (re-collateralise, unify); a book total strip; the
  consolidation chart (fragmented vs unified against the share of each sleeve); export to Excel.
- **Configurations → Counterparties**: type, rating, UMR scope, eligible collateral and compositions.
- **Methodology**: a new chapter (collateral eligibility, SA-CCR by asset class, BA-CVA, leverage,
  HQLA, SIMM aggregation), every formula numbered and cited; `docs/capital.md`; the glossary entries.

## 7. Validation

- SA-CCR against the BCBS worked examples (exact).
- BA-CVA against the MAR50 reduced-approach example.
- SIMM against ISDA's published unit-test file for the current version, IR and FX classes; the crypto
  class labelled prospective with no claim of validation.
- An Excel workbook `xva_capital` in `methodology/` reproducing one trade under the four presets with
  engine draws, in the pattern of `xva_rates` and `xva_fx`.
- Property tests: a regime that recognises everything equals the current engine exactly (no
  regression on the 755-test suite and `tests/reference`); a single netting set already on recognised
  collateral shows zero saving on consolidation; one-class books show zero IM saving; holding
  collateral fixed and re-partitioning leaves EAD unchanged.

## 8. Plan and effort

| Phase | Content | Effort |
|---|---|---|
| **K1** | Collateral catalogue and regimes; two-CSA derivation; SA-CCR by asset class with supervisory deltas; counterparty type and rating; BA-CVA; `POST /api/capital/trade`; CAPITAL tab on the ticket; tests vs the BCBS examples; methodology chapter | 5–6 days |
| **K2** | SIMM cross-class aggregation and incremental IM; consolidation what-if; `POST /api/capital/portfolio` on the worker; Risk → CAPITAL page; leverage exposure and HQLA stock; quote advantage; CSV import for a client book; Excel replication | 5–6 days |
| **K3** (later, with the collateral ops module) | actual balances replace assumed compositions; daily calls and disputes; inventory capital with real holdings; the HQLA ratio with treasury inputs; vega and curvature in SIMM | separate batch |

K1 gives any trade, any regime, any counterparty type, with the derivation open. K2 is what a firm
with a book runs.

## 9. Licensing and positioning

`pricing/collateral.py`, `pricing/sa_ccr.py`, `pricing/capital.py`, `pricing/simm.py` sit with the
pricing and risk engines under Apache-2.0, like everything a validator must be able to read and run.
The client exercise itself (importing a book, running the portfolio page with a quant on the call, the
written report) is the paid dedicated-coverage service already in the business model. The catalogue
carries asset classes and regulatory attributes only; no issuer, instrument, brand or third-party
calibration appears in the code, the data or the documents.
