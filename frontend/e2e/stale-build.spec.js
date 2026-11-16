// A release while the app is open. Each page is a file named by its build; a release replaces them, and the host
// answers a request for an old one with the app's shell. A tab opened before the release then failed on the first
// page it had not opened yet, with the browser's raw words on screen. It now knows the case: with no trade window open
// it reloads by itself, once; with one open it says the desk was updated and asks, because a reload closes the window.
import { test, expect } from './fixtures.js'

const SHELL = '<!doctype html><html><head><title>Rijeka</title></head><body><div id="root"></div></body></html>'
// the host's answer for a page file of an older build: the shell, as a page of text
const gone = (app) => app.route(/\/assets\/RiskPage-[^/]+\.js$/, route => route.fulfill({ status: 200, contentType: 'text/html; charset=UTF-8', body: SHELL }))
const RISK = (app) => app.locator('.ab-link', { hasText: /^RISK/ }).first()

test('a page of a newer build, with no trade window open: the tab reloads by itself, and asks only if that did not help', async ({ app }) => {
  await app.goto('/blotter')
  await expect(app.getByText('+ NEW TRADE').first()).toBeVisible()
  await gone(app)
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
  await gone(app)
  let loads = 0
  app.on('load', () => { loads += 1 })
  await RISK(app).dispatchEvent('click')                                   // the ticket stands over the top bar here: the link is pressed where it is
  await expect(app.getByTestId('stale-build')).toHaveText('Rijeka was updated while this window was open')
  await expect(app.getByRole('alert').first()).toContainText('a trade window that is open closes with the reload')
  await app.waitForTimeout(800)
  expect(loads, 'the tab did not reload under an open ticket').toBe(0)
  await expect(win, 'the ticket is still there').toBeVisible()
  // going back to a page this tab already has heals it: the blotter is in the build it loaded
  await app.locator('.ab-link', { hasText: /^BLOTTER/ }).first().dispatchEvent('click')
  await expect(app.getByTestId('stale-build')).toHaveCount(0)
  await expect(win).toBeVisible()
})
