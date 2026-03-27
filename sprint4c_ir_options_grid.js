// sprint4c_ir_options_grid.js
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4c_ir_options_grid.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const NTW  = path.join(ROOT, 'frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx');
const CSS  = path.join(ROOT, 'frontend\\src\\index.css');

let ok = 0, fail = 0;

function swap(filePath, anchor, replacement, label) {
  let src = fs.readFileSync(filePath, 'utf8');
  if (!src.includes(anchor)) {
    console.error(`  ✗ Anchor not found: ${label}`);
    console.error(`    ${JSON.stringify(anchor.substring(0,80))}`);
    fail++; return;
  }
  fs.writeFileSync(filePath, src.replace(anchor, replacement), 'utf8');
  console.log(`  ✓ ${label}`);
  ok++;
}

// ── 1. IR_OPTIONS_ITEMS constant + changeIT update ───────────────────────────
console.log('\n[1/3] Add IR_OPTIONS_ITEMS + wire changeIT');

// Add constant right after INSTRUMENT_GROUPS closing brace (L78 `}`)
// Anchor: end of INSTRUMENT_GROUPS block
swap(NTW,
  `// Display labels for instrument types (underscores → spaces, aliases)`,
  `// IR OPTIONS quick-switch set (mirrors INSTRUMENT_GROUPS.RATES[1].items)
const IR_OPTIONS_ITEMS = [
  { value: 'IR_SWAPTION',          label: 'IR SWAPTION',  desc: 'European / American exercise' },
  { value: 'BERMUDAN_SWAPTION',    label: 'BERMUDAN',     desc: 'Bermudan exercise schedule'   },
  { value: 'INTEREST_RATE_CAP',    label: 'CAP',          desc: 'Rate ceiling — pays if above strike' },
  { value: 'INTEREST_RATE_FLOOR',  label: 'FLOOR',        desc: 'Rate floor — pays if below strike'   },
  { value: 'INTEREST_RATE_COLLAR', label: 'COLLAR',       desc: 'Cap + floor combined'         },
]
const IR_OPTIONS_SET = new Set(IR_OPTIONS_ITEMS.map(x => x.value))

// Display labels for instrument types (underscores → spaces, aliases)`,
  'Added IR_OPTIONS_ITEMS + IR_OPTIONS_SET constants'
);

// ── 2. Inject IrOptionsGrid JSX after STRUCTURE selector block ───────────────
console.log('\n[2/3] Inject IR options quick-switch grid JSX');

// Anchor: the legs.map line that follows the structure selector
swap(NTW,
  `        {legs.map((leg,i)=><LegCard key={i} leg={leg} legIdx={i} legs={legs} setLegs={setLegs}/>)}`,
  `        {/* Sprint 4C: IR OPTIONS quick-switch grid */}
        {IR_OPTIONS_SET.has(instrument) && (
          <div className="structure-selector" style={{marginBottom:'14px'}}>
            <label className="structure-selector__label">IR OPTIONS</label>
            <div className="structure-selector__grid" style={{gridTemplateColumns:'repeat(5,1fr)'}}>
              {IR_OPTIONS_ITEMS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={\`structure-btn\${instrument === opt.value ? ' structure-btn--active' : ''}\`}
                  onClick={() => changeIT(opt.value)}
                  title={opt.desc}
                >
                  <span className="structure-btn__label">{opt.label}</span>
                  <span className="structure-btn__desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {legs.map((leg,i)=><LegCard key={i} leg={leg} legIdx={i} legs={legs} setLegs={setLegs}/>)}`,
  'Injected IR options quick-switch grid before legs.map'
);

// ── 3. CSS — tighten structure-btn__desc for 5-column layout ────────────────
console.log('\n[3/3] CSS — ensure 5-col grid desc text stays readable');

{
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes('structure-btn__desc--compact')) {
    css += `
/* Sprint 4C: 5-col IR options grid — tighter desc text */
.structure-selector__grid.grid-5col .structure-btn__desc {
  font-size: 9px;
  line-height: 1.3;
}
`;
    fs.writeFileSync(CSS, css, 'utf8');
    console.log('  ✓ Appended 5-col grid CSS');
    ok++;
  } else {
    console.log('  ℹ CSS already present');
    ok++;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`Sprint 4C complete: ${ok} passed, ${fail} failed`);
if (fail === 0) {
  console.log('\n✅ Verify in browser:');
  console.log('   1. Select IR SWAPTION from dropdown');
  console.log('   2. Grid appears: IR SWAPTION | BERMUDAN | CAP | FLOOR | COLLAR');
  console.log('   3. Click CAP → legs reload to CAP_FLOOR leg, PREMIUM section stays');
  console.log('   4. IR SWAP shows STRUCTURE grid, IR OPTIONS shows OPTIONS grid');
  console.log('   5. FRA shows neither grid');
} else {
  console.log('\n⚠  Fix ✗ items and re-run.');
}
console.log('─'.repeat(60));
