// A release while the app is open. Each page is a file named by its build; a release replaces them, and the host
// answers a request for an old one with the app's shell. A tab opened before the release then failed on the first
// page it had not opened yet, with the browser's raw words on screen. It now knows the case: with no trade window open
// and no message being typed it reloads by itself, once; otherwise it says the desk was updated and asks, because a
// reload throws those away. The browser says the same words when a connection drops, so the host is asked which
// build it serves before anything is called a release: a file that did not arrive for another reason is said as that,
// and nothing reloads. A tab of a trade window fails by itself: the window and what is typed in it stay.
import { test, expect } from './fixtures.js'

const SHELL = '<!doctype html><html><head><title>Rijeka</title></head><body><div id="root"></div></body></html>'
// the host's answer for a page file of an older build: the shell, as a page of text
const gone = (app) => app.route(/\/assets\/RiskPage-[^/]+\.js$/, route => route.fulfill({ status: 200, contentType: 'text/html; charset=UTF-8', body: SHELL }))
// the host after a release: it serves another build than the one this tab runs
const released = (app) => app.route(/\/version\.json(\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commit: 'the-next-build' }) }))
const RISK = (app) => app.locator('.ab-link', { hasText: /^RISK/ }).first()

test('a page of a newer build, with no trade window open: the tab reloads by itself, and asks only if that did not help', async ({ app }) => {
  await app.goto('/blotter')
  await expect(app.getByText('+ NEW TRADE').first()).toBeVisible()
  await gone(app); await released(app)
  const reloaded = app.waitForEvent('load')
  await RISK(app).click()
  await reloaded                                                           // it did not wait to be asked
  expect(await app.evaluate(() => Number(window.sessionStorage.getItem('rijeka.reloaded-for-build'))), 'the tab notes when it reloaded for a build').toBeGreaterThan(0)
  // here the file is still not there (in life the reload brings the new build and the page opens): it does not
  // reload again, it says what happened in plain words and offers the reload
  const card = app.getByTestId('stale-build')
  await expect(card).toHaveText('Rijeka was updated while this window was open')
  await expect(app.getByRole('alert')).toContainText('This page belongs to the new version')
  await expect(app.getByRole('alert')).not.toContainText(/Failed to fetch|dynamically imported|assets\//)
  await expect(app.getByRole('button', { name: 'RELOAD', exact: true })).toBeVisible()
  await expect(app.getByRole('button', { name: /COPY DETAILS/ })).toHaveCount(0)   // nothing to send anyone: it is not a fault
  await expect(app.locator('.ab-link', { hasText: /^BLOTTER/ }).first(), 'the top bar stays over a page that could not be opened').toBeVisible()
  await app.screenshot({ path: 'e2e/.out/shots/stale-build.png' })
  // with the file back (the new build), RELOAD opens the page
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  await app.getByRole('button', { name: 'RELOAD', exact: true }).click()
  await expect(app.getByTestId('stale-build')).toHaveCount(0)
  await expect(app).toHaveURL(/\/risk/)
})

test('a page of a newer build, with a trade window open: nothing reloads, the window stays, and the page says why', async ({ app }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await gone(app); await released(app)
  let loads = 0
  app.on('load', () => { loads += 1 })
  await RISK(app).dispatchEvent('click')                                   // the ticket stands over the top bar here: the link is pressed where it is
  await expect(app.getByTestId('stale-build')).toHaveText('Rijeka was updated while this window was open')
  await expect(app.getByRole('alert').first()).toContainText('Before you reload: a trade window that is open closes with the reload')
  await app.waitForTimeout(800)
  expect(loads, 'the tab did not reload under an open ticket').toBe(0)
  await expect(win, 'the ticket is still there').toBeVisible()
  // going back to a page this tab already has heals it: the blotter is in the build it loaded
  await app.locator('.ab-link', { hasText: /^BLOTTER/ }).first().dispatchEvent('click')
  await expect(app.getByTestId('stale-build')).toHaveCount(0)
  await expect(win).toBeVisible()
})

test('a file that did not arrive and no release: it is not called an update, and nothing reloads', async ({ app }) => {
  await app.goto('/blotter')
  await expect(app.getByText('+ NEW TRADE').first()).toBeVisible()
  await gone(app)
  await app.route(/\/version\.json(\?.*)?$/, route => route.abort())      // a dropped connection: the host cannot be asked
  let loads = 0
  app.on('load', () => { loads += 1 })
  const told = app.waitForRequest(r => r.url().endsWith('/api/ops/client-error') && r.method() === 'POST')
  await RISK(app).click()
  const title = app.getByTestId('not-loaded')
  await expect(title).toHaveText('This page could not be loaded')
  await expect(app.getByRole('alert')).toContainText('the connection may have dropped')
  await expect(app.getByRole('alert')).not.toContainText(/updated|new version|Failed to fetch|assets\//)
  await expect(app.getByTestId('stale-build')).toHaveCount(0)
  await expect(app.getByRole('button', { name: /COPY DETAILS/ })).toBeVisible()     // this one is a fault someone should hear of
  expect(JSON.parse((await told).postData()).source, 'and the operator hears of it').toBe('boundary-load')
  await app.waitForTimeout(800)
  expect(loads, 'nothing reloaded by itself').toBe(0)
  expect(await app.evaluate(() => window.sessionStorage.getItem('rijeka.reloaded-for-build'))).toBeNull()
  await expect(app.locator('.ab-link', { hasText: /^BLOTTER/ }).first()).toBeVisible()
})

test('a release while a message is being typed: nothing reloads, and the page says the message would be lost', async ({ app }) => {
  await app.goto('/blotter')
  await app.locator('.ms-launcher').click()
  const chat = app.locator('.ms-window')
  await chat.locator('.ms-conv.prom').click()
  await chat.locator('.ms-compose textarea').fill('where is my 5y payer')
  await gone(app); await released(app)
  let loads = 0
  app.on('load', () => { loads += 1 })
  await RISK(app).click()
  await expect(app.getByTestId('stale-build')).toHaveText('Rijeka was updated while this window was open')
  await expect(app.getByRole('alert').first()).toContainText('a message being typed is lost')
  await app.waitForTimeout(800)
  expect(loads, 'the tab did not reload under a typed message').toBe(0)
  await expect(chat.locator('.ms-compose textarea'), 'the message is still there').toHaveValue('where is my 5y payer')
})

test('a tab of a trade window from a newer build: the window and what is typed in it stay', async ({ app }) => {
  await app.goto('/blotter')
  await expect(app.getByText('+ NEW TRADE').first()).toBeVisible()
  await app.route(/\/assets\/XVATab-[^/]+\.js$/, route => route.fulfill({ status: 200, contentType: 'text/html; charset=UTF-8', body: SHELL }))
  await released(app)
  let loads = 0
  app.on('load', () => { loads += 1 })
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()      // the rates ticket's XVA tab is a file of its own
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const card = win.getByRole('alert')
  await expect(card).toContainText('Rijeka was updated while this window was open')
  await expect(card).toContainText('This tab belongs to the new version; the rest of the window works as it did')
  await expect(app.getByText('TRADE WINDOW', { exact: true }), 'the window did not fall with its tab').toHaveCount(0)
  await app.waitForTimeout(800)
  expect(loads).toBe(0)
  await win.screenshot({ path: 'e2e/.out/shots/stale-tab.png' })
  // the rest of the window works as it did: the ticket is on its first tab, as it was filled
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await expect(win.getByRole('button', { name: 'RATES', exact: true })).toBeVisible()
  await expect(win.getByRole('button', { name: /BOOK TRADE/ })).toBeVisible()
})
