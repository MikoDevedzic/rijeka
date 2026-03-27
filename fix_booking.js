const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

// ── Fix 1: useTradesStore — generate UUID client-side on insert ───────────────
const storePath = path.join(ROOT, 'store', 'useTradesStore.js');
let store = fs.readFileSync(storePath, 'utf8');

store = store.replace(
  `  addTrade: async (trade) => {
    const { data, error } = await supabase
      .from('trades')
      .insert([trade])`,
  `  addTrade: async (trade) => {
    // Generate UUID client-side — Supabase free tier may not have gen_random_uuid() default
    const id = crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })
    const { data, error } = await supabase
      .from('trades')
      .insert([{ ...trade, id }])`
);

fs.writeFileSync(storePath, store, 'utf8');
console.log('✅  useTradesStore.js — UUID generated client-side on insert');

// ── Fix 2: NewTradeWorkspace — fix all unformatted default notionals ──────────
const ntwPath = path.join(ROOT, 'components', 'blotter', 'NewTradeWorkspace.jsx');
let ntw = fs.readFileSync(ntwPath, 'utf8');

// Replace ALL occurrences of unformatted notional defaults in the LD object
const fixes = [
  // All the notional:'10000000' and notional: '10000000' variants
  [`notional:'10000000'`,   `notional:'10,000,000'`],
  [`notional: '10000000'`,  `notional: '10,000,000'`],
  // The ones that are set via spread with a default param
  [`notional='10000000'`,   `notional='10,000,000'`],
  // Vega notional placeholder
  [`placeholder="100,000"`, `placeholder="100,000"`], // already fine, skip
];

fixes.forEach(([from, to]) => {
  ntw = ntw.split(from).join(to);
});

// Nuclear option — replace ALL remaining bare 10000000 in notional context
ntw = ntw.replace(/notional:'10000000'/g, `notional:'10,000,000'`);
ntw = ntw.replace(/notional: '10000000'/g, `notional: '10,000,000'`);
ntw = ntw.replace(/'10000000'/g, `'10,000,000'`);

fs.writeFileSync(ntwPath, ntw, 'utf8');
console.log('✅  NewTradeWorkspace.jsx — all default notionals formatted as 10,000,000');

console.log('\nNow try booking a trade — should work.');
