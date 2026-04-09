# Rijeka

**Institutional-grade cross-asset pricing and risk — open source.**

Most of the world's derivatives intelligence sits behind proprietary systems at a handful of large banks. Smaller institutions, emerging market participants, and academic researchers operate blind — without the tools to price, hedge, or understand the true cost of a trade. Rijeka exists to change that.

Named after a village in Bosnia — *rijeka* means "river" in Bosnian, Croatian, and Serbian — this platform is built on the belief that the mathematics of modern finance should be accessible to anyone with the ambition to use it.

---

## What It Does

Rijeka is a full-stack derivatives platform covering the complete lifecycle of an interest rate swap — from trade booking and curve construction through XVA computation and margin estimation.

**Pricing & Analytics**
- OIS curve bootstrapping (SOFR, €STR, SONIA) validated to Bloomberg reference prices
- Interest rate swap pricing with per-leg Greeks: IR01, IR01_DISC, Theta, Gamma
- Par rate solving, cashflow generation, and scenario analysis

**XVA — Valuation Adjustments**
- Hull-White one-factor (HW1F) Monte Carlo simulation calibrated to ATM swaption vol surface
- Full XVA waterfall: CVA, DVA, FVA, FBA, KVA, MVA
- All-in rate computation: par rate adjusted for the true cost of the trade
- RMSE 0.23bp on 5Y-tenor calibration basket (Andersen-Piterbarg formula)

**Market Data**
- 54-curve data layer across USD, EUR, GBP, cross-currency, and fixing indices
- Bloomberg, Refinitiv, and manual snap support
- ATM swaption vol surface (6×6 grid) with live Bloomberg integration

**Trade Infrastructure**
- Multi-asset trade blotter with 43 instrument types across 5 asset classes
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

## Live Tools

Public-facing tools at **[rijeka.app](https://rijeka.app)** — no login required:

- **IRS Pricer** — price a vanilla interest rate swap against a live SOFR curve
- **XVA Simulator** — compute CVA/DVA/FVA/KVA from a HW1F Monte Carlo simulation
- **XVA Waterfall Calculator** — build an XVA waterfall from a pasted EE profile

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

Environment variables required:
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
```

---

## Documentation

- [`docs/Rijeka_Methodology_v1.1.pdf`](docs/Rijeka_Methodology_v1.1.pdf) — mathematical methodology: curve construction, swap pricing, XVA waterfall
- [`docs/EXOTIC_OPTIONS_ROADMAP.md`](docs/EXOTIC_OPTIONS_ROADMAP.md) — roadmap for exotic options coverage
- [`docs/DEPLOY_CHECKLIST.md`](docs/DEPLOY_CHECKLIST.md) — deployment reference

---

## Design Principles

- **No black boxes.** Every formula is documented. Every number is traceable.
- **Institutional quality, open access.** The same mathematics used at tier-1 banks, available to anyone.
- **SIMM-aligned risk taxonomy.** Greeks follow ISDA SIMM conventions — IR01 not DV01, SIMM buckets, proper sensitivity aggregation.
- **Audit-ready.** All market data snaps are timestamped and sourced. Calibration results are stored with full fit diagnostics.

---

## Roadmap

**XVA & Risk**
- [ ] Full ISDA SIMM MVA (replacing linear proxy)
- [ ] CVaR / Expected Shortfall from Monte Carlo engine
- [ ] Bloomberg plugin for XVA

**Interest Rates**
- [ ] Cross-currency swap pricing (XCCY basis)
- [ ] Exotic IR options: caps, floors, swaptions, CMS products

**FX & FX Options**
- [ ] FX spot, forward, and swap pricing
- [ ] FX options: vanilla, barrier, digital — Garman-Kohlhagen / local vol
- [ ] FX vol surface construction and smile calibration

**Credit & Credit Options**
- [ ] CDS pricing and hazard rate bootstrapping
- [ ] Credit options and index tranches
- [ ] Wrong-way risk in CVA

**Equity**
- [ ] Equity swaps and total return swaps
- [ ] Equity options: Black-Scholes, local vol, stochastic vol (Heston)

**Commodity & Commodity Options**
- [ ] Commodity swaps: energy, metals, agriculture
- [ ] Commodity options with seasonality and mean-reversion models
- [ ] Exchange IM integration (ICE, CME)

**Cash Instruments** *(post-derivatives)*
- [ ] Bond pricing: fixed rate, floating rate, inflation-linked
- [ ] Repo and securities financing
- [ ] Unified derivatives + cash risk view

**PnL Attribution**
- [ ] Daily PnL explain: delta, gamma, vega, theta, rho, new trades, carry
- [ ] Greeks-based attribution across all asset classes
- [ ] IPV integration: independent price verification vs. trader marks

**Collateral Management**
- [ ] ISDA CSA management: thresholds, MTA, independent amounts
- [ ] Margin call workflow: call generation, dispute tracking, settlement
- [ ] Collateral optimization: cheapest-to-deliver across eligible assets
- [ ] Real-time collateral inventory and rehypothecation tracking

**Market Risk**
- [ ] VaR: historical simulation, parametric, Monte Carlo
- [ ] Stressed VaR and Expected Shortfall (ES) per FRTB
- [ ] Sensitivity-based approach (SBA) under FRTB SA
- [ ] Risk factor bucketing and aggregation across desks

**Counterparty Credit Risk**
- [ ] PFE profiles: SA-CCR and internal model (IMM)
- [ ] Credit limits: utilization tracking and breach alerting
- [ ] Netting set and collateral agreement management
- [ ] CVA capital: BA-CVA and SA-CVA under Basel IV

**PROMETHEUS — AI Intelligence Layer**
- [ ] Contextual chat: ask questions about your book in plain language
- [ ] AI-powered PnL explain and attribution
- [ ] Hedging recommendations and what-if analysis
- [ ] XVA commentary and regulatory narrative generation
- [ ] Market news integration with portfolio impact scoring

---

## License

MIT License — © 2026 Miko Devedzic / Rijeka

---

*Built by someone who spent a career inside trading floor infrastructure — pricing systems, risk frameworks, and margin engines — and believed the tools deserved to be free.*
