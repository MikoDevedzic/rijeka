// create_docs.js
// Creates ARCHITECTURE_v26.md and SPRINT5_HANDOFF.md locally only.
// Does NOT commit to git.
// Run from: C:\Users\mikod\OneDrive\Desktop\Rijeka

const fs   = require('fs')
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka'

const ARCH = `# ARCHITECTURE_v26.md
# Rijeka — Open-Source Cross-Asset Pricing & Risk Platform
# Last updated: April 2026 | Sprint 5 complete

---

## 1. STACK OVERVIEW

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Frontend    | React + Vite (port 5173), Netlify |
| Backend     | FastAPI (port 8000), Render       |
| Database    | Supabase Postgres                 |
| Local path  | C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\ |
| GitHub      | MikoDevedzic/open-source-cross-asset-pricing-and-risk-platform |

---

## 2. DESIGN SYSTEM — LOCKED SPRINT 5

### 2.1 Color Palette (Pure Black Theme)
bg:       #000000   true black
bg-deep:  #050505
panel:    #0C0C0C   near-black panels
panel-2:  #141414
border:   #1E1E1E   subtle dark border
text:     #F0F0F0   bright white
muted:    #666666   mid-grey labels
accent:   #00D4A8   teal — Rijeka brand
blue:     #4A9EFF   shocked-down, info
amber:    #F5C842   warnings, book action
red:      #FF6B6B   pay, shocked-up, danger
green:    #1DC87A
purple:   #9060CC

### 2.2 Typography System
Numbers/values:  IBM Plex Mono
Labels/UI:       IBM Plex Sans
Base font size:  16px (html element)

Size scale:
  0.75rem  (12px) — labels, captions, column headers
  0.8125rem(13px) — body text, table cells, controls
  0.875rem (14px) — values, emphasis numbers
  0.9375rem(15px) — analytics values, NET NPV
  1rem     (16px) — section headers
  1.0625rem(17px) — primary inputs (notional, coupon rate)

Rule: IBM Plex Sans for all labels, headings, UI chrome.
      IBM Plex Mono for all numbers, values, codes, IDs.
      No other fonts. No exceptions.

---

## 3. CANVAS CHART STANDARD — RIJEKA DESIGN SPEC

ALL canvas charts in Rijeka MUST follow this standard.
Reference implementation: sofr_bootstrapper.html

### 3.1 DPR-Aware Canvas Setup
  const dpr = window.devicePixelRatio || 2
  canvas.width  = parent.offsetWidth  * dpr
  canvas.height = parent.offsetHeight * dpr
  canvas.style.width  = parent.offsetWidth  + 'px'
  canvas.style.height = parent.offsetHeight + 'px'
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1,0,0,1,0,0)
  ctx.scale(dpr, dpr)

### 3.2 Background Fill (always explicit, never transparent)
  ctx.fillStyle = '#0C0C0C'
  ctx.fillRect(0, 0, W, H)

### 3.3 Two-Pass Line Drawing (MANDATORY for all curves)
  // Pass 1 — thick faint glow halo
  ctx.beginPath()
  /* draw path */
  ctx.strokeStyle = 'rgba(0,212,168,0.15)'
  ctx.lineWidth = 7
  ctx.stroke()

  // Pass 2 — sharp thin solid line on top
  ctx.beginPath()
  /* same path */
  ctx.strokeStyle = '#00D4A8'
  ctx.lineWidth = 2
  ctx.stroke()

### 3.4 Gradient Fill Under Curves
  const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b)
  grad.addColorStop(0, 'rgba(0,212,168,0.12)')
  grad.addColorStop(1, 'rgba(0,212,168,0)')
  ctx.fillStyle = grad
  ctx.fill()

### 3.5 Dot Halos (every data point)
  // Halo ring
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI*2)
  ctx.strokeStyle = 'rgba(0,212,168,0.25)'
  ctx.lineWidth = 3
  ctx.stroke()
  // Solid dot
  ctx.beginPath()
  ctx.arc(cx, cy, 3, 0, Math.PI*2)
  ctx.fillStyle = '#00D4A8'
  ctx.fill()

### 3.6 Active/Draggable Dot
  ctx.shadowColor = curveColor
  ctx.shadowBlur  = 14
  ctx.beginPath()
  ctx.arc(cx, cy, 5.5, 0, Math.PI*2)
  ctx.fillStyle = curveColor
  ctx.fill()
  ctx.shadowBlur = 0
  // White ring
  ctx.beginPath()
  ctx.arc(cx, cy, 5.5, 0, Math.PI*2)
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 1
  ctx.stroke()

### 3.7 Color Assignments
  Base curve:          #00D4A8  glow rgba(0,212,168,0.15)
  Shocked up (bear):   #FF6B6B  glow rgba(255,107,107,0.2)
  Shocked down (bull): #4A9EFF  glow rgba(74,158,255,0.2)
  Secondary/fwd:       #F5C842  glow rgba(245,200,66,0.15)

### 3.8 Canvas Typography
  ctx.font = '9px IBM Plex Mono, JetBrains Mono, monospace'
  // 9px canvas = correct visual size at standard DPR
  // Never exceed 10px — renders oversized

### 3.9 Grid Lines
  ctx.strokeStyle = 'rgba(30,30,30,0.8)'
  ctx.lineWidth = 0.5

### 3.10 X-Axis Scale
  Yield curves:   sqrt scale — ctx x = PAD.l + Math.sqrt(t/30) * CW
  Time series:    linear scale — ctx x = PAD.l + (i/(n-1)) * CW

---

## 4. TRADE BOOKING WINDOW

### 4.1 Window
  Size: 88vw x 96vh, max 1200x980
  Store: useBookingStore (Zustand), array of {id, x, y, trade}
  Multi-window: supported

### 4.2 Tabs
  TRADE | ALL-IN PRICE | CASHFLOWS | CURVE SCENARIO | ✦ CONFIRM

### 4.3 Trade Lifecycle
  DRAFT → PENDING → CONFIRMED → LIVE → MATURED
  New trades → PENDING
  CONFIRM TRADE → PATCH /api/trades/{id} → CONFIRMED

### 4.4 Pricing
  PRICE button  → /price/preview (stateless, zero DB writes)
  BOOK TRADE    → executeBooking() → writes trade + legs + prices
  
### 4.5 Analytics
  Columns: LEG | TYPE | DIR | CCY | PV | IR01 | IR01 DISC | GAMMA | THETA
  Greek tooltips on hover
  Off-market banner when rate != par
  NPV solver: linear approx via IR01
  analyticsRef scrollIntoView after pricing

### 4.6 Button Semantics
  BOOK TRADE:     amber #F5C842  — new trade commitment
  CONFIRM TRADE:  teal #00D4A8   — approve existing PENDING trade
  (intentional color difference — semantic not stylistic)

---

## 5. CURVE SCENARIO TAB

### 5.1 Layout
  Left 420px: controls + editable rate table
  Right: stats cards + interactive chart + impact analytics

### 5.2 Stats Cards
  30Y Discount Factor:  exp(-rate30Y/100 * 30)
  5Y Zero Rate:         base 5Y + shift
  10Y FWD (5Y x 5Y):   -ln(df10/df5) / 5 * 100

### 5.3 Chart Interaction
  Drag tenor point → Gaussian ripple: weight = exp(-dist² / 2σ²)
  Ripple width slider: sigma 1–10Y
  Shift cap: ±300bp
  Sensitivity: 0.4bp/pixel fixed

### 5.4 Rate Table
  14 tenors: 1W 1M 3M 6M 1Y 2Y 3Y 4Y 5Y 7Y 10Y 15Y 20Y 30Y
  Editable par rate input: 8 decimal places
  Sub-row per tenor: SHOCKED | ZERO | DF
  Amber border = manual base rate override
  Presets: Parallel ±25/50/100bp, Bear/Bull Steep/Flat, Fed Hike/Cut/Cycle

### 5.5 CONFIRM SHAPE
  Calls /price/preview twice (base + shocked)
  Shows: NET NPV delta, IR01 delta, GAMMA delta, THETA approx

---

## 6. BOOTSTRAP — Validated April 4 2026

  USD Fixed vs SOFR OIS: NPV = $0.00 at par for all tenors 1W-50Y
  Bloomberg ref: 5Y $10M at 3.665% → NPV=$0.02, PV01=$4,552
  Algorithm: dense annual grid + frozen df_spot + sequential M-tenor + 8dp
  Quote type for shocked quotes: OIS_SWAP (not SWAP)
  Pricer endpoint: /price (not /api/pricer/price)
  Preview endpoint: /price/preview

---

## 7. KNOWN GAPS (Sprint 6)

  CRITICAL: trade_legs not written on booking via TradeBookingWindow
            executeBooking() writes trades table only
            Fix: add trade_legs write after trade creation

  LOW:      PRICER tab still in nav — remove
  LOW:      Some components may have stale font references

---

## 8. OPERATIONAL RULES

  1. Kill python3.13.exe before backend restart
  2. Kill node.exe before frontend restart
  3. NEVER run fix_valuation_spot_date.js
  4. DV01/PV01 BANNED — IR01/IR01_DISC only
  5. Trade ORM: no relationships, joinedload BANNED
  6. Always call _leg_to_dict() before pricing
  7. Canvas: mutable state in refs, never useState in addEventListener
  8. Scripts: Node.js via cmd.exe with full paths
  9. Secrets: backend/.env via node -e inline only
  10. Patching: full rewrite > patch when in doubt

---

## 9. GO-TO-MARKET

  Wedge product: rijeka_xva_parametric.html + rijeka_xva_ee.html
  Near-term: Macquarie contact (XVA desk, no IT approval needed)
  Design partner: Nomura (former intern, Associate PM)
    Requirements: bucketed IR01, CVaR/ES, unified portfolio risk
  Monetization: Free | Pro self-serve | Institutional annual license
  Domain: rijeka.app

---

## 10. PENDING SPRINTS

  5B — Zero Coupon + Step Up instruments
  5C — BASIS swaps (two-curve bootstrap)
  5E — Swaptions (SABR vol surface)
  6A — trade_legs fix, PRICER tab removal
  6B — XVA integration into platform
  6C — SIMM/IM tab
  7A — Bloomberg plugin distribution
`

fs.writeFileSync(ROOT + '\\ARCHITECTURE_v26.md', ARCH, 'utf8')
console.log('✓ ARCHITECTURE_v26.md written to', ROOT)

const HANDOFF = `# SPRINT 5 HANDOFF
# For new chat session — read ARCHITECTURE_v26.md first
# April 2026

## WHAT WAS BUILT THIS SESSION

1. Curve Scenario Tab — complete redesign
   - Two-column layout: controls/rate table left, chart right
   - Interactive drag-to-reshape curve with Gaussian ripple
   - Editable par rates (8dp), per-tenor SHOCKED/ZERO/DF
   - Stats cards: 30Y DF, 5Y Zero Rate, 10Y 5Y×5Y Fwd
   - CONFIRM SHAPE → reprices, shows impact analytics

2. Design system applied sitewide
   - Theme: Pure Black (#000000 bg)
   - Fonts: IBM Plex Mono (numbers) + IBM Plex Sans (labels)
   - 16px base, 3-tier font size scale
   - Canvas chart standard locked (see ARCHITECTURE_v26.md §3)

3. Trade window improvements
   - 88vw × 96vh default size
   - Duplicate floating leg row removed
   - Rate display: 8 decimal places
   - Analytics scrollIntoView after pricing
   - Semantic button colors: amber=book, teal=confirm

## TOP PRIORITY NEXT SESSION

  1. trade_legs write on booking (CRITICAL — cashflows broken for new trades)
  2. Sprint 5B: Zero Coupon + Step Up instruments
  3. Sprint 5C: BASIS swaps

## TEST TRADE

  5Y IR_SWAP $10M USD SOFR at ~3.665%
  At par: NPV ≈ $0, IR01 ≈ +$4,651
  Bloomberg ref: NPV=$0.02, PV01=$4,552

## BACKEND HEALTH

  Swagger: http://localhost:8000/docs
  Frontend: http://localhost:5173
  Kill python3.13.exe + node.exe before restart

## KEY FILES

  TradeBookingWindow.jsx  — trade form, ScenarioTab, analytics
  TradeBookingWindow.css  — tabs, buttons, layout
  index.css               — CSS variables, IBM Plex import, 16px base
  AppBar.jsx              — nav bar
  BlotterShell.css        — blotter table
`

fs.writeFileSync(ROOT + '\\SPRINT5_HANDOFF.md', HANDOFF, 'utf8')
console.log('✓ SPRINT5_HANDOFF.md written to', ROOT)
console.log('\nDone. Both files are local only — NOT in git.')
console.log('Run git commit separately for code only.')
