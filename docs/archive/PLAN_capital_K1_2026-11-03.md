# Plan: capital module K1, as it fits Rijeka

Date: 3 November 2026. Companion to `BRIEF_capital_efficiency_2026-11-03.md`. Everything below is
derived from the public texts named at each step (Basel CRE20, CRE22, CRE52 with the Committee's
worked examples of March 2014, MAR50, SCO60; ISDA SIMM; CFTC §23.156). No third-party material.

## 0. Principles that bind the design

1. **No number moves for the existing engine.** `run_waterfall` keeps its signature and its defaults;
   every new argument is optional and `None` reproduces today's result bit for bit. The 755-test suite
   and `tests/reference` stay green; a property test asserts the identity.
2. **One source for SA-CCR.** The add-on at t = 0 (the regulatory snapshot on the ticket) and the
   add-on along the path (the KVA leg) call the same functions in `pricing/sa_ccr.py` with different
   residual maturities. They cannot diverge.
3. **Regimes compute, they do not assert.** A regime is data (which collateral, which switches); the
   engine derives the regulatory CSA and the economic CSA and runs. No multipliers anywhere.
4. **Every constant carries its paragraph.** Tables are dictionaries with a `source` string
   (`"CRE52.72 Table 2"`), surfaced by the catalogue route and the derivation drawer.
5. **Apache.** The four new pricing modules sit with pricing and risk.

## 1. Backend modules

### 1.1 `pricing/sa_ccr.py` (new)

```python
@dataclass
class SaccrTrade:
    asset_class: str          # IR | FX | CRYPTO | CREDIT | COMMODITY
    hedging_set: str          # IR: currency; FX/CRYPTO: pair; CREDIT: entity; COMMODITY: energy|metals|...
    notional: float           # domestic currency (USD)
    start_y: float            # S_i, years from the valuation date (0 if started)
    end_y: float              # E_i
    maturity_y: float         # remaining maturity M_i (option: time to expiry; swaption: underlying's end)
    delta: float              # ±1 linear; options via supervisory_delta()
    sub_type: str = ""        # CREDIT: rating bucket or IG/SG index; COMMODITY: type
    trade_ref: str = ""
```

Functions, each a paragraph:

- `supervisory_duration(S, E)` = (e^{−0.05S} − e^{−0.05E}) / 0.05, floored at 10 business days (CRE52.34).
- `supervisory_delta(kind, bought, P, K, T, sigma, shift=0)`: ±Φ(±(ln((P+λ)/(K+λ)) + ½σ²T)/(σ√T))
  for bought/sold call/put (CRE52.40); λ the interest-rate shift, zero elsewhere.
- `maturity_factor(csa, M)`: unmargined √(min(M, 1)) with the 10-business-day floor on M; margined
  1.5√(MPoR/250) with the floors (CRE52.48, 52.50–52.52). Reads the existing `CSA`.
- `addon_ir(trades, mf)`: per currency, three buckets by E_i (<1, 1–5, >5), D_jk = Σ δ d MF, then
  √(D₁² + D₂² + D₃² + 1.4D₁D₂ + 1.4D₂D₃ + 0.6D₁D₃) × 0.50 % (CRE52.57).
- `addon_fx(trades, mf)`: per pair |Σ δ d MF| × 4.0 % (CRE52.59); `addon_crypto` the same structure at
  32 % (SCO60.98), hedging set per asset–fiat pair.
- `addon_credit`, `addon_commodity`: the single-factor formula √((ρΣA)² + (1−ρ²)ΣA²) with the
  Table 2 factors and correlations (CRE52.72; kept so the Committee's examples 2–5 anchor the
  aggregation code; credit and commodity trades are not yet booked in Rijeka).
- `aggregate_addon(trades, csa)` = Σ over asset classes (CRE52.25).
- `multiplier(V, C, addon)` = min(1, 0.05 + 0.95 e^{(V−C)/(1.9·addon)}) (CRE52.23); exponent capped
  as today.
- `replacement_cost(V, C, csa, nica)`: unmargined max(V − C, 0); margined max(V − C, TH + MTA − NICA, 0)
  (CRE52.10, 52.18–52.19).
- `ead(trades, V, C, csa, nica=0)` → `SaccrResult(ead, rc, pfe, multiplier, addon_by_class,
  addon_by_set, trades_detail, mf)`; EAD = 1.4 (RC + mult · AddOn) (CRE52.1); margined EAD capped at
  the unmargined EAD of the same set (CRE52.2).
- `profile(trades, csa, t_grid)`: the add-on at each grid date with S, E, M shifted (the KVA input).

Tests `tests/test_sa_ccr.py`: the Committee's five examples, exact to the rounding they print:
example 1 EAD 569 (IR, USD/EUR hedging sets, swaption delta −0.27), example 2 EAD 381 (credit,
multiplier 0.965), example 3 EAD 5,406 (commodity, 9-month MF √(0.75)), example 4 EAD 936 (combined),
example 5 EAD 1,879 (margined, weekly, MPoR 14, TH 0, MTA 5, IA 150, collateral 200, RC 0,
multiplier 0.958). Plus the identity that `SaccrTrade` IR at the engine's current inputs reproduces
`SF_IR · N · SD · MF`.

### 1.2 `pricing/collateral.py` (new)

```python
@dataclass(frozen=True)
class CollateralClass:
    code: str                 # CASH, GOVT, GOVT_TOKENISED, FUND_SHARES_TOKENISED, STABLECOIN, CRYPTO_2A, CRYPTO_2B
    label: str
    crm: str                  # RECOGNISED | LOOK_THROUGH | NOT_RECOGNISED      (CRE22.34–22.45, SCO60.94)
    haircut: tuple            # by residual maturity (≤1y, 1–3y, 3–5y, 5–10y, >10y) in %, CRE22.49; funds: the highest of holdings
    im_eligible: str          # YES | NO | CONDITIONAL                            (CFTC §23.156)
    vm_eligible: str          # YES | NO | CONDITIONAL
    hqla: tuple               # the states it can take: ("L1",) ("L2A","L1") () (BCBS 238 / LCR30)
    sco60_group: str | None   # 1a | 1b | 2a | 2b
    yield_bp: float           # default carry on the posted asset (the MVA pickup)
    settlement: str           # bilateral | on_chain
    sources: dict

CATALOGUE: dict[str, CollateralClass]

@dataclass
class Regime:
    name: str
    csa: CSA                                   # terms: VM, TH, MTA, MPoR, IM exchanged
    eligible: list[str]                        # catalogue codes
    posted: dict[str, float]                   # composition of what we post (weights, sum 1)
    received: dict[str, float]
    netting_enforceable: bool = True           # close-out survives: perfection + safe harbour
    im_eligibility_state: str = "POST"         # PRE | POST (the conditional classes)
    mpor_state: str = "FLOOR"                  # FLOOR | ON_CHAIN (the CSA's own argument)
    haircut_override: dict[str, float] = {}

    def regulatory_csa(self, residual_maturity_y) -> CSA   # recognised collateral only, haircuts, margined iff recognised VM and enforceable
    def economic_csa(self) -> CSA                         # exchanged collateral; gross if not enforceable
    def recognised_fraction(self, side, residual_maturity_y) -> float
    def im_pickup_bp(self) -> float                        # Σ w_i · yield_i over what we post
    def explain(self) -> list[dict]                       # one line per decision with its paragraph

PRESETS: CASH_GOVT, PLUS_STABLECOIN, PLUS_TOKENISED_FUND, PLUS_TOKENISED_SOVEREIGN
```

`CSA` gains two optional fields with safe defaults: `collateral_haircut: float = 0.0` (fraction of
collateral value lost to haircuts, applied in `collateral_held`) and `crm_recognised: bool = True`
(when False, `sa_ccr_margined` is False and NICA is zero). Defaults reproduce today.

Tests `tests/test_collateral.py`: catalogue invariants (every class has sources, haircut buckets
monotone, cash 0 %), the four presets derive the expected pair of CSAs, `recognised_fraction` under
each state, the all-recognised regime equals `CSA.bilateral()` field by field, a stablecoin-only
regime yields an unmargined regulatory CSA and a gross economic CSA when not enforceable.

### 1.3 `pricing/capital.py` (new)

- `risk_weight(counterparty_type, rating_bucket, override=None)` from CRE20.7 (sovereign), CRE20.18
  (bank), CRE20.42–20.43 (corporate; securities firms and other financials per CRE20.40: bank table
  when prudentially supervised, else corporate), funds and crypto-native as corporate; `UNRATED` 100 %.
- `cva_weight(sector, grade)` from MAR50.16 Table 1 (financials 5 % / 12 %, sovereigns 0.5 % / 2 %,
  the other sectors).
- `supervisory_df(M)` = (1 − e^{−0.05M}) / (0.05M) (MAR50.15).
- `scva(ead, M, rw_c)` = (1/1.4) · rw_c · M · ead · DF(M) (MAR50.15); `k_cva_reduced(scvas)` =
  0.65 · √((0.5 ΣS)² + 0.75 ΣS²) (MAR50.14); a single counterparty gives 0.65 · SCVA.
- `k_ccr(ead, rw)` = 0.08 · rw · ead; `rwa(ead, rw)` = rw · ead.
- `leverage_exposure(rc_no_collateral, addon)` = 1.4 (RC + AddOn) with only cash VM recognised in RC
  (LEV30.26–30.30 conditions as flags on the class).
- `hqla_value(composition, amount, state)` by level and haircut (LCR30: L1 0 %, L2A 15 %, L2B 25–50 %).
- `quote_advantage(delta_cost, annuity, notional, convention)` → running or upfront bp.
- `CapitalInputs(rw, s_c, hurdle, m_eff)` consumed by the waterfall.

Tests `tests/test_capital.py`: the risk-weight tables cell by cell against the paragraphs, BA-CVA on
a hand-computed single counterparty and on three (the aggregation formula), DF at M = 1, 2.5, 5,
leverage exposure ignores non-cash collateral.

### 1.4 `pricing/xva_engine.py` (extend, compatible)

`run_waterfall(paths, v0, p0_grid, params, csa, rng=None, *, reg_csa=None, capital=None, saccr=None)`:

- `reg_csa` (default `csa`) drives the SA-CCR branch: MF, RC form, NICA, collateral for the multiplier.
- `saccr` (a list of `SaccrTrade`, default None) replaces the single-factor add-on with
  `sa_ccr.profile` along the grid; `None` keeps `SF_IR · N · SD · MF` exactly.
- `capital` (default None) adds the CVA-capital leg: K_CVA(t) = SCVA on EAD(t) with the declining
  effective maturity; KVA = hurdle Σ (K_CCR + K_CVA) Δt P. With `None`, KVA is today's.
- `WaterfallResult` gains `kva_ccr`, `kva_cva`, `k_cva_0`, `rwa_0`, `leverage_0`, `addon_0`,
  `multiplier_0`, `rc_0`, all zero-filled when the new inputs are absent.

### 1.5 `ccr/saccr_map.py` (new)

`from_netting_set(ns, mkt, fx_to_usd, asof, forward_rates) -> list[SaccrTrade]`: SWAP → IR, S/E from
the legs' effective and maturity dates, δ = +1 receive-floating; SWAPTION → IR with the option delta
(P the forward swap rate from the curve, K the strike, σ 50 %, λ per currency from the curve's
minimum so P + λ > 0), E the underlying's end; FORWARD → FX (G10 base) or CRYPTO (digital base),
notional the base leg in USD, δ ± by direction; FX_OPTION / CRYPTO_OPTION → FX or CRYPTO with the
option delta (σ 15 % / 120 %, P spot, K strike; barriers, digitals and touches take the vanilla delta
of the same strike, labelled). Caps and floors on a float leg: the swap's ±1 (the add-on covers the
leg; labelled). Unknown kinds are skipped with a reason, as `NettingSet` already does.

### 1.6 `ccr/report.py` (refactor, same output)

Extract `netting_set_paths(db, user, cp, trades, asof, mkt, st, tpl)` returning the set, the
risk-neutral paths, `p0`, the FX map and the today's values; `counterparty_report` calls it and
produces exactly what it produces now (its tests guard that).

### 1.7 Counterparty record

Migration `docs/migrations/2026-11-04_counterparty_capital.sql`, all nullable:
`counterparty_type text` (BANK | BROKER_DEALER | CORPORATE | FUND | SOVEREIGN | CRYPTO_NATIVE),
`rating_bucket text` (AAA_AA | A | BBB | BB_B | BELOW_B | UNRATED), `risk_weight_override numeric`,
`cva_sector text` (MAR50.16 sector key), `umr_in_scope boolean`, `eligible_collateral jsonb`,
`posted_composition jsonb`, `received_composition jsonb`, `netting_enforceable boolean`. Model,
`serialize`, create and update bodies, the onboarding form. `regime_from_counterparty(cp)` in
`pricing/collateral.py` builds the record's regime (defaults: cash and government securities,
enforceable, the existing CSA fields).

### 1.8 `api/routes/capital.py` (new, under `/api/capital`)

- `GET /collateral`: the catalogue and the presets with sources.
- `POST /trade`: `{counterparty_id?, trade? | trade_id?, regimes?: [names or Regime bodies],
  counterparty_types?: [{type, rating, sector}], n_paths?, hurdle?}`. Runs the netting set with and
  without the trade on the risk-neutral paths once (seed 7, the incremental route's machinery), then
  for every regime: the two CSAs, the waterfall under the economic CSA with the CVA-capital leg, the
  SA-CCR snapshot under the regulatory CSA, and for every counterparty type the capital legs. Returns
  per regime × type: `standalone`, `with`, `without`, `incremental` for IM, EAD, RWA, K_CCR, K_CVA,
  KVA, MVA, CVA, FVA, leverage exposure, HQLA value of IM posted; `derivation` (the two CSAs, the
  regime's explain lines, the SA-CCR detail per trade and hedging set, the multiplier, RC); `quote_bp`
  vs the first regime; `notes`; `seconds`. `heavy()` budget as the incremental route.

Tests `tests/test_capital_route.py` with the engines stubbed (the pattern of `test_incremental_xva`):
request validation, the shape, the identity that the first preset with a plain counterparty gives
the incremental route's CVA, and the regime ordering (unrecognised collateral never gives a smaller
EAD than recognised).

## 2. Frontend

- `trade-window/capital.js`: pure helpers (request body, rows, formats, regime labels, the derivation
  text per cell), vitest.
- `trade-window/CapitalTab.jsx`: the XVA skeleton (`xva-shared`): a left column with regime chips
  (presets on by default, the counterparty's own regime first), the counterparty-type switch, the
  STANDALONE / INCREMENTAL toggle, hurdle and paths; the grid regimes × metrics; the quote line; a
  derivation drawer (`ProofExpander`) per selected cell; `RunReadout` with seed, paths and time.
- `TradeWindow.jsx`: the CAPITAL tab after XVA, lazily mounted like XVA, both rates and currency
  tickets; passes `buildTrade`, `counterpartyId`, `tradeId`, `priced`.
- `onboarding/Counterparties.jsx`: the new fields (type, rating, sector, UMR, eligible collateral
  from the catalogue, compositions), shown in the row.
- `docs/Roadmap.jsx`: DESK MODULES gains a DONE line for the capital tab; CCR line updated.

## 3. Documents

`docs/capital.md` (the module, every formula with its paragraph); a chapter in
`docs/methodology/rijeka_methodology.tex` after the CCR chapter (collateral eligibility, the two
CSAs, SA-CCR by asset class, BA-CVA, KVA legs, leverage, HQLA) with the PDF rebuilt; `docs/xva.md`
limits updated (the FX and crypto add-ons are now their own classes); `docs/glossary.md`,
`docs/model_inventory.md`, `CHANGELOG.md` (0.7.0), the API list in `docs/architecture.md`.

## 4. Order of work and the checks at each step

| Step | Deliverable | Check |
|---|---|---|
| 1 | `sa_ccr.py` + `test_sa_ccr.py` | the five Committee examples exact |
| 2 | `collateral.py` + `test_collateral.py` | presets and the two CSAs |
| 3 | `capital.py` + `test_capital.py` | tables and formulas |
| 4 | engine extension + property test | full suite and `tests/reference` unchanged |
| 5 | `saccr_map.py`, `netting_set_paths`, migration, model, counterparty route | `test_ccr`, `test_incremental_xva` unchanged |
| 6 | `routes/capital.py` + `test_capital_route.py` | shape and identities |
| 7 | `capital.js`, `CapitalTab.jsx`, TradeWindow, Counterparties | vitest, build, browser click-through on the local stack |
| 8 | documents, methodology PDF, roadmap, changelog | `test_methodology`, lint |
| 9 | PR, chain, verify live; apply the migration on request | health, version, the tab on a ticket |

Effort: 5–6 days of work compressed into this session where the pieces are independent.
