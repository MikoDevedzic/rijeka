// How far the app's source is from one way of setting type and colour (docs/design.md), as counts that may only
// go down. `npm run design` prints them against the baseline; `npm run design -- --update` writes a lower baseline
// after a clean-up; the unit run (src/design.test.js) fails when any count has risen.
//
// What is counted, in frontend/src (tests and generated pages aside):
//   sizes       distinct values of font-size: one scale has a handful, not dozens
//   offScale    font-size declarations that are not a step of the scale (SCALE, in px)
//   rem         font-size declarations in rem or em: a size is a step of the scale, in px
//   hex         colours written as hex outside the two files that define the tokens (index.css, theme.js)
//   fontNames   a font named directly instead of var(--mono) / var(--sans), outside index.css
//   figureBlue  var(--blue) as a text colour in a table cell's inline style (blue is a chart's second series)
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const BASELINE = join(HERE, '..', 'design-baseline.json')
export const SCALE = [9, 10, 11, 11.5, 12, 12.5, 13, 14, 16, 20]   // px: label 11, value 12.5, headline 13 to 16

function files(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { out.push(...files(p)); continue }
    if (!/\.(jsx|js|css)$/.test(name) || /\.test\.jsx?$/.test(name)) continue
    out.push(p)
  }
  return out
}

export function measure() {
  const sizes = new Set()
  const count = { offScale: 0, rem: 0, hex: 0, fontNames: 0, figureBlue: 0 }
  const worst = {}
  const bump = (k, f) => { count[k]++; (worst[k] ||= {})[f] = (worst[k][f] || 0) + 1 }
  for (const p of files(SRC)) {
    const f = relative(SRC, p)
    const s = readFileSync(p, 'utf8')
    for (const m of s.matchAll(/fontSize:\s*['"]?([0-9.]+)(px|rem|em)?['"]?|font-size:\s*([0-9.]+)(px|rem|em)/g)) {
      const n = parseFloat(m[1] ?? m[3]); const unit = (m[2] ?? m[4]) || 'px'
      sizes.add(`${n}${unit}`)
      if (unit !== 'px') bump('rem', f)
      else if (!SCALE.includes(n)) bump('offScale', f)
    }
    if (f !== 'index.css' && f !== 'theme.js') for (const _ of s.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z])/g)) bump('hex', f)
    if (f !== 'index.css') {
      for (const m of s.matchAll(/fontFamily:\s*(['"`])(.*?)\1|font-family:\s*([^;}\n]+)|\.font\s*=\s*[`'"]([^`'"]+)/g)) {
        const v = (m[2] ?? m[3] ?? m[4] ?? '').trim()
        if (/Plex|JetBrains|Helvetica|Arial|Consolas|Menlo|'DM Mono'|"DM Mono"|DM Mono,|Instrument/.test(v)) bump('fontNames', f)
      }
    }
    for (const _ of s.matchAll(/td[A-Za-z]*,?\s*color:\s*'var\(--blue\)'/g)) bump('figureBlue', f)
  }
  return { sizes: sizes.size, ...count, worst }
}

export const baseline = () => JSON.parse(readFileSync(BASELINE, 'utf8'))
export const KEYS = ['sizes', 'offScale', 'rem', 'hex', 'fontNames', 'figureBlue']

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = measure()
  let base = {}
  try { base = baseline() } catch { /* no baseline yet */ }
  const update = process.argv.includes('--update')
  let risen = false
  for (const k of KEYS) {
    const b = base[k]
    const mark = b == null ? 'new' : now[k] > b ? 'RISEN' : now[k] < b ? 'lower' : 'same'
    if (mark === 'RISEN') risen = true
    console.log(`${k.padEnd(11)} ${String(now[k]).padStart(5)}   baseline ${b ?? '-'}   ${mark}`)
    const top = Object.entries(now.worst[k] || {}).sort((a, b2) => b2[1] - a[1]).slice(0, 4).map(([f, n]) => `${f} ${n}`).join(', ')
    if (top) console.log(`            most in: ${top}`)
  }
  if (update) {
    if (risen) { console.error('a count has risen: a baseline is only ever lowered'); process.exit(1) }
    writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(KEYS.map(k => [k, now[k]])), null, 2) + '\n')
    console.log('baseline written')
  } else if (risen) process.exit(1)
}
