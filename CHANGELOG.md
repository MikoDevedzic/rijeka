# Changelog

By date, newest first. The API reports its version and commit on `GET /api/ops/health`; the
methodology document carries its own version (v1.3). Commits on `main` are the detail.

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
