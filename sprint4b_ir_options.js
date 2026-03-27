// sprint4b_ir_options.js — IR options restructure + installment premium
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4b_ir_options.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const NTW  = path.join(ROOT, 'frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx');

if (!fs.existsSync(NTW)) { console.error('NTW not found'); process.exit(1); }
let src = fs.readFileSync(NTW, 'utf8');

let ok = 0, fail = 0;

function swap(anchor, replacement, label) {
  if (!src.includes(anchor)) {
    console.error(`  ✗ Anchor not found: ${label}`);
    console.error(`    ${JSON.stringify(anchor.substring(0,80))}`);
    fail++; return false;
  }
  src = src.replace(anchor, replacement);
  console.log(`  ✓ ${label}`);
  ok++; return true;
}

function swapRx(rx, replacement, label) {
  if (!rx.test(src)) {
    console.error(`  ✗ Regex not matched: ${label}`);
    fail++; return false;
  }
  src = src.replace(rx, replacement);
  console.log(`  ✓ ${label}`);
  ok++; return true;
}

// ── 1. INSTRUMENTS.RATES — collapse swap variants, keep options + FRA ────────
console.log('\n[1/7] INSTRUMENTS.RATES restructure');

swapRx(
  /RATES:\s+\[[\s\S]*?'COLLARED_SWAP'\]/,
  `RATES: [
    // IR SWAP family (variants via STRUCTURE selector)
    'IR_SWAP',
    // Embedded-optionality swaps
    'CAPPED_SWAP','FLOORED_SWAP','COLLARED_SWAP',
    'CALLABLE_SWAP','CANCELLABLE_SWAP',
    // IR Options (standalone, upfront/installment premium)
    'IR_SWAPTION','BERMUDAN_SWAPTION',
    'INTEREST_RATE_CAP','INTEREST_RATE_FLOOR','INTEREST_RATE_COLLAR',
    // Other
    'FRA',
  ]`,
  'Collapsed swap variants; kept embedded-optionality swaps + IR options + FRA'
);

// ── 2. INSTRUMENT_GROUPS — add after INSTRUMENTS closing brace ───────────────
console.log('\n[2/7] Add INSTRUMENT_GROUPS');

swap(
  `const AC_COLOR = { RATES:'var(--accent)', FX:'var(--blue)', CREDIT:'var(--amber)', EQUITY:'var(--purple)', COMMODITY:'var(--red)' }`,
  `const AC_COLOR = { RATES:'var(--accent)', FX:'var(--blue)', CREDIT:'var(--amber)', EQUITY:'var(--purple)', COMMODITY:'var(--red)' }

// Optgroup buckets for dropdown — RATES only for now
const INSTRUMENT_GROUPS = {
  RATES: [
    {
      group: 'IR SWAP',
      items: ['IR_SWAP','CAPPED_SWAP','FLOORED_SWAP','COLLARED_SWAP','CALLABLE_SWAP','CANCELLABLE_SWAP'],
      hint:  'Variants (OIS/BASIS/XCCY etc) via STRUCTURE selector on IR SWAP',
    },
    {
      group: 'IR OPTIONS',
      items: ['IR_SWAPTION','BERMUDAN_SWAPTION','INTEREST_RATE_CAP','INTEREST_RATE_FLOOR','INTEREST_RATE_COLLAR'],
      hint:  'Standalone options with upfront, installment, deferred or contingent premium',
    },
    {
      group: 'OTHER RATES',
      items: ['FRA'],
      hint:  '',
    },
  ],
}

// Display labels for instrument types (underscores → spaces, aliases)
const INSTR_LABEL = {
  IR_SWAP:              'IR SWAP',
  CAPPED_SWAP:          'CAPPED SWAP',
  FLOORED_SWAP:         'FLOORED SWAP',
  COLLARED_SWAP:        'COLLARED SWAP',
  CALLABLE_SWAP:        'CALLABLE SWAP',
  CANCELLABLE_SWAP:     'CANCELLABLE SWAP',
  IR_SWAPTION:          'IR SWAPTION',
  BERMUDAN_SWAPTION:    'BERMUDAN SWAPTION',
  INTEREST_RATE_CAP:    'INTEREST RATE CAP',
  INTEREST_RATE_FLOOR:  'INTEREST RATE FLOOR',
  INTEREST_RATE_COLLAR: 'INTEREST RATE COLLAR',
  FRA:                  'FRA',
  FX_FORWARD:           'FX FORWARD',
  FX_SWAP:              'FX SWAP',
  NDF:                  'NDF',
  FX_OPTION:            'FX OPTION',
  FX_DIGITAL_OPTION:    'FX DIGITAL OPTION',
  EXTENDABLE_FORWARD:   'EXTENDABLE FORWARD',
  CDS:                  'CDS',
  CDS_INDEX:            'CDS INDEX',
  TOTAL_RETURN_SWAP:    'TOTAL RETURN SWAP',
  ASSET_SWAP:           'ASSET SWAP',
  RISK_PARTICIPATION:   'RISK PARTICIPATION',
  CDS_OPTION:           'CDS OPTION',
  EQUITY_SWAP:          'EQUITY SWAP',
  VARIANCE_SWAP:        'VARIANCE SWAP',
  DIVIDEND_SWAP:        'DIVIDEND SWAP',
  EQUITY_FORWARD:       'EQUITY FORWARD',
  EQUITY_OPTION:        'EQUITY OPTION',
  COMMODITY_SWAP:       'COMMODITY SWAP',
  COMMODITY_BASIS_SWAP: 'COMMODITY BASIS SWAP',
  ASIAN_COMMODITY_SWAP: 'ASIAN COMMODITY SWAP',
  EMISSIONS_SWAP:       'EMISSIONS SWAP',
  COMMODITY_OPTION:     'COMMODITY OPTION',
  COMMODITY_ASIAN_OPTION:'COMMODITY ASIAN OPTION',
}`,
  'Added INSTRUMENT_GROUPS + INSTR_LABEL display map'
);

// ── 3. changeAc — first instrument via INSTRUMENT_GROUPS if available ────────
console.log('\n[3/7] Update changeAc');

swap(
  `  const changeAc=(a)=>{setAc(a);const it=INSTRUMENTS[a][0];setInstrument(it);setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)())}`,
  `  const changeAc=(a)=>{
    setAc(a)
    const grp = INSTRUMENT_GROUPS[a]
    const it  = grp ? grp[0].items[0] : INSTRUMENTS[a][0]
    setInstrument(it)
    if(it!=='IR_SWAP') setSelectedStructure('VANILLA')
    setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)())
  }`,
  'changeAc uses INSTRUMENT_GROUPS[a][0].items[0] for grouped ACs'
);

// ── 4. Instrument dropdown JSX — optgroups for RATES ────────────────────────
console.log('\n[4/7] Instrument dropdown → optgroups');

swap(
  `              {(INSTRUMENTS[ac]||[]).map(it=><option key={it}>{it}</option>)}`,
  `              {INSTRUMENT_GROUPS[ac]
                ? INSTRUMENT_GROUPS[ac].map(g=>(
                    <optgroup key={g.group} label={\`── \${g.group} ──\`}>
                      {g.items.map(it=><option key={it} value={it}>{INSTR_LABEL[it]||it.replace(/_/g,' ')}</option>)}
                    </optgroup>
                  ))
                : (INSTRUMENTS[ac]||[]).map(it=><option key={it} value={it}>{INSTR_LABEL[it]||it.replace(/_/g,' ')}</option>)
              }`,
  'Instrument dropdown uses optgroups for RATES, plain options for others'
);

// ── 5. Add PremiumSection component — before IrSwaptionForm ─────────────────
console.log('\n[5/7] Add PremiumSection component');

swap(
  `function IrSwaptionForm({leg,set}) {`,
  `// ── Sprint 4B: PremiumSection ────────────────────────────────────────────────
// Handles UPFRONT | INSTALLMENT | DEFERRED | CONTINGENT premium structures.
// Used by all IR/FX/Equity/Commodity/CDS option forms.
function PremiumSection({leg,set}) {
  const type = leg.premium_type || 'UPFRONT'
  return (<>
    <div className="sec-lbl">PREMIUM</div>
    <div className="row2">
      <div className="fg"><label>PREMIUM TYPE</label>
        <select value={type} onChange={e=>set('premium_type',e.target.value)}>
          <option value="UPFRONT">UPFRONT — single date</option>
          <option value="INSTALLMENT">INSTALLMENT — periodic payments</option>
          <option value="DEFERRED">DEFERRED — paid at expiry</option>
          <option value="CONTINGENT">CONTINGENT — only if ITM</option>
        </select>
      </div>
      <div className="fg"><label>PREMIUM CCY</label>
        <select value={leg.premium_currency||'USD'} onChange={e=>set('premium_currency',e.target.value)}>
          {CCYS.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>
    </div>

    {type==='UPFRONT'&&(
      <div className="row2">
        <div className="fg"><label>PREMIUM AMOUNT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg"><label>PREMIUM DATE</label>
          <input type="date" value={leg.premium_date||''} onChange={e=>set('premium_date',e.target.value)}/>
        </div>
      </div>
    )}

    {type==='INSTALLMENT'&&(<>
      <div className="row2">
        <div className="fg"><label>AMOUNT PER INSTALLMENT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg"><label>FREQUENCY</label>
          <select value={leg.premium_frequency||'MONTHLY'} onChange={e=>set('premium_frequency',e.target.value)}>
            {FREQS.map(f=><option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <div className="row2">
        <div className="fg"><label>FIRST PAYMENT</label>
          <input type="date" value={leg.premium_date||''} onChange={e=>set('premium_date',e.target.value)}/>
        </div>
        <div className="fg"><label>LAST PAYMENT</label>
          <input type="date" value={leg.premium_last_date||''} onChange={e=>set('premium_last_date',e.target.value)}/>
        </div>
      </div>
      <div style={{fontSize:'0.6rem',color:'var(--text-dim)',marginBottom:'0.5rem',lineHeight:1.6}}>
        Installment option: if buyer misses a payment, option lapses and all prior premiums are forfeited.
        Total PV of installments = equivalent upfront premium.
      </div>
    </>)}

    {type==='DEFERRED'&&(
      <div className="row2">
        <div className="fg"><label>PREMIUM AMOUNT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg" style={{display:'flex',alignItems:'flex-end',paddingBottom:'0.4rem'}}>
          <span style={{fontSize:'0.6rem',color:'var(--text-dim)',lineHeight:1.5}}>
            Paid at expiry regardless of whether the option is exercised.
          </span>
        </div>
      </div>
    )}

    {type==='CONTINGENT'&&(
      <div className="row2">
        <div className="fg"><label>PREMIUM AMOUNT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg" style={{display:'flex',alignItems:'flex-end',paddingBottom:'0.4rem'}}>
          <span style={{fontSize:'0.6rem',color:'var(--text-dim)',lineHeight:1.5}}>
            Only paid if option expires in-the-money. Higher amount than equivalent upfront.
          </span>
        </div>
      </div>
    )}
  </>)
}

function IrSwaptionForm({leg,set}) {`,
  'Added PremiumSection component before IrSwaptionForm'
);

// ── 6. Replace premium blocks in all option forms with <PremiumSection/> ────
console.log('\n[6/7] Wire PremiumSection into option forms');

// The premium block pattern used in IrSwaptionForm (L1034-1038):
const OLD_PREMIUM_BLOCK_1 = `      <div className="sec-lbl">PREMIUM</div>
      <div className="row2">
        <div className="fg"><label>PREMIUM AMOUNT</label><input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/></div>
        <div className="fg"><label>PREMIUM CCY</label><select value={leg.premium_currency||'USD'} onChange={e=>set('premium_currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
        <div className="fg"><label>PREMIUM DATE</label><input type="date" value={leg.premium_date||''} onChange={e=>set('premium_date',e.target.value)}/></div>
      </div>`;

const NEW_PREMIUM_BLOCK = `      <PremiumSection leg={leg} set={set}/>`;

// Count occurrences
const count1 = src.split(OLD_PREMIUM_BLOCK_1).length - 1;
if (count1 > 0) {
  // Replace all occurrences (should be 1 for IrSwaptionForm; others may have different formats)
  src = src.split(OLD_PREMIUM_BLOCK_1).join(NEW_PREMIUM_BLOCK);
  console.log(`  ✓ Replaced ${count1} instance(s) of standard premium block`);
  ok++;
} else {
  console.error('  ✗ Standard premium block not found (L1034-1038 format)');
  // Try to find what's there
  const lines = src.split('\n');
  const idx = lines.findIndex(l => l.includes('sec-lbl">PREMIUM'));
  if (idx >= 0) {
    console.error('  Found PREMIUM label at L' + (idx+1) + ':');
    lines.slice(idx, idx+6).forEach((l,i) => console.error('    L'+(idx+i+1)+': '+l));
  }
  fail++;
}

// BermudanSwaptionForm premium — has same pattern but may differ slightly
// Check for any remaining old-style premium blocks
const OLD_PREM_RX = /<div className="sec-lbl">PREMIUM<\/div>\s*<div className="row2">\s*<div className="fg"><label>PREMIUM AMOUNT<\/label><input[^/]*\/><\/div>\s*<div className="fg"><label>PREMIUM CCY<\/label><select[^<]*<\/select><\/div>\s*<div className="fg"><label>PREMIUM DATE<\/label><input[^/]*\/><\/div>\s*<\/div>/g;
const remaining = (src.match(OLD_PREM_RX) || []).length;
if (remaining > 0) {
  src = src.replace(OLD_PREM_RX, `      <PremiumSection leg={leg} set={set}/>`);
  console.log(`  ✓ Replaced ${remaining} additional premium block(s) via regex`);
  ok++;
} else {
  console.log('  ℹ No additional premium blocks remaining');
  ok++;
}

// ── 7. Update LD option defaults — add premium_type + premium_frequency ──────
console.log('\n[7/7] Update option LD defaults');

// All option legs currently have: premium:'',premium_currency:'USD',premium_date:''
// Add: premium_type:'UPFRONT',premium_frequency:'',premium_last_date:''
const OLD_PREM_DEFAULTS = `premium:'',premium_currency:'USD',premium_date:''`;
const NEW_PREM_DEFAULTS  = `premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:''`;

const defaultCount = src.split(OLD_PREM_DEFAULTS).length - 1;
if (defaultCount > 0) {
  src = src.split(OLD_PREM_DEFAULTS).join(NEW_PREM_DEFAULTS);
  console.log(`  ✓ Updated ${defaultCount} option LD default(s) — added premium_type/frequency/last_date`);
  ok++;
} else {
  console.error('  ✗ Could not find premium defaults pattern — check LD objects manually');
  fail++;
}

// ── Write & report ────────────────────────────────────────────────────────────
fs.writeFileSync(NTW, src, 'utf8');

console.log('\n' + '─'.repeat(60));
console.log(`Sprint 4B complete: ${ok} passed, ${fail} failed`);
if (fail === 0) {
  console.log('\n✅ All changes applied. Steps:');
  console.log('   1. Frontend already running — Vite will hot-reload');
  console.log('   2. Open NEW TRADE → RATES → dropdown should show 3 optgroups');
  console.log('      ── IR SWAP ──  /  ── IR OPTIONS ──  /  ── OTHER RATES ──');
  console.log('   3. Select IR SWAPTION → PREMIUM section shows TYPE selector');
  console.log('   4. Switch to INSTALLMENT → verify frequency + first/last date fields');
  console.log('   5. Verify IR SWAP still shows STRUCTURE grid');
  console.log('   6. Verify OIS/BASIS/XCCY/etc no longer in dropdown (use STRUCTURE instead)');
} else {
  console.log('\n⚠  Fix ✗ items and re-run.');
}
console.log('─'.repeat(60));
