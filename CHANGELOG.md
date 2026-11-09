# Changelog

By date, newest first. The API reports its version and commit on `GET /api/ops/health`; the
methodology document carries its own version (v1.7). Commits on `main` are the detail.

## 0.14.0 · 9 November 2026

- **Fixings for digital assets.** A cash-settled trade's record has always named a settlement price source; nothing
  stored a fixing, so an expired trade was valued on the stored spot of the day and then read zero.
  - **The store** (`backend/settlement/`, table `fixings`, `docs/migrations/2026-11-10_fixings.sql`): the venue's
    daily delivery price for BTC, ETH and SOL (Deribit, 08:00 UTC), read once a day, shared by every account and
    never overwritten by the feed; a desk's own entry for a benchmark, its own only, a later entry superseding the
    earlier one. `GET /api/currency/fixings/{pair}`, `POST /api/currency/fixings`, a cron-gated tick, a scheduler
    step and a health check `crypto_fixings`. Until the migration is applied nothing is stored and everything
    behaves as before.
  - **What the feed's price has to pass.** A date the venue can have published; a value within 15 % of the template
    account's stored spot for that date (the day beside it where there is none), else it is not stored. A re-read
    that differs from a stored fixing stores nothing and marks the date disputed. The tick fills holes among the
    last ten dates; health is red on a hole in the last week or a disputed date. An administrator fills or
    corrects a date with a reason (`POST /api/currency/fixings/correct`; `override_band` with a longer reason
    stores a genuine fixing outside the band); the old row is kept. A desk cannot store a fixing under the
    venue's name or one that reads like it. The venue's source is offered on a ticket only where the feed is
    delivering that pair.
  - **Settlement** (`settlement/rule.py`, one rule for the booked valuation and the ticket): from its fixing date a
    trade is valued on the fixing of exactly the source it names, a forward at sign × N × (fixing − K) discounted to
    the settlement date, an option at its payoff on the fixing; another source's price is never used. With no
    fixing stored the value is today's (the stored spot), marked provisional. A barrier or touch option whose
    knock state is not recorded, and which the fixing does not decide, is provisional too: the amount shown is the
    one that holds if the barrier was never touched. The answer for a booked trade names its `state` (`LIVE`,
    `FIXED`, `SETTLED`); a booked digital-asset trade opened on or after its fixing date shows the fixing used,
    the amount and both dates instead of an error or a scenario. Not in this change: the trade's status does not
    change and no settlement event is written.
  - **On the ticket:** SETTLES ON, a choice between the venue's price (fixed automatically) and the benchmark (the
    desk enters it). The default is the automatic source wherever the feed is delivering that pair's fixing, which
    is the hosted demo once the table is there, and the benchmark elsewhere (`settlement_default` in the pairs
    answer; `fixing_default` is unchanged for older web clients). The fixing time on the record always follows the
    source, and booking checks it. Trades already booked keep the source they name.
  - **FIXING DATE** on the forward: the settlement date for the venue's morning price, one day earlier for a
    benchmark, editable from tomorrow, and no earlier than seven days before settlement, to the settlement date;
    the record's valuation date, checked at booking. Before its fixing date a forward is priced to the settlement
    date (1.4bp of notional per day of gap at a 5 % basis), which is why the gap is limited. An option fixes at
    its expiry, and the ticket says so.
  - **Market data → FX · Crypto → Fixings:** the last thirty days per source, and the entry form.
- **The CURVE SCENARIO tab of currency and digital-asset tickets, redrawn.** A chart of the pair: recent fixings to
  the left of today, the forward curve to the right, the strike and the settlement date marked. The curve is
  dragged by tenor (with a ripple to its neighbours) or as a whole, and the forward, the value and the ladders
  follow, repriced in the browser with the pricer's closed form and the backend's interpolation of forward points.
  FIXING AT EXPIRY takes a scenario fixing and shows the settlement amount. The sliders and ladders remain below.
- Fixed on the way: the tabs of a priced currency ticket could be handed the terms of the moment before the quote
  arrived (none), which the new tab showed as "no settlement price source".
- **Migrations reach production through the API.** The deployed API applies, when it starts, the migrations on
  an approved list (`backend/db/migrations_approved.txt`, copies in `backend/db/approved/`): each line carries the
  file's sha256 and the owner's approval in his own words. One transaction per file with its ledger row, a guard
  against destructive statements, off everywhere but the deployed API (`RIJEKA_MIGRATE`; a hosted database is
  refused outside it); `GET /api/ops/health` → `migrations` counts what was applied and what is pending, and
  `GET /api/ops/migrations` names them for the admin role. A ninth role, Edgar the database keeper, reviews every
  entry (`.claude/agents/edgar.md`).
- `backend/stack/apply.py` and the seed no longer follow the shell's `DATABASE_URL` to a hosted database: one is
  accepted only when named with `--database-url`, never for `--reset` or the seed, and its password is not
  printed.
- PRICE on a booked currency or digital-asset trade revalues it as booked; the button did nothing there before.
- Methodology v1.7; the map (`docs/architecture.md`) gains "Fixings and settlement", "Migrations in production"
  and the new writers.

## 0.13.0 · 9 November 2026

- *Same day, frontend only:* on Market data → FX · Crypto the source of a pair's forward points is one word in
  the table (FEED, MANUAL, BLOOMBERG; the whole label on hover) and a few words in the list. Printed whole, a
  feed's label wrapped to four lines and stretched every row of the table; the list rows had grown the same way
  earlier in the day. The table no longer spreads across a wide screen.

- **The launch view.** Two people shown the app found it overwhelming. A workspace provisioned for a new sign-in
  now starts on the `LAUNCH` set of modules: book, value, the XVA charge and its saving on chain, confirm.
  - **What a launch workspace shows.** A home page of four next steps and one button; a top bar of five items; a
    ticket without the CAPITAL tab; no P&L or RISK pages; Configurations without the items of switched-off modules
    or the roadmap placeholders. Nothing is removed from the product: the owner switches modules on under
    Configurations → Modules. Switching single modules on keeps the launch view; choosing a full preset such as
    Dealer brings back the dashboard home and the full XVA tab (`GET /api/modules` → `view`).
  - **Existing firms are not touched.** The preset is written only where a firm is created. A firm with nothing
    chosen keeps every module on and the dashboard home; its XVA tab is as it was, plus the one toggle. (A sign-in
    that never had a firm gets one, on the launch set, as any new sign-in does.)
  - **Simple XVA view.** On a launch workspace the XVA tab opens with the counterparty, settlement and collateral,
    SIMULATE, one line saying what the run assumes, and the results. The model inputs are behind SHOW MODEL INPUTS;
    the choice is remembered in the browser. The request sent is the same in both views (a browser journey compares
    them on a rates ticket at default inputs). The line says so when there is no stored calibration or no vol
    surface, instead of naming one.
  - **Who switches modules.** A profile admin anywhere; and, where every sign-in gets its own sandbox firm, the
    owner of a firm of one. Before this only a profile admin could, which on the hosted demo meant nobody a
    visitor could ask. A switch hides and skips; it is not an entitlement, and a module's API routes still answer
    when it is off. A launch workspace's P&L, risk and credit batches are off from its first day.
  - `RIJEKA_SIGNUP_PRESET` (default `LAUNCH`; `NONE` for every module on, as before).
  - Also: the RISK item in the top bar counts Collateral and opens the first risk page that is on; the home page,
    the top bar and the Risk and P&L sub-navigation read one list of which page needs which module.
- **Security, found by Magnus on this change and older than it.**
  - Provisioning looked a new account's firm up by a name built from its email and joined it as the firm's admin
    if one existed. It now always creates a new firm of one.
  - Module switching by a firm's own admin is limited to a firm of one, the note on a switch is bounded, and the
    two new write routes are rate limited.
- **Back to the venue's forwards.** In production the template account held its own saved BTC, ETH and SOL forward
  curves, so the feed, which never replaces an account's own entry, stored vols and no forwards. Market data →
  FX · Crypto → a digital-asset pair now offers USE THE FEED'S FORWARDS, in two steps, to an account pricing on its
  own saved points. Nothing is deleted: today's row is written with the same points under a feed label, the next
  marks run replaces it with the venue's, and the saved rows of earlier dates stay, so a past day re-runs as it
  did. For the template, the demo accounts still on a copy of its curve are handed back with it. It is refused
  where the feed does not write to the account or has no forwards for the pair yet.
- **Emmy's first two runs, on the venue surface** (the model validator, added today). No figure was wrong against
  the documented formula; the supports and several claims were.
  - The stale-mark filter went through three versions in a day: comparing a mark with the line between its
    neighbours also removed the neighbours; taking the worst first fixed one stale mark and failed on two side by
    side and on one at the end of a short chain. It now compares a mark with the median of the five around it.
    Three stale marks side by side are still not seen by it and are left to the bounds.
  - Stated with measured sizes in the methodology (v1.6) and the model inventory, which gains a row for the surface:
    a three-point smile is an extrapolation outside the 25-delta strikes (2 to 3 vol points low at 10 delta and 5 to
    9 at 5 delta on the skew side of test smiles); a listed expiry between tenors can be up to 1.3 points off, not
    "a few tenths"; ATM is the 50-delta-forward vol, 0.1 to 0.8 points from the vol at the forward strike at these
    levels; FUND01 under quoted points is exact to two years and a third low at three; the built vol history never
    scales its one-week row. None of the new calculations has a QuantLib row or a workbook yet; the inventory says so.
  - A digital-asset option on a quoted forward no longer says "the funding rate as the carry".
- Two more roles since 0.12.0: Nikola (architect, consulted before this build as well as after) and Emmy (model
  validator); what each role missed on the Deribit feed is written into its definition. Reviewed by Vera (no
  blocking finding, five to fix), Magnus (one high, older than this change; one medium), Nikola (the map
  against the code) and Emmy; all fixed here or stated above.

## 0.12.0 · 9 November 2026

- **Live digital-asset market data.** BTC, ETH and SOL option vols and forwards come from Deribit's public option
  marks (`market_data/deribit.py`), refreshed every ten minutes together with the spot, in place of the parametric
  surface and the flat funding rate. On 9 November the old BTC surface stood some fourteen vol points above the
  market with the risk reversal on the wrong side.
  - **The reading.** Per listed expiry the marks are read at 25 and 50 forward delta, the convention of the pricer's
    smile; across expiries ATM is linear in total variance, onto ten tenors (the FX grid plus 2W and 3W, where the
    listed term structure is steepest). The pricer is linear in vol between tenors, so it returns the venue's mark at
    a tenor and close to it between tenors from two weeks out; inside one week it holds the one-week level, which a
    steep front end can miss by points. The forward of each expiry over the index is stored as forward points; on
    the market forward mode the ticket's forward is spot plus those points. Three unauthenticated requests per run.
  - **On the ticket.** The vol and the forward name the venue and the time of the marks. A funding rate typed on a
    digital-asset ticket still wins on that price: the forward is then the carry at that rate and the response says
    so. (As before, a typed rate is not stored with the trade: the booked trade and the XVA tab value on the market.)
  - **Safeguards.** The venue's response is treated as someone else's data: a size cap and a deadline on the read,
    finite numbers and well-formed expiry codes only, marks dated within thirty minutes, a forward within bounds of
    the index, the index within 5 % of the spot fetched in the same run. Within an expiry a mark that stands off its
    neighbours is left out; an expiry inside two days, with fewer than six usable marks, with no open interest, or
    that does not reach the 25-delta points is left out; a surface needs two expiries. When the venue does not
    answer nothing is written: the last good surface stands with its own time and the daily rebuild carries it. The
    health check `crypto_marks` reads the time the marks carried (not when a row was written), for the template
    account, and turns red two hours after the oldest of the three assets; it is absent where the feed is off.
  - **Accounts.** The marks are written for the template account and pushed to every demo account in one statement.
    An account's own entry for a digital-asset vol or forward curve, the template owner's included, stays in force
    until that account replaces it: the marks tick copies and replaces only rows a feed wrote, and the daily copy
    does not lay a venue's row over an own entry. (The older writers keep their rules for the curves they build;
    `docs/architecture.md` lists each writer and what it replaces.) Saving a desk spot on a pair whose points come
    from the feed saves the spot alone.
  - **Risk.** FUND01 on the ladder is unchanged in meaning: on quoted points +1bp of funding moves the points it
    implies. A built history row never replaces a venue row, and the vol history before the venue's first surface is
    rebuilt from it so the series has no step; that takes effect when the history backfill is next run, and until
    then a VaR window containing 9 November samples the change of source as one day's fall in vol
    (`docs/market_risk.md`). Not yet a risk factor: the forward points themselves, so the basis has no VaR; the
    counterparty-credit paths still drift a digital asset at the stored flat funding rate.
  - **What moves on the first day.** A booked digital-asset forward or option revalues on the venue's forward and
    vol. The vol part is attributed to the vol step of the P&L explain; the forward part has no previous day's points
    to difference against and lands in "Cross & unattributed" that once. The pinned sample book is unchanged (the
    local stack has no venue).
  - **Switch.** `RIJEKA_DERIBIT=0` stops the requests; the process that runs the batches then removes the venue's
    rows from the template and demo accounts at the next daily rebuild (a developer's shell on the shared database
    cannot). Run the history backfill afterwards to rebuild the vol series. `RIJEKA_SCHEDULER_MARKS_MINUTES` sets the period.
  - Methodology v1.5; `docs/architecture.md` gains a market-data table, source by source, and the venue in the diagram.
  - Reviewed by Vera (one blocking finding: the desk-spot save; ten others), Magnus (two medium, six low) and
    Nikola, the architect, a seventh role added with this change (the map claimed more than the code did in a dozen
    places, most of them older than this change); all fixed or answered here. Tests: the builder against chains generated from a known smile (no venue data
    in the repository), hostile and malformed responses, the routes, the scheduler group, the health check, the
    history guard and anchor, FUND01 on quoted points, an integration test on the local stack, and a browser journey
    for the ticket's captions (33 journeys).

## 0.11.1 · 8 November 2026

- **Guardrails.** Six named roles with one job each (`CLAUDE.md`, `.claude/agents/`, `docs/ops/release.md`): Quinn the
  browser tester, Ada the numbers guardian, Vera the independent reviewer, Magnus the security reviewer, Jarvis the
  release manager, Petra the project manager.
  - **Browser journeys** (`frontend/e2e`, CI job `browser journeys`): the built app in a real browser on the local
    stack, signed in with a stack-minted token, PostgREST serving the supabase-js reads. Every page opens clean; the
    rates, FX and digital-asset tickets go from pricing through XVA, capital, booking and confirmation; the results
    must be on a laptop screen.
  - **The pinned sample book** (`tests/integration/test_golden_book.py`): 66 figures on a fixed market, date and
    seeds; a figure moves only with a dated explanation.
  - `GET /api/ops/health` reports under `schema` which optional migrations are applied and what each gates.
- **Found by the first runs and fixed:**
  - PRICE pressed before the par rate had solved priced the swap's fixed leg at 0 % (a "par" swap worth $1.6m) and
    the XVA then ran with no IR01. The window now holds the click until the coupon arrives, or says why it cannot.
  - Twenty-eight calls on the market-data configuration pages used a relative `/api/…` path. On the hosted app that
    reaches the static host, which answers with the HTML shell, so stored skew, SABR and cap-vol data silently did not
    load. They go through one helper (`lib/api.js`); a lint rule forbids a relative API path.
  - The XVA results fell below the fold whenever the inputs column was tall (a bilateral CSA with the collateral
    block). The chart and the results now set the panel's height and the inputs scroll on their own.
  - A non-admin's System page asked for the admin usage figures (a 403 on every visit); a rounded-zero bp figure
    printed "+-0.0bp"; the on-chain NPV cell clipped its value.
  - The local stack's seed lacked the platform firm, so the messenger's rooms call failed on every page there.

## 0.11.0 · 4 November 2026

- Collateral in the book, phase C3 of `docs/archive/PLAN_collateral_2026-11-04.md`:
  - **Risk → COLLATERAL:** per counterparty the schedule in force, today's variation-margin position and initial
    margin from the latest stored credit run, what each side is held in by instrument at its haircut, the carry per
    year over OIS, the rail; totals by instrument and by class, the on-chain share; the book under regimes (the
    report that was Risk → CAPITAL) below it. `GET /api/collateral/book`.
  - **Risk → CAPITAL** is regulatory stock only for the CSA as booked (RWA, K CCR, K CVA, EAD, IM, leverage
    exposure, HQLA of IM), per counterparty and in total.
  - **ColVA in the book:** the credit engine's components, the P&L's XVA reserves, the incremental charge and the
    regimes report's metrics carry it; a regime's cost is −(CVA + FVA + KVA + MVA + ColVA).
  - The COLLATERAL module switch is real (it was listed as planned): Risk → COLLATERAL and the ticket's collateral
    block.
  - Stated as not done: collateral yields as IPV inputs and a realised carry line in P&L (`docs/collateral.md` §6).

## 0.10.0 · 4 November 2026

- Collateral on the ticket, phase C2 of `docs/archive/PLAN_collateral_2026-11-04.md`:
  - **ColVA**, the carry of the variation margin against cash at OIS, in the waterfall (`docs/xva.md` §7b): posted
    margin in an asset earning more than OIS earns the excess, held margin in an asset earning less than the OIS
    rebate costs the shortfall; cash on both sides is zero, so every figure that predates instruments is unchanged
    (tests on the closed form). Every instrument enters as its carry over OIS; the IM pickup in MVA comes from the
    posted side's eligible part instead of a typed number (the field stays as an override).
  - **SETTLEMENT & COLLATERAL** on the rates, FX and digital-asset XVA panels: what the margin is posted and received
    in, from the firm's instruments with their carries; the counterparty's schedule is the default when one is
    recorded; the ColVA cell in the strip; the on-chain comparison on by default with the **saving on chain** in money
    and in bp of notional, upfront and running.
  - The three XVA routes take `collateral: {posted, received, im_posted?, rail?}`; the book's credit engine uses the
    schedule's economic CSA for a counterparty (MPoR, pickup, carries).
  - Both Excel replications carry the two carries as inputs and ColVA as a column; methodology v1.4 (ColVA, the
    instruments and schedules subsection).

## 0.9.0 · 4 November 2026

- Collateral as a first-class object, phase C1 of `docs/archive/PLAN_collateral_2026-11-04.md` (`docs/collateral.md`):
  - **Instruments.** A public seed (USD/EUR/GBP cash, Treasury bills and notes, Bunds, Gilts, USDC, USDT, PYUSD, a
    generic tokenised money-market fund share, a generic tokenised Treasury-bill claim, BTC, ETH, SOL), each with its
    regulatory class, rail (bilateral or on chain with token address) and yield source (a curve's short rate plus a
    spread, a fixed rate, or none), resolved from the account's market every time it is read. A firm adds its own rows
    under Configurations → Collateral Instruments; a firm row with a seed's code replaces that entry for the firm.
  - **Schedules.** The CSA's eligible-collateral annex per counterparty, versioned by effective date: admitted
    instruments (for VM, for IM, a negotiated haircut, a concentration limit), what is posted and received by instrument,
    the rail. Edited on the counterparty page beside the CSA terms; a new counterparty starts from cash and government
    paper of its CSA currency. The record's class-level fields follow the schedule.
  - **The regime is derived.** The counterparty's regime (the first column of the ticket's CAPITAL tab, the BASELINE of
    Risk → CAPITAL) comes from its schedule: classes from the instruments, the on-chain rail setting the on-chain MPoR
    state, each class's yield the weighted yield of the instruments posted in it. A cash schedule on the bilateral rail
    reproduces the previous regime field for field.
  - **CAPITAL tab is stock only:** IM, EAD, RWA, K CCR, K CVA, leverage exposure, HQLA of IM. KVA, MVA, CVA, FVA and the
    quote line leave the grid; they are prices and move to the XVA tab in C2.
  - Migration `docs/migrations/2026-11-05_collateral.sql` (two tables); a deploy ahead of it serves the seed and no
    schedules. Routes under `/api/collateral`. Tests: unit (`tests/test_collateral_instruments.py`) and integration
    (`tests/integration/test_collateral.py`).

## 0.8.4 · 4 November 2026

- CAPITAL tab on the ticket: the regime and counterparty-type chips are whole blocks that wrap as a row (they broke
  mid-label and ran off the column, which also drew a horizontal scrollbar); the paths field is a plain number
  field clamped to the route's 200–5,000; a footer figure that rounds to zero reads "$0" on every product (rates, FX,
  crypto) instead of "−$0" or "-0".

## 0.8.3 · 4 November 2026

- Hotfix: the rates XVA tab crashed with "fit_details.map is not a function" whenever it loaded a stored calibration
  instead of a fresh one (a new sign-in, or a cleared session). The calibration row stores the fit table inside an
  object (with converged, iterations and the surface errors) while the calibrate response carries it as a list; the
  latest-calibration endpoint now returns the response shape, and the tab normalises whichever shape it is given.
  Tests on both ends.

## 0.8.2 · 3 November 2026

- The "is the migration applied" checks for the counterparty capital attributes, the module switches and IPV no
  longer cache a negative answer for the life of the process, so a migration applied while the API runs is seen at
  the next request. The five pending migrations were applied in production on 3 November (role check, counterparty
  capital, margin terms, firm modules, IPV); `2026-11-03_jobs.sql` waits for the Render Blueprint sync.

## 0.8.1 · 3 November 2026

- Hotfix: 0.7.3 shipped two undefined variables that the build does not catch (the app shell's route guard read the
  module store without importing it, so P&L and RISK crashed with "Can't find variable: modules"; the home page read
  the switches in the wrong component). Fixed; the linter (`npm run lint --quiet`) is now a CI step, so an
  undefined variable fails the build.

## 0.8.0 · 3 November 2026

- Independent price verification (P&L → IPV, `backend/ipv`, `/api/ipv/*`): the inputs the book is priced on are
  derived from the trades in scope (every curve, funding level, vol surface and spot they read), each laddered per
  pillar through the production pricers (one quote bumped, the dependent trades repriced); a curve verifies by
  pillar, a swaption surface by expiry × tenor point, an FX surface by tenor and quote type, a spot as one cell;
  an independent mark (a controller's upload, or a self-host's second feed; `ipv_independent_marks`) gives each
  pillar a gap and a status against the firm's tolerance rules (`ipv_tolerances`, most specific wins, defaults
  otherwise); an override is a market-data event with author and reason (`ipv_overrides`) and carries its
  first-order impact (sensitivity × shift); APPLY reprices the book on the overrides and shows the residual as
  second order; inputs are VERIFIED, OVERRIDDEN, APPROVED, WAIVED (automatically when immaterial at tolerance,
  or by decision with a reason) or PENDING; the gate (no pending input, no unvalued trade) then the controller's
  sign-off writes the official P&L (`ipv_runs`, a `pnl_signoffs` row with role IPV), shown as FLASH / OFFICIAL on
  the trading P&L. Scope GLOBAL / DESK / BOOK. The run goes to the worker (`ipv_run`) or a thread; `live=1` for
  small books. Migration `docs/migrations/2026-11-05_ipv.sql`.
- P&L gains its navigation: TRADING P&L | XVA RESERVES (the reserve book: levels per counterparty and component,
  the day's change, netted against memo per the firm's policy) | IPV; Configurations → P&L & CONTROL → IPV
  TOLERANCES. The module switches IPV and XVA RESERVES are live.

## 0.7.3 · 3 November 2026

- Module switches per firm (Configurations → Operations → MODULES, admins; `GET/PUT /api/modules`,
  `backend/modules.py`): on-chain confirmation, P&L, XVA on the ticket, market risk, counterparty credit, capital,
  Prometheus, news, with collateral, XVA reserves and IPV listed as planned. A switch hides the module's pages and
  tabs (the app bar, the risk tabs, the ticket's XVA, CAPITAL and CONFIRM tabs, the home page's P&L tile), sends a
  direct visit to its route home, and skips its nightly batch for the firm's accounts; it never deletes anything.
  Presets DEALER, CORPORATE, FUND, CLASSROOM. Every change is a `module_events` row with who, when, before and
  after; `docs/migrations/2026-11-04_firm_modules.sql`, until which every module is on.

## 0.7.2 · 3 November 2026

- Configurations → Counterparties: EDIT TERMS on every row (ISDA, CSA type, currency, threshold, MTA, discount curve,
  IM model, type, rating, CVA sector, eligible collateral, enforceability, UMR scope, margin frequency, disputes)
  through `PUT /api/counterparties/{id}`, which now accepts the CSA terms and validates them; the row shows the
  terms the credit report and Risk → CAPITAL read. Risk → CAPITAL: shorter column headers that fit, a reduction
  in green and an increase in red throughout.

## 0.7.1 · 3 November 2026

- Risk → CAPITAL: the book under collateral regimes (`GET/POST /api/capital/portfolio`, `ccr/capital_report.py`, the
  `capital_run` job on the worker). Every netting set is simulated once and re-collateralised step by step from the
  CSA as booked to an on-chain CSA under today's rules (zero threshold and MTA, daily margining, no dispute doubling,
  recognised collateral, eligible IM at its yield), then to the forward-looking states (the cleared-floor margin
  period of risk, a tokenised sovereign claim as IM, Level 1 liquidity); each step's difference is its channel's
  attribution and the steps add up to the columns exactly; per counterparty and for the book, every capital
  metric, the change against the baseline and the quote in bp; the invariants (SIMM IM, market-risk capital) stated
  on the page. The counterparty record gains margin frequency and dispute state
  (`docs/migrations/2026-11-04_counterparty_margin_terms.sql`); the credit report's MPoR follows them.

## 0.7.0 · 3 November 2026

- Capital on the ticket (CAPITAL tab, `POST /api/capital/trade`): the trade's SIMM IM, SA-CCR EAD, RWA, CCR and
  CVA capital, KVA, MVA, CVA, FVA, leverage exposure and the HQLA value of the margin posted under every collateral
  regime and counterparty type, as the counterparty's netting set with the trade, without it (common random
  numbers) and the trade alone; a derivation drawer per cell with the formula, the regime's two CSAs, the inputs
  and the SA-CCR snapshot per trade and hedging set; the regime's cost against the first column in bp.
- Collateral classes and regimes (`pricing/collateral.py`): cash, government securities, a tokenised sovereign
  claim, tokenised fund shares, payment stablecoins and cryptoassets with their recognition (CRE22, SCO60.94),
  haircuts (CRE22.49), margin eligibility (CFTC §23.156), liquidity level (LCR30) and SCO60 group; a regime derives a
  regulatory CSA and an economic CSA; four presets.
- SA-CCR by asset class (`pricing/sa_ccr.py`, CRE52): interest rates with maturity buckets, FX, the cryptoasset
  class (SCO60.98), credit, equity and commodity; supervisory deltas for options; the Basel Committee's five worked
  examples reproduced unrounded as the reference suite. The waterfall's KVA leg now uses it along the path for
  every product (before: the interest-rate factor for all) and gains the CVA-capital leg (MAR50.14–50.16) with the
  counterparty's CRE20 risk weight; defaults reproduce 0.6.0 exactly.
- Counterparty record: type, rating bucket, risk-weight override, CVA sector, UMR scope, eligible collateral,
  compositions, enforceability (`docs/migrations/2026-11-04_counterparty_capital.sql`; read and written only once
  applied). Methodology v1.3 (§16); `docs/capital.md`.

## 0.6.0 · 2 November 2026 (launch candidate)

- Staging layer: a Docker-free local stack (`backend/stack`: the Supabase pieces stubbed on a plain PostgreSQL 16,
  the schema and the dated migrations applied statement by statement with a ledger, a seed with two users, a firm and
  fixed market data of 2026-11-02, a local ES256 key set the API reads through `RIJEKA_JWKS_FILE`); 59 API-level
  integration tests (every product booked with the app's own bodies and priced, tenancy, XVA for every style, the
  three reports, the methodology workbooks, confirmation with the `NullBackend`, 401/403) on a `postgres:16` service
  in CI; `docker-compose.yml` with GoTrue for sign-in as the one-command self-host (unexecuted by its author; CI
  smoke-tests `db` + `migrate`).
- Worker tier and asynchronous confirm: a `jobs` table and a `python -m worker` Render service take the counterparty-credit RUN NOW and the risk backfill off the API (routes fall back to in-process threads without the table or the worker); `POST /api/chain/confirm` waits 25 s for the receipt, then answers 202 with the transaction and `chain/pending.py` applies the CONFIRMED transition once the registry has it (`chain_reconcile` every scheduler cycle, `POST /api/chain/reconcile/{trade_id}` polled by the trade window); migration `docs/migrations/2026-11-03_jobs.sql`.
- Vol along the exposure paths: the surface's ATM term structure drives the simulated spots and an option is valued at
  each date at the forward vol for its remaining life and the smile at its moneyness (sticky-delta), in the ticket's
  XVA and in the credit engine alike; the credit engine's risk-neutral spot vol comes from the pair's surface instead
  of a desk default. RE-ROLL, seed and engine time on every XVA tab.
- XVA on every ticket: an incremental charge from the credit engine (the counterparty's netting set with
  the trade and without it, same paths) for rates, FX and digital-asset products, options included; the
  stand-alone forward XVA reads the pair's own vol surface; a stand-alone option XVA for every FX and
  digital-asset style (the option valued along simulated paths with the credit engine's model), with the
  simulated paths drawn behind the profiles and the on-chain comparison on the FX and crypto tickets as on
  the rates tab; Excel replications of the FX and digital-asset forward XVA with the engine's draws.
- Licence: the market-risk, counterparty-credit and P&L engines (`backend/risk`, `backend/ccr`, `backend/pnl`)
  move from the platform (BSL 1.1) to the engine side (Apache-2.0), alongside pricing and chain.
- Launch audit: three independent reviews, the S1 list fixed the same day (tenant scope on the
  cashflow bulk write, a BOOKED event for every trade however created, no driver or RPC text to
  clients, rate limits on every expensive handler, a Prometheus daily allowance, admin gate on
  platform analytics, logging configured; the app's global error handler no longer erases a mounted
  desk; confirm works on a fresh cap/floor/collar/swaption booking). Architecture page, environment
  reference, model inventory, glossary, this changelog, one version constant.
- XVA replication for rates: the Hull-White Monte Carlo rebuilt in Excel from the engine's own draws,
  the swaption calibration with an RMSE grid, the CSA bridge and the waterfall; a live mode.
- Methodology v1.2: market-risk and counterparty-credit chapters; the app serves the current PDF.
- Digital-asset options (BTC, ETH, SOL) in every style on the FX option engine; CRY01, IR01 as
  discounting, FUND01; vol surfaces as VaR factors; VOL stress scenarios.
- FX options: European, American, digital, barrier, double barrier, touch, each against QuantLib;
  FX vol surfaces; the VOL step in P&L; Excel replications for every style but American.
- Open-box replications: cover, ticket rebuilt in cells, derivation ledger, scenario chart, Checks
  sheet; SHOW MATH on the ticket; legacy spreadsheet functions only.
- Blotter follows the trades table live; the counterparty's booking of a product trade needs no legs.
- Deploy chain: Render deploys every commit on main; `release` follows main on frontend-only and
  docs-only pushes.

## 1 November 2026

- QuantLib reference suite: every product repriced independently on every commit (424 comparisons);
  the pricing fixes it found; methodology v1.1 with the Independent reference section.

## 30–31 October 2026

- Counterparty credit: netting sets on shared paths, two measures, historical block sampling, PFE
  and credit limits, caps, floors and swaptions on the exposure paths; XVA on the P&L page.
- Market risk: full-revaluation historical VaR, stress, limits, backtesting; stored daily runs.
- P&L: an AMEND step; sign-off policy per firm.
- Security pass: roles from the database, tenant-scoped legs, no token in errors, relayer budget,
  report-only content security policy, no runtime CDN scripts, PyJWT and Vite updates.
- Batches and the release move run inside the API; browser errors reported to a System page; usage
  beacons without cookies; auth email through Resend.

## 28–29 October 2026

- FX spot, forwards and NDFs on the G10 pairs and digital-asset NDFs on one interest-rate-parity
  model; one risk taxonomy across rates, FX and crypto; quoted forward curves and the basis.
- P&L attribution by sequential full revaluation with end of day and sign-off; market risk (ladder,
  VaR, stress, limits); Prometheus book brief with audited numbers; news summaries.
- Demo market data rebuilt daily from public sources; the policy path; the desk globe; the week
  ahead.

## Before 27 October 2026

Rates desk: OIS bootstrap, IRS / OIS / basis, European swaptions and SABR, caps and floors,
Bermudans, XVA under CSA, SIMM, on-chain confirmation on Sepolia, the messenger, the hosted demo.
Released under MIT until 27 October 2026 (tags up to `v0.5.4`), under Apache-2.0 / BSL 1.1 since.
