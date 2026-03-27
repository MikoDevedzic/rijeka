// sprint4a_diag2.js — NTW deeper scan
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4a_diag2.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const p    = (...x) => path.join(ROOT, ...x);

const NTW = p('frontend/src/components/blotter/NewTradeWorkspace.jsx');

if (!fs.existsSync(NTW)) { console.log('NTW NOT FOUND'); process.exit(1); }

const src   = fs.readFileSync(NTW, 'utf8');
const lines = src.split('\n');

console.log(`Total lines: ${lines.length}`);

// Print ALL lines containing key terms
const terms = ['useState', 'use(', 'const [', 'TEMPLATES', 'setLegs', 'legs,', 'legs ]',
               'instrument', 'formData', 'formState', 'selectedInstr', 'structur',
               'function New', 'export default', 'export function'];

console.log('\n── Key lines ──────────────────────────────────────────────');
lines.forEach((l, i) => {
  if (terms.some(t => l.includes(t))) console.log(`L${i+1}: ${l}`);
});

// Print lines 120-350 raw (function body start)
console.log('\n── L120–350 raw ────────────────────────────────────────────');
lines.slice(119, 350).forEach((l, i) => console.log(`L${120+i}: ${l}`));
