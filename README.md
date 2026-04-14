# Rijeka

**Institutional-grade derivatives pricing and risk — open source.**

Most of the world's derivatives intelligence sits behind proprietary systems at a handful of large banks. Smaller institutions, emerging market participants, and academic researchers operate blind — without the tools to price, hedge, or understand the true cost of a trade. Rijeka exists to change that.

Named after a village in Bosnia — *rijeka* means "river" in Bosnian, Croatian, and Serbian — this platform is built on the belief that the mathematics of modern finance should be accessible to anyone with the ambition to use it.

---

## Live Tools

No login required. Open in any browser.

| Tool | URL | What it does |
|------|-----|-------------|
| IRS Pricer | [rijeka.app/irs](https://rijeka.app/irs) | Price a vanilla IRS, drag the yield curve, reprice live |
| XVA Simulator | [rijeka.app/xva](https://rijeka.app/xva) | HW1F Monte Carlo EE/ENE/PFE profiles and CVA |
| XVA Waterfall | [rijeka.app/xva_ee](https://rijeka.app/xva_ee) | Paste an EE profile, get full XVA waterfall |
| Vol Surface Scenario | [rijeka.app/vol_surface](https://rijeka.app/vol_surface) | 3D SABR swaption vol surface — shock it, reprice live |

---

## What It Does

### Pricing & Analytics

- OIS curve bootstrapping (SOFR, €STR, SONIA) — validated to Bloomberg SWPM reference prices
- Interest rate swap pricing with per-leg Greeks: IR01, IR01_DISC, Theta, Gamma
- European swaption pricing — Bachelier normal vol model, Bloomberg-validated ($3 NPV delta on $10M 5Y trade)
- Par rate solving, cashflow generation, T+2 spot lag, ACT/360 DCF

### Vol Surface — β=0 Normal SABR

- Full swaption vol surface calibration using Hagan 2002 β=0 Normal SABR
- Bloomberg OTM ticker integration (SMKO) — 8 strikes per expiry/tenor bucket, ±200bp
- α (level), ρ (skew), ν (curvature) calibrated per expiry/tenor bucket via L-BFGS-B
- Interactive 3D surface: rotate, apply preset scenarios, or drag to create custom vol shocks
- Live Bachelier repricing: ΔNPV, Vega, IR01 update on every scenario change

### XVA — Valuation Adjustments

- Hull-White one-factor (HW1F) Monte Carlo — calibrated to ATM swaption vol surface
- Full XVA waterfall: CVA, DVA, FVA, FBA, KVA, MVA
- Swaption XVA: Andersen-Piterbarg 2-phase EE (option value pre-expiry, conditional swap post-expiry)
- All-in rate: par rate adjusted for the true bilateral cost of the trade
- HW1F calibration RMSE: 0.08bp on 5Y-tenor basket

### Joint Rate + Vol Scenario Engine

The trade window CURVE SCENARIO tab for swaptions shows both axes simultaneously:

- **Top panel:** yield curve — drag any tenor point to reshape, Gaussian ripple propagation
- **Bottom panel:** 3D SABR vol surface — ROTATE or RESHAPE mode, raycast-accurate drag deformation
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
- SABR calibration runs automatically after each surface snap, results stored with fit diagnostics

### Trade Infrastructure

- Multi-instrument trade blotter: IRS, OIS, FRA, Basis Swap, European Swaption
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

---

## Model Validation

Every instrument goes through documented validation before it's considered production-ready.

| Version | Instruments | Status |
|---------|-------------|--------|
| v0.4.2 | IRS, OIS — OIS bootstrap | ✅ 38/38 tests passed |
| v0.5.0 | European Swaption — Bachelier + HW1F | ✅ Bloomberg delta $3 on $10M 5Y |
| v0.6.0 | SABR calibration, joint scenario P&L attribution | 🔲 Planned |

Validation reports and Python test packages in `model_validation/`.

---

## Design Principles

**No black boxes.** Every formula is documented. Every number is traceable.

**Institutional quality, open access.** The same mathematics used at tier-1 banks, available to anyone.

**SIMM-aligned risk taxonomy.** Greeks follow ISDA SIMM conventions — IR01 not DV01, proper sensitivity aggregation.

**Audit-ready.** All market data snaps are timestamped and sourced. Calibration results are stored with full fit diagnostics.

---

## Roadmap

### Phase 1 — Rates (current)

| Instrument | Status |
|-----------|--------|
| Vanilla IRS / OIS | ✅ Live |
| FRA | ✅ Live |
| Basis Swap | ✅ Live |
| European Swaption | ✅ Live |
| Interest Rate Cap / Floor | Sprint 9 |
| Collar | Sprint 9 |
| XCCY Swap | Sprint 10 |
| Bermudan Swaption | Sprint 11 |

### Phase 2 — FX & Credit
FX spot/forward/options, CDS, credit options, wrong-way risk in CVA.

### Phase 3 — Equity & Commodity
Equity swaps, equity options (Black-Scholes / Heston), commodity swaps and options.

### Phase 4 — Risk Infrastructure
Full market risk (VaR, SVaR, FRTB), CCR (PFE, SA-CCR, IMM), collateral management, PnL attribution.

### PROMETHEUS — AI Layer
Contextual chat over your book, AI-powered PnL explain, hedging recommendations, XVA commentary.

---

## Documentation

- `docs/Rijeka_Methodology_v1.1.pdf` — curve construction, swap pricing, XVA waterfall
- `docs/EXOTIC_OPTIONS_ROADMAP.md` — options coverage roadmap
- `docs/DEPLOY_CHECKLIST.md` — deployment reference

---

## License

MIT License — © 2026 Miko Devedzic / Rijeka

Built by someone who spent a career inside trading floor infrastructure — pricing systems, risk frameworks, and margin engines — and believed the tools deserved to be free.
