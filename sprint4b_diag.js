// sprint4b_diag.js — read NTW sections needed for IR options restructure
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4b_diag.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const NTW  = path.join(ROOT, 'frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx');

if (!fs.existsSync(NTW)) { console.error('NTW not found'); process.exit(1); }
const src   = fs.readFileSync(NTW, 'utf8');
const lines = src.split('\n');

function section(label, from, to) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(label);
  console.log('═'.repeat(60));
  lines.slice(from - 1, to).forEach((l, i) => console.log(`L${from+i}: ${l}`));
}

function grep(label, terms) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(label);
  console.log('═'.repeat(60));
  lines.forEach((l, i) => {
    if (terms.some(t => l.includes(t))) console.log(`L${i+1}: ${l}`);
  });
}

// 1. INSTRUMENTS object (asset class → instrument list)
grep('INSTRUMENTS object', ['INSTRUMENTS', "RATES:", "FX:", "CREDIT:", "EQUITY:", "COMMODITY:"]);

// 2. Instrument dropdown JSX — how the select is rendered
grep('Instrument select JSX', ['ntw-instrument', '<select', 'onChange={e=>changeIT', 'optgroup', '<option']);

// 3. Existing premium fields in LD (leg defaults) and option templates
grep('Premium fields in LD/templates', ['premium', 'PREMIUM', 'premium_date', 'premium_currency']);

// 4. LegForm switch — what renders for each instrument type
{
  const start = lines.findIndex(l => l.includes('function LegForm'));
  if (start >= 0) {
    console.log(`\n${'═'.repeat(60)}\nLegForm function (L${start+1} + 120 lines)\n${'═'.repeat(60)}`);
    lines.slice(start, start + 120).forEach((l, i) => console.log(`L${start+i+1}: ${l}`));
  }
}

// 5. IR_SWAPTION and CAP_FLOOR form rendering
{
  const terms = ['IR_SWAPTION', 'CAP_FLOOR', 'BERMUDAN', 'CALLABLE', 'SwaptionForm', 'CapFloorForm', 'OptionForm'];
  grep('Swaption/Cap form references', terms);
}

// 6. FloatForm embedded optionality section
{
  const start = lines.findIndex(l => l.includes('function FloatForm'));
  if (start >= 0) {
    console.log(`\n${'═'.repeat(60)}\nFloatForm (L${start+1} + 60 lines)\n${'═'.repeat(60)}`);
    lines.slice(start, start + 60).forEach((l, i) => console.log(`L${start+i+1}: ${l}`));
  }
}
