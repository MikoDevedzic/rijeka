// SPRINT_4E_5_patch_workspace.js
// Reads TradeWorkspace.jsx, injects CurveInputPanel into the PRICING tab.
//
// What this patch does:
//   1. Adds imports: CurveInputPanel, useTradeLegsStore
//   2. Adds useMemo to derive unique curveIds from legs
//   3. Adds useEffect to call initCurveState when trade opens
//   4. Replaces the existing curve input + run pricer block with <CurveInputPanel>
//
// If any anchor is not found, the script reports WHAT was not found and exits
// without writing — safe to re-run.
//
// Run from Rijeka root: node SPRINT_4E_5_patch_workspace.js

const fs = require('fs');
const path = require('path');

const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const FILE = path.join(RIJEKA, 'frontend', 'src', 'components', 'blotter', 'TradeWorkspace.jsx');

let src = fs.readFileSync(FILE, 'utf8');
const original = src;
let errors = [];

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────
function replace(label, search, replacement) {
  if (!src.includes(search)) {
    errors.push(`NOT FOUND: ${label}\n  Looking for: ${search.slice(0,80).replace(/\n/g,'↵')}...`);
    return;
  }
  src = src.replace(search, replacement);
  console.log(`  ✓ Patched: ${label}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch 1: Add CurveInputPanel + useTradeLegsStore imports
// We anchor on the existing usePricerStore import line.
// ─────────────────────────────────────────────────────────────────────────────
replace(
  'CurveInputPanel import',
  `import usePricerStore`,
  `import CurveInputPanel from './CurveInputPanel';
import usePricerStore`
);

// Add useTradeLegsStore if not already imported
if (!src.includes('useTradeLegsStore')) {
  replace(
    'useTradeLegsStore import',
    `import usePricerStore`,
    `import useTradeLegsStore from '../../store/useTradeLegsStore';
import usePricerStore`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch 2: Add curveIds derivation + initCurveState inside the component.
// Anchor: the line where usePricerStore is destructured.
// We look for the destructure and add the curve logic immediately after.
// ─────────────────────────────────────────────────────────────────────────────

// Find the usePricerStore destructure line — flexible pattern
const pricerDestructurePatterns = [
  `const { priceTrade,`,
  `const { resultsByTrade,`,
  `const { priceTrade `,
  `const {priceTrade`,
];

let pricerDestructure = null;
for (const p of pricerDestructurePatterns) {
  const idx = src.indexOf(p);
  if (idx !== -1) {
    // Grab the full statement (up to the closing ;)
    const end = src.indexOf(';', idx);
    pricerDestructure = src.slice(idx, end + 1);
    break;
  }
}

if (!pricerDestructure) {
  errors.push('NOT FOUND: usePricerStore destructure — check component for "const { priceTrade" or similar');
} else {
  const curveLogic = `
  // Sprint 4E: derive unique curve IDs from legs, init pricer curve state
  const { legsByTrade } = useTradeLegsStore();
  const { initCurveState, buildCurveInputs, loadingByTrade, errorByTrade } = usePricerStore();

  const tradeCurveIds = React.useMemo(() => {
    const legs = legsByTrade[tradeId] || [];
    const ids = new Set();
    legs.forEach(leg => {
      if (leg.discount_curve_id) ids.add(leg.discount_curve_id);
      if (leg.forecast_curve_id) ids.add(leg.forecast_curve_id);
    });
    // Always include trade-level curves as fallback
    if (ids.size === 0) ids.add('default');
    return Array.from(ids);
  }, [legsByTrade, tradeId]);

  React.useEffect(() => {
    if (tradeCurveIds.length > 0) {
      initCurveState(tradeCurveIds);
    }
  }, [tradeCurveIds.join(',')]);

  const handleRunPricer = React.useCallback(async () => {
    const curveInputs = buildCurveInputs(tradeCurveIds);
    try {
      await usePricerStore.getState().priceTrade(tradeId, curveInputs, null);
    } catch (_) {
      // error stored in errorByTrade[tradeId]
    }
  }, [tradeCurveIds, tradeId]);
`;
  replace(
    'curve logic injection after pricer destructure',
    pricerDestructure,
    pricerDestructure + '\n' + curveLogic
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch 3: Replace the PRICING tab's curve input + button section
// with <CurveInputPanel>.
//
// We look for several possible patterns that might exist in the current
// PRICING tab. Try them in order; first match wins.
// ─────────────────────────────────────────────────────────────────────────────

// Pattern A: flat_rate input blocks followed by a RUN PRICER button
const patternA_start = `{activeTab === 'PRICING'`;
const patternA_end = `</div>`;  // This is too broad — use a narrower anchor below

// Instead, look for the curve input section that currently exists.
// The Sprint 3D curve input UI would have something like a flatRate input or
// a "curves" state block. We'll try to find a distinctive block.

const curveInputCandidates = [
  // If there's a flat_rate section before the results
  `{curves.map`,
  `{curveInputs.map`,
  `flat_rate`,
  `flatRate`,
];

// We'll look for the PRICING tab JSX block and inject CurveInputPanel at the top.
// Strategy: find activeTab === 'PRICING' section opening div, add panel right inside.

const pricingTabMarker = `activeTab === 'PRICING'`;
const pricingIdx = src.indexOf(pricingTabMarker);

if (pricingIdx === -1) {
  errors.push('NOT FOUND: activeTab === \'PRICING\' — check tab name in component');
} else {
  // Find the opening bracket/paren after this marker to get into the tab body
  // Look for JSX: && (\n or && ( or && <
  const afterMarker = src.slice(pricingIdx);

  // Look for the first <div after the PRICING marker that contains curve UI
  // We'll inject CurveInputPanel before the pricer results section.

  // Find where results are displayed — look for npv or resultsByTrade usage near PRICING
  const npvPatterns = [
    `result?.npv`,
    `resultsByTrade[tradeId]`,
    `pricingResult`,
    `npv &&`,
    `{npv}`,
    `NPV`,
  ];

  let injected = false;
  for (const pat of npvPatterns) {
    const npvIdx = src.indexOf(pat, pricingIdx);
    if (npvIdx === -1) continue;

    // Walk backward to find the start of the line or surrounding div
    const lineStart = src.lastIndexOf('\n', npvIdx) + 1;
    const lineContent = src.slice(lineStart, npvIdx + pat.length + 50);

    // Insert CurveInputPanel just before the npv display section
    // We need to find a safe line boundary to insert at
    const insertionPoint = lineStart;
    const indent = lineContent.match(/^(\s*)/)?.[1] || '      ';

    const panelJsx = `${indent}<CurveInputPanel
${indent}  curveIds={tradeCurveIds}
${indent}  onRunPricer={handleRunPricer}
${indent}  isLoading={loadingByTrade[tradeId] || false}
${indent}  error={errorByTrade[tradeId] || null}
${indent}/>\n`;

    // Only inject if CurveInputPanel isn't already there
    if (!src.slice(pricingIdx, pricingIdx + 3000).includes('CurveInputPanel')) {
      src = src.slice(0, insertionPoint) + panelJsx + src.slice(insertionPoint);
      console.log(`  ✓ Patched: CurveInputPanel injected before NPV results (anchor: "${pat}")`);
      injected = true;
      break;
    } else {
      console.log('  ℹ CurveInputPanel already present in PRICING tab — skipping injection');
      injected = true;
      break;
    }
  }

  if (!injected) {
    errors.push(
      'PRICING tab: could not find NPV results section to inject before. ' +
      'Manually add <CurveInputPanel curveIds={tradeCurveIds} onRunPricer={handleRunPricer} ' +
      'isLoading={loadingByTrade[tradeId]} error={errorByTrade[tradeId]} /> ' +
      'at the top of the PRICING tab body.'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report and write
// ─────────────────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error('\n❌ Patch incomplete — the following anchors were not found:\n');
  errors.forEach(e => console.error('  ' + e));
  console.error('\nFile NOT modified. Fix anchors above and re-run, or apply manually.');
  process.exit(1);
}

if (src === original) {
  console.log('\nℹ No changes made (all patches already applied).');
  process.exit(0);
}

// Backup original
fs.writeFileSync(FILE + '.bak', original, 'utf8');
fs.writeFileSync(FILE, src, 'utf8');
console.log('\n✓ TradeWorkspace.jsx patched successfully.');
console.log('  Backup saved to TradeWorkspace.jsx.bak');
console.log('\nNext steps:');
console.log('  1. npm run dev — check for compile errors');
console.log('  2. Open a trade → PRICING tab → verify CurveInputPanel renders');
console.log('  3. Try FLAT mode → RUN PRICER → confirm NPV result');
console.log('  4. Switch to MARKET mode → enter pillar quotes → RUN PRICER');
