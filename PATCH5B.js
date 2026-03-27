// PATCH5B.js — Sprint 4E: wire CurveInputPanel into PricingPanel
// New filename to avoid browser cache issue with SPRINT_4E_5_patch_workspace.js
//
// Run from Rijeka root:
//   node C:\Users\mikod\OneDrive\Desktop\Rijeka\PATCH5B.js

const fs = require('fs');

const FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeWorkspace.jsx';

let src = fs.readFileSync(FILE, 'utf8');
const original = src;
const errors = [];

function patch(label, search, replacement) {
  if (!src.includes(search)) {
    errors.push('NOT FOUND: ' + label + '\n  Anchor: ' + JSON.stringify(search.slice(0, 100)));
    return;
  }
  src = src.replace(search, replacement);
  console.log('  ✓ ' + label);
}

// Guard
if (src.includes('CurveInputPanel')) {
  console.log('Already patched — nothing to do.');
  process.exit(0);
}

// 1. CurveInputPanel import
patch(
  'add CurveInputPanel import',
  "import usePricerStore from '../../store/usePricerStore'",
  "import CurveInputPanel from './CurveInputPanel';\nimport usePricerStore from '../../store/usePricerStore'"
);

// 2. Replace local curveInputs useState with store wiring
// Exact text from L84-85 of your file (confirmed by diagnostic)
patch(
  'replace curveInputs useState with store wiring',
  "  const [curveInputs, setCurveInputs] = useState(() =>\n    curveIds.map(id => ({ curve_id: id, flat_rate: '0.0525' }))\n  )",
  "  const { initCurveState, buildCurveInputs } = usePricerStore()\n  React.useEffect(() => { initCurveState(curveIds) }, [curveIds.join(',')]) // eslint-disable-line"
);

// 3. Remove handleRateChange (try two spacing variants)
const handlerA = "  const handleRateChange = (curve_id, val) => {\n    setCurveInputs(prev => prev.map(c => c.curve_id === curve_id ? { ...c, flat_rate: val } : c))\n  }";
const handlerB = "  const handleRateChange = (curve_id, val) => {\n    setCurveInputs(prev => prev.map(c =>\n      c.curve_id === curve_id ? { ...c, flat_rate: val } : c\n    ))\n  }";
if (src.includes(handlerA)) {
  src = src.replace(handlerA, '  // Sprint 4E: rate changes handled in CurveInputPanel');
  console.log('  ✓ remove handleRateChange');
} else if (src.includes(handlerB)) {
  src = src.replace(handlerB, '  // Sprint 4E: rate changes handled in CurveInputPanel');
  console.log('  ✓ remove handleRateChange (alt spacing)');
} else {
  console.log('  i handleRateChange not found — skipping (non-fatal)');
}

// 4. Remove validation loop (non-fatal)
const validLoop = "    for (const c of curveInputs) {\n      if (!c.flat_rate || isNaN(parseFloat(c.flat_rate))) {\n        setError(`Enter a rate for ${c.curve_id}`)\n        return\n      }\n    }";
if (src.includes(validLoop)) {
  src = src.replace(validLoop, '    // Sprint 4E: validation in CurveInputPanel');
  console.log('  ✓ remove validation loop');
} else {
  console.log('  i validation loop not matched — skipping (non-fatal)');
}

// 5. Replace parsed = curveInputs.map(...) — try with and without default push
const parsedWithPush =
  "    const parsed = curveInputs.map(c => ({ curve_id: c.curve_id, flat_rate: parseFloat(c.flat_rate) }))\n      if (!parsed.some(c => c.curve_id === 'default')) {\n        parsed.push({ curve_id: 'default', flat_rate: parsed[0]?.flat_rate || 0.0525 })\n      }";
const parsedNoPush =
  "    const parsed = curveInputs.map(c => ({ curve_id: c.curve_id, flat_rate: parseFloat(c.flat_rate) }))";

if (src.includes(parsedWithPush)) {
  src = src.replace(parsedWithPush, "    const parsed = buildCurveInputs(curveIds)");
  console.log('  ✓ replace parsed construction (with default push)');
} else if (src.includes(parsedNoPush)) {
  src = src.replace(parsedNoPush, "    const parsed = buildCurveInputs(curveIds)");
  console.log('  ✓ replace parsed construction (no push)');
} else {
  errors.push("NOT FOUND: parsed = curveInputs.map(...)\n  Check lines around L106 in TradeWorkspace.jsx");
}

// 6. Replace curveInputs.map JSX + RUN PRICER button with <CurveInputPanel>
const mapStart = '{curveInputs.map(c => (';
const mapIdx   = src.indexOf(mapStart);

if (mapIdx === -1) {
  errors.push("NOT FOUND: {curveInputs.map(c => (  — check L133 in TradeWorkspace.jsx");
} else {
  // Find RUN PRICER button close — try indent variants
  const btnVariants = [
    "{loading ? 'PRICING...' : 'RUN PRICER'}\n            </button>",
    "{loading ? 'PRICING...' : 'RUN PRICER'}\n          </button>",
    "{loading ? 'PRICING...' : 'RUN PRICER'}</button>",
  ];
  let btnIdx = -1, btnAnchor = '';
  for (const v of btnVariants) {
    const i = src.indexOf(v, mapIdx);
    if (i !== -1) { btnIdx = i; btnAnchor = v; break; }
  }
  if (btnIdx === -1) {
    errors.push("NOT FOUND: RUN PRICER button close after curveInputs.map — check L165 area");
  } else {
    const endIdx = btnIdx + btnAnchor.length;
    // Detect indent of the map line
    const lineStart = src.lastIndexOf('\n', mapIdx) + 1;
    const indent = src.slice(lineStart, mapIdx).replace(/\S.*/, '');
    const panel = `<CurveInputPanel\n${indent}  curveIds={curveIds}\n${indent}  onRunPricer={handleRun}\n${indent}  isLoading={loading}\n${indent}  error={error}\n${indent}/>`;
    src = src.slice(0, mapIdx) + panel + src.slice(endIdx);
    console.log('  ✓ replace flat_rate input grid + RUN PRICER button with <CurveInputPanel>');
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('\n❌ Patch failed:\n');
  errors.forEach(e => console.error('  ' + e));
  console.error('\nFile NOT written. Paste error output back to Claude.');
  process.exit(1);
}

if (src === original) {
  console.log('\ni No changes — already up to date.');
  process.exit(0);
}

fs.writeFileSync(FILE + '.bak', original, 'utf8');
fs.writeFileSync(FILE, src, 'utf8');
console.log('\n✓ Done. Backup at TradeWorkspace.jsx.bak');
console.log('\nNext:');
console.log('  cd frontend && npm run dev');
console.log('  Open trade → PRICING tab → CurveInputPanel should render');
console.log('  FLAT: enter rate → RUN PRICER → NPV result');
console.log('  MARKET: fill pillars → RUN PRICER → curve_mode: bootstrapped');
