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
  const explore = page.getByRole('link', { name: /Explore Rijeka/ })
  await expect(explore).toHaveAttribute('href', 'https://rijeka.app/')
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
