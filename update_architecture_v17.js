// update_architecture_v17.js
// Updates ARCHITECTURE_v16.md → saves as ARCHITECTURE_v17.md
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\update_architecture_v17.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

const SRC  = path.join(ROOT, 'ARCHITECTURE_v16.md');
const DEST = path.join(ROOT, 'ARCHITECTURE_v17.md');

if (!fs.existsSync(SRC)) { console.error('ARCHITECTURE_v16.md not found'); process.exit(1); }
let doc = fs.readFileSync(SRC, 'utf8');

let ok = 0, fail = 0;
function swap(anchor, replacement, label) {
  const parts = doc.split(anchor);
  if (parts.length < 2) { console.error('  \u2717 ' + label); fail++; return; }
  doc = parts[0] + replacement + parts.slice(1).join(anchor);
  console.log('  \u2713 ' + label);
  ok++;
}

// ── 1. Header — bump version ─────────────────────────────────────────────────
swap(
  '# RIJEKA — MASTER BLUEPRINT v16\n*Classification: PRIVATE & CONFIDENTIAL — Never commit to GitHub*\n*Updated: Sprint 3 Complete + Options — March 2026*',
  '# RIJEKA — MASTER BLUEPRINT v17\n*Classification: PRIVATE & CONFIDENTIAL — Never commit to GitHub*\n*Updated: Sprint 4A-D Complete — March 2026*',
  'Bumped version to v17'
);

// ── 2. Repo structure — add IrSwapStructures.jsx entry ──────────────────────
swap(
  '│   │       ├── blotter/\n│   │       │   ├── BlotterShell.jsx      Tab container. Renders active workspace.\n│   │       │   ├── BookTab.jsx / .css    Trade list, sortable grid, checkboxes, filters.\n│   │       │   ├── NewTradeWorkspace     Full leg builder, 26 instruments, leg accordion.',
  '│   │       ├── blotter/\n│   │       │   ├── BlotterShell.jsx      Tab container. Renders active workspace.\n│   │       │   ├── BookTab.jsx / .css    Trade list, sortable grid, checkboxes, filters.\n│   │       │   │                         STRUCTURE badge column added Sprint 4A.\n│   │       │   ├── IrSwapStructures.jsx  Sprint 4A. 10 IR_SWAP structure definitions.\n│   │       │   │                         IR_SWAP_STRUCTURES, INSTR_LABEL, IR_OPTIONS_ITEMS,\n│   │       │   │                         IR_OPTIONS_SET. IrSwapStructureSelector component.\n│   │       │   │                         getStructureByValue(), getStructureLegs() helpers.\n│   │       │   ├── NewTradeWorkspace     Full leg builder, 43 instruments, leg accordion.',
  'Added IrSwapStructures.jsx to repo structure'
);

// ── 3. Section 5 — trades schema: add structure column ──────────────────────
swap(
  'instrument_type TEXT\nterms JSONB',
  'instrument_type TEXT\nstructure TEXT CHECK (VANILLA|OIS|BASIS|XCCY|ZERO_COUPON|STEP_UP|\n  INFLATION_ZC|INFLATION_YOY|CMS|CMS_SPREAD) — IR_SWAP variants only. NULL for all others.\nterms JSONB',
  'Added structure column to trades schema'
);

// ── 4. Section 7 — instruments: full restructure ─────────────────────────────
swap(
  '### RATES (10)\nIR_SWAP, OIS_SWAP, BASIS_SWAP, XCCY_SWAP (MTM+NonMTM), FRA,\nZERO_COUPON_SWAP, STEP_UP_SWAP, INFLATION_SWAP (ZC+YoY), CMS_SWAP, CMS_SPREAD_SWAP',
  '### RATES\n\n**IR SWAP family** (instrument_type = IR_SWAP, structure discriminator):\n  VANILLA, OIS, BASIS, XCCY, ZERO_COUPON, STEP_UP,\n  INFLATION_ZC, INFLATION_YOY, CMS, CMS_SPREAD\n\n  Structure selector grid renders when instrument = IR_SWAP.\n  OIS_SWAP/BASIS_SWAP/XCCY_SWAP etc removed from dropdown — use STRUCTURE selector instead.\n  instrument_type always stored as IR_SWAP. trades.structure + terms.structure store variant.\n  ISDA SIMM: VANILLA/OIS/BASIS/XCCY/ZC/STEP_UP/CMS/CMS_SPREAD → InterestRate delta bucket.\n             INFLATION_ZC/INFLATION_YOY → Inflation delta bucket (Sprint 5).\n\n**IR SWAP with embedded optionality** (separate instrument_type):\n  CAPPED_SWAP, FLOORED_SWAP, COLLARED_SWAP — embedded option priced into swap rate\n  CALLABLE_SWAP, CANCELLABLE_SWAP — Bermudan cancellation right stapled to swap\n  No upfront premium. Lifecycle-managed as swaps.\n\n**IR OPTIONS** (standalone, upfront/installment/deferred/contingent premium):\n  IR_SWAPTION — European/American/Bermudan exercise\n  BERMUDAN_SWAPTION — full exercise schedule\n  INTEREST_RATE_CAP, INTEREST_RATE_FLOOR, INTEREST_RATE_COLLAR\n\n  Quick-switch grid renders for all IR OPTIONS (same UX as STRUCTURE grid).\n  Premium: UPFRONT | INSTALLMENT (periodic, lapses on missed payment) |\n           DEFERRED (paid at expiry) | CONTINGENT (only if ITM)\n  PremiumSection component handles all 4 types.\n\n**Other RATES:**\n  FRA',
  'Restructured RATES instruments section'
);

// ── 5. Section 7 — update totals ─────────────────────────────────────────────
swap(
  'Total: 26 linear instruments. Options → Sprint 3 (remaining tasks).',
  'Total: 43 instruments.\n  Linear (26): IR SWAP variants via STRUCTURE + FX + Credit + Equity + Commodity linears\n  Options (9, Sprint 3E): IR_SWAPTION, CAP_FLOOR, FX_OPTION, EQUITY_OPTION,\n    COMMODITY_OPTION, CDS_OPTION, FX_DIGITAL_OPTION, EXTENDABLE_FORWARD\n  Extended options (8, Sprint 3F): BERMUDAN_SWAPTION, CALLABLE_SWAP,\n    CANCELLABLE_SWAP, CAPPED_SWAP, FLOORED_SWAP, COLLARED_SWAP,\n    COMMODITY_ASIAN_OPTION, CALLABLE_SWAP_OPTION',
  'Updated instrument totals'
);

// ── 6. Section 12 — blotter architecture ────────────────────────────────────
swap(
  'TradeWorkspace panels: OVERVIEW | LEGS | CASHFLOWS | PRICING (stub→Sprint 4) | XVA (stub→Sprint 5)',
  'TradeWorkspace panels: OVERVIEW | LEGS | CASHFLOWS | PRICING (stub→Sprint 4) | XVA (stub→Sprint 5)\n\nNEW TRADE leg builder UX (Sprint 4D):\n  Only first leg open by default — prevents wall-of-forms on multi-leg instruments.\n  Collapsed leg headers show key-term badges (rate%, index, option type, maturity).\n  legSummaryBadges() is leg-type-aware: FIXED shows rate+freq+dc, FLOAT shows index+spread,\n  options show option_type+exercise_style+premium_type.\n  COLLAPSE ALL / EXPAND ALL controls above leg list.',
  'Added Sprint 4D leg UX to blotter architecture'
);

// ── 7. Section 16 — Sprint 4 roadmap: mark 4A-D complete ────────────────────
swap(
  '### Sprint 4 — MARKET RISK + PNL + TEMPLATES (next)\nCurve bootstrap: deposit/futures/swap quotes → Curve objects for all 54 curves\nVaR (historical simulation, 1Y lookback)\nStress testing (rate shocks, FX moves, credit spread)\nFRTB ES\nPNL attribution by event, desk, book, trader\nEconomic amendment workflow with AMENDED event\nPartial termination, novation, compression\nPRICER tile in CommandCenter → live\n\nTrade Templates (see Section 20):\n  trade_templates table — personal, desk, firm-wide templates\n  SAVE AS TEMPLATE button in leg builder\n  MY TEMPLATES + FIRM TEMPLATES panel in NEW TRADE\n  IR_SWAP STRUCTURE selector (VANILLA|OIS|BASIS|XCCY|ZERO COUPON|STEP UP|INFLATION|CMS)\n  Replaces hardcoded TEMPLATES object in NewTradeWorkspace.jsx.\n  instrument_type always stored as IR_SWAP. terms.structure stores the variant.\n  This drives ISDA SIMM bucketing and blotter display.',
  '### Sprint 4 — IN PROGRESS\n\n4A ✅ IR_SWAP STRUCTURE consolidation\n  IrSwapStructures.jsx — 10 structure definitions (VANILLA/OIS/BASIS/XCCY/ZC/STEP_UP/\n    INFLATION_ZC/INFLATION_YOY/CMS/CMS_SPREAD)\n  STRUCTURE selector grid in NewTradeWorkspace — renders when instrument = IR_SWAP\n  STRUCTURE_TO_TEMPLATE maps structures → existing TEMPLATES fns\n  trades.structure column added (SQL: ALTER TABLE trades ADD COLUMN IF NOT EXISTS structure TEXT)\n  BookTab STRUCTURE badge column\n  OIS_SWAP/BASIS_SWAP/XCCY_SWAP etc removed from dropdown\n\n4B ✅ IR options restructure + installment premium\n  INSTRUMENT_GROUPS — RATES dropdown now uses <optgroup>:\n    IR SWAP | IR OPTIONS | OTHER RATES\n  INSTR_LABEL map — human-readable dropdown labels\n  PremiumSection component — UPFRONT | INSTALLMENT | DEFERRED | CONTINGENT\n    INSTALLMENT: amount per period + frequency + first/last date + lapse warning\n    DEFERRED: single amount, paid at expiry regardless of exercise\n    CONTINGENT: single amount, only paid if ITM at expiry\n  All 8 option LD defaults updated: premium_type, premium_frequency, premium_last_date added\n\n4C ✅ IR options quick-switch grid\n  IR_OPTIONS_ITEMS / IR_OPTIONS_SET constants\n  5-button grid (IR SWAPTION | BERMUDAN | CAP | FLOOR | COLLAR)\n  Renders whenever instrument is in IR_OPTIONS_SET\n  Reuses structure-btn / structure-selector CSS — visually identical to STRUCTURE grid\n  changeIT() handles leg template reloading\n\n4D ✅ Leg card UX\n  Only first leg open by default (legIdx===0)\n  legSummaryBadges() — type-aware collapsed header badges\n  LEGS — N LEGS header with COLLAPSE ALL / EXPAND ALL\n\nRemaining Sprint 4:\n  Curve bootstrap: deposit/futures/swap quotes → bootstrapped Curve objects\n  VaR (historical simulation, 1Y lookback)\n  Stress testing (rate shocks, FX moves, credit spread)\n  FRTB ES\n  PNL attribution by event, desk, book, trader\n  Economic amendment workflow with AMENDED event\n  Partial termination, novation, compression\n  PRICER tile in CommandCenter → live\n\nTrade Templates (see Section 20 — unchanged, still Sprint 4 remaining):\n  trade_templates table — personal, desk, firm-wide templates\n  SAVE AS TEMPLATE button in leg builder\n  MY TEMPLATES + FIRM TEMPLATES panel in NEW TRADE',
  'Updated Sprint 4 roadmap with 4A-D complete'
);

// ── 8. Section 19 — templates: update IR_SWAP STRUCTURE selector entry ───────
swap(
  '### IR_SWAP STRUCTURE selector (Sprint 4)\nWhen instrument = IR_SWAP, a STRUCTURE dropdown appears:\n  VANILLA (default) | OIS | BASIS | XCCY | ZERO COUPON | STEP UP | INFLATION | CMS | CMS SPREAD\nSelecting a structure loads the corresponding leg template.\nFirm templates for each structure replace the hardcoded TEMPLATES object in NewTradeWorkspace.jsx.\ninstrument_type always stored as IR_SWAP. terms.structure stores the variant.\nThis drives ISDA SIMM bucketing and blotter display.',
  '### IR_SWAP STRUCTURE selector ✅ Sprint 4A\nWhen instrument = IR_SWAP, a 10-button STRUCTURE grid appears (not a dropdown):\n  VANILLA | OIS | BASIS | XCCY | ZERO COUPON | STEP UP |\n  INFLATION ZC | INFLATION YOY | CMS | CMS SPREAD\nSelecting a structure calls STRUCTURE_TO_TEMPLATE[structure]() → reloads leg builder.\nSimilar IR OPTIONS quick-switch grid for: IR SWAPTION | BERMUDAN | CAP | FLOOR | COLLAR\ninstrument_type always stored as IR_SWAP. trades.structure + terms.structure store variant.\nDrives ISDA SIMM bucketing (Sprint 5) and blotter STRUCTURE badge column.',
  'Updated IR_SWAP STRUCTURE selector entry in Section 19'
);

// ── 9. Section 6 SQL migrations — add Sprint 4A SQL ─────────────────────────
swap(
  '### Sprint 4+ — NOT YET RUN\n\nWill be added here as sprints are delivered.',
  '### Sprint 4A — trades.structure column  \u2705 RUN\n\n```sql\nALTER TABLE trades\n  ADD COLUMN IF NOT EXISTS structure TEXT\n  CHECK (structure IN (\n    \'VANILLA\',\'OIS\',\'BASIS\',\'XCCY\',\'ZERO_COUPON\',\n    \'STEP_UP\',\'INFLATION_ZC\',\'INFLATION_YOY\',\'CMS\',\'CMS_SPREAD\'\n  ));\n\nCREATE INDEX IF NOT EXISTS trades_structure_idx\n  ON trades (structure)\n  WHERE structure IS NOT NULL;\n\n-- Backfill existing IR_SWAP trades as VANILLA\nUPDATE trades\nSET structure = \'VANILLA\'\nWHERE instrument_type = \'IR_SWAP\' AND structure IS NULL;\n```\nVerify: SELECT instrument_type, structure, COUNT(*) FROM trades GROUP BY 1,2;\n\n---\n\n### Sprint 4B-D — NO SQL (pure frontend changes)\n\nPremiumSection, INSTRUMENT_GROUPS, IR_OPTIONS_ITEMS, legSummaryBadges — all frontend only.\n\n---\n\n### Sprint 5+ — NOT YET RUN\n\nWill be added here as sprints are delivered.',
  'Added Sprint 4A SQL migration record'
);

// ── 10. Sprint completion log ────────────────────────────────────────────────
swap(
  '*Rijeka — river. Risk flows through it.*\n*PROMETHEUS — because knowledge should be free.*\n*Sprint 3 complete. Sprint 4 next: curve bootstrap + VaR + PNL.*',
  '### Sprint 4A-D \u2705 COMPLETE\n4A: IR_SWAP STRUCTURE consolidation — 10-variant selector grid, structure column in DB\n4B: IR options restructure — INSTRUMENT_GROUPS optgroups, PremiumSection\n    (UPFRONT/INSTALLMENT/DEFERRED/CONTINGENT), all option LD defaults updated\n4C: IR options quick-switch grid — 5-button grid mirroring STRUCTURE grid\n4D: Leg card UX — first-leg-only open, legSummaryBadges, COLLAPSE/EXPAND ALL\n\n---\n\n*Rijeka \u2014 river. Risk flows through it.*\n*PROMETHEUS \u2014 because knowledge should be free.*\n*Sprint 4A-D complete. Next: curve bootstrap \u2192 VaR \u2192 PNL \u2192 PRICER tile.*',
  'Added Sprint 4A-D to completion log'
);

// ── 11. Known issues — add any new entries ───────────────────────────────────
swap(
  '| Fixed leg NPV = 0 on test trades | fixed_rate is NULL on pre-Sprint3D trades | UPDATE trade_legs SET fixed_rate=0.035 WHERE leg_type=\'FIXED\' |',
  '| Fixed leg NPV = 0 on test trades | fixed_rate is NULL on pre-Sprint3D trades | UPDATE trade_legs SET fixed_rate=0.035 WHERE leg_type=\'FIXED\' |\n| structure badge missing on old trades | Pre-4A trades have structure=NULL | Expected — backfill SQL sets VANILLA for IR_SWAP trades |\n| IR options grid not showing | instrument not in IR_OPTIONS_SET | Check instrument value matches exactly e.g. IR_SWAPTION not IR_SWAP |\n| Leg badges blank on collapsed leg | leg fields blank (new trade) | Expected — badges only show when fields populated |',
  'Added Sprint 4A-D known issues'
);

// ── Write output ─────────────────────────────────────────────────────────────
fs.writeFileSync(DEST, doc, 'utf8');

console.log('\n' + '='.repeat(60));
console.log('Architecture update: ' + ok + ' passed, ' + fail + ' failed');
console.log('Written to: ' + DEST);
if (fail > 0) console.log('\u26a0  Some sections not found — check anchors above');
else console.log('\u2705 ARCHITECTURE_v17.md ready. Keep on OneDrive, never commit.');
console.log('='.repeat(60));
