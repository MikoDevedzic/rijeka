// sprint4a_boktab_fix.js
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4a_boktab_fix.js

const fs   = require('fs');
const path = require('path');
const FILE = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\components\\blotter\\BookTab.jsx');

let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('<th className="col-structure">STRUCTURE</th/>')) {
  src = src.replace('<th className="col-structure">STRUCTURE</th/>', '<th className="col-structure">STRUCTURE</th>');
  fs.writeFileSync(FILE, src, 'utf8');
  console.log('✓ Fixed: </th/> → </th>');
} else if (src.includes('<th className="col-structure">STRUCTURE</th>')) {
  console.log('ℹ Already correct — no change needed');
} else {
  console.error('✗ Neither pattern found — print lines 130-140:');
  src.split('\n').slice(129,141).forEach((l,i) => console.log(`L${130+i}: ${l}`));
}
