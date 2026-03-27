# Rijeka — Architecture v9
*Updated: Sprint 2 Complete*

---

## Project
Open-source full revaluation derivatives risk system.
Pure risk analytics: market risk, CCR, XVA, ISDA SIMM, on-chain confirmation.
Croatian/Serbian/Bosnian word for "river" — named after Miko's village in Bosnia.

---

## Infrastructure

| Service   | Purpose                    | URL |
|-----------|---------------------------|-----|
| Netlify   | React app                  | app.rijeka.app |
| Render    | FastAPI backend            | api.rijeka.app |
| Supabase  | Postgres + Auth            | upuewetohnocfshkhafg.supabase.co |
| GitHub    | Monorepo                   | MikoDevedzic/open-source-cross-asset-pricing-and-risk-platform |
| Namecheap | Domain                     | rijeka.app |

---

## Design Invariants (never change)

```
--bg:#060a0e  --bg-deep:#03060a  --panel:#0b1219  --panel-2:#0f1820  --panel-3:#141f28
--accent:#0ec9a0  --amber:#e8a020  --blue:#3d8bc8  --purple:#9060cc  --red:#d95040
--mono: JetBrains Mono
```

Dark terminal aesthetic. CSS variables only. ISDA SIMM v2.6 naming throughout.

---

## Database Schema (Supabase)

```
profiles           — trader_id, role
org_nodes          — firm/division/desk/book/strategy tree (node_type check constraint)
legal_entities     — LEI, own entity flag, regulatory regime, SIMM version
counterparties     — ISDA, CSA type/currency/threshold/MTA, discount curve, IM model
trades             — full trade record + terms JSONB (legs, cashflow_overrides, hashes)
```

### Planned (Sprint 3+)
```
trade_events       — immutable event stream (BOOKED|ACTIVATED|AMENDED|NOVATED|TERMINATED...)
trade_legs         — dedicated legs table (migrated from JSONB, leg UUIDs as PKs)
cashflows          — generated cashflow schedule (leg_id FK, status, override_amount)
```

---

## Trade Data Model

### Current (Sprint 2)
```json
trades.terms = {
  "structure": "IR_SWAP",
  "legs": [{
    "leg_id": "uuid-v4",
    "leg_ref": "TRD-12345678-L1",
    "leg_seq": 0,
    "leg_type": "FIXED",
    "direction": "PAY",
    "leg_hash": null,
    "booked_at": "ISO timestamp"
    // ... full leg economics
  }],
  "cashflow_overrides": {},
  "cashflow_hashes": {},
  "instrument_modifier": null,
  "trade_hash": null
}
```

### Sprint 3 — Event-Sourced Model
```
trade_events:
  id, trade_id, event_type, event_date, effective_date,
  created_at, created_by, payload JSONB,
  pre_state JSONB, post_state JSONB,
  counterparty_confirmed BOOL, confirmation_hash TEXT

event_types:
  BOOKED | ACTIVATED | AMENDED | BOOK_TRANSFER | STORE_CHANGE |
  PARTIAL_TERMINATION | NOVATED | TERMINATED | MATURED | CANCELLED |
  DEFAULTED | COMPRESSION | CREDIT_EVENT
```

**The trade row = current-state cache. The event stream = truth.**
All downstream systems read events, not raw trade row.

---

## Trade Lifecycle & Amendment Rules

| Field | Amendable | Event Type | Repricing |
|---|---|---|---|
| Desk / Book / Strategy | Always | BOOK_TRANSFER | No |
| Store | Always | STORE_CHANGE | No |
| Counterparty | Pre-live | AMENDMENT | No |
| Fixed rate | Pre-live | AMENDMENT | Yes |
| Notional (full) | Pre-live | AMENDMENT | Yes |
| Notional (partial) | Live | PARTIAL_TERMINATION | Yes |
| Maturity extension | Live, bilateral | AMENDMENT | Yes |
| Break clause | Live | TERMINATION | Yes |
| Novation | Live | NOVATED | Yes |
| Compression | Live | COMPRESSION | Yes |

---

## Instruments Supported (Sprint 2)

### RATES (10)
IR_SWAP, OIS_SWAP, BASIS_SWAP, XCCY_SWAP (MTM + Non-MTM), FRA,
ZERO_COUPON_SWAP, STEP_UP_SWAP, INFLATION_SWAP (ZC + YoY),
CMS_SWAP, CMS_SPREAD_SWAP

### FX (3)
FX_FORWARD, FX_SWAP, NDF

### CREDIT (5)
CDS, CDS_INDEX, TOTAL_RETURN_SWAP, ASSET_SWAP, RISK_PARTICIPATION
(RPA: funded/unfunded, LMA/BAFT/APLMA, 13 underlying facility types)

### EQUITY (4)
EQUITY_SWAP, VARIANCE_SWAP, DIVIDEND_SWAP, EQUITY_FORWARD

### COMMODITY (4)
COMMODITY_SWAP, COMMODITY_BASIS_SWAP, ASIAN_COMMODITY_SWAP, EMISSIONS_SWAP
(EUA, RGGI, CCA, UKA, NZU, ACCU, KAU)

**Total: 26 linear instruments across 5 asset classes**
Options (all 5 classes) → Sprint 3 pricing engine required

---

## Leg Architecture

Every instrument decomposes into N legs. Each leg:
- UUID (leg_id) — independently addressable
- Human ref (leg_ref: TRD-XXXXXXXX-L1) — for confirmations
- Leg type: FIXED|FLOAT|ZERO_COUPON|INFLATION|CMS|CDS_FEE|CDS_CONTINGENT|
            TOTAL_RETURN|EQUITY_RETURN|EQUITY_FWD|VARIANCE|DIVIDEND|
            COMMODITY_FLOAT|EMISSIONS_FLOAT|RPA_FEE|RPA_CONTINGENT
- Notional schedule: BULLET|LINEAR_AMORT|MORTGAGE|CUSTOM date/amount pairs
- Rate schedule: FLAT or STEP (rollercoaster) with date/rate pairs
- Spread schedule: FLAT or STEP
- Cashflow overrides: per-cashflow amount amendments (flags instrument as MODIFIED)
- Full ISDA schedule params: day count, frequency, BDC, stub type, calendar, payment lag
- Irregular period support: first_period_start, last_period_end

---

## XCCY Swap — MTM Model

```
xccy_mtm_type:          NON_MTM | MTM
xccy_fx_pair:           EURUSD, USDJPY... (15 major pairs)
xccy_initial_fx_rate:   locked at inception
xccy_notional_exchange: NONE|INITIAL_ONLY|FINAL_ONLY|BOTH|PERIODIC
xccy_mtm_reset_leg:     which leg resets (typically USD)
xccy_mtm_reset_frequency: MONTHLY|QUARTERLY|SEMI-ANNUAL|ANNUAL
xccy_mtm_fx_source:     WM_REUTERS|ECB_FIXING|BBG_BFIX|FED_H10
xccy_reset_schedule:    [{period, reset_type: MTM|FIXED, fx_rate}]
                        — Sprint 3: hybrid schedules (MTM periods + fixed rate periods)
```

---

## Blotter — Window Management

### Current (Sprint 2)
- **Tab system**: BOOK tab (pinned) + dynamic trade/new/compare tabs
- **Comparison mode**: select 2+ trades → COMPARE → side-by-side economics grid
  - Sections: IDENTITY | ECONOMICS | LEGS | PRICING (stub) | XVA (stub)
  - Diff highlighting: amber background on rows where values differ
  - OPEN → button per trade column to jump to full workspace
- **Edit Portfolio**: desk, book, store editable on any trade (non-economic fields)

### Sprint 3 — Tiling Workspace
- Workspace canvas with draggable/resizable trade tiles
- Auto-layout: 1→full, 2→50/50, 3→2+1, 4→2x2, 5+→grid+overflow
- Tile collapse to strip-only (ref + key metrics)
- Each tile: full trade workspace with live pricing numbers
- Multi-monitor: open multiple browser windows, each independent workspace
- localStorage sync for state across windows

---

## Sprint Roadmap

### Sprint 2 ✅ COMPLETE
Auth, CommandCenter (11 tiles), 54 curves, OrgHierarchy (firm/div/desk/book/strategy),
LegalEntities, Counterparties, FastAPI backend, Trades blotter, Tab system,
26-instrument leg builder, Comparison mode, Edit portfolio, Deploy config

### Sprint 3 — Pricing Engine
- trade_events table (foundation for all downstream systems)
- trade_legs table migration (leg UUIDs as proper PKs)
- cashflows table (generated schedule, leg_id FK)
- Full curve bootstrap (OIS→BASIS→XCCY→FUNDING, all 54 curves)
- IR Swap NPV (fixed leg PV + float leg PV, full ISDA schedule)
- FX Forward pricing (discount + FX basis)
- Greeks: PV01, DV01, Gamma, Vega, Theta
- Tiling workspace canvas (pricing numbers make it useful)
- Hybrid XCCY reset schedule builder
- Option booking (all 5 asset classes — economics captured, pricing engine live)

### Sprint 4 — Market Risk + PNL
- VaR (historical simulation, 1Y lookback)
- Stress testing (rate shocks, FX moves, credit spread widening)
- FRTB ES calculation
- PNL attribution by event type, desk, book, trader
- Economic amendment workflow (rate, notional, maturity changes with approval)
- Partial termination, novation, compression workflows

### Sprint 5 — CCR + Collateral + Confirmations
- CVA/DVA (EPE/ENE profiles per counterparty)
- ISDA SIMM v2.6 IM calculation
- Collateral management (margin calls, CSA-aware, dispute workflow)
- Confirmation matching (ISDA protocol, bilateral confirmation)
- Blockchain attestation (trade hash + leg hashes + cashflow hashes)

### Sprint 6 — Regulatory + Infrastructure
- EMIR reporting (UTI, trade reports)
- CFTC reporting (swap data repository)
- MiFID II transaction reporting
- Longevity swap, property derivative, repo, securities lending
- CLN, LCDS, basket credit products
- Electricity swap, freight swap (FFA), weather derivative
- Financing category (repo, sec lending)
- Methodology module (model docs, validation, governance)
- News feed, Chat (desk + counterparty + AI assist)

---

## Blockchain Confirmation Architecture (Sprint 5)

```
trade_hash    = SHA256(trade_id + all leg hashes + timestamp)
leg_hash      = SHA256(leg_id + economics + cashflow_schedule_hash)
cashflow_hash = SHA256(cashflow_id + amount + date + currency)

Both counterparties sign trade_hash.
Cashflows settle individually — each recorded on-chain.
Amendments invalidate old hash → new hash → re-confirmation required.
Immutable audit trail: every state change preserved with old+new hash.
```

---

## KRATOS — Rijeka's Derivatives Intelligence

KRATOS is Rijeka's AI intelligence layer, named after the Greek god of strength and power.
Powered by Claude (Anthropic) via FastAPI proxy — users never need their own API key.

**Access:** TRADER and ADMIN roles only. VIEWERs see upgrade prompt with hello@rijeka.app CTA.

**Current capabilities (Sprint 2):**
- Trade comparison analysis — key differences, risk implications, structural concerns
- Multi-turn conversation — follow-up questions work
- Full trade economics as context: legs, rates, counterparty, tenor, notional

**Sprint 3 capabilities:**
- Live NPV, Greeks, XVA in context — KRATOS sees real numbers
- Per-trade insights on pricing tab: "KRATOS says: elevated long-end duration"
- Pre-trade analysis: compare 3 structures before booking

**Sprint 4+:**
- KRATOS alerts: VaR breach, margin call incoming, unusual position
- KRATOS digest: daily market summary personalised to your book
- KRATOS explain: plain English explanation of any risk metric
- Voice interface: "Ask KRATOS" via microphone on trading floor

**Branding:**
- Symbol: ⚔
- Color: Deep purple gradient (#4a0080 → #6b00b3), glow #8b00ff
- Tagline: "Your derivatives intelligence"
- Floor chatter: "Just ask KRATOS" / "KRATOS flagged it" / "What does KRATOS say?"

---

## Downstream System Data Consumption

| System | Reads from |
|---|---|
| Pricer | trade_events.post_state → current leg economics |
| PNL | trade_events → attribution by event type + date |
| Market Risk | trade_events → live positions per desk/book |
| CCR | trade_events + counterparties.csa_type → exposure profile |
| Collateral | trades in scope per CSA → margin calculation |
| Confirmations | trade_events → hash chain → blockchain attestation |
| Regulatory | trade_events → UTI, EMIR/CFTC/MiFID stream |

**Rule: never read raw trade row for analytics. Always read event stream.**

---

## Curve Bootstrap Order (never change)
```
Pass 1: OIS     → independent, bootstrapped first
Pass 2: BASIS   → depends on OIS
Pass 3: XCCY    → depends on domestic OIS + USD_SOFR + FX spot
Pass 4: FUNDING → depends on OIS, additive spread
```

---

## Auth Flow
```
/login → /command-center → module tiles → /blotter | /configurations/*
AppBar: HOME | BLOTTER | CONFIGURATIONS (direct nav, no round-trip)
```

*Sprint 2 complete: 2026-03-27*
*Rijeka — Croatian/Serbian/Bosnian for "river". Risk flows through it.*
