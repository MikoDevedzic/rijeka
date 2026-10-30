# Documentation

Live documents, the ones kept current with the code:

| Document | What it covers |
|---|---|
| [pnl_attribution.md](pnl_attribution.md) | P&L attribution: sequential full revaluation, the convention, sign-off, the AMEND step |
| [market_risk.md](market_risk.md) | Ladder, VaR by full revaluation and on the ladder, stress, limits, backtesting |
| [ccr.md](ccr.md) | Counterparty credit: real-world paths, historical sampling, netting, CSA, options on the paths, PFE limits |
| [xva.md](xva.md) | XVA components and the waterfall |
| [VALIDATION.md](VALIDATION.md) | How to replicate a number and what has been validated |
| [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) | Hosting: Render, Netlify, Supabase |
| [ops/deploy.md](ops/deploy.md) | Deploy order: API first, then the app (`release` branch) |
| [ops/email.md](ops/email.md) | Auth email through Resend |
| [EXOTIC_OPTIONS_ROADMAP.md](EXOTIC_OPTIONS_ROADMAP.md) | Where exotics go next |
| [methodology/](methodology/) | The methodology workbooks and PDF sources |
| [schema.sql](schema.sql) | The database schema as first laid down |
| [migrations/](migrations/) | SQL to apply, dated; `applied-before-2026-10/` holds the early ones already in every database |

Papers: `Rijeka_Methodology_v1.1.pdf` (and `.tex`), `blockchain_derivatives_paper_v5.pdf` (and `.tex`).

[archive/](archive/) holds superseded architecture notes (v8 to v25) and sprint handoffs. They
describe the system as it was at the time and are kept for the record; nothing in them is
a current instruction. The README at the repository root is the current overview.
