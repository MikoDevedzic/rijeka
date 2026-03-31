/**
 * RIJEKA — Sprint 5A: Fix NewTradeWorkspace.jsx taxonomy
 * Renames inline pv01 variable and PV01 UI label → ir01 / IR01
 * Run from Rijeka root:
 *   node sprint5_fix_ntw_taxonomy.js
 */

const fs = require('fs');
const path = require('path');

const ROOT  = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const FILE  = 'frontend/src/components/blotter/NewTradeWorkspace.jsx';
const FULL  = path.join(ROOT, FILE);

if (!fs.existsSync(FULL)) {
  console.error('ERROR: file not found — ' + FULL);
  process.exit(1);
}

let content = fs.readFileSync(FULL, 'utf8');
const original = content;

const transforms = [
  // Comment block that documents the calculation
  ['// PV01: bump 1bp',                       '// IR01: bump 1bp'],

  // Variable declaration and calculation
  ['const pv01 = npv1bp - totalNPV',           'const ir01 = npv1bp - totalNPV'],

  // State setter — pv01 key in result object
  ['setIndResult({npv: totalNPV, pv01,',       'setIndResult({npv: totalNPV, ir01,'],
  // Variant with spaces
  ['setIndResult({npv: totalNPV, pv01 ,',      'setIndResult({npv: totalNPV, ir01 ,'],

  // Destructuring from indResult
  ['const pv01 = indResult.pv01',              'const ir01 = indResult.ir01'],
  // Direct property access variant
  ['indResult.pv01',                            'indResult.ir01'],

  // UI label string
  ['>PV01<',                                   '>IR01<'],
  ['"PV01"',                                   '"IR01"'],
  ["'PV01'",                                   "'IR01'"],

  // fmtAmt call referencing pv01
  ['{fmtAmt(pv01)}',                           '{fmtAmt(ir01)}'],

  // Any remaining bare pv01 references (standalone variable, not part of another word)
  // Use word-boundary-aware replacement via split/join on whole tokens
];

let changeCount = 0;
for (const [from, to] of transforms) {
  const before = content;
  content = content.split(from).join(to);
  const hits = (before.split(from).length - 1);
  if (hits > 0) {
    console.log(`  ✅ "${from}" → "${to}"  (${hits}x)`);
    changeCount += hits;
  }
}

// Safety check — make sure we didn't accidentally touch unrelated pv01 patterns
// Scan for any remaining 'pv01' in the file
const remaining = content.split('\n')
  .map((line, i) => ({ n: i + 1, line }))
  .filter(({ line }) => line.toLowerCase().includes('pv01'));

if (remaining.length > 0) {
  console.log('\n  ⚠️  Remaining pv01 references after patch:');
  for (const { n, line } of remaining) {
    console.log(`    L${n}: ${line.trim()}`);
  }
  console.log('  → Review these manually before committing.\n');
} else {
  console.log('\n  ✅ No remaining pv01 references in NewTradeWorkspace.jsx\n');
}

if (changeCount === 0) {
  console.log('  ── No changes made. File may already be updated.');
} else {
  fs.writeFileSync(FULL, content, 'utf8');
  console.log(`\n  ✅ Written: ${FILE}`);
  console.log(`  Total changes: ${changeCount}`);
}

console.log('\n══════════════════════════════════════════════');
console.log('  NewTradeWorkspace.jsx taxonomy — COMPLETE');
console.log('══════════════════════════════════════════════');
console.log('');
console.log('  What changed:');
console.log('    pv01  → ir01          (variable name)');
console.log('    PV01  → IR01          (UI label)');
console.log('    indResult.pv01 → indResult.ir01');
console.log('    setIndResult({pv01}) → setIndResult({ir01})');
console.log('');
console.log('  Verify in browser:');
console.log('  1. NEW TRADE → add any IR_SWAP legs → RUN (inline pricer)');
console.log('  2. Greek label should now read "IR01" not "PV01"');
console.log('  3. Value should be unchanged — same calculation, renamed label');
console.log('');
console.log('  Then commit:');
console.log('  git add frontend/src/components/blotter/NewTradeWorkspace.jsx');
console.log('  git commit -m "Sprint 5A: NewTradeWorkspace IR01 taxonomy"');
console.log('══════════════════════════════════════════════\n');
