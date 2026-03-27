// sprint4a_diag.js — read failing files and print exact anchors
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4a_diag.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const p    = (...x) => path.join(ROOT, ...x);

function show(label, filePath, patterns) {
  console.log('\n' + '═'.repeat(60));
  console.log(label);
  console.log('═'.repeat(60));
  const full = p(filePath);
  if (!fs.existsSync(full)) { console.log('  FILE NOT FOUND'); return; }
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  patterns.forEach(pat => {
    lines.forEach((l, i) => {
      if (l.includes(pat)) console.log(`  L${i+1}: ${l}`);
    });
  });
}

// 1. models.py — find Trade class + instrument_type
show('backend/db/models.py — Trade class', 'backend/db/models.py',
  ['class Trade', 'instrument_type', 'Column(', 'tablename']);

// 2. useTradesStore.js — full addTrade function
{
  const filePath = p('frontend/src/store/useTradesStore.js');
  console.log('\n' + '═'.repeat(60));
  console.log('useTradesStore.js — addTrade function body');
  console.log('═'.repeat(60));
  if (fs.existsSync(filePath)) {
    const src = fs.readFileSync(filePath, 'utf8');
    // Find addTrade start and print 60 lines from there
    const lines = src.split('\n');
    const start = lines.findIndex(l => l.includes('addTrade'));
    if (start >= 0) {
      lines.slice(start, start + 80).forEach((l, i) =>
        console.log(`  L${start+i+1}: ${l}`)
      );
    } else {
      console.log('  addTrade not found — printing first 100 lines');
      lines.slice(0, 100).forEach((l, i) => console.log(`  L${i+1}: ${l}`));
    }
  } else console.log('  FILE NOT FOUND');
}

// 3. BookTab.jsx — trade row rendering (td cells near instrument)
{
  const filePath = p('frontend/src/components/blotter/BookTab.jsx');
  console.log('\n' + '═'.repeat(60));
  console.log('BookTab.jsx — rows region (lines around instrument_type)');
  console.log('═'.repeat(60));
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const hits = lines
      .map((l, i) => ({ i, l }))
      .filter(x => x.l.includes('instrument') || x.l.includes('<td') || x.l.includes('trade_ref') || x.l.includes('trade.'));
    hits.slice(0, 60).forEach(x => console.log(`  L${x.i+1}: ${x.l}`));
  } else console.log('  FILE NOT FOUND');
}

// 4. NewTradeWorkspace.jsx — useState declarations + TEMPLATES usage (lines 60-250)
{
  const filePath = p('frontend/src/components/blotter/NewTradeWorkspace.jsx');
  console.log('\n' + '═'.repeat(60));
  console.log('NewTradeWorkspace.jsx — useState + TEMPLATES region');
  console.log('═'.repeat(60));
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    lines.slice(60, 300).forEach((l, i) => {
      if (l.includes('useState') || l.includes('TEMPLATES') || l.includes('setLegs') ||
          l.includes('selectedInstrument') || l.includes('instrument_type') ||
          l.includes('formData') || l.includes('formState')) {
        console.log(`  L${60+i+1}: ${l}`);
      }
    });
  } else console.log('  FILE NOT FOUND');
}
