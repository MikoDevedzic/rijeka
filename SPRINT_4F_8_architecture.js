// SPRINT_4F_8_architecture.js
// Writes: ARCHITECTURE_v18.md to Desktop (never commit)
// Run from Rijeka root: node SPRINT_4F_8_architecture.js

const fs = require('fs');
const path = require('path');

// Read v17 from Downloads (user uploads it at start of session)
// Or read from OneDrive if available
const DESKTOP = 'C:\\Users\\mikod\\OneDrive\\Desktop';
const RIJEKA  = path.join(DESKTOP, 'Rijeka');

// The architecture additions for Sprint 4F
const sprint4F_additions = `
### Sprint 4F ✅ COMPLETE
4F: Market data persistence + real curve bootstrap + PRICER tile

**New: market_data_snapshots table**
Stores pillar quote snapshots per curve_id + valuation_date.
UNIQUE(curve_id, valuation_date) — one snapshot per curve per day.
quotes JSONB: [{tenor, quote_type, rate, enabled}]  (rate in % e.g. 5.310)
source: MANUAL | BLOOMBERG | REFINITIV | IMPORT
RLS: SELECT/INSERT/UPDATE for authenticated users.

**New: /api/market-data routes**
POST /api/market-data/snapshots              — UPSERT snapshot (TRADER/ADMIN)
GET  /api/market-data/snapshots/{curve_id}/latest  — latest for a curve
GET  /api/market-data/snapshots/{curve_id}         — history (30 snapshots)
GET  /api/market-data/snapshots/date/{date}        — all curves for a date

**Updated: pricer.py**
_build_curve_auto() — priority order:
  1. quotes[] with >= 2 entries → bootstrap
  2. flat_rate → flat forward
  3. DB latest snapshot → bootstrap from saved pillars
  4. No data → raise ValueError with instructions
Traders no longer need to enter rates manually if market data is saved.

**Updated: useMarketDataStore.js**
saveSnapshot(curveId, date) — saves current OIS quotes to DB
loadLatestSnapshot(curveId) — loads saved quotes into store on mount
State: snapshotSaving, snapshotSaved, snapshotError per curveId

**Updated: OISDetail.jsx**
SAVE TO DB button in Instruments tab.
Date picker for valuation date (default: today).
Auto-loads latest snapshot on mount.
Status badge: ✓ saved YYYY-MM-DD | ✗ error message

**New: PricerPage.jsx + PricerPage.css**
Route: /pricer (PRICER tile in CommandCenter)
Features:
  - Trade selector (all trades)
  - Valuation date picker
  - Curve panel: AUTO (from DB) or OVERRIDE (flat rate)
  - RUN PRICER → NPV + PV01 + DV01 + Theta
  - Per-leg PV breakdown
  - Full projected cashflow schedule

**Updated: App.jsx**
Route /pricer → PricerPage

**Updated: CommandCenter.jsx**
PRICER tile → route /pricer (now LIVE)

**Version bump: 0.3.3 → 0.4.0**

---

### Sprint 4F — SQL Migration (market_data_snapshots)  ✅ RUN

\`\`\`sql
CREATE TABLE IF NOT EXISTS market_data_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  curve_id         TEXT        NOT NULL,
  valuation_date   DATE        NOT NULL,
  quotes           JSONB       NOT NULL DEFAULT '[]',
  source           TEXT        NOT NULL DEFAULT 'MANUAL'
                               CHECK (source IN ('MANUAL','BLOOMBERG','REFINITIV','IMPORT')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID        REFERENCES auth.users(id),
  CONSTRAINT market_data_snapshots_curve_date_unique UNIQUE (curve_id, valuation_date)
);
CREATE INDEX IF NOT EXISTS mds_curve_id_idx       ON market_data_snapshots (curve_id);
CREATE INDEX IF NOT EXISTS mds_valuation_date_idx ON market_data_snapshots (valuation_date DESC);
CREATE INDEX IF NOT EXISTS mds_curve_date_idx     ON market_data_snapshots (curve_id, valuation_date DESC);
ALTER TABLE market_data_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mds_select_authenticated" ON market_data_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "mds_insert_authenticated" ON market_data_snapshots FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "mds_update_authenticated" ON market_data_snapshots FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
\`\`\`
Verify: SELECT policyname, cmd FROM pg_policies WHERE tablename = 'market_data_snapshots';
Expected: 3 rows — SELECT, INSERT, UPDATE

---

### Sprint 4F — Repository additions

\`\`\`
backend/api/routes/market_data.py     Sprint 4F — market data snapshots CRUD
frontend/src/components/pricer/
  PricerPage.jsx                      Sprint 4F — standalone pricer page
  PricerPage.css                      Sprint 4F — pricer page styles
docs/market_data_migration.sql        Sprint 4F — market_data_snapshots DDL
\`\`\`

---

### The LinkedIn workflow (what is now possible)

1. CONFIGURATIONS → MARKET DATA → select USD_SOFR
2. INSTRUMENTS tab → quotes are pre-populated with real market rates
3. Adjust quotes to match current market (or connect Bloomberg feed)
4. Click SAVE TO DB → snapshot saved with today's date
5. PRICER tile → select any IR_SWAP trade → curves auto-loaded from DB
6. RUN PRICER → real bootstrapped NPV + Greeks from your own market data
7. PRICING tab in any trade → same auto-load, same result

**Bloomberg API integration path (Sprint 6):**
- source = 'BLOOMBERG' in snapshot
- Scheduled job: fetch BFV/BVOL quotes via Bloomberg API → auto-save snapshot
- Traders see live market data without manual entry
`;

// Write the additions as a standalone update note
const updateNote = `# ARCHITECTURE v18 — Sprint 4F Update Notes
*Append these sections to ARCHITECTURE_v17.md → save as ARCHITECTURE_v18.md*
*Updated: Sprint 4F Complete — March 2026*

---
${sprint4F_additions}

---

## CHANGES TO EXISTING SECTIONS

### Section 3 (Repository Structure) — add after pricer.py entry:
\`\`\`
│   ├── api/routes/market_data.py     Sprint 4F — market data snapshots
│   ...
frontend/src/components/pricer/
│   ├── PricerPage.jsx                Sprint 4F — standalone pricer
│   └── PricerPage.css
\`\`\`

### Section 5 (Database Schema) — add market_data_snapshots:
\`\`\`
### market_data_snapshots (Sprint 4F)
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
curve_id TEXT NOT NULL
valuation_date DATE NOT NULL
quotes JSONB [{tenor, quote_type, rate (%), enabled}]
source TEXT CHECK (MANUAL|BLOOMBERG|REFINITIV|IMPORT)
created_at TIMESTAMPTZ, created_by UUID FK auth.users
UNIQUE(curve_id, valuation_date)
\`\`\`

### Section 8 (Pricing Engine) — update curve inputs:
\`\`\`
Sprint 4F auto-load priority:
  1. quotes[] with >= 2 entries → bootstrap (Sprint 4E)
  2. flat_rate                  → flat forward (Sprint 3D compat)
  3. DB latest snapshot         → bootstrap from saved market data (Sprint 4F NEW)
  4. No data                    → error with instructions
\`\`\`

### Section 11 (Command Center Tiles) — update PRICER:
\`\`\`
| PRICER | LIVE Sprint 4F | /pricer |
\`\`\`

### Section 16 (Sprint Roadmap) — add Sprint 4F:
(see Sprint 4F section above)

### Section 25 (Sprint Completion Log) — add:
\`\`\`
### Sprint 4F ✅ COMPLETE
4F: market_data_snapshots table, /api/market-data routes, pricer auto-load,
    OISDetail SAVE button, PricerPage, PRICER tile live, version 0.4.0
\`\`\`

---
*Rijeka v0.4.0 — real curves, real bootstrap, real NPV.*
*PROMETHEUS — because knowledge should be free.*
`;

const dest = path.join(DESKTOP, 'ARCHITECTURE_v18_update.md');
fs.writeFileSync(dest, updateNote, 'utf8');
console.log('✓ Written: ' + dest);
console.log('');
console.log('Open ARCHITECTURE_v17.md, apply these additions, save as ARCHITECTURE_v18.md');
console.log('Keep on OneDrive Desktop — never commit to GitHub.');
