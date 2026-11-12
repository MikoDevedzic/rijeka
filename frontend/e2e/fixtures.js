// e2e/fixtures.js — what every journey starts from: a signed-in page on the local stack and a record of
// everything that went wrong in the browser while the journey ran.
//
// Sign-in: the session serve.sh minted is placed where supabase-js keeps it (sessionStorage, key
// sb-stack-auth-token), so the app starts signed in without a hosted auth server. The reads the app makes through
// supabase-js (http://stack.local/rest/v1/…) are answered by the local PostgREST on the stack database, with the
// same token, so row-level security applies as it does on Supabase. Realtime is a quiet stub.
//
// A journey fails on any uncaught exception or console error in the page. Errors that are only the stack's
// missing realtime or auth host are not the app's and are filtered.
import { test as base, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REST = 'http://127.0.0.1:3010'
export const API = 'http://127.0.0.1:8010'
const STACK = 'http://stack.local'
export const WEB = 'http://127.0.0.1:4174'
// GETs whose 404 means "nothing stored yet" and is handled by the page
const NOTHING_STORED = [/\/api\/market-data\/cap-vol\/\d{4}-\d{2}-\d{2}$/]

export function sessions() {
  return JSON.parse(fs.readFileSync(path.join(HERE, '.out', 'session.json'), 'utf8'))
}

// "Failed to load resource" is the browser's echo of a response; the response handler below judges those by status.
// the last one is Firefox's: a web font still downloading when the page navigates away is reported as a failed
// download with the status of a cancelled load (2152398850, NS_BINDING_ABORTED)
const NOT_THE_APPS = [/stack\.local/, /ERR_NAME_NOT_RESOLVED/, /WebSocket connection/, /realtime/i, /Download the React DevTools/, /Failed to load resource/,
  /downloadable font: download failed.*status=2152398850/]
// a request the page itself cancelled (a newer one replaced it, or the page navigated), as each engine words it:
// Chromium, Firefox, WebKit
const CANCELLED = /ERR_ABORTED|NS_BINDING_ABORTED|cancelled|Load request cancelled/i

export const test = base.extend({
  // who is signed in: 'USER.A' (firm ADMIN, the template account with market data) unless a journey says otherwise
  who: ['USER.A', { option: true }],

  problems: async ({ page }, use) => {
    const problems = []
    page.on('pageerror', e => problems.push(`uncaught: ${e.message}`))
    page.on('console', m => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (NOT_THE_APPS.some(rx => rx.test(t))) return
      problems.push(`console.error: ${t.slice(0, 400)}`)
    })
    page.on('response', r => {
      const u = r.url()
      // every 4xx and 5xx from the API or the REST layer is a problem, except a 404 on the reads the pages treat as
      // "nothing stored yet" (NOTHING_STORED: each one named, so a mistyped route is still caught)
      const st = r.status(), m = r.request().method()
      const handled = st === 404 && m === 'GET' && NOTHING_STORED.some(rx => rx.test(u))
      if (st >= 400 && !handled && (u.startsWith(API) || u.startsWith(STACK))) problems.push(`HTTP ${st} ${m} ${u}`)
    })
    // a request that never got an answer from the API (it died, or refused the connection); a navigation that
    // cancels an in-flight request is not that
    page.on('requestfailed', r => {
      const why = r.failure()?.errorText || ''
      if (r.url().startsWith(API) && !CANCELLED.test(why)) problems.push(`no answer: ${r.method()} ${r.url()} (${why})`)
    })
    // an API path sent to the page's own host: the relative-path mistake, which the static host answers with HTML
    page.on('request', r => {
      const u = new URL(r.url())
      if (u.origin === WEB && /^\/(api|auth)\//.test(u.pathname)) problems.push(`API path sent to the page's own host: ${r.method()} ${u.pathname}`)
    })
    await use(problems)
  },

  app: [async ({ page, who, problems }, use) => {
    const session = sessions()[who]
    if (!session) throw new Error(`no session for ${who}: run e2e/serve.sh`)
    await page.addInitScript(([key, value]) => {
      try { window.sessionStorage.setItem(key, value); window.sessionStorage.setItem('rijeka.booted', '1') } catch { /* a page without storage */ }
    }, ['sb-stack-auth-token', JSON.stringify(session)])

    // supabase-js REST → the local PostgREST, the caller's own token passed through
    await page.route(`${STACK}/rest/v1/**`, async route => {
      const req = route.request()
      const url = req.url().replace(`${STACK}/rest/v1`, REST)
      try {
        const resp = await route.fetch({ url })
        await route.fulfill({ response: resp, headers: { ...resp.headers(), 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } })
      } catch (e) { await route.abort() ; problems.push(`REST ${req.method()} ${url}: ${e.message}`) }
    })
    // the auth host: the user this session belongs to, and a refresh that returns the same session
    await page.route(`${STACK}/auth/v1/**`, async route => {
      const u = route.request().url()
      const body = u.includes('/token') ? session : u.includes('/logout') ? {} : session.user
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    })
    // realtime: accept the socket, acknowledge joins and heartbeats, send nothing
    await page.routeWebSocket(/stack\.local\/realtime/, ws => {
      ws.onMessage(raw => {
        let m; try { m = JSON.parse(raw) } catch { return }
        const reply = (response = {}) => ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', ref: m.ref, join_ref: m.join_ref, payload: { status: 'ok', response } }))
        if (m.event === 'phx_join') {
          const pc = m.payload?.config?.postgres_changes || []
          reply({ postgres_changes: pc.map((c, i) => ({ ...c, id: i + 1 })) })
        } else if (m.event === 'heartbeat' || m.event === 'phx_leave' || m.event === 'access_token') reply()
      })
    })
    await use(page)
  }, { auto: false }],
})

// The journey's last line: nothing went wrong in the browser while it ran.
export function expectClean(problems) {
  expect(problems, `the browser reported problems:\n${problems.join('\n')}`).toEqual([])
}

// No element inside `root` is wider than it: the clipped-chips and stray-horizontal-scrollbar check.
export async function expectNoHorizontalOverflow(locator, label) {
  const over = await locator.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(over.sw, `${label}: content is ${over.sw}px wide in a ${over.cw}px box (horizontal overflow)`).toBeLessThanOrEqual(over.cw + 1)
}

export { expect }

// The whole of `locator` is on screen without scrolling anything: what "it should all fit right away" means.
export async function expectFullyInView(locator, label) {
  const r = await locator.evaluate(el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, vh: window.innerHeight, vw: window.innerWidth } })
  expect(r.top, `${label}: starts above the screen`).toBeGreaterThanOrEqual(-1)
  expect(r.bottom, `${label}: ends at ${Math.round(r.bottom)}px on a ${r.vh}px screen (below the fold)`).toBeLessThanOrEqual(r.vh + 1)
  expect(r.right, `${label}: runs off the right edge`).toBeLessThanOrEqual(r.vw + 1)
}

// A figure that should be nothing: zero, whichever sign the arithmetic left on it.
export function expectZero(v, label) {
  expect(Math.abs(v), label).toBe(0)
}

// Press SIMULATE and wait for both runs it starts: the ticket's own and the on-chain comparison (the second POST,
// under the ON_CHAIN preset). Returns their JSON bodies and the first request's body.
export async function simulateWithComparison(page, win, urlEnd) {
  const isSim = r => r.url().endsWith(urlEnd) && r.request().method() === 'POST'
  const preset = r => r.request().postDataJSON()?.csa?.preset
  const own = page.waitForResponse(r => isSim(r) && preset(r) !== 'ON_CHAIN', { timeout: 90_000 })
  const cmp = page.waitForResponse(r => isSim(r) && preset(r) === 'ON_CHAIN', { timeout: 90_000 })
  await win.getByRole('button', { name: /SIMULATE/ }).click()
  const [a, b] = await Promise.all([own, cmp])
  return { run: await a.json(), onChain: await b.json(), request: a.request().postDataJSON() }
}

// how much of a canvas is drawn at full strength, in its left part (the river) and its right part (the letter and
// ring), and a number that changes when the drawing does (`shape`: where the ink is, not only how much). The
// waiting outline of the letter is faint and is not counted.
export const ink = (canvas) => canvas.evaluate(cv => {
  const { width: w, height: h } = cv, d = cv.getContext('2d').getImageData(0, 0, w, h).data
  let river = 0, letter = 0, shape = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 150) { if (x < w * 0.62) river++; else letter++; shape = (shape * 31 + y * w + x) % 2147483647 }
  // counted in the page's own pixels: a canvas on a screen of twice the density (the Safari profile) holds four times as many
  const k = (window.devicePixelRatio || 1) ** 2
  return { river: Math.round(river / k), letter: Math.round(letter / k), shape }
})

// a swap against the demo bank, priced and booked, with its CONFIRM tab open
export async function bookedSwap(app) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await priced
  const booked = app.waitForResponse(r => r.url().includes('/api/book/trade'))
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  expect((await booked).status()).toBe(201)
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  await expect(win).toContainText('PENDING')
  return win
}
