// deliver_docs_day5.js — Rijeka Sprint 2 Day 5
// Delivers: ARCHITECTURE_v8.md + SPRINT2_DAY5_HANDOFF.md
//
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\deliver_docs_day5.js

const fs   = require('fs')
const path = require('path')

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka'

function write(rel, content) {
  const full = path.join(ROOT, rel.split('/').join(path.sep))
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
  console.log('  ✅  ' + rel)
}

// ─────────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE_v8.md
// ─────────────────────────────────────────────────────────────────────────────
write('docs/ARCHITECTURE_v8.md',
`# Rijeka — ARCHITECTURE_v8.md
> Updated: Sprint 2 Day 5 complete (2026-03-26)
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

**Local dev path:** \`C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\\`

---

## Monorepo Structure

\`\`\`
Rijeka/
├── frontend/                   React + Vite (Netlify — app.rijeka.app)
│   ├── .env                    Supabase keys — NEVER COMMIT
│   └── src/
│       ├── App.jsx             Full router + auth guard + initAuth ✅
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
│           ├── org/
│           │   └── OrgHierarchy.jsx  Collapsible tree, Supabase wired ✅
│           ├── onboarding/
│           │   ├── LegalEntities.jsx   ✅
│           │   └── Counterparties.jsx  ✅
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
\`\`\`

---

## Design Invariants — Never Change

\`\`\`
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
\`\`\`

---

## Stack

\`\`\`
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
\`\`\`

---

## URL Structure

\`\`\`
rijeka.app/                         → Landing page (public, static)
app.rijeka.app/                     → Root → /command-center or /login
app.rijeka.app/login                → Login
app.rijeka.app/signup               → Signup
app.rijeka.app/confirm              → Post-email-confirmation handle reveal
app.rijeka.app/command-center       → Command center (authenticated home)
app.rijeka.app/configurations/market-data/curves  → Curves workspace
app.rijeka.app/configurations/org-hierarchy       → Org hierarchy
app.rijeka.app/configurations/legal-entities      → Legal entities ✅
app.rijeka.app/configurations/counterparties      → Counterparties ✅
app.rijeka.app/pricer               → Pricer (Sprint 5)
app.rijeka.app/market-risk          → Market Risk (Sprint 10)
app.rijeka.app/pnl                  → PnL Attribution (Sprint 11)
app.rijeka.app/ccr                  → CCR (Sprint 14)
app.rijeka.app/simm                 → SIMM (Sprint 16)
app.rijeka.app/blockchain           → Blockchain registry (Sprint 18)
\`\`\`

---

## Auth Architecture

### Supabase Configuration
\`\`\`
Project URL:  https://upuewetohnocfshkhafg.supabase.co
Anon key:     sb_publishable_jfdfyrFFT5BF2js3cFXJ8A_PH2o3jEa
Auth:         Email + password, confirmation required, min 8 chars
Site URL:     https://rijeka.app
Redirect URLs:
  http://localhost:5173/confirm
  http://localhost:5173
  https://app.rijeka.app/confirm
\`\`\`

### Trader ID Generation (live)
\`\`\`
miko.devedzic@gmail.com → MIKO.DEVEDZIC
Collision: MIKO.DEVEDZIC_2, _3 etc.
Trigger: on_auth_user_created → handle_new_user() SECURITY DEFINER
Immutable after creation.
\`\`\`

### AuthGuard (critical)
\`\`\`
AuthGuard is a React Router v6 layout route — renders <Outlet /> not {children}.
initAuth() must be called in App.jsx useEffect on mount.
Without initAuth(): loading stays true forever → INITIALISING... hangs.
\`\`\`

---

## RBAC — Role Definitions

\`\`\`python
class Role(str, Enum):
    TRADER        = "trader"        # read + own trades only
    RISK          = "risk"          # read + run risk engines, all trades
    XVA           = "xva"           # read + run XVA, all trades
    ADMIN         = "admin"         # full access
    READ_ONLY     = "read_only"     # all tabs visible, no write (early access default)
    COUNTERPARTY  = "counterparty"  # external — facing trades + shared threads only (Sprint 18)
\`\`\`

---

## Core Database Schema

### Profiles (live)
\`\`\`sql
CREATE TABLE profiles (
    id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    trader_id TEXT UNIQUE NOT NULL,
    role      TEXT NOT NULL DEFAULT 'read_only',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

### Org Nodes (live)
\`\`\`sql
CREATE TABLE org_nodes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id  UUID REFERENCES org_nodes(id),
    name       TEXT NOT NULL,
    node_type  TEXT NOT NULL,  -- 'firm'|'division'|'desk'|'sub-desk'|'custom'
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);
-- RLS: authenticated read/insert/update
-- Hard delete: blocked if node has children
-- Sprint 4: also block if trades.desk_id references node
\`\`\`

### Legal Entities (live)
\`\`\`sql
CREATE TABLE legal_entities (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    lei               TEXT        UNIQUE NOT NULL,
    name              TEXT        NOT NULL,
    short_name        TEXT,
    home_currency     TEXT        NOT NULL,
    jurisdiction      TEXT        NOT NULL,
    regulatory_regime TEXT[],
    simm_version      TEXT        NOT NULL DEFAULT 'v2.6',
    im_threshold_m    NUMERIC(12,2),
    ois_curve_id      TEXT,
    is_own_entity     BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID        REFERENCES auth.users(id)
);
-- RLS: authenticated read/insert/update/delete
-- is_own_entity = TRUE for Rijeka itself — only one should ever be TRUE
-- lei is the GLEIF LEI code — 20 char alphanumeric
-- ois_curve_id → curve_definitions (not FK enforced — FK added Sprint 3)
\`\`\`

### Counterparties (live)
\`\`\`sql
CREATE TABLE counterparties (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_entity_id   UUID        REFERENCES legal_entities(id),
    name              TEXT        NOT NULL,
    isda_agreement    TEXT,
    csa_type          TEXT        CHECK (csa_type IN ('VM_ONLY','VM_IM','NO_CSA')),
    csa_currency      TEXT,
    csa_threshold_m   NUMERIC(12,2),
    csa_mta_k         NUMERIC(12,2),
    discount_curve_id TEXT,
    im_model          TEXT        NOT NULL DEFAULT 'SIMM',
    is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID        REFERENCES auth.users(id)
);
-- RLS: authenticated read/insert/update/delete
-- discount_curve_id auto-mapped from CSA_DISCOUNT_MAP on UI, overridable
-- Sprint 4: trades.counterparty_id FK → block hard delete if trades exist
\`\`\`

### Curves
\`\`\`sql
CREATE TABLE curve_definitions (
    id               TEXT PRIMARY KEY,
    ccy              TEXT NOT NULL,
    curve_class      TEXT NOT NULL,  -- 'OIS'|'BASIS'|'XCCY_BASIS'|'FUNDING'
    tenor_basis      TEXT,
    base_curve_id    TEXT REFERENCES curve_definitions(id),
    collateral_ccy   TEXT,
    index_name       TEXT,
    day_count        TEXT,
    description      TEXT,
    is_active        BOOLEAN DEFAULT TRUE
);

CREATE TABLE curve_stores (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_type     TEXT NOT NULL,  -- 'HISTORY'|'PRODUCTION'|'WORKING'
    curve_id       TEXT NOT NULL REFERENCES curve_definitions(id),
    curve_date     DATE NOT NULL,
    tenors         TEXT[] NOT NULL,
    zero_rates     NUMERIC[] NOT NULL,
    discount_factors NUMERIC[],
    source         TEXT,
    created_by     UUID REFERENCES auth.users(id),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (store_type, curve_id, curve_date)
);
\`\`\`

### Trades (Sprint 4)
\`\`\`sql
CREATE TABLE trades (
    id               TEXT PRIMARY KEY,  -- RJK-YYYY-NNNNN
    trade_ref        TEXT UNIQUE NOT NULL,
    product_type     TEXT NOT NULL,     -- 'IRS'|'CDS'|'FX_FWD'|'XCCY'|'OIS'
    asset_class      TEXT NOT NULL,     -- ISDA SIMM: 'Rates'|'Credit'|'FX'|'Equity'|'Commodity'
    counterparty_id  UUID REFERENCES counterparties(id),
    desk_id          UUID REFERENCES org_nodes(id),
    trader_id        TEXT REFERENCES profiles(trader_id),
    notional         NUMERIC(20,2) NOT NULL,
    notional_ccy     TEXT NOT NULL,
    trade_date       DATE NOT NULL,
    effective_date   DATE NOT NULL,
    maturity_date    DATE NOT NULL,
    pay_leg_type     TEXT,
    rec_leg_type     TEXT,
    fixed_rate       NUMERIC(10,8),
    floating_index   TEXT,
    status           TEXT NOT NULL DEFAULT 'LIVE',
    -- 'LIVE'|'TERMINATED'|'MATURED'|'CANCELLED'
    created_at       TIMESTAMPTZ DEFAULT NOW()
    -- NEVER UPDATED — all changes via trade_events
);

CREATE TABLE trade_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id      TEXT NOT NULL REFERENCES trades(id),
    event_type    TEXT NOT NULL,
    -- 'NEW'|'AMEND'|'TERMINATE'|'NOVATE'|'UNWIND'
    event_date    DATE NOT NULL,
    details       JSONB,
    created_by    TEXT REFERENCES profiles(trader_id),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

### Risk Results (Sprint 10)
\`\`\`sql
CREATE TABLE risk_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id    TEXT NOT NULL REFERENCES trades(id),
    run_date    DATE NOT NULL,
    dv01        NUMERIC(14,4),
    cs01        NUMERIC(14,4),
    vega        NUMERIC(14,4),
    delta_by_tenor JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (trade_id, run_date)
);
\`\`\`

### PnL (Sprint 11)
\`\`\`sql
CREATE TABLE pnl_results (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id     TEXT NOT NULL REFERENCES trades(id),
    pnl_date     DATE NOT NULL,
    total_pnl    NUMERIC(14,2),
    delta_pnl    NUMERIC(14,2),
    theta_pnl    NUMERIC(14,2),
    vega_pnl     NUMERIC(14,2),
    residual_pnl NUMERIC(14,2),
    is_new_trade BOOLEAN DEFAULT FALSE,
    is_eod       BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (trade_id, pnl_date)
);
\`\`\`

### Chat (append-only)
\`\`\`sql
CREATE TABLE chat_rooms (
    id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    room_type TEXT NOT NULL,
    -- 'global'|'desk'|'dm'|'custom'|'trade'|'report'|'xva_run'|'counterparty'
    name       TEXT,
    context_id TEXT,
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
    attachment_type TEXT,
    attachment_id   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
    -- NO UPDATE, NO DELETE — immutable
);
\`\`\`

### News
\`\`\`sql
CREATE TABLE news_items (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    headline     TEXT NOT NULL,
    summary      TEXT,
    source       TEXT,
    url          TEXT,
    published_at TIMESTAMPTZ,
    fetched_at   TIMESTAMPTZ DEFAULT NOW(),
    impact_level TEXT,
    asset_class  TEXT[],
    direction    TEXT,
    currencies   TEXT[],
    tenors       TEXT[],
    ai_summary   TEXT,
    ai_scored_at TIMESTAMPTZ
);
\`\`\`

---

## CSA → Discount Curve Mapping

\`\`\`python
CSA_DISCOUNT_MAP = {
    'USD': 'USD_SOFR',  'EUR': 'EUR_ESTR',  'GBP': 'GBP_SONIA',
    'JPY': 'JPY_TONAR', 'CHF': 'CHF_SARON', 'AUD': 'AUD_AONIA',
    'CAD': 'CAD_CORRA',
}
# Auto-mapped in Counterparties UI on CSA currency change. Overridable.
\`\`\`

---

## Curve Bootstrap Order

\`\`\`
Pass 1: OIS     (13) — independent
Pass 2: Basis   (22) — depends on OIS
Pass 3: XCCY    (12) — depends on OIS + USD_SOFR + FX spot
Pass 4: Funding  (7) — additive spread on OIS, no bootstrap
\`\`\`

---

## Legal Entity vs Counterparty — Conceptual Split

\`\`\`
Legal Entity  = the real-world company. Has LEI, jurisdiction, regulatory regime.
                Static regulatory data. One record per firm.
                is_own_entity = TRUE for Rijeka itself (one record only).

Counterparty  = your bilateral trading relationship with that entity.
                Has ISDA agreement, CSA terms, discount curve, IM model.
                One legal entity can have multiple counterparty records
                (e.g. Goldman London vs Goldman NYC under different CSAs).

Trades reference counterparty_id, not legal_entity_id directly.
XVA engine walks up to legal_entity for LEI, jurisdiction, SIMM version.
\`\`\`

---

## AI Architecture (Sprint 11+)

Claude API — server-side only in FastAPI. Never in frontend.

\`\`\`
pnl_explain.py     — EOD or on-demand. Input: PnL row + market moves.
hedging_recs.py    — limit breach trigger or on-demand. Input: portfolio greeks + limits.
xva_commentary.py  — on XVA run completion. Input: XVA results per counterparty.
news_scorer.py     — every 15min. Input: headline + summary. Output: scored news item.
\`\`\`

---

## Chat Architecture

\`\`\`
Sprint 7  — Global feed, DMs, desk rooms (auto-created from org hierarchy)
Sprint 8  — Contextual threads on trades/reports/XVA runs + trade cards
Sprint 14 — Internal + external counterparty rooms (COUNTERPARTY role)
Sprint 19 — Custom user-created rooms
\`\`\`

---

## Sprint Roadmap

\`\`\`
Sprint 1  ✅  Market data workspace HTML prototype
Sprint 2  🔄  React · Auth · Curves · Org · Legal Entity · Counterparty · FastAPI · Deploy
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
\`\`\`

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

\`\`\`
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
\`\`\`

ISDA has been attempting this with the Common Domain Model (CDM) for years.
It is overcomplicated and committee-driven. A clean open-source implementation
that actually works — built on top of a real risk system — can leapfrog it.

**Deployment model:** single-tenant until Sprint 21. Each firm deploys their
own Rijeka instance. The blockchain layer is the only shared infrastructure —
and it is neutral by design.

**Multi-tenancy:** when firm adoption becomes real, add \`firm_id TEXT NOT NULL DEFAULT 'DEFAULT'\`
to all tables. Do not build this now. Current users are individuals with Gmail accounts.

*If you are reading this and you work in post-trade, smart contracts, or risk
technology — this is the problem worth solving. Contributions welcome.*

---

## File Delivery Rules (for Claude)

1. Complete replacement files only — never patches
2. Node.js scripts for multi-file delivery — not PowerShell
3. Always give \`copy\` cmd + \`node full\\path\\script.js\` cmd — never just \`node script.js\`
4. New session: read handoff first, then this doc
5. End of sprint: \`git add . && git commit && git push\`
6. AuthGuard is a layout route — always renders <Outlet />, never {children}
7. App.jsx must call initAuth() in useEffect on mount

---

*Architecture v8 — Sprint 2 Day 5 (2026-03-26)*
*Rijeka — Croatian/Serbian/Bosnian for "river". Risk flows through it.*
*One system. One vocabulary. One source of truth.*
`);

// ─────────────────────────────────────────────────────────────────────────────
//  SPRINT2_DAY5_HANDOFF.md
// ─────────────────────────────────────────────────────────────────────────────
write('SPRINT2_DAY5_HANDOFF.md',
`# Rijeka — Sprint 2 Day 5 Complete
> Start every new chat session by reading this document first.
> Every file delivered = complete replacement. Never patch. Never append.
> Every file is delivered as a Node.js script. Copy to Rijeka root, run with full path.
> Never run commands from C:\\Users\\mikod — always cd to Rijeka first or use full path.
> End of every sprint: git add . && git commit -m "Sprint X complete" && git push

---

## Project

Rijeka — open-source full revaluation derivatives risk system.
Pure risk analytics: market risk, CCR, XVA, ISDA SIMM, on-chain confirmation.
ISDA SIMM v2.6 naming conventions used throughout.
Croatian/Serbian/Bosnian word for "river" — named after Miko's village in Bosnia.

---

## Infrastructure (locked — do not change)

| Service   | Purpose                        | Account        | URL |
|-----------|-------------------------------|----------------|-----|
| Netlify   | Landing page (static)          | MikoDevedzic   | rijeka.app |
| Netlify   | React app (future)             | MikoDevedzic   | app.rijeka.app (Day 7) |
| Render    | Backend FastAPI                | MikoDevedzic   | Day 6 |
| Supabase  | Postgres + Auth                | MikoDevedzic   | https://upuewetohnocfshkhafg.supabase.co |
| GitHub    | Monorepo source control        | MikoDevedzic   | see below |
| Namecheap | Domain registrar               | mikod7         | rijeka.app |

**GitHub repo:**
\`https://github.com/MikoDevedzic/open-source-cross-asset-pricing-and-risk-platform\`

**Local path (Windows):**
\`C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\\`

**Monorepo structure:**
\`\`\`
Rijeka\\
├── frontend\\
│   ├── .env                          ← Supabase keys (never commit)
│   └── src\\
│       ├── App.jsx                   ← router + auth guard + initAuth ✅
│       ├── index.css                 ← all design tokens + Sprint 2 styles ✅
│       ├── lib\\
│       │   └── supabase.js           ← Supabase client (sessionStorage) ✅
│       ├── data\\
│       │   └── ratesCurves.js        ← 54 curves + CCY_GROUPS + helpers ✅
│       ├── store\\
│       │   ├── useMarketDataStore.js ← Zustand store ✅
│       │   └── useAuthStore.js       ← auth + profile + trader ID ✅
│       └── components\\
│           ├── layout\\               ← AppBar, CfgNav (3 sections), StubPage ✅
│           ├── auth\\                 ← LoginPage, SignupPage, ConfirmPage, AuthGuard ✅
│           ├── CommandCenter.jsx     ← matrix rain + boot sequence + tiles ✅
│           ├── market-data\\          ← full curves workspace ✅
│           ├── org\\
│           │   └── OrgHierarchy.jsx  ← collapsible tree, Supabase wired ✅
│           └── onboarding\\
│               ├── LegalEntities.jsx  ← wired to Supabase ✅
│               └── Counterparties.jsx ← wired to Supabase ✅
├── backend\\                          ← FastAPI (Day 6)
├── landing\\                          ← Static marketing site
│   └── index.html                    ← rijeka.app ✅ LIVE
└── docs\\
    ├── ARCHITECTURE_v8.md            ← current
    └── SPRINT2_DAY5_HANDOFF.md      ← this file
\`\`\`

---

## Supabase (live, configured)

**Project URL:** \`https://upuewetohnocfshkhafg.supabase.co\`
**Publishable key:** \`sb_publishable_jfdfyrFFT5BF2js3cFXJ8A_PH2o3jEa\`

**Tables live:**
- \`profiles\` — id, trader_id, role, created_at
- \`org_nodes\` — id, parent_id, name, node_type, is_active, sort_order, created_at, created_by
- \`legal_entities\` — id, lei, name, short_name, home_currency, jurisdiction, regulatory_regime, simm_version, im_threshold_m, ois_curve_id, is_own_entity, is_active, created_at, created_by
- \`counterparties\` — id, legal_entity_id, name, isda_agreement, csa_type, csa_currency, csa_threshold_m, csa_mta_k, discount_curve_id, im_model, is_active, created_at, created_by

**Triggers live:**
- \`on_auth_user_created\` → \`handle_new_user()\` — auto-generates trader ID from email

**RLS:**
- \`profiles\` — RLS disabled (trigger is SECURITY DEFINER)
- \`org_nodes\` — authenticated read/insert/update
- \`legal_entities\` — authenticated read/insert/update/delete
- \`counterparties\` — authenticated read/insert/update/delete

---

## Design Invariants (never change)

\`\`\`
--bg:        #060a0e
--bg-deep:   #03060a
--panel:     #0b1219
--panel-2:   #0f1820
--panel-3:   #141f28
--accent:    #0ec9a0
--amber:     #e8a020
--blue:      #3d8bc8
--purple:    #9060cc
--red:       #d95040
--mono:      JetBrains Mono
\`\`\`

Dark terminal aesthetic. Every component uses CSS variables — no hardcoded hex values.
ISDA SIMM naming on every variable, endpoint, and column.
3-store separation: History / Production / Working — never overlap.
Immutability enforced at DB level.
\`firm_spread(t)\` is single source of truth for FVA/ColVA/MVA.

---

## Critical Auth Notes (learned Day 5)

**AuthGuard must render \`<Outlet />\` not \`{children}\`** — React Router v6 layout route pattern.
**App.jsx must call \`initAuth()\` in \`useEffect\` on mount** — without this, \`loading\` stays \`true\` forever and every route shows INITIALISING... indefinitely.
Both of these are already correct in the delivered files.

---

## File Delivery Rules (critical)

1. **Complete replacement files only** — never patches, never manual edits
2. **Node.js scripts for all file delivery** — not PowerShell (quote escaping issues)
3. **Always deliver script as download, then:**
   \`\`\`cmd
   copy C:\\Users\\mikod\\Downloads\\script_name.js C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\script_name.js
   node C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\script_name.js
   \`\`\`
4. **Never tell user to run \`node script.js\` without full path** — they may be in wrong directory
5. **Never ask user to scroll, find text, or edit manually**
6. New session: read handoff first, then ARCHITECTURE_v8.md

---

## Dev Commands

\`\`\`cmd
# Start frontend (run in its own terminal tab — keep running)
cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend
npm run dev
# → http://localhost:5173

# Run a delivery script (always use full path)
node C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\script_name.js

# Push to GitHub
cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka
git add .
git commit -m "message"
git push
\`\`\`

---

## Live URLs

| URL | Status |
|-----|--------|
| \`rijeka.app\` | ✅ Live |
| \`localhost:5173\` | ✅ Running locally |
| \`app.rijeka.app\` | ⏳ Day 7 |

---

## Auth Flow (fully working locally)

\`\`\`
localhost:5173/login → ENTER SYSTEM
    ↓
localhost:5173/command-center → matrix rain → RIJEKA boot
    ↓
Module tiles → MARKET DATA → /configurations/market-data/curves
              → ORG HIERARCHY → /configurations/org-hierarchy
              → LEGAL ENTITIES → /configurations/legal-entities
              → COUNTERPARTIES → /configurations/counterparties
\`\`\`

---

## Sprint 2 Progress

### Day 1 ✅ COMPLETE
- React + Vite, dependencies, CSS tokens, router, layout components

### Day 2 ✅ COMPLETE
- 54 curves, Zustand store, full curves workspace

### Day 3 ✅ COMPLETE
- Supabase auth, profiles table, trader ID trigger
- LoginPage, SignupPage, ConfirmPage, AuthGuard, CommandCenter

### Day 4 ✅ COMPLETE
- \`org_nodes\` table in Supabase
- \`OrgHierarchy.jsx\` — full collapsible tree wired to Supabase
- Collapsible tree, inline rename, drag-drop reorder, soft delete, hard delete guard

### Day 5 ✅ COMPLETE
- \`legal_entities\` table in Supabase (RLS enabled)
- \`counterparties\` table in Supabase (RLS enabled)
- \`LegalEntities.jsx\` — table list + inline add form + double-click rename + deact/react/delete
- \`Counterparties.jsx\` — same pattern + CSA currency → discount curve auto-map
- \`CfgNav.jsx\` updated — ONBOARDING section added (LEGAL ENTITIES + COUNTERPARTIES)
- \`App.jsx\` updated — new routes added
- **Bug fixed:** AuthGuard renders \`<Outlet />\` not \`{children}\`
- **Bug fixed:** \`initAuth()\` called in App.jsx \`useEffect\` on mount

**LegalEntities features:**
- Add form: LEI, name, short name, currency, jurisdiction, regulatory regime (comma-sep → array), SIMM version, IM threshold, OIS curve, own entity flag
- Left border: accent = own entity, blue = counterparty entity
- Double-click inline rename (persists to Supabase)
- DEACT / REACT / hard DELETE (inactive only)
- SHOW INACTIVE toggle

**Counterparties features:**
- Add form: name, legal entity (FK dropdown), ISDA agreement, CSA type, CSA currency, discount curve (auto-mapped), threshold, MTA, IM model
- CSA fields collapse when NO_CSA selected
- Left border color encodes CSA type: accent=VM_IM, blue=VM_ONLY, amber=NO_CSA
- Double-click inline rename, DEACT / REACT / DELETE

**Test data in Supabase:**
- Legal entities: RIJEKA CAPITAL (own), GOLDMAN SACHS INTERNATIONAL, JP MORGAN CHASE BANK NA
- Counterparties: GSI (VM_IM / GBP / GBP_SONIA), JPMCB (VM_ONLY / USD / USD_SOFR)

---

### Day 6 — NEXT: FastAPI Backend

**Location:** \`C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\\`

**Structure:**
\`\`\`
backend/
├── main.py
├── requirements.txt
├── .env                    ← DB URL + JWT secret (never commit)
├── db/
│   ├── session.py          ← SQLAlchemy engine + session
│   └── models.py           ← SQLAlchemy models mirroring Supabase schema
├── api/
│   └── routes/
│       ├── curves.py
│       ├── org.py
│       ├── legal_entities.py
│       └── counterparties.py
└── engines/                ← Sprint 3+
\`\`\`

**Key endpoints:**
\`\`\`
GET  /health
GET  /api/curves/rates
GET  /api/org/nodes
GET  /api/legal-entities
GET  /api/counterparties
POST /api/legal-entities
POST /api/counterparties
PUT  /api/legal-entities/{id}
PUT  /api/counterparties/{id}
\`\`\`

**Auth:** Supabase JWT validation in FastAPI middleware — no separate user table.
**Deploy:** Render, auto-deploy from \`backend/\` on GitHub push.
**URL:** \`api.rijeka.app\` (configure on Render)

---

### Day 7 — Deploy to app.rijeka.app

- Create Netlify site from \`frontend/\`
- Set custom domain: \`app.rijeka.app\`
- Update Supabase redirect URLs
- Deploy new \`landing/index.html\`

---

## Test Firm Structure (in Supabase)

**org_nodes:**
\`\`\`
RIJEKA TEST FIRM (firm)
├── GLOBAL MARKETS (division)
│   ├── FX TRADING (desk) → G10 FX, EM FX
│   ├── RATES TRADING (desk) → G10 RATES, EM RATES
│   ├── CREDIT TRADING (desk) → INVESTMENT GRADE, HIGH YIELD
│   ├── COMMODITIES TRADING (desk) → ENERGY, METALS
│   └── EQUITY DERIVATIVES (desk) → SINGLE STOCK, INDEX & VOLATILITY
├── XVA DESK (division)
│   ├── CVA/DVA, FVA & COLVA, MVA, KVA
└── RISK MANAGEMENT (division)
    ├── MARKET RISK, CCR, MODEL RISK
\`\`\`

**legal_entities:**
- RIJEKA CAPITAL (own entity, USD, US)
- GOLDMAN SACHS INTERNATIONAL (GBP, GB, EMIR/MIFID2)
- JP MORGAN CHASE BANK NA (USD, US, DODD-FRANK)

**counterparties:**
- GOLDMAN SACHS INTERNATIONAL → GSI, VM_IM, GBP, GBP_SONIA, 50M threshold
- JP MORGAN CHASE BANK NA → JPMCB, VM_ONLY, USD, USD_SOFR, 0 threshold

---

## Curve Bootstrap Order (never change)

\`\`\`
Pass 1: OIS        → independent, bootstrapped first
Pass 2: Basis      → depends on OIS (base_curve_id FK)
Pass 3: XCCY       → depends on domestic OIS + USD_SOFR + FX spot
Pass 4: Funding    → depends on OIS, additive spread (no bootstrap)
\`\`\`

---

*Sprint 1 complete: 2025-01-15*
*Sprint 2 Day 1 complete: 2026-03-25*
*Sprint 2 Day 2 complete: 2026-03-25*
*Sprint 2 Day 3 complete: 2026-03-26*
*Sprint 2 Day 4 complete: 2026-03-26*
*Sprint 2 Day 5 complete: 2026-03-26*
*Rijeka — Croatian/Serbian/Bosnian for "river". Risk flows through it.*
`);

console.log(`
✅  Both docs written.

  docs/ARCHITECTURE_v8.md
  SPRINT2_DAY5_HANDOFF.md

Now commit everything:

  cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka
  git add .
  git commit -m "Sprint 2 Day 5 complete"
  git push

Then open a new chat and paste SPRINT2_DAY5_HANDOFF.md to start Day 6.
`);
