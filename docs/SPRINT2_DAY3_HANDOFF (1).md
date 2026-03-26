# Rijeka — Sprint 2 Day 3 Complete
> Start every new chat session by reading this document first.
> Every file delivered = complete replacement. Never patch. Never append.
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
| Netlify   | React app (future)             | MikoDevedzic   | app.rijeka.app (not yet deployed) |
| Render    | Backend FastAPI                | MikoDevedzic   | (Day 4+) |
| Supabase  | Postgres + Auth                | MikoDevedzic   | https://upuewetohnocfshkhafg.supabase.co |
| GitHub    | Monorepo source control        | MikoDevedzic   | see below |
| Namecheap | Domain registrar               | mikod7         | rijeka.app |

**GitHub repo:**
`https://github.com/MikoDevedzic/open-source-cross-asset-pricing-and-risk-platform`

**Local path (Windows):**
`C:\Users\mikod\OneDrive\Desktop\Rijeka\`

**Monorepo structure:**
```
Rijeka\
├── frontend\                   ← React + Vite (Sprint 2 active)
│   ├── .env                    ← Supabase keys (never commit)
│   └── src\
│       ├── App.jsx             ← full router tree with auth guard ✅
│       ├── index.css           ← all design tokens + Sprint 2 styles ✅
│       ├── lib\
│       │   └── supabase.js     ← Supabase client (sessionStorage) ✅
│       ├── data\
│       │   └── ratesCurves.js  ← 54 curves + CCY_GROUPS + helpers ✅
│       ├── store\
│       │   ├── useMarketDataStore.js ← Zustand store ✅
│       │   └── useAuthStore.js ← auth + profile + trader ID ✅
│       └── components\
│           ├── layout\         ← AppBar, CfgNav, MdNav, StubPage ✅
│           ├── auth\           ← LoginPage, SignupPage, ConfirmPage, AuthGuard ✅
│           ├── CommandCenter.jsx ← matrix rain + boot sequence + tiles ✅
│           └── market-data\    ← full curves workspace ✅
├── backend\                    ← FastAPI (Day 4)
├── landing\                    ← Static marketing site
│   ├── index.html              ← rijeka.app ✅ LIVE (old version — new About version ready to deploy)
│   └── command-center.html     ← matrix rain boot (legacy, superseded by React)
├── docs\                       ← methodology PDF/LaTeX
└── sprint 1 Market Data\       ← reference only
```

---

## Supabase (live, configured)

**Project URL:** `https://upuewetohnocfshkhafg.supabase.co`
**Publishable key:** `sb_publishable_jfdfyrFFT5BF2js3cFXJ8A_PH2o3jEa`

**Tables live:**
- `profiles` — id (UUID FK auth.users), trader_id (TEXT UNIQUE), role (TEXT), created_at

**Trigger live:**
- `on_auth_user_created` → `handle_new_user()` — auto-generates trader ID from email
  - `miko.devedzic@gmail.com` → `MIKO.DEVEDZIC`
  - Collision resolution: `_2`, `_3` etc.

**RLS:**
- Row Level Security DISABLED on profiles (trigger is SECURITY DEFINER, handles all inserts)
- Public SELECT policy on profiles

**Auth settings:**
- Email provider: enabled
- Min password: 8 characters
- Site URL: `https://rijeka.app`
- Redirect URLs: `http://localhost:5173/confirm`, `http://localhost:5173`, `https://app.rijeka.app/confirm`

---

## Design Invariants (never change)

```
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
```

Dark terminal aesthetic. Every component uses CSS variables — no hardcoded hex values.
ISDA SIMM naming on every variable, endpoint, and column.
3-store separation: History / Production / Working — never overlap.
Immutability enforced at DB level.
`firm_spread(t)` is single source of truth for FVA/ColVA/MVA.

---

## Live URLs

| URL | What it is | Status |
|-----|-----------|--------|
| `rijeka.app` | Landing page (old version) | ✅ Live |
| `localhost:5173` | React app (dev only) | ✅ Running locally |
| `app.rijeka.app` | React app (production) | ⏳ Not deployed yet |

**New landing/index.html** is written and ready — drag `landing\` folder to Netlify
(fantastic-khapse-cffe0d) to deploy the About section.

**Deploy React app to app.rijeka.app:** create new Netlify site from `frontend\` folder,
set custom domain to `app.rijeka.app`. Do this when backend is ready (Day 4+).

---

## Auth Flow (fully working locally)

```
rijeka.app → "Request Early Access"
    ↓
localhost:5173/signup
    → email + password
    → handle types itself out as you type (typewriter effect)
    → REQUEST ACCESS → CONFIRMED ✓
    → "Check your email" screen with glowing handle preview
    ↓
Email confirmation link → localhost:5173/confirm
    → "Identity confirmed" fades in
    → "Welcome to the river."
    → Trader handle types itself out large with glow pulse
    → "ENTER THE SYSTEM →" button fades in
    ↓
localhost:5173/command-center
    → Matrix rain (dense, layered, financial chars)
    → RIJEKA boots up letter by letter
    → "Welcome, MIKO.DEVEDZIC." types out
    → Module tiles slide in staggered
    → Click MARKET DATA tile → /configurations/market-data/curves
    ↓
App (curves workspace, all routes)
    → RIJEKA in AppBar → back to command center
    → EXIT → sign out → login
```

---

## Sprint 2 Progress

### Day 1 ✅ COMPLETE
- React + Vite project in `frontend/`
- Dependencies: react-router-dom, zustand, axios, tailwindcss, @dnd-kit, @supabase/supabase-js
- CSS design tokens in `src/index.css`
- Full React Router tree in `src/App.jsx`
- AppBar, CfgNav, MdNav, StubPage layout components

### Day 2 ✅ COMPLETE
- `src/data/ratesCurves.js` — 54 curves, CCY_GROUPS, helpers
- `src/store/useMarketDataStore.js` — Zustand store
- Full curves workspace (CurvesWorkspace, CurvesSidebar, CurveDetail, OISDetail, BasisDetail, XCCYDetail, FundingDetail)
- Landing page + command-center.html live

### Day 3 ✅ COMPLETE
- Supabase project configured (auth, profiles table, trader ID trigger)
- `src/lib/supabase.js` — client with sessionStorage (no localStorage)
- `src/store/useAuthStore.js` — session, profile, signIn, signUp, signOut, initAuth
- `src/components/auth/AuthGuard.jsx` — protects all authenticated routes
- `src/components/auth/LoginPage.jsx` — dopamine UI, rain background, sweep button
- `src/components/auth/SignupPage.jsx` — typewriter handle preview, rain background
- `src/components/auth/ConfirmPage.jsx` — handle reveal with glow pulse, "Welcome to the river."
- `src/components/CommandCenter.jsx` — matrix rain, boot sequence, staggered tiles
- `src/App.jsx` — auth guard wired, /command-center as default post-login route
- `src/components/layout/AppBar.jsx` — shows MIKO.DEVEDZIC + role + EXIT
- App shell layout CSS fixed (app-root, app-body, appbar, md-root etc.)
- New landing/index.html with About section (ready to deploy, not yet live)

---

### Day 4 — NEXT: Org Hierarchy (Frontend)

**Route:** `/configurations/org-hierarchy`
**Component:** `src/components/org/OrgHierarchy.jsx`

**UI:**
- Collapsible tree — Firm → Division → Desk → Sub-desk → Custom
- Add node button at each level
- Rename inline (double-click)
- Deactivate (soft delete — is_active = false)
- Drag-drop reorder (@dnd-kit already installed)

**Node type border colours:**
```
Firm      → --accent  (#0ec9a0)
Division  → --blue    (#3d8bc8)
Desk      → --amber   (#e8a020)
Sub-desk  → --purple  (#9060cc)
Custom    → --border-hi
```

**DB table (already in architecture):**
```sql
CREATE TABLE org_nodes (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    parent_id   TEXT REFERENCES org_nodes(id),
    name        TEXT NOT NULL,
    node_type   TEXT NOT NULL,  -- 'firm'|'division'|'desk'|'sub_desk'|'custom'
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    created_by  TEXT
);
```

**For Day 4:** Build UI with local state only (no API yet).
Wire to Supabase directly from frontend (same pattern as auth).
Backend API layer comes Day 4 FastAPI sprint.

---

### Day 5 — Legal Entity + Counterparty Master

**CSA → Discount curve auto-mapping:**
```python
CSA_DISCOUNT_MAP = {
    'USD': 'USD_SOFR', 'EUR': 'EUR_ESTR', 'GBP': 'GBP_SONIA',
    'JPY': 'JPY_TONAR', 'CHF': 'CHF_SARON', 'AUD': 'AUD_AONIA', 'CAD': 'CAD_CORRA'
}
```

---

### Day 6 — FastAPI Backend

**Location:** `C:\Users\mikod\OneDrive\Desktop\Rijeka\backend\`

```bash
pip install fastapi uvicorn sqlalchemy alembic python-jose[cryptography] passlib psycopg2-binary
```

**Key endpoints:**
- `GET  /api/curves/rates`
- `POST /api/curves/rates/bootstrap` — 501 stub (Sprint 3)
- `GET/PUT /api/curves/funding/spreads`
- `POST /auth/login` → JWT
- `GET/POST/PUT /api/org/nodes`
- `GET/POST/PUT /api/legal-entities`
- `GET/POST/PUT /api/counterparties`

**Deploy:** Render, auto-deploy from `backend/` on GitHub push.

---

### Day 7 — Deploy to app.rijeka.app

- Create Netlify site from `frontend/`
- Set custom domain: `app.rijeka.app`
- Update Supabase redirect URLs to include `https://app.rijeka.app/confirm`
- Update `frontend/.env` with production Supabase URL
- Deploy new `landing/index.html` (About section)
- "Request Early Access" on landing → `https://app.rijeka.app/signup`

---

### Day 8 — Integration testing + Sprint 3 handoff

---

## Curve Bootstrap Order (never change)

```
Pass 1: OIS        → independent, bootstrapped first
Pass 2: Basis      → depends on OIS (base_curve_id FK)
Pass 3: XCCY       → depends on domestic OIS + USD_SOFR + FX spot
Pass 4: Funding    → depends on OIS, additive spread (no bootstrap)
```

---

## Dev Commands

```cmd
# Start frontend
cd C:\Users\mikod\OneDrive\Desktop\Rijeka\frontend
npm run dev
# → http://localhost:5173

# If port 5173 is in use — find and kill
netstat -ano | findstr :5173
taskkill /PID <pid> /F

# Push to GitHub
cd C:\Users\mikod\OneDrive\Desktop\Rijeka
git add .
git commit -m "message"
git push

# Run a node setup script
node setup_script.js

# Deploy landing page — drag landing\ folder into Netlify drop zone
# Project: fantastic-khapse-cffe0d (rijeka.app)
# URL: app.netlify.com/projects/fantastic-khapse-cffe0d/overview
```

---

## Architecture Notes (updated Sprint 2 Day 3)

**Auth architecture:**
- Supabase JS client in frontend — no backend needed for auth
- Tokens stored in sessionStorage (not localStorage — XSS prevention)
- 8h access token, 30d refresh
- Trader ID immutable after creation — generated by DB trigger
- READ_ONLY role for all early access users

**Two Netlify sites:**
- `fantastic-khapse-cffe0d` → `rijeka.app` — static landing
- New site (Day 7) → `app.rijeka.app` — React app

**DNS:** Namecheap Advanced DNS:
- A Record `@` → `75.2.60.5`
- CNAME `www` → `apex-loadbalancer.netlify.com`
- CNAME `app` → (to be added Day 7 when React app deployed)

**Command center is React** (not the old static HTML):
- `/command-center` route in React app
- Old `landing/command-center.html` is legacy — keep for reference only
- Boot welcome: "Welcome, [TRADER_ID]." — live from Supabase session

**File delivery rules:**
1. Always deliver complete replacement files — never patches
2. Always use Node.js scripts for multi-file delivery (not PowerShell — quote escaping issues)
3. Always give `copy` cmd to move downloaded files into place
4. New session starts by reading this handoff document first

---

## Methodology Status

`docs/Rijeka_Methodology_v1.1.pdf` — covers Sprint 1 complete.
Next update: v1.2 at Sprint 2 completion (Day 8).
Sections to add in v1.2:
- Section 2: System Architecture (auth, RBAC, trader ID, 3-store model)
- Section 3: Org Hierarchy data model
- Section 4.6: Supabase immutability trigger pattern

---

## About / Landing Page Copy (approved)

*Rijeka* means "river" in the languages of the former Yugoslavia — Serbian, Croatian, Bosnian.
One word, shared across a region that has known both division and belonging. That is intentional.

I grew up in a small village called Rijeka in Bosnia. I left in May 2000, after a decade of war
had reshaped everything. I came to the United States, learned the language, built a family, and
followed every path this country made available. I am forever grateful for that.

I spent 15+ years in banking and finance, working inside the systems that price and risk-manage
derivatives at an institutional level. I watched that knowledge stay locked behind proprietary
walls — available only to firms that could afford it.

Rijeka is my attempt to change that. Open-source, full-revaluation derivatives risk — educational
in purpose, open in spirit. Built for the curious, for the self-taught, for anyone in any corner
of the world who wants to understand how these systems actually work.

The community will take it wherever it is destined to go.

— Miko Devedzic · linkedin.com/in/mikodevedzic · hello@rijeka.app

---

*Sprint 1 complete: 2025-01-15*
*Sprint 2 Day 1 complete: 2026-03-25*
*Sprint 2 Day 2 complete: 2026-03-25*
*Sprint 2 Day 3 complete: 2026-03-26*
*Rijeka — Croatian/Serbian/Bosnian for "river". Risk flows through it.*
