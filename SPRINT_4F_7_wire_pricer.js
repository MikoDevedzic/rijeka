// SPRINT_4F_7_wire_pricer.js
// Patches App.jsx (add /pricer route) and CommandCenter.jsx (activate PRICER tile)
// Run from Rijeka root: node SPRINT_4F_7_wire_pricer.js

const fs = require('fs');
const path = require('path');
const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

// ── 1. App.jsx ────────────────────────────────────────────────────────────────
const APP = path.join(RIJEKA, 'frontend', 'src', 'App.jsx');
let app = fs.readFileSync(APP, 'utf8');

if (!app.includes('PricerPage')) {
  // Add import
  app = app.replace(
    "import CommandCenter from './components/CommandCenter'",
    "import CommandCenter from './components/CommandCenter'\nimport PricerPage from './components/pricer/PricerPage'"
  );
  // Add route — find the blotter route and add pricer after it
  // Try common patterns
  const routePatterns = [
    `<Route path="/blotter" element={<BlotterShell/>}/>`,
    `<Route path="/blotter" element={<BlotterShell />}/>`,
    `<Route path="blotter" element={<BlotterShell/>}/>`,
    `<Route path="blotter" element={<BlotterShell />}/>`,
  ];
  let patched = false;
  for (const pat of routePatterns) {
    if (app.includes(pat)) {
      app = app.replace(pat, pat + '\n            <Route path="/pricer" element={<PricerPage/>}/>');
      patched = true;
      console.log('  ✓ /pricer route added to App.jsx');
      break;
    }
  }
  if (!patched) {
    // Try finding any Route with blotter
    const blotterIdx = app.indexOf('/blotter');
    if (blotterIdx !== -1) {
      const lineEnd = app.indexOf('\n', blotterIdx);
      app = app.slice(0, lineEnd) + '\n            <Route path="/pricer" element={<PricerPage/>}/>' + app.slice(lineEnd);
      console.log('  ✓ /pricer route added (fallback method)');
      patched = true;
    }
  }
  if (!patched) console.log('  ! Could not add /pricer route — add manually to App.jsx');

  fs.writeFileSync(APP, app, 'utf8');
  console.log('  ✓ App.jsx saved');
} else {
  console.log('  i App.jsx already has PricerPage');
}

// ── 2. CommandCenter.jsx ──────────────────────────────────────────────────────
const CC_PATHS = [
  path.join(RIJEKA, 'frontend', 'src', 'components', 'CommandCenter.jsx'),
  path.join(RIJEKA, 'frontend', 'src', 'components', 'command-center', 'CommandCenter.jsx'),
];
let CC_FILE = null;
for (const p of CC_PATHS) {
  if (fs.existsSync(p)) { CC_FILE = p; break; }
}
if (!CC_FILE) {
  // Search for it
  const result = require('child_process').execSync(
    'dir /s /b "C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\CommandCenter.jsx"',
    { encoding: 'utf8', stdio: 'pipe' }
  ).trim();
  if (result) CC_FILE = result.split('\n')[0].trim();
}

if (!CC_FILE) {
  console.log('  ! CommandCenter.jsx not found — locate and add /pricer link to PRICER tile manually');
} else {
  let cc = fs.readFileSync(CC_FILE, 'utf8');

  // Find PRICER tile — it's currently a stub. Activate it by adding a link.
  // Pattern: tile with label PRICER that has no route or says "Sprint 4"
  // We'll replace the PRICER tile's href/onClick to navigate to /pricer

  if (!cc.includes("'/pricer'") && !cc.includes('"/pricer"')) {
    // Try to find the PRICER tile and add navigation
    // Common patterns in CommandCenter
    const patterns = [
      // Pattern: tile object in array with label PRICER
      `label: 'PRICER'`,
      `label: "PRICER"`,
      `'PRICER'`,
    ];

    let found = false;
    for (const pat of patterns) {
      const idx = cc.indexOf(pat);
      if (idx === -1) continue;

      // Look for route or path near this label
      const context = cc.slice(Math.max(0, idx - 100), idx + 200);

      // If there's a route: null or route: '' nearby, replace it
      if (cc.includes(`route: null`) || cc.includes(`route: ''`) || cc.includes(`route: ""`)) {
        // Find the specific PRICER tile's route property and update
        const tileStart = cc.lastIndexOf('{', idx);
        const tileEnd = cc.indexOf('}', idx);
        const tileStr = cc.slice(tileStart, tileEnd + 1);

        if (tileStr.includes('route')) {
          const newTile = tileStr.replace(/route:\s*(null|''|"")/, `route: '/pricer'`);
          cc = cc.slice(0, tileStart) + newTile + cc.slice(tileEnd + 1);
          console.log('  ✓ PRICER tile route activated in CommandCenter');
          found = true;
        }
      }
      break;
    }

    // If pattern-based didn't work, try direct string replace for known stub patterns
    if (!found) {
      const stubPatterns = [
        [`{ label:'PRICER', route:null,`, `{ label:'PRICER', route:'/pricer',`],
        [`{ label:'PRICER', route: null,`, `{ label:'PRICER', route: '/pricer',`],
        [`{label:'PRICER',route:null,`, `{label:'PRICER',route:'/pricer',`],
        [`label:'PRICER',\n    route:null`, `label:'PRICER',\n    route:'/pricer'`],
        [`label: 'PRICER',\n    route: null`, `label: 'PRICER',\n    route: '/pricer'`],
      ];
      for (const [from, to] of stubPatterns) {
        if (cc.includes(from)) {
          cc = cc.replace(from, to);
          console.log('  ✓ PRICER tile route activated (pattern: ' + from.slice(0, 30) + ')');
          found = true;
          break;
        }
      }
    }

    if (!found) {
      console.log('  ! Could not auto-patch PRICER tile. Find the PRICER tile in CommandCenter.jsx');
      console.log('    and change its route from null to \'/pricer\'');
    }

    fs.writeFileSync(CC_FILE, cc, 'utf8');
    console.log('  ✓ CommandCenter.jsx saved');
  } else {
    console.log('  i CommandCenter already has /pricer');
  }
}

console.log('\nDone.');
console.log('Restart backend: uvicorn main:app --reload');
console.log('Frontend hot-reloads automatically.');
console.log('Then: HOME → PRICER tile → standalone pricer');
