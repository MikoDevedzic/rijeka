// The front door: what a visitor with no session meets at the app's address (rijeka.app is to open here). Sign in
// or create a desk, the product beside the form, a way on to the public site; on a phone, one screen with nothing
// to scroll. A visitor who is signed in never sees it. The form's own submit is not pressed: there is no auth
// server on the local stack.
import { test, expect, expectClean } from './fixtures.js'

// no session: the auth host answers that nobody is signed in
const signedOut = async (page) => {
  await page.route(/stack\.local\/auth\/v1/, r => r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"msg":"no session"}' }))
}
const scrolls = (page) => page.evaluate(() => ({ down: document.documentElement.scrollHeight - window.innerHeight, across: document.documentElement.scrollWidth - window.innerWidth }))

test('a visitor with no session lands on the door: sign in or create a desk, the logo, and a way to the site', async ({ page, problems }) => {
  await signedOut(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('rijeka-logo'), 'the logo, not the name in type').toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Confirm it on chain.')
  await expect(page.getByTestId('desk-note-door'), 'a monitor is not told it is a monitor').toHaveCount(0)
  const explore = page.getByRole('link', { name: /Explore Rijeka/ })
  await expect(explore).toHaveAttribute('href', 'https://rijeka.app/about')
  const seg = page.getByRole('navigation', { name: 'Sign in or create a desk' })
  await expect(seg.getByRole('link', { name: 'SIGN IN' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  const at = await scrolls(page)
  expect(at.across, 'nothing wider than the window').toBeLessThanOrEqual(0)
  expect(at.down, `on a laptop the door is one screen too (it is ${at.down}px taller)`).toBeLessThanOrEqual(0)
  await page.screenshot({ path: 'e2e/.out/shots/door-desktop.png' })

  await seg.getByRole('link', { name: 'CREATE A DESK' }).click()
  await expect(page).toHaveURL(/\/signup$/)
  await expect(seg.getByRole('link', { name: 'CREATE A DESK' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Confirm password')).toBeVisible()
  await seg.getByRole('link', { name: 'SIGN IN' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expectClean(problems)
})

for (const [name, width, height] of [['a current phone', 390, 844], ['a small phone', 375, 667], ['the narrowest phone', 320, 568]]) {
  test(`the door on ${name} is one screen: nothing to scroll, the form and the way to the site in view`, async ({ page, problems }) => {
    await signedOut(page)
    await page.setViewportSize({ width, height })
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)      // the logo is measured again once its face has loaded
    await page.waitForTimeout(400)
    const at = await scrolls(page)
    expect(at.down, `the sign-in door is taller than a ${width} by ${height} screen by ${at.down}px`).toBeLessThanOrEqual(0)
    expect(at.across).toBeLessThanOrEqual(0)
    const boxes = []
    for (const part of [page.getByTestId('rijeka-logo'), page.getByRole('link', { name: /Explore Rijeka/ }), page.getByRole('button', { name: 'ENTER SYSTEM' })]) {
      const box = await part.boundingBox()
      expect(box && box.y >= 0 && box.y + box.height <= height, 'in view without scrolling').toBe(true)
      boxes.push(box)
    }
    // the logo and the way to the site share the top row and do not touch; the button is tall enough for a thumb
    expect(boxes[1].x - (boxes[0].x + boxes[0].width), 'the logo runs into the EXPLORE button').toBeGreaterThanOrEqual(6)
    expect(boxes[1].height, 'a thumb\'s height').toBeGreaterThanOrEqual(36)
    await page.screenshot({ path: `e2e/.out/shots/door-phone-${width}.png` })
    if (height >= 800) {      // the longer form, on the taller screen
      await page.goto('/signup')
      await expect(page.getByLabel('Confirm password')).toBeVisible()
      await page.waitForTimeout(500)
      expect((await scrolls(page)).down, 'the sign-up door scrolls').toBeLessThanOrEqual(0)
      await page.screenshot({ path: 'e2e/.out/shots/door-phone-signup.png' })
    }
    expectClean(problems)
  })
}

test('a visitor who is signed in does not meet the door', async ({ app, problems }) => {
  await app.goto('/')
  await expect(app).toHaveURL(/\/command-center$/)
  expectClean(problems)
})

// The surface is drawn from the day's quotes. It is started when it comes into view and when the quotes arrive; a
// key pressed in the form beside it is neither, and must not start it again (it did: each letter of an email sent
// the drawing back to its first frame).
test('typing in the sign-in form leaves the volatility surface turning: a key does not start it again', async ({ page, problems }) => {
  await signedOut(page)
  await page.addInitScript(() => {
    window.__surfaceStarts = 0
    const observe = ResizeObserver.prototype.observe
    ResizeObserver.prototype.observe = function (el, ...rest) {
      if (el?.classList?.contains('au-vol')) window.__surfaceStarts += 1     // the drawing watches its canvas once per start
      return observe.call(this, el, ...rest)
    }
  })
  // the day's quotes, so the surface is the live one and not the stand-in drawn when there are none
  await page.route(/\/api\/public\/pulse/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    const quotes = []
    for (const [e, level] of [[1, 96], [2, 101], [5, 98]]) for (const [t, add] of [[1, 0], [5, 6], [10, 9]]) quotes.push({ tenor: `${e}Yx${t}Y`, rate: level + add })
    await route.fulfill({ response, json: { ...body, vol: { valuation_date: '2026-11-13', quotes } } })
  })
  await page.goto('/login')
  await expect(page.locator('canvas.au-vol')).toBeVisible()
  await expect(page.locator('.au-live'), 'the live surface, not the stand-in').toContainText('SNAPSHOT 2026-11-13')
  const starts = () => page.evaluate(() => window.__surfaceStarts)
  const before = await starts()
  expect(before, 'the surface was started').toBeGreaterThanOrEqual(1)
  await page.getByLabel('Email').pressSequentially('desk@example.com')
  await page.getByLabel('Password', { exact: true }).pressSequentially('a-long-pass')
  expect(await starts(), 'the surface was started again while the form was typed in').toBe(before)
  await expect(page.getByLabel('Email'), 'and the form kept what was typed').toHaveValue('desk@example.com')
  expectClean(problems)
})
