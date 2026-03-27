// sprint4a_fix.js — targeted fixes for the 4 remaining Sprint 4A failures
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4a_fix.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const p    = (...x) => path.join(ROOT, ...x);

let ok = 0, fail = 0;

function read(filePath) {
  const full = p(filePath);
  if (!fs.existsSync(full)) { console.error(`  ✗ NOT FOUND: ${filePath}`); fail++; return null; }
  return fs.readFileSync(full, 'utf8');
}
function write(filePath, content) { fs.writeFileSync(p(filePath), content, 'utf8'); }
function swap(filePath, from, to, label) {
  const src = read(filePath);
  if (src === null) return;
  if (!src.includes(from)) {
    console.error(`  ✗ Anchor missing in ${filePath}:`);
    console.error(`    ${JSON.stringify(from.substring(0,100))}`);
    fail++; return;
  }
  write(filePath, src.replace(from, to));
  console.log(`  ✓ ${label}`);
  ok++;
}

// ============================================================
// FIX 1 — backend/db/models.py
// Add structure Column after instrument_type (uses Column(String) not Column(Text))
// ============================================================
console.log('\n[1/4] models.py — add structure Column');

swap(
  'backend/db/models.py',
  '    instrument_type      = Column(String, nullable=True)',
  '    instrument_type      = Column(String, nullable=True)\n    structure            = Column(String, nullable=True)',
  'Added structure = Column(String, nullable=True) after instrument_type'
);

// ============================================================
// FIX 2 — BookTab.jsx
// Insert structure badge <td> after instrument_type <td>
// Header was already added by sprint4a run, only cell needed.
// ============================================================
console.log('\n[2/4] BookTab.jsx — add structure badge cell');

swap(
  'frontend/src/components/blotter/BookTab.jsx',
  '<td className="td-dim">{t.instrument_type}</td>',
  `<td className="td-dim">{t.instrument_type}</td>
                      <td>{t.structure
                        ? <span className={\`structure-badge\${['INFLATION_ZC','INFLATION_YOY'].includes(t.structure)?(' structure-badge--inflation'):''}\`}>{t.structure.replace(/_/g,' ')}</span>
                        : <span className="td-dim" style={{opacity:0.3}}>—</span>}
                      </td>`,
  'Added structure badge cell after instrument_type cell'
);

// ============================================================
// FIX 3 — NewTradeWorkspace.jsx
// 3a: Declare selectedStructure state
// 3b: Add STRUCTURE_TO_TEMPLATE helper (maps structure names → TEMPLATES fns)
// 3c: Update changeIT to reset structure when leaving IR_SWAP
// 3d: Replace injected JSX block (uses wrong variable names)
// 3e: Fix terms.structure (was hardcoded to instrument, now uses selectedStructure)
// 3f: Add top-level structure field to booking payload
// ============================================================
console.log('\n[3/4] NewTradeWorkspace.jsx — 6 surgical patches');

const NTW = 'frontend/src/components/blotter/NewTradeWorkspace.jsx';

// 3a: state declaration — add after instrument state line
swap(
  NTW,
  "  const [instrument,setInstrument]=useState('IR_SWAP')",
  "  const [instrument,setInstrument]=useState('IR_SWAP')\n  const [selectedStructure,setSelectedStructure]=useState('VANILLA')",
  '3a: Added selectedStructure state'
);

// 3b: Add STRUCTURE_TO_TEMPLATE helper before the component function
// Anchor on the export default function line
swap(
  NTW,
  "export default function NewTradeWorkspace({tab}) {",
  `// ── Sprint 4A: structure → template mapping ─────────────────────────────────
// instrument_type stays IR_SWAP for all 10 variants.
// terms.structure and trades.structure store the variant name.
const STRUCTURE_TO_TEMPLATE = {
  VANILLA:       () => TEMPLATES.IR_SWAP(),
  OIS:           () => TEMPLATES.OIS_SWAP      ? TEMPLATES.OIS_SWAP()      : TEMPLATES.IR_SWAP(),
  BASIS:         () => TEMPLATES.BASIS_SWAP    ? TEMPLATES.BASIS_SWAP()    : TEMPLATES.IR_SWAP(),
  XCCY:          () => TEMPLATES.XCCY_SWAP     ? TEMPLATES.XCCY_SWAP()     : TEMPLATES.IR_SWAP(),
  ZERO_COUPON:   () => TEMPLATES.ZERO_COUPON_SWAP  ? TEMPLATES.ZERO_COUPON_SWAP()  : TEMPLATES.IR_SWAP(),
  STEP_UP:       () => TEMPLATES.STEP_UP_SWAP  ? TEMPLATES.STEP_UP_SWAP()  : TEMPLATES.IR_SWAP(),
  INFLATION_ZC:  () => TEMPLATES.INFLATION_SWAP? TEMPLATES.INFLATION_SWAP(): TEMPLATES.IR_SWAP(),
  INFLATION_YOY: () => TEMPLATES.INFLATION_SWAP? TEMPLATES.INFLATION_SWAP(): TEMPLATES.IR_SWAP(),
  CMS:           () => TEMPLATES.CMS_SWAP      ? TEMPLATES.CMS_SWAP()      : TEMPLATES.IR_SWAP(),
  CMS_SPREAD:    () => TEMPLATES.CMS_SPREAD_SWAP? TEMPLATES.CMS_SPREAD_SWAP(): TEMPLATES.IR_SWAP(),
}

export default function NewTradeWorkspace({tab}) {`,
  '3b: Added STRUCTURE_TO_TEMPLATE helper before component'
);

// 3c: Update changeIT to reset selectedStructure when instrument changes away from IR_SWAP
// Current: const changeIT=(it)=>{setInstrument(it);setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)());setDirty(tab.id,true)}
swap(
  NTW,
  "  const changeIT=(it)=>{setInstrument(it);setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)());setDirty(tab.id,true)}",
  "  const changeIT=(it)=>{setInstrument(it);if(it!=='IR_SWAP')setSelectedStructure('VANILLA');setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)());setDirty(tab.id,true)}",
  '3c: changeIT resets selectedStructure when leaving IR_SWAP'
);

// 3d: Fix terms.structure — was hardcoded to `instrument`, now uses selectedStructure for IR_SWAP
// From diag: L1684: `      structure: instrument,`
swap(
  NTW,
  '      structure: instrument,',
  '      structure: instrument===\'IR_SWAP\' ? selectedStructure : null,',
  '3d: terms.structure now uses selectedStructure for IR_SWAP'
);

// 3e: Add top-level structure to booking payload
// From diag L1699: instrument_type:instrument, is in the payload — inject structure after it
swap(
  NTW,
  'instrument_type:instrument,',
  'instrument_type:instrument,structure:instrument===\'IR_SWAP\'?selectedStructure:null,',
  '3e: Added top-level structure to booking payload'
);

// 3f: Replace the injected JSX block (uses wrong var names: formData, selectedInstrument, instrumentType)
// The block was injected starting with this exact text:
const BAD_JSX = `{/* Sprint 4A: STRUCTURE selector — IR_SWAP only */}
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
        )}`;

const GOOD_JSX = `{/* Sprint 4A: STRUCTURE selector — IR_SWAP only */}
        {instrument === 'IR_SWAP' && (
          <IrSwapStructureSelector
            value={selectedStructure}
            onChange={(newStructure) => {
              setSelectedStructure(newStructure);
              const tplLegs = (STRUCTURE_TO_TEMPLATE[newStructure] || STRUCTURE_TO_TEMPLATE.VANILLA)();
              // Inherit current dates, ccy, notional into new legs
              setLegs(tplLegs.map(l => ({
                ...l,
                currency: l.currency || notionalCcy || 'USD',
                effective_date: effectiveDate || '',
                maturity_date: maturityDate || '',
              })));
              setDirty(tab.id, true);
            }}
          />
        )}`;

swap(NTW, BAD_JSX, GOOD_JSX, '3f: Fixed IrSwapStructureSelector JSX — correct variable names + STRUCTURE_TO_TEMPLATE');

// ============================================================
// FIX 4 — Verify IrSwapStructures import no longer imports
//          getStructureLegs (no longer needed in NTW)
// ============================================================
console.log('\n[4/4] NTW import cleanup — remove unused getStructureLegs import');

{
  const src = read(NTW);
  if (src !== null) {
    if (src.includes("import IrSwapStructureSelector, { getStructureLegs } from './IrSwapStructures'")) {
      swap(
        NTW,
        "import IrSwapStructureSelector, { getStructureLegs } from './IrSwapStructures'",
        "import IrSwapStructureSelector from './IrSwapStructures'",
        'Removed unused getStructureLegs from import (NTW now uses STRUCTURE_TO_TEMPLATE)'
      );
    } else if (src.includes("from './IrSwapStructures'")) {
      console.log('  ℹ IrSwapStructures import already clean');
      ok++;
    } else {
      console.error('  ✗ IrSwapStructures import not found — was the sprint4a run successful?');
      fail++;
    }
  }
}

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '─'.repeat(60));
console.log(`Sprint 4A fix complete: ${ok} passed, ${fail} failed`);
if (fail === 0) {
  console.log('\n✅ All fixes applied. Steps:');
  console.log('   1. Run SQL in Supabase (if not already done)');
  console.log('   2. cd backend && uvicorn main:app --reload');
  console.log('   3. cd frontend && npm run dev');
  console.log('   4. Open NEW TRADE → select IR_SWAP → verify STRUCTURE grid appears');
  console.log('   5. Switch structure (e.g. BASIS) → verify legs reload');
  console.log('   6. Book a trade → verify STRUCTURE badge in BookTab blotter');
  console.log('   7. Check Supabase trades table → structure column populated');
} else {
  console.log('\n⚠  Fix and re-run for ✗ items above.');
}
console.log('─'.repeat(60));
