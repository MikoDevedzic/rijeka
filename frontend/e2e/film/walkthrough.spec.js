// The walkthrough film: one take through the desk on the local stack with a local chain. Not a journey: it asserts
// nothing and is run on purpose (playwright.film.config.js). It drives the real app as a person would, slowly, with a
// pointer and captions drawn over the page, and writes what the browser paints to e2e/.out/film/frames at 30 frames
// a second; e2e/film/encode.sh makes the film from them. Stills of each scene go to e2e/.out/film/stills, to be read
// before anyone is shown the film.
//
// What is on the screen is the app as it is: the trades, prices, signatures and the chain's answers are real for this
// stack. The stack's parties and market data are its seed (demonstration data), and its chain is a local test chain;
// the closing card says so.
import fs from 'node:fs'
import { test } from '../fixtures.js'

const OUT = 'e2e/.out/film', FRAMES = `${OUT}/frames`, STILLS = `${OUT}/stills`, FPS = 30

// drawn over the page: the pointer, the ring a click leaves, the caption, and the opening and closing cards
const OVERLAY = () => {
  if (document.getElementById('film-cap')) return
  const style = document.createElement('style')
  style.textContent = `
    #film-ptr { position: fixed; z-index: 2147483600; left: 0; top: 0; width: 26px; height: 26px; pointer-events: none; transform: translate(-200px, -200px); will-change: transform; transition: opacity .3s ease; }
    #film-ring { position: fixed; z-index: 2147483599; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 2px solid #f1d488; opacity: 0; pointer-events: none; }
    #film-ring.go { animation: film-ring .5s ease-out; }
    @keyframes film-ring { from { opacity: .95; transform: scale(.35) } to { opacity: 0; transform: scale(1.5) } }
    #film-cap { position: fixed; z-index: 2147483598; left: 50%; top: 18px; transform: translate(-50%, -10px); max-width: 1080px; padding: 12px 24px 13px; border-radius: 6px;
      background: rgba(8, 23, 20, .94); border: 1px solid #5f7165; color: #f6f1e4; font: 500 21px/1.3 'Instrument Sans', system-ui, sans-serif; text-align: center; white-space: nowrap;
      opacity: 0; transition: opacity .4s ease, transform .4s ease; pointer-events: none; box-shadow: 0 14px 34px rgba(0, 0, 0, .5); }
    #film-cap.on { opacity: 1; transform: translate(-50%, 0); }
    #film-cap.foot { top: auto; bottom: 30px; }
    #film-cap b { color: #f1d488; font-weight: 600; }
    #film-card { position: fixed; inset: 0; z-index: 2147483597; display: grid; place-content: center; justify-items: center; gap: 18px; background: #081714; color: #f6f1e4;
      opacity: 0; transition: opacity .7s ease; pointer-events: none; text-align: center; }
    #film-card.on { opacity: 1; }
    #film-card .n { font: 600 34px/1 'Instrument Sans', system-ui, sans-serif; letter-spacing: .5em; margin-right: -.5em; color: #f1d488; }
    #film-card .l { font: italic 500 46px/1.15 'Bodoni Moda', Didot, serif; max-width: 980px; }
    #film-card .l i { color: #d9b25c; font-style: italic; }
    #film-card .s { font: 400 19px/1.5 'Instrument Sans', system-ui, sans-serif; color: #a9b9ae; max-width: 900px; }
    #film-card .f { font: 400 14px/1.5 'DM Mono', ui-monospace, monospace; color: #7b9388; letter-spacing: .04em; margin-top: 14px; }
    html.film-quiet .ms-launcher { display: none !important; }
  `
  document.documentElement.appendChild(style)
  document.documentElement.classList.add('film-quiet')
  const add = (id, html = '') => { const e = document.createElement('div'); e.id = id; e.innerHTML = html; document.documentElement.appendChild(e); return e }
  const ptr = add('film-ptr', '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2.5 21 13.2l-7.6 1.5 4.3 7.6-3 1.7-4.3-7.7L4.6 22z" fill="#f6f1e4" stroke="#081714" stroke-width="1.6" stroke-linejoin="round"/></svg>')
  const ring = add('film-ring'); add('film-cap'); add('film-card')
  document.addEventListener('mousemove', (e) => { ptr.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)` }, true)
  document.addEventListener('mousedown', (e) => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go') }, true)
}

test('the walkthrough', async ({ app }) => {
  test.setTimeout(600_000)
  app.setDefaultTimeout(40_000)                     // a step that cannot find its control says so, and does not film a still screen for minutes
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true }); fs.mkdirSync(STILLS, { recursive: true })

  // ── the camera: what the browser paints, written at a steady 30 frames a second ──
  const cdp = await app.context().newCDPSession(app)
  let latest = null, written = 0, started = 0, rolling = false, cutMs = 0
  const scenes = []
  cdp.on('Page.screencastFrame', (f) => { latest = Buffer.from(f.data, 'base64'); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) })
  const tick = setInterval(() => {
    if (!rolling || !latest) return
    const due = Math.floor((Date.now() - started - cutMs) / 1000 * FPS)
    while (written < due) { written++; fs.writeFileSync(`${FRAMES}/f-${String(written).padStart(6, '0')}.jpg`, latest) }
  }, 1000 / FPS / 2)
  const roll = async () => { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, everyNthFrame: 1 }); started = Date.now(); rolling = true }
  // a wait left out of the film: nothing is written while it lasts, and the caption after it says how long it was
  const skip = async (waiting) => { const t0 = Date.now(); rolling = false; try { await waiting } finally { cutMs += Date.now() - t0; rolling = true } return (Date.now() - t0) / 1000 }
  const cut = async () => { rolling = false; clearInterval(tick); await cdp.send('Page.stopScreencast').catch(() => {}) }

  // ── the hand and the voice ──
  const hold = (ms) => app.waitForTimeout(ms)
  let at = { x: 760, y: 430 }
  const glide = async (x, y, ms = 520) => {
    const n = Math.max(8, Math.round(ms / 16)), from = { ...at }
    for (let i = 1; i <= n; i++) { const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await app.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e); await hold(16) }
    at = { x, y }
  }
  const to = async (loc, ms) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2, ms) }
  const press = async (loc, after = 500) => { console.log('  press', String(loc).slice(0, 110)); await to(loc); await hold(180); await app.mouse.down(); await hold(70); await app.mouse.up(); await hold(after) }
  // at the top, over a ticket's title bar; at the foot where the top of the page is what the scene shows (the menu, the paper's own buttons)
  const say = async (html, foot = false) => { console.log('SCENE', String(html).replace(/<[^>]+>/g, '').slice(0, 60), written); scenes.push({ at: +(written / FPS).toFixed(2), caption: String(html).replace(/<[^>]+>/g, '') }); await app.evaluate(OVERLAY); await app.evaluate(([h, f]) => { const c = document.getElementById('film-cap'); c.classList.remove('on'); setTimeout(() => { c.innerHTML = h; c.classList.toggle('foot', f); if (h) c.classList.add('on') }, 420) }, [html, foot]); await hold(600) }
  const card = async (html) => { await app.evaluate(OVERLAY); await app.evaluate((h) => { const c = document.getElementById('film-card'), p = document.getElementById('film-ptr'); p.style.opacity = h ? '0' : '1'; if (h) { c.innerHTML = h; c.classList.add('on') } else c.classList.remove('on') }, html); await hold(750) }      // no pointer over a card
  const still = (name) => app.screenshot({ path: `${STILLS}/${name}.png` })
  const tab = (win, name) => win.locator(`.tbw-tab[data-tab="${name}"]`)

  // ── 0. the title, over the home as it loads ──
  await app.goto('/command-center')
  await app.evaluate(() => document.fonts.ready)
  await card('<div class="n">RIJEKA</div><div class="l">Price it. See what it costs. <i>Confirm it on chain.</i></div><div class="s">An open-source desk for OTC derivatives</div>')
  await app.locator('.dh-kpis').first().waitFor({ timeout: 60_000 })
  await hold(1200)
  await roll()
  await hold(3400); await still('00-title')
  await card('')

  // ── 1. the home ──
  await say('The desk on one screen: <b>the book, its risk, the market</b>', true)
  await glide(520, 330, 900); await hold(2600); await still('01-home')
  await app.mouse.wheel(0, 420); await hold(2400); await still('01-home-2')
  await app.mouse.wheel(0, -420); await hold(600)

  // ── 2. a trade, priced ──
  await say('Enter a trade', true)
  await app.getByRole('link', { name: /BLOTTER/ }).or(app.getByRole('button', { name: /BLOTTER/ })).first().click().catch(() => app.goto('/blotter'))
  await app.getByText('+ NEW TRADE').first().waitFor(); await hold(900)
  await press(app.getByText('+ NEW TRADE').first(), 900)
  const win = app.locator('.tbw-window'); await win.waitFor()
  await say('A bitcoin forward, <b>priced on the desk\'s own curves</b>')
  await hold(900); await still('02-ticket')
  const cpty = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await to(cpty); await hold(300); await cpty.selectOption({ label: 'RIJEKA DEMO BANK AG' }); await hold(1500)
  const priced = app.waitForResponse(r => r.url().includes('/api/currency/forward/price') && r.request().method() === 'POST', { timeout: 60_000 }).catch(() => null)
  await press(win.getByRole('button', { name: /PRICE/ }).first(), 300); await priced; await hold(2800); await still('02-priced')
  await win.evaluate(el => { for (const e of [el, ...el.querySelectorAll('*')]) if (e.scrollHeight - e.clientHeight > 120 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden') { e.scrollTo({ top: 420, behavior: 'smooth' }); break } })
  await hold(2600); await still('02-priced-terms')

  // ── 3. what it costs ──
  await say('See what it costs: <b>XVA from simulated exposure</b>')
  await press(tab(win, 'XVA'), 1300); await still('03-xva-before')
  const ran = app.waitForResponse(r => r.url().includes('/api/xva/') && r.request().method() === 'POST', { timeout: 180_000 }).catch(() => null)
  await press(win.getByRole('button', { name: /SIMULATE/ }).first(), 300); await ran; await hold(3600); await still('03-xva')
  const strip = win.getByTestId('va-strip').first()
  if (await strip.count()) { await to(strip, 700); await hold(2600) }
  await win.evaluate(el => { for (const e of [el, ...el.querySelectorAll('*')]) if (e.scrollHeight - e.clientHeight > 200 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden') { e.scrollTo({ top: e.scrollTop + 460, behavior: 'smooth' }); break } })
  await hold(3200); await still('03-xva-exposure')

  // ── 4. booked ──
  await say('Book it')
  await press(tab(win, 'TRADE'), 900)
  const booked = app.waitForResponse(r => /\/api\/(book\/trade|trades\/)/.test(r.url()) && r.request().method() === 'POST', { timeout: 60_000 }).catch(() => null)
  await press(win.getByRole('button', { name: /BOOK TRADE/ }), 300); await booked; await hold(2200); await still('04-booked')

  // ── 5. confirmed on chain ──
  await say('Confirm it <b>on chain</b>')
  await press(tab(win, '◆ CONFIRM'), 1500); await still('05-confirm-pending')
  await press(win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).first(), 300)
  const cert = win.getByTestId('confirm-certificate'); await cert.waitFor({ timeout: 120_000 })
  await say('The terms are signed. <b>The record is anchored on chain.</b>')
  await hold(4600); await still('05-confirming')
  await cert.scrollIntoViewIfNeeded(); await hold(3600); await still('05-certificate')

  // ── 6. anyone can check it ──
  await say('Anyone can check it, <b>without Rijeka</b>')
  await press(cert.getByRole('button', { name: /VERIFY/ }), 300)
  const verdict = win.getByTestId('confirm-verify-result')
  await verdict.waitFor({ timeout: 60_000 }).catch(() => {})
  await verdict.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' })).catch(() => {})      // the answer is under the buttons: bring it into the frame
  await to(verdict, 700).catch(() => {}); await hold(3800); await still('06-verified')

  // ── 7. on paper ──
  await say('And a paper confirmation, <b>printed from the signed record</b>', true)
  await press(cert.getByTestId('paper-open'), 300)
  const sheet = app.getByTestId('paper-confirmation'); await sheet.waitFor({ timeout: 60_000 }); await hold(3200); await still('07-paper')
  await app.getByTestId('paper-view').evaluate(el => el.scrollTo({ top: 620, behavior: 'smooth' })); await hold(3400); await still('07-paper-2')
  await app.getByTestId('paper-view').evaluate(el => el.scrollTo({ top: 0, behavior: 'smooth' })); await hold(1300)
  await press(app.getByTestId('paper-close'), 900)

  // ── 8. the rest of the book ──
  await say('Swaps, swaptions, caps and floors. <b>FX and digital assets.</b>')
  await press(win.getByRole('button', { name: 'NEW TRADE', exact: true }), 1100)
  await press(tab(win, 'TRADE'), 900)                    // a new ticket opens on the tab the last one was left on
  await press(win.getByRole('button', { name: 'RATES', exact: true }), 1100); await still('08-rates')
  const cp2 = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await to(cp2); await hold(250); await cp2.selectOption({ label: 'RIJEKA DEMO BANK AG' }); await hold(1000)
  const swapPriced = app.waitForResponse(r => r.url().endsWith('/price/preview') && r.request().method() === 'POST', { timeout: 60_000 }).catch(() => null)
  await press(win.getByRole('button', { name: /PRICE/ }).first(), 300); await swapPriced; await hold(2400); await still('08-swap-priced')
  await press(tab(win, 'CASHFLOWS'), 2600); await still('08-swap-cashflows')
  await press(tab(win, 'CURVE SCENARIO'), 3000); await still('08-swap-scenario')

  // ── 9. Prometheus, asked about the trade just confirmed. The stack calls the model only when the run was given a key
  //       (RIJEKA_STACK_ASSISTANT_KEY, e2e/serve.sh); without one the scene is left out. The answer is the model's own;
  //       the wait for it is cut from the film and the caption says how long it was ──
  await press(win.locator('.tbw-light-r'), 500)
  if (process.env.RIJEKA_STACK_ASSISTANT_KEY) {
    await say('Ask Prometheus, <b>the desk\'s read-only assistant</b>', true)
    await app.evaluate(() => document.documentElement.classList.remove('film-quiet')); await hold(500)
    await press(app.locator('.ms-launcher'), 1200)
    await press(app.locator('.ms-list-scroll').getByText('✦ Prometheus'), 2600); await still('09-prometheus')
    await press(app.locator('.ms-compose textarea'), 250)
    await app.keyboard.type('Is the bitcoin forward I just confirmed still what was signed?', { delay: 38 }); await hold(500)
    await press(app.locator('.ms-send'), 300)
    await hold(2400); await still('09-prometheus-asked')
    const waited = await skip(app.locator('.ms-thinking').waitFor({ state: 'hidden', timeout: 200_000 }))
    console.log('  prometheus answered after', (waited + 2.7).toFixed(1), 's; cut from the film:', waited.toFixed(1), 's')
    const answer = app.locator('.ms-thread .ms-msg').last()
    console.log('  ANSWER: ' + (await answer.innerText()).replace(/\n+/g, ' | ').slice(0, 1800))
    await say(`Its answer, ${Math.round(waited + 2.7)} seconds later. <b>It reads; it never changes anything.</b>`, true)
    await answer.evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'smooth' })); await glide(1010, 470, 700)      // the pointer beside the panel, not over the answer
    await hold(7200); await still('09-prometheus-answer')
    await app.locator('.ms-thread').evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })); await hold(2600); await still('09-prometheus-answer-2')
    await press(app.locator('.ms-titlebar .ms-icon[title="Close"]'), 500)
    await app.evaluate(() => document.documentElement.classList.add('film-quiet'))
  }

  // ── 10. written down ──
  await say('Every model is written down and <b>checked against QuantLib</b>', true)
  await press(app.getByRole('link', { name: /METHODOLOGY/ }).or(app.getByRole('button', { name: /METHODOLOGY/ })).first(), 2800); await still('09-methodology')
  await app.mouse.wheel(0, 500); await hold(2600); await still('09-methodology-2')

  // ── 11. the close ──
  await say('')
  await card('<div class="n">RIJEKA</div><div class="l">Where the trading desk <i>meets the chain</i></div><div class="s">rijeka.app · open source · a hosted demonstration on the Sepolia test network</div><div class="f">Recorded on a local demonstration stack: its parties and market data are sample data, its chain a local test chain</div>')
  await hold(5200); await still('10-close')
  await cut()
  fs.writeFileSync(`${OUT}/take.json`, JSON.stringify({ frames: written, seconds: +(written / FPS).toFixed(1), cutSeconds: +(cutMs / 1000).toFixed(1), at: new Date().toISOString(), scenes }, null, 1))
})
