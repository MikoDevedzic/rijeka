# Collateral: instruments, schedules, and the regime they derive

Collateral is a first-class object: a concrete *instrument* a firm can post or receive, a *schedule* per
counterparty (the CSA's eligible-collateral annex), and the *regime* the engines derive from the schedule. The
regulatory classes and their rules are unchanged (`docs/capital.md` §1); this layer names the assets and carries
their economics. Plan: `docs/archive/PLAN_collateral_2026-11-04.md`. Built from public standards only.

## 1. Instruments (`pricing/collateral.py` `Instrument`, `SEED`)

An instrument is one asset: a code, a name, its regulatory class (one of the seven in the catalogue), its
currency and issuer, its settlement rail (`bilateral` or `on_chain`, with chain id and token address when on
chain), its **yield source**, and an optional negotiated haircut.

| Yield source | Meaning | Resolved as |
|---|---|---|
| `CURVE` | a curve's short rate plus a spread | the one-year zero of the account's latest snapshot of `yield_ref` (continuously compounded, bp) + `yield_bp`; the spread alone when the curve has no snapshot |
| `FIXED` | a rate the firm enters | `yield_bp` |
| `NONE` | nothing accrues to the holder | 0 |

The public seed (versioned in code, so it moves with the rules it depends on): USD, EUR and GBP cash (CURVE on
the currency's OIS, zero spread: cash earns what the discounting assumes); US Treasury bills and notes, Bunds,
Gilts (CURVE on the OIS until a government curve is loaded); USDC, USDT, PYUSD (STABLECOIN, on chain, NONE);
a generic tokenised money-market fund share (FUND_SHARES_TOKENISED, on chain, CURVE USD_SOFR − 10 bp) and a
generic tokenised Treasury-bill claim (GOVT_TOKENISED, on chain, CURVE USD_SOFR); BTC, ETH, SOL (CRYPTO_2A,
NONE). Nothing in the seed names a private issuer's product beyond public tickers.

A firm adds its own rows under Configurations → Collateral Instruments (`collateral_instruments`, keyed by firm):
a named fund with its own yield, a sovereign token with its legal findings, an issuer's stablecoin, a deactivated
seed entry. A firm row with a seed's code replaces that seed entry for the firm. Rows are visible to the firm
only. Editing needs the trader, controller, risk or admin role.

## 2. Schedules (`Schedule`, `collateral_schedules`)

Per counterparty, versioned by effective date: the admitted instruments, each with whether it is admitted for VM
and for IM, a negotiated haircut (blank = the class's CRE22.49 row) and a concentration limit; the composition
posted and received today by instrument (weights, normalised to one on save); the rail; a note. The counterparty
page edits it in the same form as the CSA terms (NEW COUNTERPARTY, EDIT TERMS); a new counterparty starts from
cash and government paper of its CSA currency.

Saving a schedule also writes the record's class-level fields (`eligible_collateral`, `posted_composition`,
`received_composition`) derived from it, so every reader that predates schedules sees the same facts. A
counterparty with no schedule keeps today's behaviour: those class-level fields, or cash and government
securities when they are blank.

## 3. The regime a schedule derives (`regime_from_schedule`, `collateral/regimes.py`)

- eligible classes = the admitted instruments' classes;
- posted and received compositions aggregate by class, and the instrument-level compositions ride along
  (`posted_instruments`, `received_instruments`) for the derivation drawer;
- the on-chain rail sets the on-chain MPoR state (the cleared floor, atomic settlement); the bilateral rail keeps
  the CSA's own MPoR from the margin terms;
- each class's yield is the weighted yield of the instruments posted in it, resolved from market data
  (`instrument_yields_bp`), so the IM pickup in MVA is the posted composition's real carry rather than a typed
  number;
- netting enforceability comes from the record.

A cash-only schedule on the bilateral rail reproduces the class-level regime field for field
(`tests/test_collateral_instruments.py`), so numbers before and after a schedule is recorded agree.

Where it is used: the first column of the ticket's CAPITAL tab (`/api/capital/trade`), the BASELINE of the book's
regimes report (Risk → CAPITAL, `ccr/capital_report.py`), and, from C2, the XVA tab's collateral block.

## 4. Routes (`api/routes/collateral.py`)

| Route | What |
|---|---|
| `GET /api/collateral/instruments` | the seed with the firm's rows over it, every yield resolved from today's market |
| `POST /api/collateral/instruments` | add or replace one of the firm's rows |
| `DELETE /api/collateral/instruments/{code}` | remove the firm's row (a seed entry is overridden, never removed) |
| `GET /api/collateral/schedules` | {counterparty id: the schedule in force} for the account |
| `GET /api/collateral/schedule/{cp_id}` | the schedule in force, its history, the regime it derives and its explain lines |
| `PUT /api/collateral/schedule/{cp_id}` | a new version; the record's class fields follow |

Before `docs/migrations/2026-11-05_collateral.sql` is applied the routes serve the seed and no schedules and the
writes answer 409; nothing else changes.

## 5. The ticket (C2, done 4 November 2026)

- **Carry over OIS** (`Instrument.carry_bp`): what the engines use. A CURVE instrument on its currency's OIS is its
  spread; on another curve the two curves' difference plus the spread; FIXED is the rate less the OIS one-year zero
  of the account's latest market; NONE is minus that OIS. Without a market a spread stands and the rest count zero.
  The absolute yield (`resolve_yield_bp`) stays for display.
- **ColVA** in the waterfall (`docs/xva.md` §7b) from the CSA's `vm_post_carry_bp` and `vm_recv_carry_bp`; the
  schedule-derived regime sets both on its CSAs; `collateral/apply.py` sets them from the ticket's own choice
  (`collateral: {posted, received, im_posted?, rail?}` on `/api/xva/simulate`, `/currency`, `/currency-option`),
  with the IM pickup from the posted side's eligible part unless the CSA body overrides it.
- **The ticket:** SETTLEMENT & COLLATERAL on the rates, FX and digital-asset panels: one select per side over the
  firm's instruments with their carries, the counterparty's schedule as the default when one is recorded, a button
  back to it; the ColVA cell in the strip; the on-chain comparison on by default with the saving in money and bp.
- **The book:** the credit engine's economic CSA for a counterparty is its schedule's (`ccr/report.py`), so the
  exposure paths, the incremental charge and the reserves carry the schedule's MPoR, pickup and carries.
- Both Excel replications carry the two carries as inputs and ColVA as a column; the methodology is v1.4.

## 6. What comes next (C3)

Risk → COLLATERAL (requirements, inventory, carry, settlement status; the regimes report moves there), a
COLLATERAL CARRY line in P&L, the yields as IPV inputs, the COLLATERAL module switch live, ColVA in the incremental
charge's components.
