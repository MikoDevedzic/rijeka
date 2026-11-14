// The door on a monitor: "Open as an app". Chrome and Edge are asked to install it (one press) and otherwise shown
// their own menu's steps; Safari on a Mac is shown its File menu's; Firefox, which cannot, is shown no button; an
// iPad is shown the phone's button and taps; and opened as an app, the door has no button and the mark opens it.
import { test, expect, expectClean } from './fixtures.js'

const signedOut = (page) => page.route(/stack\.local\/auth\/v1/, r => r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"msg":"no session"}' }))
const as = (page, ua) => page.addInitScript(u => Object.defineProperty(window.navigator, 'userAgent', { get: () => u, configurable: true }), ua)
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const CHROME = `${MAC} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`
const BROWSERS = [
  ['chrome', CHROME, 'Cast, save, and share', 'Install page as app…'],
  ['edge', `${CHROME} Edg/131.0.0.0`, 'Apps', 'Install this site as an app'],
  ['safari-mac', `${MAC} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15`, 'File', 'Add to Dock…'],
]

test('a monitor: the door offers the app, and says this browser\'s own steps where the browser has not offered to install it', async ({ page, problems }) => {
  await signedOut(page)
  for (const [way, ua, second, third] of BROWSERS) {
    await as(page, ua)
    await page.goto('/login')
    const open = page.getByTestId('open-as-app')
    await expect(open, way).toBeVisible()
    await expect(open).toHaveText('OPEN AS AN APP')
    await expect(page.getByTestId('add-to-home'), `${way}: not the phone's button`).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    const at = await page.evaluate(() => ({ down: document.documentElement.scrollHeight - window.innerHeight, across: document.documentElement.scrollWidth - window.innerWidth }))
    expect(at.down, `${way}: the door with its button is still one screen`).toBeLessThanOrEqual(0)
    expect(at.across).toBeLessThanOrEqual(0)
    // the button is as wide as the card above it and sits under it
    const card = await page.locator('.au-card').boundingBox(), btn = await open.boundingBox()
    expect(Math.round(btn.width), `${way}: as wide as the card`).toBe(Math.round(card.width))
    expect(btn.y, `${way}: under the card`).toBeGreaterThan(card.y + card.height)
    if (way === 'chrome') { await page.waitForTimeout(1200); await page.screenshot({ path: 'e2e/.out/shots/door-open-as-app.png' }) }      // the door has come in
    await open.click()
    const sheet = page.getByRole('dialog', { name: 'Open Rijeka as an app' })
    await expect(sheet).toHaveAttribute('data-way', way)
    const steps = sheet.locator('ol > li')
    await expect(steps).toHaveCount(4)
    await expect(steps.nth(way === 'safari-mac' ? 0 : 1)).toContainText(second)
    await expect(steps.nth(way === 'safari-mac' ? 1 : 2)).toContainText(third)
    await expect(sheet.getByRole('button', { name: 'GOT IT' }), `${way}: focus is in the sheet`).toBeFocused()
    const box = await sheet.locator(':scope > div').boundingBox(), view = page.viewportSize()
    expect(box.y, `${way}: the sheet is on the screen`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(view.height)
    const past = await sheet.locator(':scope > div').evaluate(el => [...el.querySelectorAll('li, p, b, span')].filter(n => n.getBoundingClientRect().right > el.getBoundingClientRect().right - 21).length)
    expect(past, `${way}: nothing in the sheet runs past its edge`).toBe(0)
    await page.screenshot({ path: `e2e/.out/shots/door-open-as-app-${way}.png` })
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(open, `${way}: focus goes back to the button`).toBeFocused()
  }
  expectClean(problems)
})

test('a monitor: where the browser offers to install, one press asks it, and once installed the button is gone', async ({ page, problems }) => {
  await signedOut(page)
  await as(page, CHROME)
  await page.goto('/login')
  const open = page.getByTestId('open-as-app')
  await expect(open).toBeVisible()
  // the browser's offer, as Chrome raises it on a page it can install
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true })
    e.prompt = () => { window.__asked = (window.__asked || 0) + 1 }
    e.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(e)
  })
  await open.click()
  expect(await page.evaluate(() => window.__asked), 'the browser was asked').toBe(1)
  await expect(page.getByRole('dialog'), 'and no sheet of steps is shown').toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(open, 'installed: nothing more to offer').toHaveCount(0)
  expectClean(problems)
})

test('a monitor: Firefox, which cannot install a site, is shown no button', async ({ page, problems }) => {
  await signedOut(page)
  await as(page, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0')
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByTestId('open-as-app')).toHaveCount(0)
  await expect(page.getByTestId('add-to-home')).toHaveCount(0)
  expectClean(problems)
})

test('an iPad, wider than a phone: the phone\'s button and its taps, in a box in the middle of the page', async ({ page, problems }) => {
  await signedOut(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  await as(page, 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1')
  await page.goto('/login')
  const add = page.getByTestId('add-to-home')
  await expect(add).toHaveText('ADD TO HOME SCREEN')
  await expect(page.getByTestId('open-as-app')).toHaveCount(0)
  await add.click()
  const sheet = page.getByRole('dialog', { name: 'Add Rijeka to your home screen' })
  await expect(sheet).toHaveAttribute('data-way', 'safari')
  await expect(sheet.locator('ol > li')).toHaveCount(4)
  const box = await sheet.locator(':scope > div').boundingBox()
  expect(box.width, 'a box, not a drawer the width of the screen').toBeLessThanOrEqual(380)
  expect(box.y + box.height).toBeLessThanOrEqual(768)
  await page.screenshot({ path: 'e2e/.out/shots/door-ipad-add-to-home.png' })
  await sheet.getByRole('button', { name: 'GOT IT' }).click()
  await expect(add).toBeFocused()
  expectClean(problems)
})

test('a monitor, opened as an app: the mark opens it once and the door has no button', async ({ page, problems }) => {
  await signedOut(page)
  await as(page, CHROME)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q))
  })
  await page.goto('/login')
  const mark = page.getByTestId('launch-mark')
  await expect(mark).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'e2e/.out/shots/door-app-launch.png' })
  await expect(mark, 'it leaves by itself').toHaveCount(0, { timeout: 6000 })
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByTestId('open-as-app'), 'already an app').toHaveCount(0)
  await page.screenshot({ path: 'e2e/.out/shots/door-app.png' })
  expectClean(problems)
})
