# Rijeka

**Where the trading desk meets the chain.** An open-source OTC derivatives desk: the pricing, risk and bilateral confirmation a trading desk runs on, in open code, with the confirmed record anchored on Ethereum. Rates, FX and digital assets are live; credit, equities and commodities next. Free for everyone.

Most of the world's derivatives intelligence sits behind proprietary systems at a handful of large banks. Smaller institutions, emerging-market participants and academic researchers operate blind, without the tools to price, hedge or understand the true cost of a trade. Rijeka exists to change that.

Named after a village in Bosnia (*rijeka* means "river" in Bosnian, Croatian and Serbian), it is built on the belief that the mathematics of modern finance should be accessible to anyone with the ambition to use it.

---

## What is live

Hosted demo at [app.rijeka.app](https://app.rijeka.app); the in-app **ROADMAP** is the honest status of every item (DONE means in the code and tested).

- **Pricing.** OIS bootstrap per currency (SOFR, €STR, SONIA, SARON, TONA, AONIA, CORRA); IRS, OIS and basis swaps; European swaptions (Bachelier on a β=0 SABR surface); caps, floors and collars; Bermudans on a Hull-White trinomial tree; FX spot, forwards and NDFs on the G10 pairs and non-deliverable forwards on BTC, ETH and SOL on one interest-rate-parity model; FX and digital-asset options in six styles (European, American, digital, barrier, double barrier, touch) on one engine, each against its QuantLib counterpart.
- **Risk.** Key-rate IR01 ladders by bump-and-reprice with FX01 / CRY01, FUND01 and vega; historical-simulation VaR by full revaluation with the curves, spots and volatility surfaces as factors, the ladder VaR alongside; named stress; backtesting (Basel traffic light, Kupiec); limits with utilisation and breaches.
- **Counterparty credit and XVA.** Netting sets on shared Hull-White and lognormal paths, real-world calibration from public history with historical block sampling, the CSA on the netted value, EE / EPE / PFE and credit limits; the XVA waterfall (CVA, DVA, FVA, FBA, KVA, MVA) under CSA presets with a margin period of risk; SIMM initial margin.
- **P&L.** Attribution by sequential full revaluation (carry, cash, curves by bucket, spot, points, vol, residual), day / MTD / YTD, trader and controller sign-off, XVA P&L.
- **Confirmation on chain.** Canonical record v2 → EIP-712 → registry on Sepolia; amend and terminate; a public verifier that trusts nothing of Rijeka's. Messenger with firms, rooms, trade cards and wallet countersigning; Telegram mirror.
- **Open box.** The methodology (v1.3) names the module for every formula; the Methodology tab exports an Excel replication per product from your own market data, the ticket rebuilt in cells with every number linked to its derivation and a Checks sheet against the engine; the XVA book carries the engine's own Monte Carlo draws.
- **Prometheus.** A read-only assistant inside the messenger: sees your book and the engine, never changes anything.

## Validation

Every product is repriced in QuantLib on every commit: 424 comparisons in `backend/tests/reference`, each with a tolerance that fails the build when exceeded; 696 Python tests; 16 Foundry tests on the registry contract. What is validated against what, and the open findings ([#31](https://github.com/MikoDevedzic/rijeka/issues/31)–[#36](https://github.com/MikoDevedzic/rijeka/issues/36)), is in [docs/VALIDATION.md](docs/VALIDATION.md); the April 2026 Bloomberg comparison for IRS and OIS (v0.4.2, 38 tests) is kept in `model_validation/` as history. Independent validators are wanted and named on the report: USD 250 for a confirmed S1 or S2 pricing finding.

## Public tools

No login required, on [rijeka.app](https://rijeka.app): the IRS pricer with a draggable curve (`/irs`), the XVA simulator (`/xva`) and waterfall (`/xva_ee`), the SABR vol surface scenario (`/vol_surface`), the Bermudan tree, the attribution and SIMM tools, and the verifier (`/verify`). Their source is the landing site, deployed separately from this repository.

## Desk home

Under the policy path, the next four decisions of the currency's central bank (FOMC, ECB, BoE, SNB, BoJ; published calendars in `backend/market_data/policy_path.py`) show what the curve prices for each: the forward overnight rate between consecutive meetings, the step in basis points against the window before, and the running total. Indicative, from the demo curve, not a forecast.

The desk home opens on the **desk globe**: a turning Earth lit by the real sun, the five desks glowing while their session is open, every live trade drawn as an arc from your entity's home city to the counterparty's, and an orbital ring that holds one satellite per confirmation anchored on the registry. Beside it, chain health (latest block, relayer wallet, registry), an inbox of what needs your action (countersign requests, trades awaiting the other side, maturities inside 30 days, confirmations that never reached the chain, a low relayer wallet) and the latest anchors with their proof links. Land outlines are Natural Earth 110m (public domain); the globe is plain canvas, no 3D library.

**Relayer budget.** The hosted demo pays Sepolia gas from one relayer, so every anchoring action (confirm, countersign, amend, terminate, the chat-card countersign included) is charged to the person who pressed the button before anything is sent, and counted as an attempt, so a reverted or timed-out transaction still counts. Three rolling 24-hour caps: `RIJEKA_CHAIN_DAILY_LIMIT` per user (unset = off, for local and self-hosted), `RIJEKA_CHAIN_FIRM_DAILY_LIMIT` per firm (default three times the user cap), `RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT` for everyone (default 200 once the user cap is set; with no cap set at all the budget is off and nothing is counted). Concurrent clicks serialise on an advisory lock. `RIJEKA_CHAIN_MAX_FEE_GWEI` (default 100) is a ceiling on the fee the relayer will pay; above it nothing is sent. Sends are serialised per process on the pending nonce, and a revert, a timeout or a used nonce is reconciled against the registry: if the record is already there, by this relayer or by the counterparty, it is taken as the anchor rather than retried into the same revert. Attempts are stored in `chain_attempts` (`docs/migrations/2026-10-31_chain_attempts.sql`), in memory until that table exists.

## Prometheus

The desk's quant, risk and margin analyst. Reads everything, changes nothing. Live today: read-only chat over your trades and the engine, in-app news summaries, and the **book brief** on the home page: the pricers compute a fact sheet (NPV and IR01 per trade, curve moves, pending confirmations, maturities, CSA terms, news tagged to the positions), Prometheus narrates it citing fact ids, and every number in the prose is checked against the sheet before it is shown; forecasting and advice are rejected. Next: scenario risk across the whole book, counterparty exposure and CVA commentary, SIMM margin against thresholds, a Telegram digest.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| Backend | FastAPI (Python) |
| Database | Supabase (Postgres) |
| Deployment | Netlify (frontend) · Render (backend) |

---

## Getting Started

**Backend**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

**Environment variables required:**
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
```

**Hosted demo.** [app.rijeka.app](https://app.rijeka.app) runs this code on the
Sepolia testnet. Sign up and a sandbox workspace is created for you: your own
entity, RIJEKA DEMO BANK AG as counterparty, the demo market data, trader role.
Book a swap, confirm it on-chain, and check the proof pack at
[rijeka.app/verify](https://rijeka.app/verify) — nothing in that check trusts
Rijeka's servers. Demo signatures for the demo bank are held by Rijeka and the
attestation says so (`bilateral: false`); a real counterparty countersigns with
its own wallet.

**Methodology.** The full model document, LaTeX and PDF, is in [docs/methodology](docs/methodology); the app's METHODOLOGY tab serves it and exports Excel replications per product from your own market data.

**Self-hosting.** Your curves, your trades, your keys, your Bloomberg seat:
see [SELF-HOSTING.md](SELF-HOSTING.md). The full schema is in
[docs/schema.sql](docs/schema.sql).

---

## Design principles

**No black boxes.** Every formula is documented, every number is traceable to the module that produced it, and every workbook shows its derivation.

**Institutional quality, open access.** The same mathematics used at tier-1 banks, available to anyone.

**One taxonomy.** IR01 not DV01; FX01 on a pair and CRY01 on a digital asset; on a digital asset IR01 is discounting only and FUND01 the funding rate; SIMM-aligned aggregation.

**Audit-ready.** Every snapshot is stamped with its source and provenance; calibrations are stored with their fit diagnostics; every pricing change ships with a test and a before/after number.

---

## P&L and attribution

A `P&L` tab next to the blotter, and a tile on the desk home: day, month to date and year to date, each split into **market** and **trading** P&L, the attribution waterfall, the roll-up desk → book → trade with every trade's explain rows, and sign-off.

Attribution is **sequential full revaluation**, never a sensitivity estimate. Starting from yesterday's mark on yesterday's market, the valuation is moved one thing at a time in a fixed, stated order and each step is one row: carry (the date roll on the prior market), cash settled, each curve by tenor bucket (0-1Y, 1-5Y, 5-10Y, 10Y+; discount, forecast, then base), spot, quoted forward points, residual. Rows sum to the total by construction. New trades carry their close mark; unwinds remove the prior mark plus any fee. Marks are the production pricers on the saved market of each date, so the P&L page and the ticket agree to the cent.

End of day (`POST /api/pnl/eod`, and daily by cron for every account whose firm has the P&L module on) stores one mark per trade and one attributed row per trade per date, so MTD and YTD are sums of what was signed. Sign-off is trader first, then P&L controller or desk CFO (the `controller`, `cfo`, `admin` role, or a firm admin); a FINAL day is visible to management with the comments (`GET /api/pnl/firm`, the MANAGEMENT view). The history tables are `docs/migrations/2026-10-30_pnl.sql`; until applied, the report is computed live and says so.

## Market risk

A `RISK` tab next to P&L, and `Configurations › Market Risk` for the risk manager.

- **Ladder.** Key-rate IR01 by curve and tenor bucket (0-1Y, 1-5Y, 5-10Y, 10Y+, the same buckets as the P&L explain), by bumping each bucket 1bp and repricing every trade through the production pricers; FX01 and CRY01 per asset from the pricers, vega per surface and bucket. Totals in the reporting currency.
- **VaR.** Historical simulation by full revaluation: each day's observed changes in the window (basis points per tenor, log returns for spots) shift today's market and every live trade is repriced on it; VaR is the empirical loss quantile, expected shortfall the mean beyond it, the horizon scales by √t. The ladder VaR (the same changes applied to the key-rate sensitivities) is computed alongside as the linear comparison, and the gap is reported as convexity. The firm chooses the headline method; confidence, horizon, window and minimum observations are its settings.
- **History.** Risk factors come from the public sources the demo already uses (Treasury par yields, NY Fed SOFR, ECB €STR and AAA curve, BoE SONIA and gilts, ECB reference FX, Coinbase daily closes), fetched over a date range and stored as the template account's snapshots, which the daily rebuild extends. `risk-backfill.yml` fetches two years on dispatch.
- **Stress.** Named scenarios by full revaluation: parallel ±25/±100bp, steepener, flattener, USD ±10%, digital assets ±30%, a combined risk-off.
- **Limits.** The risk manager (`risk` or `admin` role, or a firm admin) sets limits on any reported number: VaR and ES, IR01 total or per curve or bucket, FX01 / CRY01 per asset, NPV, any scenario's loss; scope book total, desk or book; a warning level. Utilisation and breaches show on the risk page and in the home inbox after the daily run.

Tables: `docs/migrations/2026-10-30_market_risk.sql`.

## Counterparty credit

`RISK › COUNTERPARTY CREDIT`: exposure against credit limits, the way market risk is VaR against limits. Every trade of a counterparty is valued on the same simulated paths (a Hull-White factor per currency, a lognormal factor per spot; each monthly step a block of observed daily changes from two years of public history, the same block for every factor, or Gaussian shocks correlated from that history, the firm's choice), so netting is exact; the counterparty's CSA is applied to the netted value with the margin period of risk. Two measures, labelled: **real-world** for exposure (vols from history, mean reversion by policy, zero drift, historical correlations) giving EE, EPE, PFE at 95 / 97.5 / 99, peak and tenor buckets; **risk-neutral** for the XVA reserves through the XVA waterfall, which are reported on the P&L page (before and after XVA, netted by the firm's policy), not on the credit page. Credit limits on peak PFE, PFE by bucket, EPE and current exposure. RUN NOW computes in the background and stores per counterparty; the daily cron does every account. Method: `docs/ccr.md`; tables: `docs/migrations/2026-10-31_ccr.sql`.

## Risk taxonomy

One set of names on every ticket, SIMM-aligned. Rate factors are per basis point; spot factors are per 1 % (the SIMM delta convention for FX and equity).

| Factor | Rates (IRS, swaption, cap/floor) | FX forward / NDF | Crypto forward | FX option | Crypto option |
|--------|-----------------------------------|------------------|----------------|-----------|---------------|
| NPV | settlement currency | quote currency | USD | quote currency | USD |
| IR01 | +1 bp on every rate curve | = IR01 DISC + IR01 BASE | = IR01 DISC + FUND01 | = IR01 DISC + IR01 BASE | IR01 DISC only |
| IR01 DISC | +1 bp on the discount curve only | +1 bp on the quote (settlement) curve | +1 bp on the USD curve | +1 bp on the quote curve | +1 bp on the USD curve |
| IR01 BASE / FUND01 | — | +1 bp on the base-currency curve | +1 bp on the asset funding rate | +1 bp on the base curve | FUND01: +1 bp on the funding rate, reported apart |
| FX01 / CRY01 | — | PV for +1 % spot | PV for +1 % spot | FX01 | CRY01 |
| VEGA | swaption / cap surface, +1 bp normal vol | — | — | +1 vol point | +1 vol point |
| THETA | one day's carry | one day's carry | one day's carry | one calendar day | one calendar day |
| GAMMA | dollar convexity to ±1 bp | — (a forward is linear in spot) | — | spot gamma | spot gamma |
| XVA | HW1F Monte Carlo exposure → waterfall | lognormal forward exposure → the same waterfall | the same, with an assumed IM weight (outside SIMM) | on the exposure paths (ccr) | on the exposure paths (ccr) |

The names on screen: `IR01 DISC` is the key `IR01_DISC`; `SPOT01` in the limits catalogue is FX01 or CRY01 by asset.

## Market data

The home page carries **the week ahead**: central bank decisions and the releases a rates desk waits for (CPI, payrolls, GDP, unemployment) across USD, EUR, GBP, CHF and JPY, plus UST coupon auctions, with the last print and, once out, the actual and the surprise against it. Dates come from the agencies' published schedules (central banks, BLS, BEA, Japan's Statistics Bureau), the ONS API for the UK, and the usual slot, flagged, where a calendar is not machine-readable (euro area, Switzerland); actuals from BLS, ONS, Eurostat and the SNB, all keyless. There is no consensus column, because survey medians are a terminal product. `backend/market_data/calendar.py`, `GET /api/public/calendar`.

The hosted demo prices on **demo market data rebuilt daily from public sources**, never on terminal data (Bloomberg data is licensed to a seat and cannot be redistributed). Every snapshot is stamped with its provenance and the app says so on the home page.

| Curve | Built from | Indicative assumption |
|-------|-----------|------------------------|
| USD SOFR OIS | NY Fed SOFR fixing + US Treasury daily par yield curve | SOFR-OIS below Treasuries: −12 bp at 1M to −70 bp at 30Y |
| EUR €STR OIS | ECB €STR fixing + ECB euro-area AAA government par curve | swaps above AAA: +10 bp at 3M to +35 bp at 20Y+ |
| GBP SONIA OIS | Bank of England SONIA fixing + gilt par yields (5Y, 10Y, 20Y) | SONIA-OIS below gilts: −15 bp at 1Y to −75 bp at 30Y |
| CHF SARON | SNB SARON monthly average | flat at the fixing: the SNB's Confederation-bond cubes stopped in mid-2025 and no other free CHF curve exists |
| JPY TONA OIS | TONA (end of month, via the SNB money-market cube) + Japan MoF daily JGB yields | TONA-OIS below JGBs: −5 bp at 1Y to −45 bp at 30Y |
| BTC, ETH, SOL option vols and forwards | Deribit's public option marks, every 10 minutes: ATM, 25Δ risk reversal and butterfly per tenor; the forward of each listed expiry | read at 25 and 50 forward delta per expiry; ATM variance-linear and the skew time-linear onto ten tenors, flat beyond the last listed expiry; a three-point smile, so strikes outside 25 delta are an extrapolation (2 to 3 vol points low at 10 delta on test smiles) and a listed expiry between tenors can be up to a point off; the time of the marks is on every ticket |
| BTC, ETH, SOL fixings | Deribit's daily delivery price at 08:00 UTC, stored once a day and never overwritten; a desk's own entry for a licensed benchmark | a cash-settled trade settles on the fixing of the source its record names and on no other; until that fixing is stored its value is on the stored spot and marked provisional |
| Swaption ATM vols, skew, cap vols, G10 FX vols | **synthetic** parametric surface | not market; shaped like one so SABR, XVA and scenarios work |

The spread schedules live in one place, `backend/market_data/demo_feed.py`, and the tick that rebuilds the set (`POST /api/market-data/demo/tick`) runs from the scheduled workflow. `GET /api/market-data/demo/sources` is public and lists the providers, the assumptions and the latest date per curve. A self-hosted instance turns the tick off with `RIJEKA_DEMO_MARKET_DATA=0` and runs on its own marks or its own Bloomberg seat (`pricing/bloomberg_client.py`, tickers already mapped).

---

## Documentation

- `docs/methodology/rijeka_methodology.pdf` (v1.7, source `.tex` beside it) — curves, every product, market and counterparty risk, XVA, on-chain confirmation, the QuantLib reference; the same file the app's Methodology tab serves
- `docs/VALIDATION.md` — the validation charter, what is validated against what, and the open findings
- `docs/market_risk.md`, `docs/ccr.md`, `docs/pnl_attribution.md`, `docs/xva.md` — the per-module notes behind the methodology chapters
- `docs/ops/deploy.md` — the deploy chain (API first on Render, then the app from the `release` branch)
- `docs/architecture.md` — the map of the pieces and the data flow of a trade; `docs/ops/environment.md` — every environment variable; `docs/model_inventory.md` — every model with its validation status; `docs/glossary.md` — the names on every screen; `CHANGELOG.md`
- `docs/archive/AUDIT_launch_2026-11-02.md` — the launch audit and the plan it set

---

## License

**Apache-2.0** for the engine and the standard (`backend/pricing`, `backend/risk`, `backend/ccr`, `backend/pnl`, `backend/ipv`, `backend/chain`, `chain/`, the methodology, the schema, the tests, the validation reports) and **Business Source License 1.1** for the platform (API, database layer, frontend): free to run for your own organisation, free to teach and study, not to be offered to others as a hosted service without a commercial licence; each version becomes Apache-2.0 after four years. The market-risk, counterparty-credit and P&L engines (`backend/risk`, `backend/ccr`, `backend/pnl`) are Apache-2.0 with the pricing engine. Path table, every directory named, in [LICENSE](LICENSE); GitHub shows the licence as "Other" because the file is this dual text. © 2026 Rijeka LLC

Built by someone who spent a career inside trading floor infrastructure — pricing systems, risk frameworks, and margin engines — and believed the tools deserved to be free.
