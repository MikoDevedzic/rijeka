// What lies on top of what in the new trade window at the widths phones have: for each kind of ticket, each tab,
// before and after pricing, every pair of things a person reads or presses (a line of text, a field, a button) whose
// boxes cross. Not a journey and not a gate:
//   npx playwright test -c playwright.perf.config.js overlap.spec.js
// Findings in e2e/.out/phone/overlap.json, a picture of each first finding beside it.
import fs from 'node:fs'
import { test } from '../fixtures.js'

const WIDTHS = (process.env.OVERLAP_WIDTHS || '320,360,375,390,402,414,430').split(',').map(Number)
const DIR = 'e2e/.out/phone'
const found = {}

const scan = (root) => {
  const name = (e) => (e.dataset?.testid ? `[${e.dataset.testid}]` : '') + e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')
  const shown = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false } return true }
  // what is pinned over the page (a bar at the foot) is on its own layer and may cover what scrolls under it
  const layer = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'fixed' || p === 'sticky') return x } return null }
  // the box a scrolling ancestor shows: what it has scrolled away is not on the screen
  const clip = (e, r) => {
    let { left, top, right, bottom } = r
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      const s = getComputedStyle(x)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const c = x.getBoundingClientRect(); left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom) }
    }
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null
  }
  const atoms = []
  for (const e of root.querySelectorAll('*')) {
    if (e.closest('select') && e.tagName !== 'SELECT') continue
    if (e.closest('svg') && e.tagName !== 'svg') continue
    if (!shown(e)) continue
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.tagName) || e.tagName === 'svg') {
      const r = clip(e, e.getBoundingClientRect())
      if (r) atoms.push({ e, r, what: `${name(e)} ${(e.value || e.innerText || '').slice(0, 24)}`.trim(), layer: layer(e) })
      continue
    }
    if (e.closest('button')) continue
    for (const n of e.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(n)
      for (const q of range.getClientRects()) {
        const r = clip(e, q)
        if (r) atoms.push({ e, r, what: `${name(e)} "${n.textContent.trim().slice(0, 28)}"`, layer: layer(e) })
      }
    }
  }
  const hits = []
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j]
    if (a.e === b.e || a.layer !== b.layer || a.e.contains(b.e) || b.e.contains(a.e)) continue
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
    if (w > 3 && h > 3) hits.push({ a: a.what, b: b.what, by: `${Math.round(w)}x${Math.round(h)}`, y: Math.round(Math.max(a.r.top, b.r.top)) })
  }
  // and what is cut: text wider than the box that holds it, with nothing to say so
  const cut = []
  for (const e of root.querySelectorAll('*')) {
    if (!shown(e) || e.children.length || !e.textContent.trim() || e.closest('select')) continue
    const s = getComputedStyle(e)
    if (e.scrollWidth > e.clientWidth + 2 && s.overflowX === 'hidden' && s.textOverflow !== 'ellipsis' && e.clientWidth > 0) cut.push(`${name(e)} "${e.textContent.trim().slice(0, 28)}" +${e.scrollWidth - e.clientWidth}`)
  }
  // and what is hidden behind an edge: a box that clips across and holds more than it shows (a panel squeezed to a sliver)
  const clipped = []
  for (const e of root.querySelectorAll('*')) {
    if (!shown(e) || !e.children.length) continue
    const s = getComputedStyle(e)
    if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && e.scrollWidth > e.clientWidth + 8 && e.clientWidth > 0 && e.clientHeight > 0) clipped.push(`${name(e)} "${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}" shows ${e.clientWidth} of ${e.scrollWidth}`)
  }
  const seen = new Set(), out = []
  for (const h of hits) { const k = `${h.a}|${h.b}`; if (!seen.has(k)) { seen.add(k); out.push(h) } }
  return { overlaps: out.slice(0, 14), cut: [...new Set(cut)].slice(0, 10), clipped: [...new Set(clipped)].slice(0, 10) }
}

for (const [kind, pick] of [['forward', []], ['rates', ['RATES']], ['fx', ['FX']], ['option', ['CRYPTO OPTION']], ['fxoption', ['FX', 'FX OPTION']]]) {
  test(`overlaps: a ${kind} ticket at phone widths`, async ({ app }) => {
    test.setTimeout(600_000)
    await app.setViewportSize({ width: 390, height: 844 })
    await app.goto('/blotter')
    await app.getByRole('navigation', { name: 'Rijeka' }).getByRole('button', { name: 'New trade' }).click()
    const win = app.locator('.tbw-window')
    await win.waitFor()
    for (const b of pick) { await win.getByRole('button', { name: b, exact: true }).first().click().catch(() => {}); await app.waitForTimeout(600) }
    const look = async (state) => {
      const tabs = await win.locator('.tbw-tab').evaluateAll(els => els.filter(e => e.getBoundingClientRect().width > 0).map(e => e.dataset.tab))
      for (const name of state === 'empty' ? ['TRADE'] : tabs) {
        await win.locator(`.tbw-tab[data-tab="${name}"]`).click(); await app.waitForTimeout(900)
        for (const w of WIDTHS) {
          await app.setViewportSize({ width: w, height: 844 }); await app.waitForTimeout(350)
          const r = await win.evaluate(scan)
          if (r.overlaps.length || r.cut.length || r.clipped.length) {
            const key = `${kind} ${state} ${name} @${w}`
            found[key] = r
            fs.mkdirSync(DIR, { recursive: true })
            if (r.clipped.length && !r.overlaps.length) await app.screenshot({ path: `${DIR}/overlap-${kind}-${state}-${name.replace(/[^A-Z]+/g, '-').toLowerCase()}-${w}-clipped.png` })
            if (r.overlaps.length) {
              await win.evaluate((el, y) => { for (const e of [el, ...el.querySelectorAll('*')]) if (e.scrollHeight - e.clientHeight > 40 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden') { e.scrollTop += y - 300; break } }, r.overlaps[0].y)
              await app.waitForTimeout(250)
              await app.screenshot({ path: `${DIR}/overlap-${kind}-${state}-${name.replace(/[^A-Z]+/g, '-').toLowerCase()}-${w}.png` })
            }
            fs.writeFileSync(`${DIR}/overlap.json`, JSON.stringify(found, null, 1))
          }
        }
        await app.setViewportSize({ width: 390, height: 844 })
      }
    }
    await look('empty')
    await win.locator('.tbw-tab[data-tab="TRADE"]').click()
    await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' }).catch(() => {})
    await app.waitForTimeout(2500)
    await win.getByRole('button', { name: /PRICE/ }).first().click().catch(() => {})
    await app.waitForTimeout(5000)
    await look('priced')
  })
}
