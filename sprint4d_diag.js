// sprint4d_diag.js
const fs   = require('fs');
const path = require('path');
const NTW  = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx');
const CSS  = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\index.css');
const src   = fs.readFileSync(NTW, 'utf8');
const lines = src.split('\n');

function section(label, from, to) {
  console.log(`\n${'═'.repeat(60)}\n${label}\n${'═'.repeat(60)}`);
  lines.slice(from-1, to).forEach((l,i) => console.log(`L${from+i}: ${l}`));
}

// 1. LegCard component full
{
  const start = lines.findIndex(l => l.includes('function LegCard'));
  section('LegCard full', start+1, start+40);
}

// 2. legs.map render call
{
  const idx = lines.findIndex(l => l.includes('legs.map((leg,i)=><LegCard'));
  section('legs.map render', idx+1, idx+5);
}

// 3. ntw-body CSS in index.css
{
  const css = fs.readFileSync(CSS, 'utf8').split('\n');
  console.log(`\n${'═'.repeat(60)}\nindex.css — ntw / leg-card classes\n${'═'.repeat(60)}`);
  css.forEach((l,i) => {
    if (l.includes('ntw') || l.includes('leg-card') || l.includes('leg-body') || l.includes('leg-hdr'))
      console.log(`L${i+1}: ${l}`);
  });
}
