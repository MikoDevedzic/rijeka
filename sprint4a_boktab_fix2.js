// sprint4a_boktab_fix2.js
const fs   = require('fs');
const path = require('path');
const FILE = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\components\\blotter\\BookTab.jsx');

let src = fs.readFileSync(FILE, 'utf8');

// The broken state: TH never closed, new th injected inside it
const BAD = `              <TH col="instrument_type" label="INSTRUMENT"\n              <th className="col-structure">STRUCTURE</th/>`;
const GOOD = `              <TH col="instrument_type" label="INSTRUMENT"/>\n              <th className="col-structure">STRUCTURE</th>`;

if (src.includes(BAD)) {
  src = src.replace(BAD, GOOD);
  fs.writeFileSync(FILE, src, 'utf8');
  console.log('✓ Fixed: TH closed correctly, STRUCTURE th on own line');
} else {
  console.error('✗ Pattern not found — raw chars around col-structure:');
  const i = src.indexOf('col-structure');
  if (i >= 0) console.log(JSON.stringify(src.substring(i - 60, i + 80)));
}
