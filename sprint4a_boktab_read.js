// sprint4a_boktab_read.js
const fs   = require('fs');
const path = require('path');
const FILE = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\components\\blotter\\BookTab.jsx');

const lines = fs.readFileSync(FILE, 'utf8').split('\n');

// Print L128-L142
console.log('── BookTab.jsx L128-L145 ──');
lines.slice(127, 145).forEach((l, i) => {
  // Show invisible chars as hex
  const safe = l.replace(/[^\x20-\x7e]/g, c => `\\x${c.charCodeAt(0).toString(16)}`);
  console.log(`L${128+i}: ${safe}`);
});

// Also show exact char codes around the problem area
const src = fs.readFileSync(FILE, 'utf8');
const idx = src.indexOf('col-structure');
if (idx >= 0) {
  console.log('\n── Raw chars around col-structure ──');
  console.log(JSON.stringify(src.substring(idx - 5, idx + 60)));
}
