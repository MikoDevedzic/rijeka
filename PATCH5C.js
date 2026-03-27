// PATCH5C.js — adds CurveInputPanel import, then re-runs all patches
// Replaces PATCH5B.js entirely — fresh filename to avoid cache

const fs = require('fs');
const FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeWorkspace.jsx';

let src = fs.readFileSync(FILE, 'utf8');
const original = src;
const errors = [];

if (src.includes('CurveInputPanel')) {
  console.log('Already patched.'); process.exit(0);
}

function patch(label, search, replacement) {
  if (!src.includes(search)) {
    errors.push('NOT FOUND: ' + label + '\n  -> ' + JSON.stringify(search.slice(0,80)));
    return;
  }
  src = src.replace(search, replacement);
  console.log('  v ' + label);
}

// 1. Import — uses exact string from findstr output
patch('CurveInputPanel import',
  "import usePricerStore, { fmtCcy, fmtBps, fmtPct } from '../../store/usePricerStore'",
  "import CurveInputPanel from './CurveInputPanel';\nimport usePricerStore, { fmtCcy, fmtBps, fmtPct } from '../../store/usePricerStore'"
);

// 2. curveInputs useState -> store wiring
patch('curveInputs useState',
  "  const [curveInputs, setCurveInputs] = useState(() =>\n    curveIds.map(id => ({ curve_id: id, flat_rate: '0.0525' }))\n  )",
  "  const { initCurveState, buildCurveInputs } = usePricerStore()\n  React.useEffect(() => { initCurveState(curveIds) }, [curveIds.join(',')]) // eslint-disable-line"
);

// 3. handleRateChange (non-fatal)
const ha = "  const handleRateChange = (curve_id, val) => {\n    setCurveInputs(prev => prev.map(c => c.curve_id === curve_id ? { ...c, flat_rate: val } : c))\n  }";
if (src.includes(ha)) { src = src.replace(ha, ''); console.log('  v remove handleRateChange'); }

// 4. parsed construction
patch('parsed = buildCurveInputs',
  "    const parsed = curveInputs.map(c => ({ curve_id: c.curve_id, flat_rate: parseFloat(c.flat_rate) }))",
  "    const parsed = buildCurveInputs(curveIds)"
);

// 5. JSX block -> CurveInputPanel
const mapStart = '{curveInputs.map(c => (';
const mapIdx = src.indexOf(mapStart);
if (mapIdx === -1) {
  errors.push('NOT FOUND: curveInputs.map JSX');
} else {
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
    errors.push('NOT FOUND: RUN PRICER button close');
  } else {
    const lineStart = src.lastIndexOf('\n', mapIdx) + 1;
    const indent = src.slice(lineStart, mapIdx).replace(/\S.*/, '');
    const panel = `<CurveInputPanel\n${indent}  curveIds={curveIds}\n${indent}  onRunPricer={handleRun}\n${indent}  isLoading={loading}\n${indent}  error={error}\n${indent}/>`;
    src = src.slice(0, mapIdx) + panel + src.slice(btnIdx + btnAnchor.length);
    console.log('  v JSX -> CurveInputPanel');
  }
}

if (errors.length) {
  console.error('\nFAILED:'); errors.forEach(e => console.error(e));
  process.exit(1);
}

fs.writeFileSync(FILE + '.bak', original, 'utf8');
fs.writeFileSync(FILE, src, 'utf8');
console.log('\nDone. TradeWorkspace.jsx updated. Backup at .bak');
console.log('Next: cd frontend && npm run dev');
