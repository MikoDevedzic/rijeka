# Collateral as a first-class object: the plan (4 November 2026)

Status: proposed. Follows `PLAN_capital_K1_2026-11-03.md` (capital under regimes) and the decision that capital
is stock and XVA is price. Built from public standards only (Basel CRE22/CRE52/SCO60/LCR30, CFTC §23.156, ISDA
SIMM, the ISDA CSA's Eligible Collateral annex). Nothing in this plan comes from any client engagement.

## 1. The problem, in one paragraph

Today the app knows seven regulatory *classes* of collateral (`pricing/collateral.py`: cash, government
securities, tokenised sovereign, tokenised fund shares, stablecoin, Group 2a and 2b cryptoassets) with the rules
each one attracts, and a counterparty record can carry a composition over those classes. It does not know a single
*instrument*: USDC and USDT are the same "STABLECOIN", a T-bill and a Bund are the same "GOVT", and the yield of
every class is hard-coded to zero, so the only way yield enters a price is the IM-yield slider on the XVA tab that a
trader types by hand. "ON-CHAIN" on the XVA tab is a settlement preset (continuous VM, zero threshold and MTA, 5-day
MPoR), not a statement about what the margin is held in. And the CAPITAL tab on the ticket mixes regulatory stock
(IM, EAD, RWA, K) with lifetime prices (KVA, MVA, CVA, FVA) because the regime comparison needed a cost to compare.
The result is that the app cannot answer the question Rijeka exists to answer: *this trade, with this counterparty,
margined in this asset on this rail, costs this much less than the same trade on paper, and here is why.*

## 2. The model

Four layers, each one a table or a dataclass, each one used by every page that touches collateral.

### 2.1 Instruments (what can be posted)

A collateral instrument is a concrete asset: a code, a display name, its regulatory class (one of the seven), its
currency, its issuer, its settlement rail (bilateral or on-chain with chain and token address), its *yield source*,
and its *haircut sources* (the regulatory row by residual maturity from CRE22.49, and optionally a CSA-negotiated
haircut). The yield source is one of: a curve (the CSA currency's OIS; T-bills off the government curve we already
load daily), a fixed rate the firm enters (a fund's distribution yield, a stablecoin's reward rate), or none (a
payment stablecoin at zero, a cryptoasset at zero).

Rijeka ships a public seed: USD, EUR, GBP cash; US Treasury bills and notes, Bunds, Gilts; USDC, USDT, PYUSD; a
generic tokenised money-market fund share and a generic tokenised T-bill token; BTC, ETH, SOL. A firm adds its own
instruments under its own names in Configurations → Collateral → Instruments (a named tokenised fund, a specific
sovereign token, an issuer's stablecoin). The seed is generic; a firm's additions stay in that firm's rows.

Table `collateral_instruments` (firm_id nullable for the seed; firm-scoped RLS for additions): code, name, class,
currency, issuer, rail, chain_id, token_address, yield_source {kind, ref, bp}, csa_haircut_pct, active, sources
(the citations), created_by. Backend: `pricing/collateral.py` grows `Instrument` beside `CollateralClass`; the
catalogue of classes stays as the rulebook; the instrument carries the economics.

### 2.2 Schedules (what a CSA admits)

A collateral schedule is the ISDA CSA's Eligible Collateral annex: per counterparty, the list of admitted
instruments with each one's CSA haircut, concentration limit and whether it is admitted for VM, for IM, or both;
plus the composition actually posted and received today (weights over instruments, not classes); the settlement
rail; and the terms already on the record (threshold, MTA, margin frequency, dispute flag, MPoR, netting
enforceability, IM model). The schedule replaces the three class-level fields on the record
(`eligible_collateral`, `posted_composition`, `received_composition`) with instrument-level ones; the class is
derived from the instrument, never entered twice.

Table `collateral_schedules` (one per counterparty, versioned by effective date so a renegotiated annex is a new
row, not an overwrite): counterparty_id, effective_from, eligible [{instrument, vm, im, csa_haircut_pct,
limit_pct}], posted {instrument: weight}, received {instrument: weight}, rail. The counterparty page edits it in
place (the EDIT TERMS flow from 0.7.2 grows an ELIGIBLE COLLATERAL section).

### 2.3 Two CSAs, derived (unchanged in principle)

From a schedule the engine derives, as it does today from a regime, a *regulatory* CSA (only recognised
collateral counts, at its haircut; margined treatment iff recognised and enforceable; NICA only from IM-eligible
instruments) and an *economic* CSA (what is exchanged, gross if netting is unenforceable). What is new is a
*carry* term structure on each CSA: the yield of the posted VM composition, the yield of the posted IM composition,
and the funding cost of posting each, all from the instruments' yield sources rather than a typed number.

Regimes become derived objects: a regime is a schedule plus rulebook states (IM eligibility pre/post, HQLA floor/
ceiling, MPoR floor/on-chain). The four presets stay as quick what-ifs ("the same set, cash and government
securities", "plus a stablecoin", …) and the counterparty's real schedule is always the first column.

### 2.4 Pricing effects (where the yield goes)

- **ColVA (new):** variation margin held in an asset earning r_coll instead of the OIS the discounting assumes:
  ColVA = Σ VM(t) · (r_coll(t) − r_ois(t)) · dt · DF(t), signed by who posts. Zero for cash at OIS; positive carry
  for a yielding instrument we post; a cost when we receive one and must rebate. One formula, one paragraph, in the
  workbook.
- **MVA:** the IM pickup is the posted IM composition's yield from the instruments, replacing the typed slider (the
  slider stays as an explicit override, labelled OVERRIDE).
- **FVA:** unchanged in form; the residual exposure it funds is already the economic CSA's.
- **KVA:** unchanged in form; the regulatory CSA's recognition and haircut already drive SA-CCR and the CRE52.2 cap.
- **MPoR:** from the schedule's rail and margin terms (`mpor_from_terms`), so ON-CHAIN is a consequence of the
  schedule, not a preset.

Every effect is in the Excel replications as new columns, and the reference suite gets the limiting cases: cash at
OIS reproduces today's numbers bit for bit; a security at OIS + x gives ColVA = x · Σ VM · dt · DF; the five Basel
SA-CCR examples are untouched.

## 3. Where it shows

### 3.1 The ticket

- **XVA tab (rates, FX, crypto panels alike):** the SETTLEMENT block becomes SETTLEMENT & COLLATERAL: the
  counterparty's schedule by default (rail, posted VM in …, posted IM in …, each with its yield and haircut), with a
  what-if selector to re-collateralise the same trade in any instrument on the firm's list. The XVA rows gain
  ColVA, KVA and MVA (KVA and MVA move here from CAPITAL; CVA and FVA stop being duplicated there). Beneath the
  rows, **VS ON-CHAIN** is always shown when the booked schedule is not on-chain: every adjustment side by side on
  the same paths, the total saving in money and in bp of notional running and upfront, with one line per driver
  (threshold and MTA, MPoR, collateral yield, recognition). This is the automatic "how much cheaper on chain" the
  product is for; today it is a button on the rates panel only.
- **CAPITAL tab:** stock only, in USD, today: SIMM IM, SA-CCR EAD, RWA, K CCR, K CVA, leverage exposure, HQLA of
  IM; columns are the counterparty's schedule and the what-if regimes; the derivation drawer stays. No row with a
  discount factor in it.
- **Booking:** the XVA record stores the schedule version and the instrument composition it was priced under, so a
  later question "what was this priced against" has an answer.

### 3.2 The book

- **Risk → COLLATERAL (new page, the COLLATERAL module switch goes live):** per counterparty, the agreement (the
  schedule), today's VM and IM requirement from the exposure run, what is posted and received by instrument at
  haircut-adjusted value, the carry earned and paid, the settlement rail and the on-chain settlement status of the
  last call; book totals by instrument and by class; and the regimes report (BOOKED → ON-CHAIN NOW → ON-CHAIN
  FORWARD) moves here from Risk → CAPITAL, because it is a collateral question with a capital answer.
- **Risk → CAPITAL:** stock only, by risk type (CCR, CVA, market risk when FRTB lands), as decided on 3 November.
- **P&L:** a COLLATERAL CARRY line (yield earned on posted, rebate paid on received, day on day) beside the XVA
  reserve components, with ColVA inside XVA reserves; the sign-off and IPV flows already cover it because the
  collateral yields are inputs on the ladder (see 3.3).
- **Counterparty onboarding (Configurations):** the schedule editor; the capital attributes already there.
- **Configurations → Collateral:** the instrument list (seed plus the firm's own), yield sources, and default
  schedules a new counterparty starts from.

### 3.3 Market data, IPV, modules, chain

- Yields are market-data inputs: OIS from the curves we have, T-bill from the government curve we load daily, fund
  and stablecoin rates as firm-entered marks until a feed exists; the market-data service (architecture doc §
  market data) owns them with lineage. IPV lists "collateral yield · <instrument>" as an input with a tolerance
  like any other, so a changed fund yield shows up in the official P&L the same way a curve pillar does.
- The COLLATERAL module switch (already in the catalogue as planned) turns the page, the P&L line and the ticket
  selector on and off per firm; ColVA on the ticket needs XVA on.
- On chain: the confirmation record gains the schedule hash and the token addresses, so both sides confirm the
  terms the price assumed. VM and IM calls settling on chain (atomic transfer of the token against the call) is the
  step after this plan, on the roadmap under COLLATERAL.

## 4. Phases, with what each proves

| Phase | Scope | Days | Proof |
|---|---|---|---|
| C1 data and config | `collateral_instruments`, `collateral_schedules` migrations and seed; `Instrument` and `Schedule` in `pricing/collateral.py`; regime derived from a schedule; counterparty schedule editor; Configurations → Collateral; CAPITAL tab stock only; KVA/MVA/CVA/FVA removed from the capital grid | 2 | unit tests on derivation (schedule → two CSAs); a deploy ahead of the migration is safe (SQL-backed reads, as for capital attributes) |
| C2 pricing | ColVA in the engine and both workbooks; MVA pickup from instruments; schedule-driven MPoR; XVA tab SETTLEMENT & COLLATERAL on all three panels; KVA and MVA rows on the XVA tab; VS ON-CHAIN strip on all three panels with the driver lines; the priced-against record on booking | 2–3 | limiting-case tests (cash at OIS bit-identical; OIS + x gives the closed form); Basel examples unchanged; `tests/reference` green; workbook columns tie to the API |
| C3 book | Risk → COLLATERAL page with requirements, inventory, carry, status; the regimes report moved; P&L COLLATERAL CARRY line; IPV inputs for yields; module switch live | 2–3 | integration test of the page's figures against the exposure run; P&L attribution still sums; IPV run lists the yield inputs |
| C4 operations (roadmap) | margin calls and disputes workflow, settlement of calls on chain, reconciliation of collateral balances with the counterparty | later | — |

Order of work inside each phase: migration and dataclass, tests, route, page, docs (`docs/collateral.md` new,
`docs/capital.md`, `docs/xva.md`, the methodology §16 and a new §17, the architecture doc, the roadmap).

## 5. Decisions needed

1. **Scope of the seed.** The public list in §2.1, or a shorter one. My recommendation: the full list; it is all
   public tickers and generic classes, and a firm adds its own names in its own rows.
2. **Rebate on received collateral.** Whether ColVA on received non-cash collateral assumes the OIS rebate the CSA
   would specify (my recommendation) or zero.
3. **Which engine owns the ticket's XVAs.** The XVA tab's own model (HW1F for rates, the FX engine) or the credit
   engine's paths that tie to the book's reserves. My recommendation: the credit engine for anything booked or
   quoted, the tab's model as a labelled what-if. This is its own half-day and is not required for C1–C3.
4. **KVA and MVA on the FX and crypto panels.** Yes in my view; same rows everywhere.
