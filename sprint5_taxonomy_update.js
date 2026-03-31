/**
 * RIJEKA — Sprint 5A: Risk Taxonomy Update
 * Replaces ALL pv01/dv01 references with IR01/IR01_DISC across the entire codebase.
 * Run from Rijeka root:
 *   node sprint5_taxonomy_update.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
let totalChanges = 0;
let filesChanged = [];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function read(filePath) {
  const full = path.join(ROOT, filePath);
  if (!fs.existsSync(full)) {
    console.log(`  SKIP (not found): ${filePath}`);
    return null;
  }
  return fs.readFileSync(full, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(path.join(ROOT, filePath), content, 'utf8');
}

function patch(filePath, transforms) {
  const original = read(filePath);
  if (original === null) return;

  let content = original;
  let count = 0;

  for (const [label, from, to] of transforms) {
    const before = content;
    // Replace all occurrences
    content = content.split(from).join(to);
    const hits = (before.split(from).length - 1);
    if (hits > 0) {
      console.log(`    [${label}] "${from}" → "${to}"  (${hits}x)`);
      count += hits;
    }
  }

  if (count > 0) {
    write(filePath, content);
    filesChanged.push(filePath);
    totalChanges += count;
    console.log(`  ✅ ${filePath} — ${count} change(s)\n`);
  } else {
    console.log(`  ── ${filePath} — no changes needed\n`);
  }
}

// ─────────────────────────────────────────────────────────────
// 1. backend/pricing/greeks.py
//    Greeks dataclass: pv01 → ir01, dv01 → ir01_disc
//    compute_greeks() return dict keys
// ─────────────────────────────────────────────────────────────
console.log('=== backend/pricing/greeks.py ===');
patch('backend/pricing/greeks.py', [
  // dataclass / TypedDict fields
  ['field rename',   'pv01: float',         'ir01: float'],
  ['field rename',   'dv01: float',         'ir01_disc: float'],
  // dict key strings
  ['key string',     '"pv01"',              '"ir01"'],
  ['key string',     '"dv01"',              '"ir01_disc"'],
  ['key string',     "'pv01'",              "'ir01'"],
  ['key string',     "'dv01'",              "'ir01_disc'"],
  // variable assignments
  ['var assign',     'pv01 =',              'ir01 ='],
  ['var assign',     'dv01 =',              'ir01_disc ='],
  // return dict
  ['return key',     '"pv01":',             '"ir01":'],
  ['return key',     '"dv01":',             '"ir01_disc":'],
  ['return key',     "'pv01':",             "'ir01':"],
  ['return key',     "'dv01':",             "'ir01_disc':"],
  // attribute access
  ['attr access',    '.pv01',               '.ir01'],
  ['attr access',    '.dv01',               '.ir01_disc'],
  // comments
  ['comment',        'PV01',                'IR01'],
  ['comment',        'DV01',                'IR01_DISC'],
  // variable names (standalone)
  ['var name',       'pv01_',               'ir01_'],
  ['var name',       'dv01_',               'ir01_disc_'],
]);

// ─────────────────────────────────────────────────────────────
// 2. backend/pricing/ir_swap.py
//    SwapResult dataclass, LegResult, price_swap return
// ─────────────────────────────────────────────────────────────
console.log('=== backend/pricing/ir_swap.py ===');
patch('backend/pricing/ir_swap.py', [
  ['field rename',   'pv01: float',         'ir01: float'],
  ['field rename',   'dv01: float',         'ir01_disc: float'],
  ['key string',     '"pv01"',              '"ir01"'],
  ['key string',     '"dv01"',              '"ir01_disc"'],
  ['key string',     "'pv01'",              "'ir01'"],
  ['key string',     "'dv01'",              "'ir01_disc'"],
  ['return key',     '"pv01":',             '"ir01":'],
  ['return key',     '"dv01":',             '"ir01_disc":'],
  ['return key',     "'pv01':",             "'ir01':"],
  ['return key',     "'dv01':",             "'ir01_disc':"],
  ['attr access',    '.pv01',               '.ir01'],
  ['attr access',    '.dv01',               '.ir01_disc'],
  ['var assign',     'pv01 =',              'ir01 ='],
  ['var assign',     'dv01 =',              'ir01_disc ='],
  ['comment',        'PV01',                'IR01'],
  ['comment',        'DV01',                'IR01_DISC'],
]);

// ─────────────────────────────────────────────────────────────
// 3. backend/api/routes/pricer.py
//    PriceResponse Pydantic model, route return values
// ─────────────────────────────────────────────────────────────
console.log('=== backend/api/routes/pricer.py ===');
patch('backend/api/routes/pricer.py', [
  ['pydantic field',  'pv01: float',         'ir01: float'],
  ['pydantic field',  'dv01: float',         'ir01_disc: float'],
  ['pydantic field',  'pv01: Optional[float]','ir01: Optional[float]'],
  ['pydantic field',  'dv01: Optional[float]','ir01_disc: Optional[float]'],
  ['key string',      '"pv01"',              '"ir01"'],
  ['key string',      '"dv01"',              '"ir01_disc"'],
  ['key string',      "'pv01'",              "'ir01'"],
  ['key string',      "'dv01'",              "'ir01_disc'"],
  ['return key',      '"pv01":',             '"ir01":'],
  ['return key',      '"dv01":',             '"ir01_disc":'],
  ['attr access',     '.pv01',               '.ir01'],
  ['attr access',     '.dv01',               '.ir01_disc'],
  ['comment',         'PV01',                'IR01'],
  ['comment',         'DV01',                'IR01_DISC'],
]);

// ─────────────────────────────────────────────────────────────
// 4. backend/pricing/__init__.py (if it re-exports Greeks)
// ─────────────────────────────────────────────────────────────
console.log('=== backend/pricing/__init__.py ===');
patch('backend/pricing/__init__.py', [
  ['export',  'pv01',  'ir01'],
  ['export',  'dv01',  'ir01_disc'],
  ['comment', 'PV01',  'IR01'],
  ['comment', 'DV01',  'IR01_DISC'],
]);

// ─────────────────────────────────────────────────────────────
// 5. frontend/src/store/usePricerStore.js
//    Result parsing, state shape, helper exports
// ─────────────────────────────────────────────────────────────
console.log('=== frontend/src/store/usePricerStore.js ===');
patch('frontend/src/store/usePricerStore.js', [
  // object destructuring / access
  ['destructure',   'pv01',         'ir01'],
  ['destructure',   'dv01',         'ir01_disc'],
  // string labels in display helpers
  ['label string',  "'PV01'",       "'IR01'"],
  ['label string',  "'DV01'",       "'IR01_DISC'"],
  ['label string',  '"PV01"',       '"IR01"'],
  ['label string',  '"DV01"',       '"IR01_DISC"'],
  // fmtBps / helper references
  ['comment',       'PV01',         'IR01'],
  ['comment',       'DV01',         'IR01_DISC'],
]);

// ─────────────────────────────────────────────────────────────
// 6. frontend/src/components/pricer/PricerPage.jsx
//    Display labels, result.pv01, result.dv01
// ─────────────────────────────────────────────────────────────
console.log('=== frontend/src/components/pricer/PricerPage.jsx ===');
patch('frontend/src/components/pricer/PricerPage.jsx', [
  // JS property access on result object
  ['prop access',   'result.pv01',    'result.ir01'],
  ['prop access',   'result.dv01',    'result.ir01_disc'],
  ['prop access',   '.pv01',          '.ir01'],
  ['prop access',   '.dv01',          '.ir01_disc'],
  // Display label strings shown in UI
  ['UI label',      '>PV01<',         '>IR01<'],
  ['UI label',      '>DV01<',         '>IR01_DISC<'],
  ['UI label',      "'PV01'",         "'IR01'"],
  ['UI label',      "'DV01'",         "'IR01_DISC'"],
  ['UI label',      '"PV01"',         '"IR01"'],
  ['UI label',      '"DV01"',         '"IR01_DISC"'],
  // Variable names
  ['var',           'pv01',           'ir01'],
  ['var',           'dv01',           'ir01_disc'],
  ['comment',       'PV01',           'IR01'],
  ['comment',       'DV01',           'IR01_DISC'],
]);

// ─────────────────────────────────────────────────────────────
// 7. Scan TradeWorkspace components for PRICING tab
//    These render the pricing results inline
// ─────────────────────────────────────────────────────────────
const tradeworkspaceCandidates = [
  'frontend/src/components/blotter/TradeWorkspace.jsx',
  'frontend/src/components/blotter/TradeWorkspace/index.jsx',
  'frontend/src/components/blotter/TradeWorkspace/PricingTab.jsx',
  'frontend/src/components/blotter/PricingTab.jsx',
];

const tradeWorkspaceTx = [
  ['prop access',   'result.pv01',    'result.ir01'],
  ['prop access',   'result.dv01',    'result.ir01_disc'],
  ['prop access',   '.pv01',          '.ir01'],
  ['prop access',   '.dv01',          '.ir01_disc'],
  ['UI label',      '>PV01<',         '>IR01<'],
  ['UI label',      '>DV01<',         '>IR01_DISC<'],
  ['UI label',      "'PV01'",         "'IR01'"],
  ['UI label',      "'DV01'",         "'IR01_DISC'"],
  ['UI label',      '"PV01"',         '"IR01"'],
  ['UI label',      '"DV01"',         '"IR01_DISC"'],
  ['var',           'pv01',           'ir01'],
  ['var',           'dv01',           'ir01_disc'],
  ['comment',       'PV01',           'IR01'],
  ['comment',       'DV01',           'IR01_DISC'],
];

for (const f of tradeworkspaceCandidates) {
  console.log(`=== ${f} ===`);
  patch(f, tradeWorkspaceTx);
}

// ─────────────────────────────────────────────────────────────
// 8. CompareWorkspace (PROMETHEUS analysis includes PV01/DV01)
// ─────────────────────────────────────────────────────────────
console.log('=== frontend/src/components/blotter/CompareWorkspace.jsx ===');
patch('frontend/src/components/blotter/CompareWorkspace.jsx', [
  ['prop access',   '.pv01',    '.ir01'],
  ['prop access',   '.dv01',    '.ir01_disc'],
  ['UI label',      '>PV01<',   '>IR01<'],
  ['UI label',      '>DV01<',   '>IR01_DISC<'],
  ['UI label',      '"PV01"',   '"IR01"'],
  ['UI label',      '"DV01"',   '"IR01_DISC"'],
  ['UI label',      "'PV01'",   "'IR01'"],
  ['UI label',      "'DV01'",   "'IR01_DISC'"],
  ['var',           'pv01',     'ir01'],
  ['var',           'dv01',     'ir01_disc'],
]);

// ─────────────────────────────────────────────────────────────
// 9. analyse.py — PROMETHEUS system prompt references PV01/DV01
// ─────────────────────────────────────────────────────────────
console.log('=== backend/api/routes/analyse.py ===');
patch('backend/api/routes/analyse.py', [
  ['prompt text',  'PV01',        'IR01'],
  ['prompt text',  'DV01',        'IR01_DISC'],
  ['prompt text',  'pv01',        'ir01'],
  ['prompt text',  'dv01',        'ir01_disc'],
]);

// ─────────────────────────────────────────────────────────────
// 10. BROAD SCAN — find any remaining files with pv01/dv01
//     across all Python and JSX/JS files
// ─────────────────────────────────────────────────────────────

console.log('\n=== BROAD SCAN — remaining pv01/dv01 references ===\n');

function scanDir(dir, exts, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '__pycache__') continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanDir(full, exts, results);
    } else if (exts.some(e => entry.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = scanDir(ROOT, ['.py', '.jsx', '.js', '.ts', '.tsx']);
const remaining = [];

for (const f of allFiles) {
  const rel = f.replace(ROOT + path.sep, '').replace(/\\/g, '/');
  // Skip already-patched files and node_modules
  if (filesChanged.some(c => rel.endsWith(c.replace(/\\/g, '/')))) continue;
  const content = fs.readFileSync(f, 'utf8');
  const lower = content.toLowerCase();
  if (lower.includes('pv01') || lower.includes('dv01')) {
    const lines = content.split('\n');
    const hits = lines
      .map((l, i) => ({ line: i + 1, text: l.trim() }))
      .filter(({ text }) => text.toLowerCase().includes('pv01') || text.toLowerCase().includes('dv01'));
    remaining.push({ file: rel, hits });
  }
}

if (remaining.length === 0) {
  console.log('  ✅ No remaining pv01/dv01 references found.\n');
} else {
  console.log('  ⚠️  Remaining files with pv01/dv01 — review manually:\n');
  for (const { file, hits } of remaining) {
    console.log(`  FILE: ${file}`);
    for (const { line, text } of hits) {
      console.log(`    L${line}: ${text}`);
    }
    console.log('');
  }
}

// ─────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  RISK TAXONOMY UPDATE — COMPLETE');
console.log('══════════════════════════════════════════════');
console.log(`  Files changed:   ${filesChanged.length}`);
console.log(`  Total changes:   ${totalChanges}`);
console.log(`  Files remaining: ${remaining.length} (see above)`);
console.log('');
console.log('  What was renamed:');
console.log('    pv01  → ir01        (IR rate sensitivity, parallel +1bp)');
console.log('    dv01  → ir01_disc   (discount-only IR sensitivity)');
console.log('    PV01  → IR01        (display labels)');
console.log('    DV01  → IR01_DISC   (display labels)');
console.log('');
console.log('  Next steps:');
console.log('  1. Restart backend:  cd backend && uvicorn main:app --reload');
console.log('  2. Hard refresh frontend: Ctrl+Shift+R on localhost:5173');
console.log('  3. Run PRICER on TRD-90992960 — confirm output shows IR01/IR01_DISC');
console.log('  4. Expected: IR01 ≈ $7,087  IR01_DISC ≈ $7,087 (flat curve, identical)');
console.log('  5. git add . && git commit -m "Sprint 5A: risk taxonomy IR01/IR01_DISC"');
console.log('══════════════════════════════════════════════\n');
