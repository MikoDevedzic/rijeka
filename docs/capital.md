# Capital: collateral regimes, SA-CCR by asset class, CVA capital, the ticket's CAPITAL tab

Modules: `pricing/collateral.py`, `pricing/sa_ccr.py`, `pricing/capital.py`, `ccr/saccr_map.py`,
`api/routes/capital.py`; the waterfall's capital legs in `pricing/xva_engine.py`. Methodology §16.
Every constant carries the paragraph it comes from; `GET /api/capital/collateral` returns them all.

## What the tab answers

For a trade in a counterparty's netting set: the initial margin, exposure at default, RWA, CCR and CVA
capital, KVA, MVA, CVA, FVA, leverage exposure and the HQLA value of the margin posted, under every
collateral regime and counterparty type, as the set with the trade, without it (the same paths, seed 7)
and the trade alone. Columns are regimes, rows are the quantities, a click on a cell opens its
derivation: the formula, the regime's two CSAs, the counterparty inputs and the SA-CCR snapshot per
trade and hedging set. The last row is the regime's cost against the first column as a running or
upfront spread of notional.

## 1. Collateral classes and regimes

The catalogue holds asset *classes* with their regulatory attributes. A specific instrument (USDC, a Treasury
bill, a named tokenised fund) is a row in the firm's instrument list and a counterparty's schedule says which are
admitted and what is posted; the regime is derived from the schedule (`docs/collateral.md`):

| Class | Recognised for capital | Haircut row | IM / VM eligible | HQLA | SCO60 |
|---|---|---|---|---|---|
| CASH | yes (CRE22.34(1)) | 0 % | yes / yes (§23.156(a)(1)(i)) | Level 1 | — |
| GOVT, AAA to AA− | yes (CRE22.34(3)) | sovereign 0.5 / 2 / 2 / 4 / 4 % by residual maturity (CRE22.49) | yes / yes | Level 1 | — |
| GOVT_TOKENISED | yes through SCO60.94 (a tokenised Group 1a of an eligible asset), conditional on the legal findings | the underlying sovereign's row | conditional / conditional: a state the firm elects | Level 2A floor, Level 1 ceiling: a state | 1a |
| FUND_SHARES_TOKENISED | look-through (CRE22.34(5), the CRE22.49 note) | other issuers AAA–AA as the fund's worst permitted holding | yes / yes (§23.156(a)(1)(ix) as amended 13 July 2026) | Level 2A | 1a |
| STABLECOIN | no (SCO60.94) | — | no / no (the 24 September 2026 FAQ) | none | 1b |
| CRYPTO_2A, CRYPTO_2B | no (SCO60.94) | — | no / no | none | 2a / 2b |

A **regime** is a CSA (the terms: VM, threshold, MTA, MPoR, IM exchanged) plus the eligible set, the
compositions posted and received, and three labelled switches: `netting_enforceable` (perfection and
safe harbour hold in close-out), `im_eligibility_state` (PRE / POST, how a conditional class is read),
`mpor_state` (FLOOR / ON_CHAIN: the cleared floor the paper argues for atomic settlement), and the
HQLA state (FLOOR / CEILING). Four presets ship: CASH_GOVT; PLUS_STABLECOIN (not enforceable by
default, the conservative reading); PLUS_TOKENISED_FUND; PLUS_TOKENISED_SOVEREIGN (on-chain MPoR).

From one regime the engine derives two CSAs:

    regulatory CSA   recognised collateral only, at 1 − Σ w_i · rec_i · (1 − h_i); margined for SA-CCR iff
                     recognised VM is exchanged and the set is enforceable; IM counts as NICA only where it is
                     eligible IM in recognised form. Feeds SA-CCR, BA-CVA, the leverage exposure.
    economic CSA     what is exchanged, at full value; uncollateralised (gross) when not enforceable.
                     Feeds CVA, DVA, FVA, FBA, MVA. The pickup on posted IM is the eligible part's yield;
                     the ineligible part must be replaced by eligible IM funded separately.

The all-recognised regime reproduces the plain CSA field by field (`tests/test_collateral.py`), so
today's XVA numbers are the CASH_GOVT column with cash.

## 2. SA-CCR (CRE52)

    EAD = 1.4 · (RC + multiplier · AddOn)                                   CRE52.1
    RC  = max(V − C, 0)            unmargined                                 CRE52.10
    RC  = max(V − C, TH + MTA − NICA, 0)   margined                           CRE52.18–52.19
    multiplier = min(1, 0.05 + 0.95 · exp((V − C) / (1.9 · AddOn)))           CRE52.23
    d_i = N_i · SD_i,  SD = (e^{−0.05 S} − e^{−0.05 E}) / 0.05  (rates, credit; floored at 10bd)   CRE52.34
    MF  = sqrt(min(M, 1y)) unmargined (M floored at 10bd); 1.5 · sqrt(MPoR / 250) margined          CRE52.48, 52.52
    δ   = ±1 linear; options ±Φ(±(ln((P+λ)/(K+λ)) + ½σ²T) / (σ√T)) with the supervisory σ            CRE52.39–52.40

Add-ons: interest rate per currency with three maturity buckets (<1, 1–5, >5 years) and
EN = √(D₁² + D₂² + D₃² + 1.4 D₁D₂ + 1.4 D₂D₃ + 0.6 D₁D₃), factor 0.50 % (CRE52.57); FX per pair |Σ δ d MF|
at 4 % (CRE52.59); the cryptoasset class per asset–fiat pair at 32 % with no supervisory duration and
supervisory option volatility 120 % (SCO60.98); credit, equity and commodity with the single-factor
formula √((Σ ρ A)² + Σ (1 − ρ²) A²) and the Table 2 factors (CRE52.72), kept so the Committee's
worked examples anchor the aggregation code. Asset classes add without diversification (CRE52.25). A
margined set is capped at the same set unmargined (CRE52.2).

The netting set maps to rows (`ccr/saccr_map.py`): a swap is IR with δ = +1 when we pay fixed; a
physically settled swaption is IR with the option delta on the forward par rate from the curve, active
to the underlying's end; a forward is FX or CRYPTO by its base currency with the foreign leg in USD; an
option is FX or CRYPTO with the supervisory delta at spot and strike (exotic styles at the vanilla delta
of their strike, labelled). Caps and floors enter at the swap's δ, labelled. Every approximation is a
note in the response.

**Reference tests** (`tests/test_sa_ccr.py`): the Basel Committee's worked examples of March 2014
(Annex 4a), reproduced unrounded: example 1 (three rate trades, EAD 569; the swaption delta −0.27),
example 2 (three credit trades, multiplier 0.965, EAD 381), example 3 (commodities, nine-month MF,
EAD 5,406), example 4 (combined, EAD 936), example 5 (margined weekly, MPoR 14, independent amount,
RC 0, multiplier 0.958, EAD 1,879).

Along the exposure path, the KVA leg calls the same functions with the dates shifted and trades past
their end dropped, so the snapshot and the profile cannot diverge; with one interest-rate trade the
module gives today's `SF · N · SD · MF` exactly (`tests/test_capital_engine.py`).

## 3. Capital (CRE20, MAR50)

    RWA = RW · EAD;  K_CCR = 8 % · RWA
    RW by counterparty type and rating: sovereigns CRE20.7, banks CRE20.18 (base), corporates CRE20.42–20.43;
       broker-dealers as banks when prudentially supervised else as corporates (CRE20.40); funds and crypto-native
       firms as corporates; an explicit override on the record, labelled
    SCVA_c = (1/α) · RW_c · M · EAD · DF(M),  DF = (1 − e^{−0.05 M}) / (0.05 M)     MAR50.15
    K_CVA  = 0.65 · √((0.5 Σ SCVA)² + 0.75 Σ SCVA²)                               MAR50.14 (ρ = 50 %)
    RW_c by sector and grade (financials 5 % / 12 %, sovereigns 0.5 % / 2 %, …)      MAR50.16 Table 1
    KVA    = −hurdle · Σ (K_CCR(t) + K_CVA(t)) Δt P(0,t)   with M(t) the remaining maturity
    leverage exposure = 1.4 · (max(V − cash VM, 0) + AddOn): only cash VM reduces it    LEV30
    HQLA value of IM posted: Level 1 0 %, Level 2A 15 %, Level 2B 50 %, none otherwise  LCR30
    quote advantage = Δcost / (N · annuity) running, Δcost / N upfront, in bp

The CVA-capital leg is new in KVA (`run_waterfall(..., capital=CapitalInputs)`); without it the
waterfall is unchanged to the bit (`test_capital_engine.py::test_defaults_are_the_previous_engine`).

## 4. The route

`POST /api/capital/trade` `{counterparty_id, trade | trade_id, regimes?, counterparty_types?, n_paths?, hurdle}`:
the netting set with the trade, without it and the trade alone on the credit engine's risk-neutral paths
(seed 7), then per regime (the record's own first, then the presets on the record's terms) the two CSAs,
the waterfall with the CVA-capital leg per counterparty type, the SA-CCR snapshot at the valuation date,
the HQLA value and the quote line. The record's own regime is its collateral schedule when one is recorded
(instruments, rail, yields from market data), else its class-level fields. The ticket's CAPITAL tab shows the
regulatory stock only (IM, EAD, RWA, K CCR, K CVA, leverage exposure, HQLA of IM); the lifetime prices of that
stock (KVA, MVA) and the credit and funding adjustments are valuation adjustments and belong on the XVA tab,
where they move in the collateral plan's C2. IM is SIMM's interest-rate delta weight on the set's IR01 plus the FX
delta weight on its spot sensitivity (a labelled assumption for digital assets), scaled by √(MPoR/10);
nothing is posted where the collateral is not eligible IM. `GET /api/capital/collateral` is the catalogue
with the tables and sources.

The counterparty record carries `counterparty_type`, `rating_bucket`, `risk_weight_override`,
`cva_sector`, `umr_in_scope`, `eligible_collateral`, `posted_composition`, `received_composition`,
`netting_enforceable` (`docs/migrations/2026-11-04_counterparty_capital.sql`); they are read and
written only once the migration is applied, so a deploy ahead of it changes nothing. The three collateral fields
are kept in step with the counterparty's schedule when one is saved.

## 5. The book under regimes (Risk → CAPITAL)

`GET /api/capital/portfolio` (the stored run; `live=1` computes it in the request), `POST /api/capital/portfolio`
(the worker when one is expected, else a thread; `GET /api/capital/portfolio/status`). Engine
`ccr/capital_report.py`. Every netting set is simulated once on the risk-neutral paths (seed 7) and
re-collateralised step by step; each step changes one thing in the previous step's CSA, and the difference it
makes is that channel's attribution. The steps add up to the columns exactly (`tests/test_capital_report.py`,
`tests/integration/test_capital.py`).

| Step | State | What changes | Where it says so |
|---|---|---|---|
| BASELINE | — | the record: CSA type, threshold, MTA, margin frequency (MPoR 9 + N, floored at 10), disputes (the floor doubled), collateral, enforceability | the counterparty record; CRE52.50–52.51 |
| THRESHOLD_MTA | current | VM at zero threshold and zero MTA (VM switched on for a NO_CSA record) | CRE52.18–52.19 |
| MARGIN_FREQUENCY | current | daily margining: MPoR to the floor | CRE52.50 |
| DISPUTES | current | the doubled floor removed | CRE52.51 |
| COLLATERAL | current | recognised collateral received, close-out netting enforceable | CRE22.34, SCO60.94, CRE52.18 |
| IM_ELIGIBILITY | current | eligible IM in the asset held, at its yield; no double funding | CFTC §23.156 |
| MPOR_RELIEF | forward | the cleared floor for atomic settlement | CRE52.50 as argued; not recognised today |
| TOKENISED_IM | forward | a tokenised sovereign claim eligible as IM, at the yield given | CFTC §23.156: a state |
| HQLA_L1 | forward | Level 1 liquidity treatment of the margin posted | BCBS 238 / LCR30: a state |

Columns: CSA AS BOOKED, ON-CHAIN under current rules (after IM_ELIGIBILITY), ON-CHAIN with the forward states.
Per counterparty and for the book: every metric of §4 plus the cost (−(CVA + FVA + KVA + MVA)), the change
against the baseline, and the quote line (the cost difference as a running or upfront spread of notional).

What the arithmetic will and will not show, and is tested to: a record already on cash and government
securities shows zero in the COLLATERAL step (parity, not superiority); a daily, undisputed CSA shows zero in
MARGIN_FREQUENCY and DISPUTES; SIMM IM moves only with the margin period of risk, never with the collateral;
market-risk capital is not a function of any step and is not computed here; the P&L charges and the regulatory
stock are separate ledgers. The forward states are shown in their own column and never summed into the
current-rules one.

Where the terms are set: Configurations → Counterparties, on creation and through EDIT TERMS on any row (`PUT /api/counterparties/{id}`): ISDA, CSA type, currency, threshold, MTA, discount curve, IM model, the capital attributes and the margin terms. The counterparty record carries `margin_frequency_days` and `mpor_disputed`
(`docs/migrations/2026-11-04_counterparty_margin_terms.sql`); `ccr.exposure.csa_from_counterparty` reads them,
so the credit report's MPoR follows the record too (null = daily, undisputed: today's behaviour).

## Limits, stated

- IM is a delta margin per risk class without the cross-class aggregation (no incremental-IM or
  consolidation arithmetic yet); vega and curvature are not in it.
- The book's run re-collateralises each netting set on its own; unifying netting sets across counterparties
  (consolidation) and the FRTB market-risk block are the next steps.
- SA-CCR deltas are held fixed along the path; the add-on profile moves with the dates only.
- The leverage exposure and the HQLA value are the stock for the trade, not the ratio; the denominators
  are treasury inputs.
- The crypto asset class follows SCO60.98; the IM weight for a digital asset is an assumption, labelled.
- Credit, equity and commodity rows exist for the reference examples; those products are not booked.
- The counterparty type's operational cost under the uncleared margin rules is not a line yet.
