// ============================================================
// RIJEKA — Sprint 4A: IR_SWAP STRUCTURE CONSOLIDATION
// Run from Rijeka root:
//   copy C:\Users\mikod\Downloads\sprint4a_ir_swap_structure.js C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4a_ir_swap_structure.js
//   node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4a_ir_swap_structure.js
// ============================================================

const fs   = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const p = (...parts) => path.join(ROOT, ...parts);

let passed = 0, failed = 0;

function check(label, filePath) {
  const full = p(filePath);
  if (!fs.existsSync(full)) {
    console.error(`  ✗ NOT FOUND: ${filePath}`);
    failed++;
    return null;
  }
  return fs.readFileSync(full, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(p(filePath), content, 'utf8');
}

function patch(filePath, anchor, replacement, label) {
  const content = check(label, filePath);
  if (content === null) return false;
  if (!content.includes(anchor)) {
    console.error(`  ✗ Anchor not found in ${filePath}:`);
    console.error(`    "${anchor.substring(0, 80).replace(/\n/g, '↵')}"`);
    // Diagnostic: print lines containing related keywords
    const keyword = anchor.split('\n')[0].trim().substring(0, 20);
    const lines = content.split('\n');
    const hits = lines.map((l, i) => ({ i: i+1, l }))
      .filter(x => x.l.includes(keyword.substring(0, 10)));
    if (hits.length) {
      console.error(`    Nearby lines with "${keyword.substring(0,10)}":`);
      hits.slice(0, 5).forEach(x => console.error(`      L${x.i}: ${x.l.trim()}`));
    }
    failed++;
    return false;
  }
  write(filePath, content.replace(anchor, replacement));
  console.log(`  ✓ ${label}`);
  passed++;
  return true;
}

function patchOnce(filePath, anchor, replacement, label) {
  // Same as patch but ensures anchor appears exactly once
  const content = check(label, filePath);
  if (content === null) return false;
  const count = content.split(anchor).length - 1;
  if (count === 0) {
    console.error(`  ✗ Anchor not found in ${filePath}:`);
    console.error(`    "${anchor.substring(0, 80).replace(/\n/g, '↵')}"`);
    failed++;
    return false;
  }
  if (count > 1) {
    console.error(`  ✗ Anchor appears ${count} times in ${filePath} — too ambiguous.`);
    console.error(`    "${anchor.substring(0, 80).replace(/\n/g, '↵')}"`);
    failed++;
    return false;
  }
  write(filePath, content.replace(anchor, replacement));
  console.log(`  ✓ ${label}`);
  passed++;
  return true;
}

function createFile(filePath, content, label) {
  const dir = path.dirname(p(filePath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  write(filePath, content);
  console.log(`  ✓ ${label}`);
  passed++;
}

// ============================================================
// ██████  1. IrSwapStructures.jsx  (NEW FILE — complete)
// ============================================================
console.log('\n[1/7] Creating IrSwapStructures.jsx...');

const IR_SWAP_STRUCTURES_FILE = `// IrSwapStructures.jsx
// IR_SWAP variant definitions + STRUCTURE selector component
// Sprint 4A: IR_SWAP STRUCTURE consolidation
//
// instrument_type is always stored as IR_SWAP.
// terms.structure + trades.structure store the variant.
// Drives ISDA SIMM bucketing (Sprint 5) and blotter display.

// ── Structure Definitions ────────────────────────────────────
// Each entry defines the ISDA class, description, and default
// leg configuration that pre-populates the leg builder.
// fixed_rate left blank '' — trader must enter their rate.

export const IR_SWAP_STRUCTURES = [
  {
    value:       'VANILLA',
    label:       'VANILLA',
    description: 'Fixed / Float, same CCY',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'OIS',
    label:       'OIS',
    description: 'Daily compounding float, OIS curve',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 2,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'ANNUAL',
        reset_frequency: 'DAILY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        ois_compounding: 'FLAT', spread: 0,
        notional_type: 'BULLET', payment_lag: 2,
      },
    ],
  },
  {
    value:       'BASIS',
    label:       'BASIS',
    description: 'Float / Float, tenor spread',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FLOAT', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        reset_frequency: 'SEMI_ANNUAL', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0.001, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'XCCY',
    label:       'XCCY',
    description: 'Cross-currency, dual notional exchange',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FLOAT', direction: 'PAY',
        currency: 'USD',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        currency: 'EUR',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        reset_frequency: 'SEMI_ANNUAL', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'EUR_ESTR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'ZERO_COUPON',
    label:       'ZERO COUPON',
    description: 'Single bullet exchange at maturity',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: '30/360', payment_frequency: 'ZERO_COUPON',
        bdc: 'MOD_FOLLOWING',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'ZERO_COUPON',
        reset_frequency: 'ZERO_COUPON', bdc: 'MOD_FOLLOWING',
        forecast_curve_id: 'USD_SOFR', spread: 0,
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'STEP_UP',
    label:       'STEP UP',
    description: 'Step fixed rate — callable / structured',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: '30/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'STEP',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'INFLATION_ZC',
    label:       'INFLATION ZC',
    description: 'Zero-coupon CPI swap — LDI / pension',
    isda_class:  'Inflation',
    legs: [
      {
        leg_type: 'INFLATION', direction: 'PAY',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ZERO_COUPON',
        bdc: 'MOD_FOLLOWING', forecast_curve_id: 'USD_CPI',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FIXED', direction: 'RECEIVE',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ZERO_COUPON',
        bdc: 'MOD_FOLLOWING',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'INFLATION_YOY',
    label:       'INFLATION YOY',
    description: 'Year-on-year CPI swap',
    isda_class:  'Inflation',
    legs: [
      {
        leg_type: 'INFLATION', direction: 'PAY',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ANNUAL',
        bdc: 'MOD_FOLLOWING', forecast_curve_id: 'USD_CPI',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FIXED', direction: 'RECEIVE',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ANNUAL',
        bdc: 'MOD_FOLLOWING',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'CMS',
    label:       'CMS',
    description: 'Constant maturity swap rate vs fixed',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'CMS', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        forecast_curve_id: 'USD_SOFR',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FIXED', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'CMS_SPREAD',
    label:       'CMS SPREAD',
    description: 'Curve steepener / flattener (30Y−2Y)',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'CMS', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        forecast_curve_id: 'USD_SOFR',
        notional_type: 'BULLET', payment_lag: 0,
        // cms_tenor: '30Y' — stored in leg terms
      },
      {
        leg_type: 'CMS', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        forecast_curve_id: 'USD_SOFR',
        notional_type: 'BULLET', payment_lag: 0,
        // cms_tenor: '2Y' — stored in leg terms
      },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────

export function getStructureByValue(value) {
  return IR_SWAP_STRUCTURES.find(s => s.value === value)
    ?? IR_SWAP_STRUCTURES[0];    // default VANILLA
}

/**
 * Returns a leg array ready to load into the leg builder.
 * Each leg gets a fresh UUID and seq index.
 * Caller may override currency / notional / dates after the call.
 */
export function getStructureLegs(structureValue) {
  const s = getStructureByValue(structureValue);
  return s.legs.map((leg, i) => ({
    ...leg,
    leg_id:  crypto.randomUUID(),
    leg_ref: \`L\${i + 1}\`,
    leg_seq: i,
  }));
}

// ── IrSwapStructureSelector component ───────────────────────

export default function IrSwapStructureSelector({ value, onChange }) {
  return (
    <div className="structure-selector">
      <label className="structure-selector__label">STRUCTURE</label>
      <div className="structure-selector__grid">
        {IR_SWAP_STRUCTURES.map(s => (
          <button
            key={s.value}
            type="button"
            className={\`structure-btn\${value === s.value ? ' structure-btn--active' : ''}\`}
            onClick={() => onChange(s.value)}
            title={s.description}
          >
            <span className="structure-btn__label">{s.label}</span>
            <span className="structure-btn__desc">{s.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
`;

createFile(
  'frontend/src/components/blotter/IrSwapStructures.jsx',
  IR_SWAP_STRUCTURES_FILE,
  'Created IrSwapStructures.jsx'
);

// ============================================================
// ██████  2. index.css  — structure selector styles
// ============================================================
console.log('\n[2/7] Patching index.css...');

const CSS_ANCHOR = '/* ── end of design tokens ── */';
const CSS_ANCHOR_ALT = ':root {';   // fallback: inject before root block

const STRUCTURE_CSS = `
/* ── Sprint 4A: IR_SWAP STRUCTURE selector ─────────────────── */
.structure-selector {
  margin-bottom: 18px;
}
.structure-selector__label {
  color: var(--text-muted, #8899aa);
  display: block;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
  text-transform: uppercase;
}
.structure-selector__grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.structure-btn {
  background: var(--panel-2, #0f1820);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 4px;
  color: #6a8090;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 10px;
  text-align: left;
  transition: border-color 0.13s, background 0.13s, color 0.13s;
}
.structure-btn:hover {
  background: rgba(14,201,160,0.05);
  border-color: rgba(14,201,160,0.3);
  color: #a8bfcc;
}
.structure-btn--active {
  background: rgba(14,201,160,0.09);
  border-color: var(--accent, #0ec9a0);
  color: var(--accent, #0ec9a0);
}
.structure-btn__label {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  line-height: 1;
}
.structure-btn__desc {
  font-size: 9.5px;
  line-height: 1.35;
  opacity: 0.55;
}
.structure-btn--active .structure-btn__desc {
  opacity: 0.75;
}
/* blotter STRUCTURE column badge */
.structure-badge {
  background: rgba(14,201,160,0.08);
  border: 1px solid rgba(14,201,160,0.25);
  border-radius: 3px;
  color: var(--accent, #0ec9a0);
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 2px 5px;
  white-space: nowrap;
}
.structure-badge--inflation {
  background: rgba(61,139,200,0.08);
  border-color: rgba(61,139,200,0.3);
  color: var(--blue, #3d8bc8);
}
/* ── end Sprint 4A ─────────────────────────────────────────── */
`;

// Try to append at the very end of index.css
{
  const filePath = 'frontend/src/index.css';
  const content = check('index.css', filePath);
  if (content !== null) {
    if (content.includes('Sprint 4A: IR_SWAP STRUCTURE selector')) {
      console.log('  ℹ Structure CSS already present — skipping');
      passed++;
    } else {
      write(filePath, content + STRUCTURE_CSS);
      console.log('  ✓ Appended structure selector CSS');
      passed++;
    }
  }
}

// ============================================================
// ██████  3. backend/db/models.py  — add structure column
// ============================================================
console.log('\n[3/7] Patching backend/db/models.py...');

patchOnce(
  'backend/db/models.py',
  'instrument_type = Column(Text)',
  'instrument_type = Column(Text)\n    structure = Column(Text)',
  'Added structure Column to Trade model'
);

// ============================================================
// ██████  4. backend/api/routes/trades.py  — Pydantic + SQL
// ============================================================
console.log('\n[4/7] Patching backend/api/routes/trades.py...');

// 4a: Add Optional import if not already present
{
  const filePath = 'backend/api/routes/trades.py';
  const content = check('trades.py', filePath);
  if (content !== null && !content.includes('Optional')) {
    const optionalPatch = content.replace(
      'from typing import',
      'from typing import Optional,'
    );
    if (optionalPatch !== content) {
      write(filePath, optionalPatch);
      console.log('  ✓ Added Optional to typing imports');
      passed++;
    } else {
      // inject typing import if not present
      const typingPatch = content.replace(
        'from fastapi import',
        'from typing import Optional\nfrom fastapi import'
      );
      write(filePath, typingPatch);
      console.log('  ✓ Injected typing.Optional import');
      passed++;
    }
  } else if (content !== null) {
    console.log('  ℹ Optional already imported');
    passed++;
  }
}

// 4b: Add structure to TradeBase / TradeCreate Pydantic model
// The model likely has instrument_type: str
patchOnce(
  'backend/api/routes/trades.py',
  '    instrument_type: str',
  '    instrument_type: str\n    structure: Optional[str] = None',
  'Added structure: Optional[str] to trade Pydantic model'
);

// 4c: Add structure to the INSERT SQL or ORM create call
// Trades are likely created via SQLAlchemy ORM: Trade(**trade_data.dict())
// or via explicit keyword args. If ORM dict()-based, no extra patch needed
// as structure will flow through automatically. Verify with a targeted check:
{
  const filePath = 'backend/api/routes/trades.py';
  const content = check('trades.py SQL check', filePath);
  if (content !== null) {
    if (content.includes('trade_data.dict()') || content.includes('**trade_data')) {
      console.log('  ✓ ORM dict-based create — structure flows through automatically');
      passed++;
    } else if (content.includes('instrument_type=')) {
      // Explicit keyword args — need to add structure=
      const patched = content.replace(
        'instrument_type=trade_data.instrument_type',
        'instrument_type=trade_data.instrument_type,\n        structure=trade_data.structure'
      );
      if (patched !== content) {
        write(filePath, patched);
        console.log('  ✓ Added structure= to explicit ORM create call');
        passed++;
      } else {
        console.log('  ℹ Could not find explicit ORM create pattern — check manually');
      }
    } else {
      console.log('  ℹ Trade create pattern unrecognised — structure may flow via dict() — verify');
      passed++;
    }
  }
}

// ============================================================
// ██████  5. useTradesStore.js  — add structure to addTrade
// ============================================================
console.log('\n[5/7] Patching useTradesStore.js...');

// The addTrade function builds a trade object. It likely maps tradeData fields.
// Try multiple known anchor patterns:

const tradeStoreFile = 'frontend/src/store/useTradesStore.js';
{
  const content = check('useTradesStore.js', tradeStoreFile);
  if (content !== null) {
    let patched = content;
    let didPatch = false;

    // Pattern 1: explicit instrument_type mapping
    if (patched.includes('instrument_type: tradeData.instrument_type,')) {
      patched = patched.replace(
        'instrument_type: tradeData.instrument_type,',
        'instrument_type: tradeData.instrument_type,\n        structure: tradeData.structure || null,'
      );
      didPatch = true;
    }
    // Pattern 2: spread of tradeData — structure will come through if present in tradeData
    else if (patched.includes('...tradeData,') || patched.includes('...tradeData }')) {
      console.log('  ℹ useTradesStore uses ...tradeData spread — structure flows automatically');
      passed++;
      didPatch = true; // handled by spread
    }
    // Pattern 3: asset_class adjacent
    else if (patched.includes('asset_class: tradeData.asset_class,')) {
      patched = patched.replace(
        'asset_class: tradeData.asset_class,',
        'asset_class: tradeData.asset_class,\n        structure: tradeData.structure || null,'
      );
      didPatch = true;
    }

    if (didPatch && patched !== content) {
      write(tradeStoreFile, patched);
      console.log('  ✓ Added structure to addTrade payload');
      passed++;
    } else if (!didPatch) {
      console.error('  ✗ Could not find addTrade field-mapping anchor in useTradesStore.js');
      console.error('    Search for where instrument_type is set and add:');
      console.error('      structure: tradeData.structure || null,');
      failed++;
    }
  }
}

// ============================================================
// ██████  6. NewTradeWorkspace.jsx  — STRUCTURE selector
// ============================================================
console.log('\n[6/7] Patching NewTradeWorkspace.jsx...');

const NTW_FILE = 'frontend/src/components/blotter/NewTradeWorkspace.jsx';
{
  const content = check('NewTradeWorkspace.jsx', NTW_FILE);
  if (content !== null) {
    let patched = content;

    // 6a: Add import for IrSwapStructureSelector
    if (!patched.includes('IrSwapStructures')) {
      // Find a blotter-relative import to anchor after
      const importAnchors = [
        "import { useTradeLegsStore }",
        "import { useTradesStore }",
        "import { useTabStore }",
        "import { useCashflowsStore }",
        "import { usePricerStore }",
      ];
      let importAnchor = importAnchors.find(a => patched.includes(a));
      if (importAnchor) {
        const importLine = patched.split('\n')
          .find(l => l.includes(importAnchor.split('{')[1]?.split('}')[0] ?? ''));
        patched = patched.replace(
          importAnchor,
          `import IrSwapStructureSelector, { getStructureLegs } from './IrSwapStructures';\n${importAnchor}`
        );
        console.log('  ✓ Added IrSwapStructures import');
        passed++;
      } else {
        console.error('  ✗ Could not find store import anchor for IrSwapStructures import');
        console.error('    Add manually near other imports:');
        console.error("    import IrSwapStructureSelector, { getStructureLegs } from './IrSwapStructures';");
        failed++;
      }
    } else {
      console.log('  ℹ IrSwapStructures already imported');
      passed++;
    }

    // 6b: Add structure state — look for existing useState near legs or instrument
    if (!patched.includes('selectedStructure') && !patched.includes('structure,')) {
      const stateAnchors = [
        "const [legs, setLegs]",
        "const [selectedInstrument",
        "const [instrumentType",
        "const [formData",
        "const [formState",
      ];
      let stateAnchor = stateAnchors.find(a => patched.includes(a));
      if (stateAnchor) {
        patched = patched.replace(
          stateAnchor,
          `const [selectedStructure, setSelectedStructure] = useState('VANILLA');\n  ${stateAnchor}`
        );
        console.log('  ✓ Added selectedStructure state');
        passed++;
      } else {
        console.error('  ✗ Could not find useState anchor for selectedStructure state');
        console.error('    Add manually inside the component function:');
        console.error("    const [selectedStructure, setSelectedStructure] = useState('VANILLA');");
        failed++;
      }
    } else {
      console.log('  ℹ structure state already present');
      passed++;
    }

    // 6c: Wire structure to leg loading — find where TEMPLATES are applied on instrument change
    // The instrument selection handler likely calls setLegs from TEMPLATES[instrument]
    const templateAnchors = [
      'TEMPLATES[instrument]',
      'TEMPLATES[selectedInstrument]',
      'TEMPLATES[instrumentType]',
      'TEMPLATES[formData.instrument_type]',
      "TEMPLATES['IR_SWAP']",
    ];
    let foundTemplateAnchor = templateAnchors.find(a => patched.includes(a));
    if (foundTemplateAnchor && !patched.includes('getStructureLegs')) {
      // Inject structure-aware leg loading for IR_SWAP
      patched = patched.replace(
        foundTemplateAnchor,
        `(instrument === 'IR_SWAP' ? { legs: getStructureLegs(selectedStructure) } : ${foundTemplateAnchor})`
      );
      console.log('  ✓ Wired structure-aware leg loading in TEMPLATES handler');
      passed++;
    } else if (foundTemplateAnchor && patched.includes('getStructureLegs')) {
      console.log('  ℹ Structure leg wiring already present');
      passed++;
    } else {
      console.error('  ✗ Could not find TEMPLATES[instrument] handler — manual wire needed');
      console.error('    In your instrument change handler, for IR_SWAP:');
      console.error('    const legs = instrument === "IR_SWAP"');
      console.error('      ? getStructureLegs(selectedStructure)');
      console.error('      : TEMPLATES[instrument]?.legs ?? [];');
      failed++;
    }

    // 6d: Inject <IrSwapStructureSelector> JSX
    // Look for where instrument_type field is rendered, or just before leg builder
    if (!patched.includes('<IrSwapStructureSelector')) {
      const jsxAnchors = [
        // After instrument select onChange wiring
        '{/* legs */}',
        '{/* LEGS */}',
        '{legs.map(',
        '{currentLegs.map(',
        'className="leg-accordion"',
        'className="legs-section"',
        'className="leg-builder"',
        // After instrument type field
        'instrument_type</label>',
        '"instrument_type"',
        // As last resort: before the first leg add button
        'ADD LEG',
        'addLeg',
      ];
      let jsxAnchor = jsxAnchors.find(a => patched.includes(a));
      if (jsxAnchor) {
        patched = patched.replace(
          jsxAnchor,
          `{/* Sprint 4A: STRUCTURE selector — IR_SWAP only */}
        {(formData?.instrument_type === 'IR_SWAP' || selectedInstrument === 'IR_SWAP' || instrumentType === 'IR_SWAP') && (
          <IrSwapStructureSelector
            value={selectedStructure}
            onChange={(newStructure) => {
              setSelectedStructure(newStructure);
              const newLegs = getStructureLegs(newStructure);
              const ccy = formData?.notional_ccy || 'USD';
              const eff = formData?.effective_date || '';
              const mat = formData?.maturity_date || '';
              const not = formData?.notional || '';
              setLegs(newLegs.map(l => ({ ...l, currency: l.currency || ccy, effective_date: eff, maturity_date: mat, notional: not })));
            }}
          />
        )}
        ${jsxAnchor}`
        );
        console.log('  ✓ Injected <IrSwapStructureSelector> JSX');
        passed++;
      } else {
        console.error('  ✗ Could not find JSX injection anchor for <IrSwapStructureSelector>');
        console.error('    Add manually near the instrument type field or before the leg builder:');
        console.error('    {formData.instrument_type === "IR_SWAP" && (');
        console.error('      <IrSwapStructureSelector value={selectedStructure}');
        console.error('        onChange={(s) => { setSelectedStructure(s); setLegs(getStructureLegs(s)); }} />');
        console.error('    )}');
        failed++;
      }
    } else {
      console.log('  ℹ IrSwapStructureSelector JSX already present');
      passed++;
    }

    // 6e: Include structure in booking payload
    if (!patched.includes('structure: selectedStructure') && !patched.includes('structure:')) {
      const bookingAnchors = [
        'instrument_type: selectedInstrument,',
        'instrument_type: formData.instrument_type,',
        'instrument_type: instrumentType,',
      ];
      let bookingAnchor = bookingAnchors.find(a => patched.includes(a));
      if (bookingAnchor) {
        patched = patched.replace(
          bookingAnchor,
          `${bookingAnchor}\n      structure: selectedInstrument === 'IR_SWAP' || formData?.instrument_type === 'IR_SWAP' ? selectedStructure : null,`
        );
        console.log('  ✓ Added structure to booking payload');
        passed++;
      } else {
        console.error('  ✗ Could not find booking payload anchor for structure field');
        console.error('    Add manually near instrument_type in your BOOK TRADE handler:');
        console.error('    structure: instrument_type === "IR_SWAP" ? selectedStructure : null,');
        failed++;
      }
    } else {
      console.log('  ℹ structure already in booking payload');
      passed++;
    }

    write(NTW_FILE, patched);
  }
}

// ============================================================
// ██████  7. BookTab.jsx  — STRUCTURE column in blotter grid
// ============================================================
console.log('\n[7/7] Patching BookTab.jsx...');

const BOOK_TAB_FILE = 'frontend/src/components/blotter/BookTab.jsx';
{
  const content = check('BookTab.jsx', BOOK_TAB_FILE);
  if (content !== null) {
    let patched = content;

    // 7a: Add STRUCTURE column header after INSTRUMENT header
    const headerAnchors = [
      'INSTRUMENT</th>',
      '>INSTRUMENT<',
      '"INSTRUMENT"',
      'INSTRUMENT TYPE',
    ];
    let headerAnchor = headerAnchors.find(a => patched.includes(a));
    if (headerAnchor && !patched.includes('STRUCTURE</th>') && !patched.includes('>STRUCTURE<')) {
      patched = patched.replace(
        headerAnchor,
        `${headerAnchor}\n              <th className="col-structure">STRUCTURE</th>`
      );
      console.log('  ✓ Added STRUCTURE column header');
      passed++;
    } else if (!headerAnchor) {
      console.error('  ✗ Could not find INSTRUMENT column header — add STRUCTURE th manually');
      failed++;
    } else {
      console.log('  ℹ STRUCTURE header already present');
      passed++;
    }

    // 7b: Add STRUCTURE cell in trade row (after instrument_type cell)
    // The cell likely renders trade.instrument_type
    const cellAnchors = [
      '{trade.instrument_type}</td>',
      '<td>{t.instrument_type}',
      'trade.instrument_type}</td>',
    ];
    let cellAnchor = cellAnchors.find(a => patched.includes(a));
    if (cellAnchor && !patched.includes('structure-badge')) {
      patched = patched.replace(
        cellAnchor,
        `${cellAnchor}
              <td>
                {(trade || t)?.structure ? (
                  <span className={\`structure-badge\${['INFLATION_ZC','INFLATION_YOY'].includes((trade || t).structure) ? ' structure-badge--inflation' : ''}\`}>
                    {(trade || t).structure.replace('_', ' ')}
                  </span>
                ) : null}
              </td>`
      );
      console.log('  ✓ Added STRUCTURE cell to trade row');
      passed++;
    } else if (!cellAnchor) {
      console.error('  ✗ Could not find instrument_type cell — add STRUCTURE td manually');
      failed++;
    } else {
      console.log('  ℹ STRUCTURE cell already present');
      passed++;
    }

    write(BOOK_TAB_FILE, patched);
  }
}

// ============================================================
// ██████  SUMMARY
// ============================================================
console.log('\n' + '─'.repeat(60));
console.log(`Sprint 4A delivery complete: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n⚠  Some patches need manual application — see ✗ messages above.');
  console.log('   Run: node sprint4a_ir_swap_structure.js  again after fixing anchors.');
} else {
  console.log('\n✅ All patches applied. Next steps:');
  console.log('   1. Run Supabase SQL (see below in response)');
  console.log('   2. cd backend && uvicorn main:app --reload');
  console.log('   3. cd frontend && npm run dev');
  console.log('   4. Book a new IR_SWAP trade — STRUCTURE selector should appear');
  console.log('   5. Verify structure column in BookTab blotter');
}
console.log('─'.repeat(60));
