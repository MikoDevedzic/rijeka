# Rijeka — Sprint 2 Day 5 Complete
> Start every new chat session by reading this document first.
> Every file delivered = complete replacement. Never patch. Never append.
> Every file is delivered as a Node.js script. Copy to Rijeka root, run with full path.
> Never run commands from C:\Users\mikod — always cd to Rijeka first or use full path.
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
`https://github.com/MikoDevedzic/open-source-cross-asset-pricing-and-risk-platform`

**Local path (Windows):**
`C:\Users\mikod\OneDrive\Desktop\Rijeka\`

**Monorepo structure:**
```
Rijeka\
├── frontend\
│   ├── .env                          ← Supabase keys (never commit)
│   └── src\
│       ├── App.jsx                   ← router + auth guard + initAuth ✅
│       ├── index.css                 ← all design tokens + Sprint 2 styles ✅
│       ├── lib\
│       │   └── supabase.js           ← Supabase client (sessionStorage) ✅
│       ├── data\
│       │   └── ratesCurves.js        ← 54 curves + CCY_GROUPS + helpers ✅
│       ├── store\
│       │   ├── useMarketDataStore.js ← Zustand store ✅
│       │   └── useAuthStore.js       ← auth + profile + trader ID ✅
│       └── components\
│           ├── layout\               ← AppBar, CfgNav (3 sections), StubPage ✅
│           ├── auth\                 ← LoginPage, SignupPage, ConfirmPage, AuthGuard ✅
│           ├── CommandCenter.jsx     ← matrix rain + boot sequence + tiles ✅
│           ├── market-data\          ← full curves workspace ✅
│           ├── org\
│           │   └── OrgHierarchy.jsx  ← collapsible tree, Supabase wired ✅
│           └── onboarding\
│               ├── LegalEntities.jsx  ← wired to Supabase ✅
│               └── Counterparties.jsx ← wired to Supabase ✅
├── backend\                          ← FastAPI (Day 6)
├── landing\                          ← Static marketing site
│   └── index.html                    ← rijeka.app ✅ LIVE
└── docs\
    ├── ARCHITECTURE_v8.md            ← current
    └── SPRINT2_DAY5_HANDOFF.md      ← this file
```

---

## Supabase (live, configured)

**Project URL:** `https://upuewetohnocfshkhafg.supabase.co`
**Publishable key:** `sb_publishable_jfdfyrFFT5BF2js3cFXJ8A_PH2o3jEa`

**Tables live:**
- `profiles` — id, trader_id, role, created_at
- `org_nodes` — id, parent_id, name, node_type, is_active, sort_order, created_at, created_by
- `legal_entities` — id, lei, name, short_name, home_currency, jurisdiction, regulatory_regime, simm_version, im_threshold_m, ois_curve_id, is_own_entity, is_active, created_at, created_by
- `counterparties` — id, legal_entity_id, name, isda_agreement, csa_type, csa_currency, csa_threshold_m, csa_mta_k, discount_curve_id, im_model, is_active, created_at, created_by

**Triggers live:**
- `on_auth_user_created` → `handle_new_user()` — auto-generates trader ID from email

**RLS:**
- `profiles` — RLS disabled (trigger is SECURITY DEFINER)
- `org_nodes` — authenticated read/insert/update
- `legal_entities` — authenticated read/insert/update/delete
- `counterparties` — authenticated read/insert/update/delete

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

## Critical Auth Notes (learned Day 5)

**AuthGuard must render `<Outlet />` not `{children}`** — React Router v6 layout route pattern.
**App.jsx must call `initAuth()` in `useEffect` on mount** — without this, `loading` stays `true` forever and every route shows INITIALISING... indefinitely.
Both of these are already correct in the delivered files.

---

## File Delivery Rules (critical)

1. **Complete replacement files only** — never patches, never manual edits
2. **Node.js scripts for all file delivery** — not PowerShell (quote escaping issues)
3. **Always deliver script as download, then:**
   ```cmd
   copy C:\Users\mikod\Downloads\script_name.js C:\Users\mikod\OneDrive\Desktop\Rijeka\script_name.js
   node C:\Users\mikod\OneDrive\Desktop\Rijeka\script_name.js
   ```
4. **Never tell user to run `node script.js` without full path** — they may be in wrong directory
5. **Never ask user to scroll, find text, or edit manually**
6. New session: read handoff first, then ARCHITECTURE_v8.md

---

## Dev Commands

```cmd
# Start frontend (run in its own terminal tab — keep running)
cd C:\Users\mikod\OneDrive\Desktop\Rijeka\frontend
npm run dev
# → http://localhost:5173

# Run a delivery script (always use full path)
node C:\Users\mikod\OneDrive\Desktop\Rijeka\script_name.js

# Push to GitHub
cd C:\Users\mikod\OneDrive\Desktop\Rijeka
git add .
git commit -m "message"
git push
```

---

## Live URLs

| URL | Status |
|-----|--------|
| `rijeka.app` | ✅ Live |
| `localhost:5173` | ✅ Running locally |
| `app.rijeka.app` | ⏳ Day 7 |

---

## Auth Flow (fully working locally)

```
localhost:5173/login → ENTER SYSTEM
    ↓
localhost:5173/command-center → matrix rain → RIJEKA boot
    ↓
Module tiles → MARKET DATA → /configurations/market-data/curves
              → ORG HIERARCHY → /configurations/org-hierarchy
              → LEGAL ENTITIES → /configurations/legal-entities
              → COUNTERPARTIES → /configurations/counterparties
```

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
- `org_nodes` table in Supabase
- `OrgHierarchy.jsx` — full collapsible tree wired to Supabase
- Collapsible tree, inline rename, drag-drop reorder, soft delete, hard delete guard

### Day 5 ✅ COMPLETE
- `legal_entities` table in Supabase (RLS enabled)
- `counterparties` table in Supabase (RLS enabled)
- `LegalEntities.jsx` — table list + inline add form + double-click rename + deact/react/delete
- `Counterparties.jsx` — same pattern + CSA currency → discount curve auto-map
- `CfgNav.jsx` updated — ONBOARDING section added (LEGAL ENTITIES + COUNTERPARTIES)
- `App.jsx` updated — new routes added
- **Bug fixed:** AuthGuard renders `<Outlet />` not `{children}`
- **Bug fixed:** `initAuth()` called in App.jsx `useEffect` on mount

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

**Location:** `C:\Users\mikod\OneDrive\Desktop\Rijeka\backend\`

**Structure:**
```
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
```

**Key endpoints:**
```
GET  /health
GET  /api/curves/rates
GET  /api/org/nodes
GET  /api/legal-entities
GET  /api/counterparties
POST /api/legal-entities
POST /api/counterparties
PUT  /api/legal-entities/{id}
PUT  /api/counterparties/{id}
```

**Auth:** Supabase JWT validation in FastAPI middleware — no separate user table.
**Deploy:** Render, auto-deploy from `backend/` on GitHub push.
**URL:** `api.rijeka.app` (configure on Render)

---

### Day 7 — Deploy to app.rijeka.app

- Create Netlify site from `frontend/`
- Set custom domain: `app.rijeka.app`
- Update Supabase redirect URLs
- Deploy new `landing/index.html`

---

## Test Firm Structure (in Supabase)

**org_nodes:**
```
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
```

**legal_entities:**
- RIJEKA CAPITAL (own entity, USD, US)
- GOLDMAN SACHS INTERNATIONAL (GBP, GB, EMIR/MIFID2)
- JP MORGAN CHASE BANK NA (USD, US, DODD-FRANK)

**counterparties:**
- GOLDMAN SACHS INTERNATIONAL → GSI, VM_IM, GBP, GBP_SONIA, 50M threshold
- JP MORGAN CHASE BANK NA → JPMCB, VM_ONLY, USD, USD_SOFR, 0 threshold

---

## Curve Bootstrap Order (never change)

```
Pass 1: OIS        → independent, bootstrapped first
Pass 2: Basis      → depends on OIS (base_curve_id FK)
Pass 3: XCCY       → depends on domestic OIS + USD_SOFR + FX spot
Pass 4: Funding    → depends on OIS, additive spread (no bootstrap)
```

---

*Sprint 1 complete: 2025-01-15*
*Sprint 2 Day 1 complete: 2026-03-25*
*Sprint 2 Day 2 complete: 2026-03-25*
*Sprint 2 Day 3 complete: 2026-03-26*
*Sprint 2 Day 4 complete: 2026-03-26*
*Sprint 2 Day 5 complete: 2026-03-26*
*Rijeka — Croatian/Serbian/Bosnian for "river". Risk flows through it.*
