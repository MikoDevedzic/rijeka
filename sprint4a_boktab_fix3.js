// sprint4a_boktab_fix3.js
const fs   = require('fs');
const path = require('path');
const FILE = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\components\\blotter\\BookTab.jsx');

let src = fs.readFileSync(FILE, 'utf8');

// Raw chars confirmed: the original <TH.../> was split by the patch.
// The /> from the original self-close is now stranded after </th>
// Actual file content at L134-135:
//   <TH col="instrument_type" label="INSTRUMENT"
//               <th className="col-structure">STRUCTURE</th>/>
//
// The fix: restore TH self-close, put STRUCTURE th on its own clean line.

const BAD  = '<TH col="instrument_type" label="INSTRUMENT"\n              <th className="col-structure">STRUCTURE</th>/>';
const GOOD = '<TH col="instrument_type" label="INSTRUMENT"/>\n              <th className="col-structure">STRUCTURE</th>';

if (src.includes(BAD)) {
  src = src.replace(BAD, GOOD);
  fs.writeFileSync(FILE, src, 'utf8');
  console.log('✓ Fixed');

  // Verify
  const lines = src.split('\n');
  console.log('\nL133-137 after fix:');
  lines.slice(132, 137).forEach((l, i) => console.log(`  L${133+i}: ${l}`));
} else {
  // Print exactly what's there so we can see the real bytes
  const i = src.indexOf('col-structure');
  if (i < 0) { console.error('col-structure not found at all'); process.exit(1); }

  console.log('BAD pattern not matched. Actual bytes around col-structure:');
  console.log('  ' + JSON.stringify(src.substring(i - 80, i + 80)));

  // Try a broader replace: find everything between INSTRUMENT" and <th>COUNTERPARTY
  // and replace it with the correct form
  const RE = /(<TH col="instrument_type" label="INSTRUMENT")[^<]*(<th className="col-structure">STRUCTURE<\/th>)[^<]*/;
  if (RE.test(src)) {
    src = src.replace(RE, '$1/>\n              $2');
    fs.writeFileSync(FILE, src, 'utf8');
    console.log('✓ Fixed via regex fallback');
    const lines = src.split('\n');
    console.log('\nL133-137 after fix:');
    lines.slice(132, 137).forEach((l, i) => console.log(`  L${133+i}: ${l}`));
  } else {
    console.error('Regex fallback also failed — paste the JSON output above back to Claude');
  }
}
