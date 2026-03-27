const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx';
let src = fs.readFileSync(filePath, 'utf8');

// ── 1. Add UUID generator at top of file (after imports) ──────────────────────
src = src.replace(
  `import './NewTradeWorkspace.css'`,
  `import './NewTradeWorkspace.css'

// ── UUID v4 generator (crypto API — no external dependency) ───────────────────
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ── Leg ref generator — human readable + UUID ─────────────────────────────────
function makeLegRef(tradeRef, legIdx) {
  return \`\${tradeRef}-L\${legIdx + 1}\`
}`
);

// ── 2. Update submit() to assign proper UUIDs and refs to each leg ────────────
src = src.replace(
  `    const terms={structure:instrument,legs:legs.map((l,i)=>({...l,leg_id:\`leg_\${i}\`})),cashflow_overrides:{},instrument_modifier:null,notional_exchange:notionalExchange}`,
  `    const terms={
      structure: instrument,
      legs: legs.map((l, i) => ({
        ...l,
        leg_id:  uuidv4(),                        // UUID — independently addressable
        leg_ref: makeLegRef(tradeRef, i),          // human readable: TRD-12345678-L1
        leg_seq: i,                                // ordinal position
        leg_hash: null,                            // Sprint 5: filled by confirmation engine
        booked_at: new Date().toISOString(),
      })),
      cashflow_overrides: {},
      cashflow_hashes: {},                         // Sprint 5: cashflow-level hashes
      instrument_modifier: null,
      notional_exchange: notionalExchange,
      trade_hash: null,                            // Sprint 5: filled by confirmation engine
    }`
);

fs.writeFileSync(filePath, src, 'utf8');
console.log('✅  Leg UUID patch complete.');
console.log('');
console.log('Each leg now gets at booking time:');
console.log('  leg_id:     crypto.randomUUID() — e.g. 550e8400-e29b-41d4-a716-446655440000');
console.log('  leg_ref:    TRD-12345678-L1, TRD-12345678-L2 (human readable)');
console.log('  leg_seq:    0, 1, 2... (ordinal position)');
console.log('  leg_hash:   null (Sprint 5 — confirmation engine fills this)');
console.log('  booked_at:  ISO timestamp of when leg was booked');
console.log('');
console.log('Trade terms also gets:');
console.log('  cashflow_hashes: {} (Sprint 5)');
console.log('  trade_hash:      null (Sprint 5)');
console.log('');
console.log('All stored in JSONB — no schema change needed.');
console.log('Sprint 3: cashflows table with leg_id FK');
console.log('Sprint 5: hashing layer for blockchain confirmations');
