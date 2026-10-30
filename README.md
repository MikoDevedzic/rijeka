# Rijeka

**Where the trading desk meets the chain.** An open-source derivatives desk for both worlds: the models and bilateral confirmations trading desks run on, the open code and on-chain record crypto expects. Rates, FX and crypto forwards today; credit, equities and commodities next. Free for everyone.

Most of the world's derivatives intelligence sits behind proprietary systems at a handful of large banks. Smaller institutions, emerging market participants, and academic researchers operate blind — without the tools to price, hedge, or understand the true cost of a trade. Rijeka exists to change that.

Named after a village in Bosnia — *rijeka* means "river" in Bosnian, Croatian, and Serbian — this platform is built on the belief that the mathematics of modern finance should be accessible to anyone with the ambition to use it.

---

## Live Tools

No login required. Open in any browser.

| Tool | URL | What it does |
|------|-----|-------------|
| IRS Pricer | rijeka.app/irs | Price a vanilla IRS, drag the yield curve, reprice live |
| XVA Simulator | rijeka.app/xva | HW1F Monte Carlo EE/ENE/PFE profiles and CVA |
| XVA Waterfall | rijeka.app/xva_ee | Paste an EE profile, get full XVA waterfall |
| Vol Surface Scenario | rijeka.app/vol_surface | 3D SABR swaption vol surface — shock it, reprice live |

---

## What It Does

### Pricing & Analytics

- OIS curve bootstrapping (SOFR, €STR, SONIA) — validated to Bloomberg SWPM reference prices
- Interest rate swap pricing with per-leg Greeks: IR01, IR01_DISC, Theta, Gamma
- European swaption pricing — Bachelier normal vol model, Bloomberg-validated ($3 NPV delta on $10M 5Y trade)
- **Interest rate cap / floor / collar** — Bachelier Normal model, T_mid convention, Bloomberg-validated (0.1% gap at matched vol), vol override, per-caplet cashflows
- Par rate solving, cashflow generation, T+2 spot lag, ACT/360 DCF

### Vol Surface — β=0 Normal SABR

- Full swaption vol surface calibration using Hagan 2002 β=0 Normal SABR
- Bloomberg OTM ticker integration (SMKO) — 8 strikes per expiry/tenor bucket, ±200bp
- α (level), ρ (skew), ν (curvature) calibrated per expiry/tenor bucket via L-BFGS-B
- Interactive 3D surface: rotate, apply preset scenarios, or drag to create custom vol shocks
- Live Bachelier repricing: ΔNPV, Vega, IR01 update on every scenario change
- **Cap/floor vol surface** — 3D mesh from Bloomberg snapped `cap_vol_surface` quotes (tenor × strike spread × vol)

### XVA — Valuation Adjustments

- Hull-White one-factor (HW1F) Monte Carlo — calibrated to ATM swaption vol surface
- Full XVA waterfall: CVA, DVA, FVA, FBA, KVA, MVA
- Swaption XVA: Andersen-Piterbarg 2-phase EE (option value pre-expiry, conditional swap post-expiry)
- All-in rate: par rate adjusted for the true bilateral cost of the trade
- HW1F calibration RMSE: 0.08bp on 5Y-tenor basket

### Joint Rate + Vol Scenario Engine

The trade window CURVE SCENARIO tab shows both axes simultaneously:

- **Top panel:** yield curve — drag any tenor point to reshape, Gaussian ripple propagation
- **Bottom panel:** 3D SABR vol surface (swaption) or cap vol surface (cap/floor/collar) — ROTATE mode, rotatable/zoomable mesh
- **Single repricing button** runs 4 parallel calls and decomposes P&L:

```
ΔNPV rate only   =  shocked rate,  base vol
ΔNPV vol only    =  base rate,     shocked vol
ΔNPV joint       =  shocked rate,  shocked vol
ΔNPV cross-gamma =  joint − rate − vol  (the non-linear term no system shows)
```

### Market Data

- Market data snapshot layer: Bloomberg, Refinitiv, and manual sources
- ATM + OTM swaption vol surface snap with unified button (ATM ICPL + SMKO OTM in one pass)
- Cap/floor vol surface snap from Bloomberg cap surface tickers
- SABR calibration runs automatically after each surface snap, results stored with fit diagnostics

### Trade Infrastructure

- Multi-instrument trade blotter: IRS, OIS, Basis Swap, European Swaption, Cap, Floor, Collar
- Full org hierarchy: firm → division → desk → book
- Legal entity and counterparty master data
- Role-based access: VIEWER / TRADER / ADMIN

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

## Model Validation

Every instrument goes through documented validation before it's considered production-ready.

| Version | Instruments | Status |
|---------|------------|--------|
| v0.4.2 | IRS, OIS — OIS bootstrap | ✅ 38/38 tests passed |
| v0.5.0 | European Swaption — Bachelier + HW1F | ✅ Bloomberg delta $3 on $10M 5Y |
| v0.6.0 | SABR calibration, joint scenario P&L attribution | ✅ Live |
| v0.4.3 | Interest Rate Cap / Floor / Collar — Bachelier Normal | ✅ Bloomberg delta 0.1% on $10M 5Y at matched vol |

Validation reports and Python test packages in `model_validation/`.

---

## Design Principles

**No black boxes.** Every formula is documented. Every number is traceable.

**Institutional quality, open access.** The same mathematics used at tier-1 banks, available to anyone.

**SIMM-aligned risk taxonomy.** Greeks follow ISDA SIMM conventions — IR01 not DV01, proper sensitivity aggregation.

**Audit-ready.** All market data snaps are timestamped and sourced. Calibration results are stored with full fit diagnostics.

---

## Roadmap

### Phase 1 — Rates, FX & crypto forwards (live, hosted demo)

| Instrument | Status |
|-----------|--------|
| Vanilla IRS / OIS / basis / amortising | ✅ Live |
| European Swaption | ✅ Live |
| Interest Rate Cap / Floor / Collar | ✅ Live |
| FX spot / forward / NDF (EUR, GBP, JPY, CHF, AUD, CAD vs USD) | ✅ Live |
| BTC / ETH / SOL forwards and NDFs | ✅ Live |
| Bilateral confirmation anchored on Ethereum (Sepolia) | ✅ Live |
| XCCY Swap | Roadmap |
| Bermudan Swaption | Roadmap |

Under the policy path, the next four decisions of the currency's central bank (FOMC, ECB, BoE, SNB, BoJ; published calendars in `backend/market_data/policy_path.py`) show what the curve prices for each: the forward overnight rate between consecutive meetings, the step in basis points against the window before, and the running total. Indicative, from the demo curve, not a forecast.

The desk home opens on the **desk globe**: a turning Earth lit by the real sun, the five desks glowing while their session is open, every live trade drawn as an arc from your entity's home city to the counterparty's, and an orbital ring that holds one satellite per confirmation anchored on the registry. Beside it, chain health (latest block, relayer wallet, registry), an inbox of what needs your action (countersign requests, trades awaiting the other side, maturities inside 30 days, confirmations that never reached the chain, a low relayer wallet) and the latest anchors with their proof links. Land outlines are Natural Earth 110m (public domain); the globe is plain canvas, no 3D library.

### Phase 2 — FX options & Credit (next)

FX and crypto forwards share one interest-rate-parity model (`pricing/currency_forward.py`), booked from the same NEW TRADE ticket as rates. Next: FX options and cross-currency swaps; CDS, credit options, wrong-way risk in CVA.

### Phase 3 — Equity & Commodity

Equity swaps, equity options (Black-Scholes / Heston), commodity swaps and options.

### Phase 4 — Risk Infrastructure

Full market risk (VaR, SVaR, FRTB), CCR (PFE, SA-CCR, IMM), collateral management, PnL attribution.

### PROMETHEUS — AI Layer

The desk's quant, risk and margin analyst. Reads everything, changes nothing. Live today: read-only chat over your trades and the engine, in-app news summaries, and the **book brief** on the home page: the pricers compute a fact sheet (NPV and IR01 per trade, curve moves, pending confirmations, maturities, CSA terms, news tagged to the positions), Prometheus narrates it citing fact ids, and every number in the prose is checked against the sheet before it is shown; forecasting and advice are rejected. Next: scenario risk across the whole book, counterparty exposure and CVA commentary, SIMM margin against thresholds, a Telegram digest.

---

## P&L and attribution

A `P&L` tab next to the blotter, and a tile on the desk home: day, month to date and year to date, each split into **market** and **trading** P&L, the attribution waterfall, the roll-up desk → book → trade with every trade's explain rows, and sign-off.

Attribution is **sequential full revaluation**, never a sensitivity estimate. Starting from yesterday's mark on yesterday's market, the valuation is moved one thing at a time in a fixed, stated order and each step is one row: carry (the date roll on the prior market), cash settled, each curve by tenor bucket (0-1Y, 1-5Y, 5-10Y, 10Y+; discount, forecast, then base), spot, quoted forward points, residual. Rows sum to the total by construction. New trades carry their close mark; unwinds remove the prior mark plus any fee. Marks are the production pricers on the saved market of each date, so the P&L page and the ticket agree to the cent.

End of day (`POST /api/pnl/eod`, and daily by cron for every account) stores one mark per trade and one attributed row per trade per date, so MTD and YTD are sums of what was signed. Sign-off is trader first, then P&L controller or desk CFO (the `controller`, `cfo`, `admin` role, or a firm admin); a FINAL day is visible to management with the comments (`GET /api/pnl/firm`, the MANAGEMENT view). The history tables are `docs/migrations/2026-10-30_pnl.sql`; until applied, the report is computed live and says so.

## Market risk

A `RISK` tab next to P&L, and `Configurations › Market Risk` for the risk manager.

- **Ladder.** Key-rate IR01 by curve and tenor bucket (0-1Y, 1-5Y, 5-10Y, 10Y+, the same buckets as the P&L explain), by bumping each bucket 1bp and repricing every trade through the production pricers; FX01 and BTC01 per asset from the pricers. Totals in the reporting currency.
- **VaR.** Historical simulation by full revaluation: each day's observed changes in the window (basis points per tenor, log returns for spots) shift today's market and every live trade is repriced on it; VaR is the empirical loss quantile, expected shortfall the mean beyond it, the horizon scales by √t. The ladder VaR (the same changes applied to the key-rate sensitivities) is computed alongside as the linear comparison, and the gap is reported as convexity. The firm chooses the headline method; confidence, horizon, window and minimum observations are its settings.
- **History.** Risk factors come from the public sources the demo already uses (Treasury par yields, NY Fed SOFR, ECB €STR and AAA curve, BoE SONIA and gilts, ECB reference FX, Coinbase daily closes), fetched over a date range and stored as the template account's snapshots, which the daily rebuild extends. `risk-backfill.yml` fetches two years on dispatch.
- **Stress.** Named scenarios by full revaluation: parallel ±25/±100bp, steepener, flattener, USD ±10%, digital assets ±30%, a combined risk-off.
- **Limits.** The risk manager (`risk` or `admin` role, or a firm admin) sets limits on any reported number: VaR and ES, IR01 total or per curve or bucket, FX01/BTC01 per asset, NPV, any scenario's loss; scope book total, desk or book; a warning level. Utilisation and breaches show on the risk page and in the home inbox after the daily run.

Tables: `docs/migrations/2026-10-30_market_risk.sql`.

## Counterparty credit

`RISK › COUNTERPARTY CREDIT`: exposure against credit limits, the way market risk is VaR against limits. Every trade of a counterparty is valued on the same simulated paths (a Hull-White factor per currency, a lognormal factor per spot; each monthly step a block of observed daily changes from two years of public history, the same block for every factor, or Gaussian shocks correlated from that history, the firm's choice), so netting is exact; the counterparty's CSA is applied to the netted value with the margin period of risk. Two measures, labelled: **real-world** for exposure (vols from history, mean reversion by policy, zero drift, historical correlations) giving EE, EPE, PFE at 95 / 97.5 / 99, peak and tenor buckets; **risk-neutral** for the XVA reserves through the XVA waterfall, which are reported on the P&L page (before and after XVA, netted by the firm's policy), not on the credit page. Credit limits on peak PFE, PFE by bucket, EPE and current exposure. RUN NOW computes in the background and stores per counterparty; the daily cron does every account. Method: `docs/ccr.md`; tables: `docs/migrations/2026-10-31_ccr.sql`.

## Risk taxonomy

One set of names on every ticket, SIMM-aligned. Rate factors are per basis point; spot factors are per 1 % (the SIMM delta convention for FX and equity).

| Factor | Rates (IRS, swaption, cap/floor) | FX forward / NDF | Crypto forward |
|--------|-----------------------------------|------------------|----------------|
| NPV | settlement currency | quote currency | USD |
| IR01 | +1 bp on every rate curve | = IR01 DISC + IR01 BASE | = IR01 DISC + FUND01 |
| IR01 DISC | +1 bp on the discount curve only | +1 bp on the quote (settlement) curve | +1 bp on the USD curve |
| IR01 BASE / FUND01 | — | +1 bp on the base-currency curve | +1 bp on the asset funding rate |
| FX01 / BTC01 | — | PV for +1 % spot | PV for +1 % spot |
| THETA | one day's carry | one day's carry | one day's carry |
| GAMMA | dollar convexity to ±1 bp | — (a forward is linear in spot) | — |
| XVA | HW1F Monte Carlo exposure → waterfall | lognormal forward exposure → the same waterfall | the same, with an assumed IM weight (outside SIMM) |

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
| Swaption ATM vols, skew, cap vols | **synthetic** parametric normal-vol surface | not market; shaped like one so SABR, XVA and scenarios work |

The spread schedules live in one place, `backend/market_data/demo_feed.py`, and the tick that rebuilds the set (`POST /api/market-data/demo/tick`) runs from the scheduled workflow. `GET /api/market-data/demo/sources` is public and lists the providers, the assumptions and the latest date per curve. A self-hosted instance turns the tick off with `RIJEKA_DEMO_MARKET_DATA=0` and runs on its own marks or its own Bloomberg seat (`pricing/bloomberg_client.py`, tickers already mapped).

---

## Documentation

- `docs/Rijeka_Methodology_v1.1.pdf` — curve construction, swap pricing, XVA waterfall
- `docs/EXOTIC_OPTIONS_ROADMAP.md` — options coverage roadmap
- `docs/DEPLOY_CHECKLIST.md` — deployment reference

---

## License

**Apache-2.0** for the engine and the standard (`backend/pricing`, `backend/chain`, `chain/`, the methodology, the schema, the tests, the validation reports) and **Business Source License 1.1** for the platform (API, database layer, frontend): free to run for your own organisation, free to teach and study, not to be offered to others as a hosted service without a commercial licence; each version becomes Apache-2.0 after four years. Path table in [LICENSE](LICENSE). © 2026 Rijeka LLC

Built by someone who spent a career inside trading floor infrastructure — pricing systems, risk frameworks, and margin engines — and believed the tools deserved to be free.
