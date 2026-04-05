// apply_theme.js
// Applies Pure Black theme + IBM Plex fonts across entire Rijeka app.
// Touches: index.css, all JSX files, all CSS files.
// Run from: C:\Users\mikod\OneDrive\Desktop\Rijeka

const fs   = require('fs')
const path = require('path')
const SRC  = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src'

const T = {
  bg:      '#000000',
  surface: '#0C0C0C',
  surface2:'#141414',
  border:  '#1E1E1E',
  text:    '#F0F0F0',
  muted:   '#666666',
  muted2:  '#2A2A2A',
  accent:  '#00D4A8',
  blue:    '#4A9EFF',
  amber:   '#F5C842',
  red:     '#FF6B6B',
  green:   '#1DC87A',
  purple:  '#9060CC',
}

// Font stacks
const MONO = "'IBM Plex Mono', 'JetBrains Mono', monospace"
const SANS = "'IBM Plex Sans', 'Space Grotesk', system-ui, sans-serif"

function walkDir(dir, exts) {
  let files = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
      files = files.concat(walkDir(full, exts))
    } else if (exts.some(e => entry.endsWith(e))) {
      files.push(full)
    }
  }
  return files
}

let changed = 0

// ─── 1. index.css ─────────────────────────────────────────────────────────────
const CSS_PATH = path.join(SRC, 'index.css')
let css = fs.readFileSync(CSS_PATH, 'utf8')

// Add IBM Plex font import if not present
if (!css.includes('IBM+Plex')) {
  css = css.replace(
    `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono`,
    `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');\n@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono`
  )
}

// Replace CSS variables
const varMap = {
  '--bg:           #0a0f14':  `--bg:           ${T.bg}`,
  '--bg-deep:      #070b0f':  `--bg-deep:      #050505`,
  '--panel:        #0f1823':  `--panel:        ${T.surface}`,
  '--panel-2:      #152030':  `--panel-2:      ${T.surface2}`,
  '--panel-3:      #1c2a3a':  `--panel-3:      #1A1A1A`,
  '--border:       #1e3045':  `--border:       ${T.border}`,
  '--border-hi:    #243850':  `--border-hi:    #282828`,
  '--border-glow:  #1a4060':  `--border-glow:  #2A2A2A`,
  '--text:         #e8f0f8':  `--text:         ${T.text}`,
  '--text-hi:      #e8f0f8':  `--text-hi:      ${T.text}`,
  '--text-dim:     #526878':  `--text-dim:     ${T.muted}`,
  '--text-mute:    #526878':  `--text-mute:    ${T.muted}`,
  "--mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Courier New', monospace":
    `--mono: 'IBM Plex Mono', 'JetBrains Mono', 'Cascadia Code', monospace`,
  "--sans: 'Space Grotesk', var(--sans, system-ui), sans-serif":
    `--sans: 'IBM Plex Sans', 'Space Grotesk', system-ui, sans-serif`,
}
Object.entries(varMap).forEach(([from, to]) => {
  if (css.includes(from)) css = css.replace(from, to)
})

// Update body font
css = css.replace(
  `font-family: 'Space Grotesk', var(--sans, system-ui), sans-serif;`,
  `font-family: '${SANS.replace(/'/g,"'")}';`
)

fs.writeFileSync(CSS_PATH, css, 'utf8')
console.log('✓ index.css — Pure Black palette + IBM Plex fonts')
changed++

// ─── 2. Replace all old color hardcodes in JSX/CSS files ─────────────────────
const COLOR_MAP = [
  // Old dark navies → pure black
  ['#07080D', T.bg],       ['#070d12', T.bg],
  ['#0D0F17', T.surface],  ['#0d0f17', T.surface],
  ['#12151F', T.surface2], ['#0a0f14', T.bg],
  ['#070b0f', '#050505'],  ['#0f1823', T.surface],
  ['#0f1823', T.surface],  ['#152030', T.surface2],
  ['#1c2a3a', '#1A1A1A'],  ['#0a0c14', T.bg],
  ['#070810', T.bg],       ['#0c0d14', T.bg],
  ['#08080F', T.bg],       ['#060810', T.bg],
  // Old borders → clean dark
  ['#1e3045', T.border],   ['#1E3045', T.border],
  ['#1E2235', T.border],   ['#1e2235', T.border],
  ['#243850', '#282828'],  ['#1a2a3a', '#1A1A1A'],
  ['#1a2a58', '#222222'],  ['#172030', '#1A1A1A'],
  ['#1a3060', '#222222'],  ['#1E2A3A', T.border],
  // Old muted text
  ['#526878', T.muted],    ['#4a6878', T.muted],
  ['#6B7A99', T.muted],    ['#6b7a99', T.muted],
  ['#3D4560', T.muted2],   ['#3d4560', T.muted2],
  // Keep accents same (already correct)
]

// Font replacements in JSX
const FONT_MAP = [
  // Mono fonts → IBM Plex Mono
  [`'DM Mono',var(--mono)`,           `'IBM Plex Mono',var(--mono)`],
  [`'DM Mono', var(--mono)`,          `'IBM Plex Mono', var(--mono)`],
  [`'DM Mono',monospace`,             `'IBM Plex Mono',monospace`],
  [`'DM Mono', monospace`,            `'IBM Plex Mono', monospace`],
  [`'DM Mono',JetBrains Mono,monospace`, `'IBM Plex Mono',monospace`],
  [`"'DM Mono',var(--mono)"`,         `"'IBM Plex Mono',var(--mono)"`],
  [`"'DM Mono', var(--mono)"`,        `"'IBM Plex Mono', var(--mono)"`],
  [`"'DM Mono',monospace"`,           `"'IBM Plex Mono',monospace"`],
  [`"'DM Mono', monospace"`,          `"'IBM Plex Mono', monospace"`],
  [`"DM Mono,var(--mono)"`,           `"'IBM Plex Mono',var(--mono)"`],
  [`"DM Mono,monospace"`,             `"'IBM Plex Mono',monospace"`],
  [`"DM Mono, monospace"`,            `"'IBM Plex Mono', monospace"`],
  [`"DM Mono,JetBrains Mono,monospace"`, `"'IBM Plex Mono',monospace"`],
  [`'JetBrains Mono',var(--mono)`,    `'IBM Plex Mono',var(--mono)`],
  [`'JetBrains Mono', var(--mono)`,   `'IBM Plex Mono', var(--mono)`],
  [`fontFamily:'var(--mono)'`,        `fontFamily:"'IBM Plex Mono',var(--mono)"`],
  [`fontFamily: 'var(--mono)'`,       `fontFamily:"'IBM Plex Mono',var(--mono)"`],
  // Sans/label fonts → IBM Plex Sans
  [`"'Space Grotesk',var(--mono)"`,   `"'IBM Plex Sans',var(--sans)"`],
  [`"'Space Grotesk', var(--mono)"`,  `"'IBM Plex Sans', var(--sans)"`],
  [`"'Space Grotesk',system-ui,sans-serif"`, `"'IBM Plex Sans',system-ui,sans-serif"`],
  [`"'Space Grotesk', system-ui,sans-serif"`, `"'IBM Plex Sans', system-ui,sans-serif"`],
  [`"'Space Grotesk',var(--sans)"`,   `"'IBM Plex Sans',var(--sans)"`],
  [`'Space Grotesk',system-ui`,       `'IBM Plex Sans',system-ui`],
  [`fontFamily:"'Space Grotesk`,      `fontFamily:"'IBM Plex Sans`],
]

const allFiles = [
  ...walkDir(SRC, ['.jsx']),
  ...walkDir(SRC, ['.css']),
]

allFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8')
  const orig = content

  // Apply color replacements
  COLOR_MAP.forEach(([from, to]) => {
    content = content.replaceAll(from, to)
  })

  // Apply font replacements (JSX only)
  if (file.endsWith('.jsx')) {
    FONT_MAP.forEach(([from, to]) => {
      content = content.replaceAll(from, to)
    })
  }

  // Apply font replacements in CSS files
  if (file.endsWith('.css')) {
    content = content
      .replace(/font-family:\s*var\(--mono\)/g, `font-family: 'IBM Plex Mono', var(--mono)`)
      .replace(/font-family:\s*'Space Grotesk'[^;]*/g, `font-family: 'IBM Plex Sans', system-ui, sans-serif`)
      .replace(/font-family:\s*var\(--sans\)/g, `font-family: 'IBM Plex Sans', var(--sans)`)
      .replace(/'JetBrains Mono'[^;,]*/g, `'IBM Plex Mono', monospace`)
      .replace(/'DM Mono'[^;,]*/g, `'IBM Plex Mono', monospace`)
  }

  if (content !== orig) {
    fs.writeFileSync(file, content, 'utf8')
    changed++
    console.log('✓', path.relative(SRC, file))
  }
})

// ─── 3. Fix ScenarioTab hardcoded colors ──────────────────────────────────────
// The scenario tab uses #07080D etc. in inline styles that are now handled above
// but also has some component-level background colors
const TBW = path.join(SRC, 'components\\blotter\\TradeBookingWindow.jsx')
let tbw = fs.readFileSync(TBW, 'utf8')
const tbwOrig = tbw

// Scenario tab background
tbw = tbw.replaceAll(`background:'#07080D'`, `background:'${T.bg}'`)
tbw = tbw.replaceAll(`background:'#0D0F17'`, `background:'${T.surface}'`)
tbw = tbw.replaceAll(`background:'#070d12'`, `background:'${T.bg}'`)
// Chart canvas background (in draw function)
tbw = tbw.replaceAll(`ctx.fillStyle='#0D0F17'`, `ctx.fillStyle='${T.surface}'`)
// Scenario card backgrounds
tbw = tbw.replaceAll(`background:'#07080D'`, `background:'${T.bg}'`)
// Border colors in scenario
tbw = tbw.replaceAll(`'#1E2235'`, `'${T.border}'`)
tbw = tbw.replaceAll(`'#1e2235'`, `'${T.border}'`)
tbw = tbw.replaceAll(`'#1a2a3a'`, `'${T.border}'`)
tbw = tbw.replaceAll(`color:'#E8EAF0'`, `color:'${T.text}'`)
tbw = tbw.replaceAll(`color:'#6B7A99'`, `color:'${T.muted}'`)
tbw = tbw.replaceAll(`color:'#3D4560'`, `color:'${T.muted2}'`)
// Grid lines in canvas
tbw = tbw.replaceAll(`'rgba(30,34,53,0.8)'`, `'rgba(40,40,40,0.8)'`)
tbw = tbw.replaceAll(`'rgba(30,34,53,0.6)'`, `'rgba(40,40,40,0.6)'`)
tbw = tbw.replaceAll(`'rgba(30,34,53,0.4)'`, `'rgba(40,40,40,0.4)'`)
tbw = tbw.replaceAll(`'rgba(30,34,53,0.7)'`, `'rgba(40,40,40,0.7)'`)
tbw = tbw.replaceAll(`'rgba(30,34,53,0.5)'`, `'rgba(40,40,40,0.5)'`)

if (tbw !== tbwOrig) {
  fs.writeFileSync(TBW, tbw, 'utf8')
  console.log('✓ TradeBookingWindow.jsx — scenario canvas + panel colors updated')
  changed++
}

// ─── 4. Update TradeBookingWindow.css for new theme ───────────────────────────
const TBWCSS = path.join(SRC, 'components\\blotter\\TradeBookingWindow.css')
let tbwcss = fs.readFileSync(TBWCSS, 'utf8')
const tbwcssOrig = tbwcss

// Update tab font to IBM Plex Sans
tbwcss = tbwcss.replace(
  /font-family:.*Space Grotesk.*var\(--mono\)[^;]*/,
  `font-family: 'IBM Plex Sans', var(--sans)`
)
tbwcss = tbwcss.replace(
  /\.tbw-title\s*\{[^}]+\}/s,
  `.tbw-title {
  font-family: 'IBM Plex Sans', var(--sans);
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text);
  flex: 1;
}`
)
tbwcss = tbwcss.replace(
  /\.tbw-tab\s*\{[^}]+\}/s,
  `.tbw-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-dim);
  font-family: 'IBM Plex Sans', var(--sans);
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  padding: 0 1rem;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
  height: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
}`
)
tbwcss = tbwcss.replace(
  /\.tbw-tab\.active\s*\{[^}]+\}/s,
  `.tbw-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}`
)
if (tbwcss !== tbwcssOrig) {
  fs.writeFileSync(TBWCSS, tbwcss, 'utf8')
  console.log('✓ TradeBookingWindow.css — IBM Plex Sans tabs/title')
  changed++
}

// ─── 5. Update AppBar for IBM Plex ────────────────────────────────────────────
const APPBAR = path.join(SRC, 'components\\layout\\AppBar.jsx')
let appbar = fs.readFileSync(APPBAR, 'utf8')
const appbarOrig = appbar
appbar = appbar
  .replaceAll(`'Space Grotesk', var(--mono)`, `'IBM Plex Sans', var(--sans)`)
  .replaceAll(`"'Space Grotesk',var(--mono)"`, `"'IBM Plex Sans',var(--sans)"`)
  .replaceAll(`"'Space Grotesk', var(--mono)"`, `"'IBM Plex Sans', var(--sans)"`)
if (appbar !== appbarOrig) { fs.writeFileSync(APPBAR, appbar, 'utf8'); console.log('✓ AppBar.jsx'); changed++ }

// ─── 6. BlotterShell.css ─────────────────────────────────────────────────────
const BLCSS = path.join(SRC, 'components\\blotter\\BlotterShell.css')
let blcss = fs.readFileSync(BLCSS, 'utf8')
const blcssOrig = blcss
blcss = blcss
  .replace(/font-family:.*Space Grotesk[^;]*/g, `font-family: 'IBM Plex Sans', var(--sans)`)
  .replace(/font-family:.*IBM Plex Mono[^;]*/g, `font-family: 'IBM Plex Mono', var(--mono)`)
if (blcss !== blcssOrig) { fs.writeFileSync(BLCSS, blcss, 'utf8'); console.log('✓ BlotterShell.css'); changed++ }

console.log(`\n✅ Done — ${changed} files updated.`)
console.log('')
console.log('THEME APPLIED: Pure Black')
console.log('  bg:      #000000  (true black)')
console.log('  surface: #0C0C0C  (near black panels)')
console.log('  border:  #1E1E1E  (subtle dark border)')
console.log('  text:    #F0F0F0  (bright white text)')
console.log('  muted:   #666666  (mid grey labels)')
console.log('  accent:  #00D4A8  (teal — unchanged)')
console.log('  blue:    #4A9EFF  (blue — unchanged)')
console.log('  amber:   #F5C842  (amber — unchanged)')
console.log('  red:     #FF6B6B  (red — unchanged)')
console.log('')
console.log('FONTS APPLIED:')
console.log('  Numbers/values: IBM Plex Mono (Bloomberg-grade)')
console.log('  Labels/UI:      IBM Plex Sans (clean geometric)')
console.log('')
console.log('Vite will hot-reload all changes.')
