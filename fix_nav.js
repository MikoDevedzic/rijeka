const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

// ── Fix 1: CommandCenter.jsx — rename MARKET DATA tile to CONFIGURATIONS ──────
const ccPath = path.join(ROOT, 'components', 'CommandCenter.jsx');
let cc = fs.readFileSync(ccPath, 'utf8');

// Replace the MARKET DATA module tile label and sub-items
cc = cc
  .replace(/MARKET DATA/g, 'CONFIGURATIONS')
  .replace(/Curves · Surfaces · Fixings/g, 'Curves · Entities · Blotter');

fs.writeFileSync(ccPath, cc, 'utf8');
console.log('✅  CommandCenter.jsx — tile renamed to CONFIGURATIONS');

// ── Fix 2: CfgNav.jsx — section headers should look like labels, not buttons ─
const navPath = path.join(ROOT, 'components', 'layout', 'CfgNav.jsx');
let nav = fs.readFileSync(navPath, 'utf8');

// Replace the section button style block so headers are plain labels
nav = nav.replace(
  /style=\{\{\s*width: '100%',\s*background: 'none',\s*border: 'none',\s*padding: '0\.45rem 1rem',\s*display: 'flex',\s*alignItems: 'center',\s*justifyContent: 'space-between',\s*cursor: 'pointer',\s*fontFamily: 'var\(--mono\)',\s*fontSize: '0\.6rem',\s*fontWeight: 700,\s*letterSpacing: '0\.12em',\s*color: active \? 'var\(--accent\)' : 'var\(--text-dim\)',\s*transition: 'color 0\.15s',\s*\}\}/,
  `style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '0.45rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontFamily: 'var(--mono)',
                fontSize: '0.58rem',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: 'var(--text-dim)',
                transition: 'color 0.15s',
              }}`
);

fs.writeFileSync(navPath, nav, 'utf8');
console.log('✅  CfgNav.jsx — section headers fixed (no active color)');
console.log('\nDone. Vite will hot-reload automatically.');
