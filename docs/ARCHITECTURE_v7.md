# Rijeka — ARCHITECTURE_v7.md
> Updated: Sprint 2 Day 3 complete (2026-03-26)
> Read this before writing any code.

---

## What Rijeka Is

Open-source full revaluation derivatives risk system.
Pure risk analytics — no front office, no order management.
Covers: market risk, CCR, XVA, ISDA SIMM, trade lifecycle, PnL attribution, on-chain confirmation.
ISDA SIMM v2.6 naming conventions used as universal vocabulary throughout.
Named after a village in Bosnia — *rijeka* means "river" in Serbian, Croatian, and Bosnian.

**The longer vision:** a neutral, open, on-chain derivatives infrastructure layer that any firm
can connect to — trade confirmation, margin, SIMM, disputes, regulatory reporting — without
trusting a vendor or a counterparty. See "The Network Vision" section at the bottom.

---

## Infrastructure

| Service   | Purpose                  | Account      | Status |
|-----------|--------------------------|--------------|--------|
| Netlify   | Landing page (static)    | MikoDevedzic | ✅ Live — rijeka.app |
| Netlify   | React app                | MikoDevedzic | ⏳ Day 7 — app.rijeka.app |
| Render    | Backend (FastAPI)        | MikoDevedzic | ⏳ Day 6 |
| Supabase  | Postgres + Auth          | MikoDevedzic | ✅ Live — upuewetohnocfshkhafg.supabase.co |
| GitHub    | Monorepo                 | MikoDevedzic | ✅ Live |
| Namecheap | Domain registrar         | mikod7       | ✅ rijeka.app |

**Local dev path:** `C:\Users\mikod\OneDrive\Desktop\Rijeka\`

---

## Monorepo Structure

```
Rijeka/
├── frontend/                   React + Vite (Netlify — app.rijeka.app)
│   ├── .env                    Supabase keys — NEVER COMMIT
│   └── src/
│       ├── App.jsx             Full router + auth guard ✅
│       ├── index.css           Design tokens + all component styles ✅
│       ├── lib/
│       │   └── supabase.js     Supabase client (sessionStorage) ✅
│       ├── data/
│       │   └── ratesCurves.js  54 curves, CCY_GROUPS, helpers ✅
│       ├── store/
│       │   ├── useMarketDataStore.js  Zustand market data store ✅
│       │   └── useAuthStore.js        Auth + profile + trader ID ✅
│       ├── api/                Axios client + endpoint functions (Day 6)
│       └── components/
│           ├── layout/         AppBar, CfgNav, MdNav, StubPage ✅
│           ├── auth/           LoginPage, SignupPage, ConfirmPage, AuthGuard ✅
│           ├── CommandCenter.jsx  Matrix rain + boot sequence + tiles ✅
│           ├── market-data/    CurvesWorkspace, sidebar, detail panels ✅
│           ├── org/            OrgHierarchy, LegalEntity, Counterparty (Day 4-5)
│           ├── chat/           GlobalChat, DeskRoom, DM, ContextThread (Sprint 7-8)
│           ├── news/           NewsFeed, NewsCard (Sprint 10)
│           ├── ai/             PnlExplain, HedgingRecs, XvaCommentary (Sprint 11-13)
│           ├── pricer/         Sprint 5
│           ├── market-risk/    Sprint 10
│           ├── pnl/            Sprint 11
│           └── ccr/            Sprint 14
├── backend/                    FastAPI (Render — api.rijeka.app) Day 6
│   ├── api/routes/
│   ├── models/
│   ├── db/
│   └── engines/
│       ├── bootstrap/          Sprint 3 — QuantLib OIS + Basis
│       ├── var/                Sprint 8 — Historical simulation VaR
│       ├── xva/                Sprint 12 — CVA, DVA, FVA, ColVA, MVA, KVA
│       ├── simm/               Sprint 15 — ISDA SIMM v2.6
│       ├── ai/                 Sprint 11+ — Claude API (server-side only)
│       │   ├── pnl_explain.py
│       │   ├── hedging_recs.py
│       │   ├── xva_commentary.py
│       │   └── news_scorer.py
│       └── news/               Sprint 10 — feed + AI scoring
├── landing/                    Static marketing site
│   ├── index.html              rijeka.app ✅ (new About version ready to deploy)
│   └── command-center.html     Legacy — superseded by React CommandCenter
├── docs/                       Methodology PDF + LaTeX source
└── sprint 1 Market Data/       Reference only
```

---

## Design Invariants — Never Change

```
1.  CSS variables: --bg #060a0e  --bg-deep #03060a  --panel #0b1219
    --accent #0ec9a0  --amber #e8a020  --blue #3d8bc8  --purple #9060cc
    --red #d95040  --mono JetBrains Mono
    Dark terminal aesthetic. No hardcoded hex values anywhere.

2.  ISDA SIMM naming: every variable, endpoint, column follows ISDA SIMM v2.6.

3.  3-store separation: History / Production / Working — never overlap.

4.  Immutability: committed rows are never modified. Corrections = new rows.
    Enforced at DB level via triggers.

5.  Trade immutability: trades never updated in place.
    All lifecycle changes go through trade_events.

6.  Audit trail: every write records user_id + timestamp. No anonymous mutations.

7.  Funding curves: firm_spread(t) is single source of truth for FVA/ColVA/MVA.

8.  PnL attribution: trade-level PnL is the atomic unit. All views aggregate from it.

9.  Trader ID immutability: generated once at signup, never changed.
    Permanent identity across trades, events, audit rows, chat messages.

10. Auth tokens: sessionStorage only — never localStorage. XSS prevention.
    8h access token, 30d refresh.

11. AI API keys: Claude API key lives server-side in FastAPI only.
    Never exposed to frontend. All AI calls go through backend.

12. Chat messages: append-only, never updated or deleted. Full audit trail.
```

---

## Stack

```
Frontend:   React 18 + Vite 8 + React Router v6 + Zustand + Axios
Styling:    Tailwind v4 + CSS variables (design tokens)
Auth:       Supabase JS client (frontend) + JWT (backend, Day 6)
Database:   Supabase Postgres — no SQLite ever
Realtime:   Supabase Realtime (chat — zero extra infrastructure)
Backend:    Python 3.11+ + FastAPI + SQLAlchemy + Alembic (Day 6)
AI:         Anthropic Claude API (server-side only, Sprint 11+)
Analytics:  QuantLib-Python + own Python implementations (Sprint 3+)
Blockchain: EVM-compatible (Sprint 18)
Drag-drop:  @dnd-kit/core + @dnd-kit/sortable
```

---

## URL Structure

```
rijeka.app/                     → Landing page (public, static)
app.rijeka.app/                 → Root → /command-center or /login
app.rijeka.app/login            → Login
app.rijeka.app/signup           → Signup
app.rijeka.app/confirm          → Post-email-confirmation handle reveal
app.rijeka.app/command-center   → Command center (authenticated home)
app.rijeka.app/configurations/* → Configurations
app.rijeka.app/pricer           → Pricer (Sprint 5)
app.rijeka.app/market-risk      → Market Risk (Sprint 10)
app.rijeka.app/pnl              → PnL Attribution (Sprint 11)
app.rijeka.app/ccr              → CCR (Sprint 14)
app.rijeka.app/simm             → SIMM (Sprint 16)
app.rijeka.app/blockchain       → Blockchain registry (Sprint 18)
```

---

## Auth Architecture

### Supabase Configuration
```
Project URL:  https://upuewetohnocfshkhafg.supabase.co
Anon key:     sb_publishable_jfdfyrFFT5BF2js3cFXJ8A_PH2o3jEa
Auth:         Email + password, confirmation required, min 8 chars
Site URL:     https://rijeka.app
Redirect URLs:
  http://localhost:5173/confirm
  http://localhost:5173
  https://app.rijeka.app/confirm
```

### Trader ID Generation (live)
```
miko.devedzic@gmail.com → MIKO.DEVEDZIC
Collision: MIKO.DEVEDZIC_2, _3 etc.
Trigger: on_auth_user_created → handle_new_user() SECURITY DEFINER
Immutable after creation.
```

---

## RBAC — Role Definitions

```python
class Role(str, Enum):
    TRADER        = "trader"        # read + own trades only
    RISK          = "risk"          # read + run risk engines, all trades
    XVA           = "xva"           # read + run XVA, all trades
    ADMIN         = "admin"         # full access
    READ_ONLY     = "read_only"     # all tabs visible, no write (early access default)
    COUNTERPARTY  = "counterparty"  # external — facing trades + shared threads only (Sprint 18)
```

---

## Core Database Schema

### Profiles (live)
```sql
CREATE TABLE profiles (
    id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    trader_id TEXT UNIQUE NOT NULL,
    role      TEXT NOT NULL DEFAULT 'read_only',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Curves
```sql
CREATE TABLE curve_definitions (
    id               TEXT PRIMARY KEY,
    ccy              TEXT NOT NULL,
    curve_class      TEXT NOT NULL,  -- 'OIS'|'BASIS'|'XCCY_BASIS'|'FUNDING'
    full_name        TEXT NOT NULL,
    ql_index_class   TEXT,
    day_count        TEXT,
    calendar         TEXT,
    settlement_days  INT,
    payment_lag      INT,
    telescopic       BOOLEAN,
    default_interp   TEXT DEFAULT 'LogLinearDiscount',
    base_curve_id    TEXT REFERENCES curve_definitions(id),
    parent_curve_ids TEXT[],
    spread_mode      TEXT DEFAULT 'term',
    is_active        BOOLEAN DEFAULT TRUE,
    sprint_available INT DEFAULT 1
);

CREATE TABLE working_funding_spreads (
    curve_id       TEXT PRIMARY KEY REFERENCES curve_definitions(id),
    spread_mode    TEXT NOT NULL DEFAULT 'term',
    spreads_json   JSONB NOT NULL,
    flat_spread_bp NUMERIC(8,2),
    source         TEXT DEFAULT 'manual',
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_by     TEXT
);
```

### Organisation
```sql
CREATE TABLE org_nodes (
    id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    parent_id TEXT REFERENCES org_nodes(id),
    name      TEXT NOT NULL,
    node_type TEXT NOT NULL,  -- 'firm'|'division'|'desk'|'sub_desk'|'custom'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT
);

CREATE TABLE legal_entities (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    lei               TEXT UNIQUE NOT NULL,
    name              TEXT NOT NULL,
    short_name        TEXT,
    home_currency     TEXT NOT NULL,
    jurisdiction      TEXT NOT NULL,
    regulatory_regime TEXT[],
    simm_version      TEXT DEFAULT 'v2.6',
    im_threshold_m    NUMERIC(12,2),
    ois_curve_id      TEXT REFERENCES curve_definitions(id),
    is_own_entity     BOOLEAN DEFAULT FALSE,
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE counterparties (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    legal_entity_id   TEXT NOT NULL REFERENCES legal_entities(id),
    name              TEXT NOT NULL,
    isda_agreement    TEXT,
    csa_type          TEXT,       -- 'VM_ONLY'|'VM_IM'|'NO_CSA'
    csa_currency      TEXT,
    csa_threshold_m   NUMERIC(12,2),
    csa_mta_k         NUMERIC(12,2),
    discount_curve_id TEXT REFERENCES curve_definitions(id),
    im_model          TEXT DEFAULT 'SIMM',
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### Trades (immutable)
```sql
CREATE TABLE trades (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    trade_ref         TEXT UNIQUE NOT NULL,
    instrument_type   TEXT NOT NULL,
    counterparty_id   TEXT REFERENCES counterparties(id),
    desk_id           TEXT REFERENCES org_nodes(id),
    trader_id         TEXT NOT NULL,
    notional          NUMERIC(20,2),
    notional_currency TEXT,
    trade_date        DATE NOT NULL,
    effective_date    DATE,
    maturity_date     DATE,
    status            TEXT DEFAULT 'active',
    trade_json        JSONB NOT NULL,
    blockchain_hash   TEXT,    -- Sprint 18
    blockchain_tx     TEXT,    -- Sprint 18
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    created_by        TEXT NOT NULL
);

CREATE TABLE trade_events (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    trade_id            TEXT NOT NULL REFERENCES trades(id),
    event_type          TEXT NOT NULL,
    event_date          DATE NOT NULL,
    effective_date      DATE,
    user_id             TEXT NOT NULL,
    desk_id             TEXT REFERENCES org_nodes(id),
    previous_json       JSONB,
    new_json            JSONB,
    new_counterparty_id TEXT REFERENCES counterparties(id),
    notional_change     NUMERIC(20,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trade_pnl (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    trade_id        TEXT NOT NULL REFERENCES trades(id),
    pnl_date        DATE NOT NULL,
    desk_id         TEXT REFERENCES org_nodes(id),
    trader_id       TEXT NOT NULL,
    counterparty_id TEXT REFERENCES counterparties(id),
    total_pnl       NUMERIC(20,4),
    delta_pnl       NUMERIC(20,4),
    gamma_pnl       NUMERIC(20,4),
    vega_pnl        NUMERIC(20,4),
    theta_pnl       NUMERIC(20,4),
    rho_pnl         NUMERIC(20,4),
    fx_pnl          NUMERIC(20,4),
    residual_pnl    NUMERIC(20,4),
    is_new_trade    BOOLEAN DEFAULT FALSE,
    is_eod          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (trade_id, pnl_date)
);
```

### Chat (append-only)
```sql
CREATE TABLE chat_rooms (
    id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    room_type TEXT NOT NULL,
    -- 'global'|'desk'|'dm'|'custom'|'trade'|'report'|'xva_run'|'counterparty'
    name       TEXT,
    context_id TEXT,   -- trade_id, desk_id, counterparty_id etc.
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active  BOOLEAN DEFAULT TRUE
);

CREATE TABLE chat_members (
    room_id   TEXT REFERENCES chat_rooms(id),
    user_id   TEXT NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE chat_messages (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    room_id         TEXT NOT NULL REFERENCES chat_rooms(id),
    sender_id       TEXT NOT NULL,
    body            TEXT,
    attachment_type TEXT,  -- 'trade'|'risk_report'|'xva_run'|'news'|'blockchain'|null
    attachment_id   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
    -- NO UPDATE, NO DELETE — immutable
);
-- Realtime: Supabase Realtime on chat_messages
```

**Trade card format in chat:**
```
┌─────────────────────────────────────┐
│ IRS · USD · $50M                    │
│ REF: RJK-2026-00147                 │
│ Goldman Sachs · 5Y · Pay Fixed      │
│ 4.23% vs SOFR · Maturity 2031-03-26 │
│ CVA: $180k  ·  DV01: $23k           │
│ ⛓ On-chain: 0x4a3f...c2b1  [verify] │
└─────────────────────────────────────┘
Click to open trade
```

### News
```sql
CREATE TABLE news_items (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    headline     TEXT NOT NULL,
    summary      TEXT,
    source       TEXT,
    url          TEXT,
    published_at TIMESTAMPTZ,
    fetched_at   TIMESTAMPTZ DEFAULT NOW(),
    impact_level TEXT,    -- 'high'|'medium'|'low'
    asset_class  TEXT[],  -- ['rates','credit','fx','equity']
    direction    TEXT,    -- 'risk_on'|'risk_off'|'neutral'
    currencies   TEXT[],
    tenors       TEXT[],
    ai_summary   TEXT,
    ai_scored_at TIMESTAMPTZ
);
```

---

## Curve Bootstrap Order

```
Pass 1: OIS     (13) — independent
Pass 2: Basis   (22) — depends on OIS
Pass 3: XCCY    (12) — depends on OIS + USD_SOFR + FX spot
Pass 4: Funding  (7) — additive spread on OIS, no bootstrap
```

---

## CSA → Discount Curve Mapping

```python
CSA_DISCOUNT_MAP = {
    'USD': 'USD_SOFR',  'EUR': 'EUR_ESTR',  'GBP': 'GBP_SONIA',
    'JPY': 'JPY_TONAR', 'CHF': 'CHF_SARON', 'AUD': 'AUD_AONIA',
    'CAD': 'CAD_CORRA',
}
```

---

## AI Architecture (Sprint 11+)

Claude API — server-side only in FastAPI. Never in frontend.

```
pnl_explain.py     — EOD or on-demand. Input: PnL row + market moves.
hedging_recs.py    — limit breach trigger or on-demand. Input: portfolio greeks + limits.
xva_commentary.py  — on XVA run completion. Input: XVA results per counterparty.
news_scorer.py     — every 15min. Input: headline + summary. Output: scored news item.
```

News feed color coding:
```
🔴 HIGH   — red border    — major market moving
🟡 MEDIUM — amber border  — notable, watch
🟢 LOW    — dim border    — informational
```

---

## Chat Architecture

```
Sprint 7  — Global feed, DMs, desk rooms (auto-created from org hierarchy)
Sprint 8  — Contextual threads on trades/reports/XVA runs + trade cards
Sprint 14 — Internal + external counterparty rooms (COUNTERPARTY role)
Sprint 19 — Custom user-created rooms
```

---

## Sprint Roadmap

```
Sprint 1  ✅  Market data workspace HTML prototype
Sprint 2  🔄  React · Auth · Curves · Org · Legal Entity · Counterparty · Command Center
Sprint 3      QuantLib bootstrap · Bloomberg adapter · Free API adapters · History tab
Sprint 4      Trade entry · Portfolio save · Trade blotter
Sprint 5      Pricer — IRS, CDS, FX Forward
Sprint 6      XCCY bootstrap · FX surface · Vol surface
Sprint 7      Chat — global, DMs, desk rooms · Supabase Realtime
Sprint 8      Contextual trade threads · Embedded trade cards · Blockchain link in chat
Sprint 9      Stress testing · Scenario library
Sprint 10     Market risk dashboard · AI news feed · VaR
Sprint 11     PnL attribution · PnL Explain AI (Claude)
Sprint 12     XVA engines · XVA AI commentary
Sprint 13     Hedging recommendations AI · Multi-currency CSA · KVA
Sprint 14     CCR · SA-CCR · Counterparty chat rooms
Sprint 15     ISDA SIMM sensitivities
Sprint 16     ISDA SIMM IM + margin call workflow
Sprint 17     PDF/Excel reporting · LCH FHS replication
Sprint 18     On-chain trade confirmation · Public trade registry
Sprint 19     Dispute resolution · Custom chat rooms · Methodology viewer
Sprint 20     On-chain margin calls · SIMM anchored to chain
Sprint 21     Regulatory reporting layer · Community release
```

---

## The Network Vision

*Where Sprint 18+ is heading. Not a near-term build — the reason this project matters.*

The derivatives industry spends billions annually on post-trade reconciliation.
TriOptima, AcadiaSoft, DTCC, MarkitSERV all exist because there is no neutral
source of truth. Every firm has their own system. They constantly compare notes.

**The vision:** when two firms both confirm a trade on Rijeka's blockchain layer,
the chain becomes the neutral source of truth. Neither firm needs to trust the
other's system. Both run the same ISDA SIMM model on the same inputs.
The numbers match by construction — not by reconciliation.

```
Firm A (Rijeka instance) ──→ On-chain confirmation ←── Firm B (Rijeka instance)
                                    ↓
                         Public trade registry
                         Any party queries their facing trades
                         No vendor. No custodian. No DTCC.
                                    ↓
                         Margin calculations
                         Both sides run SIMM on same data
                         Margin call sent on-chain, acknowledged on-chain
                                    ↓
                         Disputes
                         Both sides submit numbers
                         Diff is public and auditable
                                    ↓
                         Regulatory reporting
                         Regulator pulls from chain directly
                         No manual submission. No restatement risk.
```

ISDA has been attempting this with the Common Domain Model (CDM) for years.
It is overcomplicated and committee-driven. A clean open-source implementation
that actually works — built on top of a real risk system — can leapfrog it.

**Deployment model:** single-tenant until Sprint 21. Each firm deploys their
own Rijeka instance. The blockchain layer is the only shared infrastructure —
and it is neutral by design.

**Multi-tenancy:** when firm adoption becomes real, add `firm_id TEXT NOT NULL DEFAULT 'DEFAULT'`
to all tables. Do not build this now. Current users are individuals with Gmail accounts.

*If you are reading this and you work in post-trade, smart contracts, or risk
technology — this is the problem worth solving. Contributions welcome.*

---

## File Delivery Rules (for Claude)

1. Complete replacement files only — never patches
2. Node.js scripts for multi-file delivery — not PowerShell
3. Always give `copy` cmd + `node script.js` cmd
4. New session: read handoff first, then this doc
5. End of sprint: `git add . && git commit && git push`

---

*Architecture v7 — Sprint 2 Day 3 (2026-03-26)*
*Rijeka — Croatian/Serbian/Bosnian for "river". Risk flows through it.*
*One system. One vocabulary. One source of truth.*
