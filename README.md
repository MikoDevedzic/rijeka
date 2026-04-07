# Rijeka — Open-Source Cross-Asset Pricing & Risk Platform

> Institutional-grade derivatives intelligence. Built in the open.

**Live demo:** [rijeka.app](https://rijeka.app) &nbsp;·&nbsp; **API:** [xva-engine.onrender.com](https://xva-engine.onrender.com/docs)

---

## What is Rijeka?

Rijeka is a full-stack derivatives pricing and risk platform built to democratize access to institutional-grade analytics. Banks, hedge funds, regional dealers, and academic institutions use Bloomberg and Murex at $100K+ per seat. Rijeka delivers the same core capability — curve bootstrapping, swap pricing, XVA waterfall, ISDA SIMM, scenario analysis — as open-source software.

The name comes from a city in Bosnia. The project is built with the same ethos: give people tools that were previously only available to those with resources.

---

## Capabilities

### Interest Rate Derivatives
- **IR Swap Pricing** — Fixed vs Float, OIS, Basis across 7 CCYs (USD, EUR, GBP, JPY, CHF, AUD, CAD)
- **Curve Bootstrap** — Sequential OIS bootstrap, dense annual grid, frozen spot DF pillar
- **Par Rate Solver** — Bisection solver for breakeven fixed rate at any NPV target
- **Greeks** — IR01, IR01_DISC (forecast/discount curve split), Gamma, Theta
- **Schedule Generation** — Full ISDA cashflow schedule with MOD_FOLLOWING, stub handling, payment lag
- **Validated** — USD/SOFR OIS NPV = $0.000000 at par for all tenors 1W–50Y. Bloomberg reference: 5Y $10M @ 3.665% → NPV=$0.02, PV01=$4,552

### Trade Lifecycle
- Multi-window trade booking with full leg builder
- Trade status: DRAFT → PENDING → CONFIRMED → LIVE → MATURED
- Append-only trade event stream (BOOKED, AMENDED, NOVATED, TERMINATED...)
- Cashflow schedule generation and persistence
- Per-leg Greeks with IR01/IR01_DISC separation (DV01/PV01 explicitly banned per ISDA convention)

### Risk Analytics
- **DETAILS Tab** — Per-period schedule editor with rate, notional, and spread overrides
- **Curve Scenario** — Interactive drag-to-reshape yield curve with Gaussian ripple propagation
- **Scenario Analytics** — Base vs shocked NPV, IR01, Gamma, Theta
- **Excel Export** — Styled schedule export (ExcelJS, dark theme, teal/red color coding)
- **Paste/Import** — Clipboard paste and drag-drop Excel import for amortization schedules

### XVA (Standalone Tools)
Two standalone HTML tools for desks running Calypso or similar systems with no XVA module:
- **`rijeka_xva_parametric.html`** — Parametric EE profile → CVA/DVA/FCA/FBA/MVA/KVA waterfall
- **`rijeka_xva_ee.html`** — Monte Carlo EE profile paste → full XVA waterfall
- No server required. No IT approval needed. Paste and price.

### Counterparty & Legal Entity Master
- Legal entity hierarchy (firm → division → desk → sub-desk)
- Counterparty master with LEI, jurisdiction, ISDA/CSA terms
- Discount curve assignment per counterparty

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite, Netlify |
| Backend | FastAPI, Render |
| Database | Supabase (Postgres) |
| Auth | Supabase JWT, role-based (viewer/trader/admin) |
| Pricing | Pure Python — no QuantLib dependency |

---

## Design Philosophy

**Pure Black theme.** IBM Plex Mono for numbers, IBM Plex Sans for labels. 16px base. Every canvas chart follows a strict two-pass line drawing standard (thick glow + sharp line on top) with gradient fill and dot halos. The UI is built to feel like a professional terminal, not a web app.

**No DV01/PV01.** The platform uses IR01 (parallel bump, all curves) and IR01_DISC (discount curve only, forecast flat) exclusively. This is the correct ISDA-aligned sensitivity taxonomy.

**Append-only event stream.** Trades are never mutated. Every lifecycle event is a new record with pre/post state, counterparty confirmation flag, and hash.

---

## Running Locally

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

Create a `.env` file in `backend/` with:
```
SUPABASE_URL=your_supabase_url
SUPABASE_JWT_SECRET=your_jwt_secret
DATABASE_URL=your_postgres_url
```

---

## Roadmap

- [ ] Basis swaps (two-curve bootstrap, SOFR vs EURIBOR)
- [ ] Zero coupon swaps
- [ ] Amortizing / step-up swaps
- [ ] Swaptions (SABR vol surface)
- [ ] XVA integration into main platform
- [ ] ISDA SIMM v2.8 (delta/vega/curvature, all risk classes)
- [ ] CVaR / Expected Shortfall
- [ ] Bloomberg plugin distribution
- [ ] On-chain trade confirmation (Ethereum)

---

## Why Open Source?

Derivatives risk infrastructure is expensive, opaque, and concentrated in a handful of vendors. A trader at a regional bank in Sarajevo or Lagos should have access to the same pricing tools as Goldman Sachs. Rijeka is built on the belief that financial infrastructure should be a public good.

The XVA standalone tools were built specifically for desks that can't get IT approval for new systems — they work in a browser with no installation required.

---

## License

MIT © 2026 Miko Devedzic

---

*Built by a derivatives risk professional with 15 years across XVA, ISDA SIMM, CCR, IPV, and valuation control. Domain expertise is the hardest part — the code is just the expression of it.*
