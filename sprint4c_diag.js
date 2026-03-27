// sprint4c_diag.js
const fs   = require('fs');
const path = require('path');
const NTW  = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx');
const src   = fs.readFileSync(NTW, 'utf8');
const lines = src.split('\n');

function grep(label, terms) {
  console.log(`\n${'═'.repeat(60)}\n${label}\n${'═'.repeat(60)}`);
  lines.forEach((l, i) => { if (terms.some(t => l.includes(t))) console.log(`L${i+1}: ${l}`); });
}

// 1. IrSwapStructureSelector JSX injection point (how the structure grid is wired)
grep('Structure selector JSX in render', ['IrSwapStructureSelector','instrument===','instrument ===','STRUCTURE selector']);

// 2. Instrument dropdown + surrounding JSX (ntw-instrument-row area)
{
  const start = lines.findIndex(l => l.includes('ntw-instrument-row'));
  console.log(`\n${'═'.repeat(60)}\nntw-instrument-row region\n${'═'.repeat(60)}`);
  if (start >= 0) lines.slice(start, start + 30).forEach((l,i) => console.log(`L${start+i+1}: ${l}`));
}

// 3. IrSwapStructures import line
grep('IrSwapStructures import', ['IrSwapStructures','IrSwapStructureSelector']);

// 4. INSTRUMENT_GROUPS definition (first few lines)
{
  const start = lines.findIndex(l => l.includes('INSTRUMENT_GROUPS'));
  console.log(`\n${'═'.repeat(60)}\nINSTRUMENT_GROUPS\n${'═'.repeat(60)}`);
  if (start >= 0) lines.slice(start, start + 30).forEach((l,i) => console.log(`L${start+i+1}: ${l}`));
}
