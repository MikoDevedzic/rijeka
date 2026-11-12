// The methodology read in place: how the system is built (a trade followed through the pieces, the API's own
// health answer under it), the document's nineteen sections with their formulas and the PDF's numbering, the
// evidence beside a section, a worked table that reprices, and a reference in the text that goes where it says.
import { test, expect, expectClean, expectNoHorizontalOverflow } from './fixtures.js'

test('methodology: the system page follows a trade, names a piece, and shows the API\'s own health answer', async ({ app, problems }) => {
  const asked = app.waitForResponse(r => r.url().endsWith('/api/ops/health'))
  await app.goto('/methodology')
  await expect(app.getByRole('heading', { level: 1, name: 'How the system is built' })).toBeVisible()
  // the scene is drawn in this browser (it has WebGL): a scene that fails to build is a failure, not a fallback
  const stage = app.getByTestId('mr-stage')
  await expect(stage).toHaveAttribute('data-scene', 'on', { timeout: 20_000 })
  await expect(stage.locator('canvas')).toHaveAttribute('data-ready', 'true')
  await expect(app.getByTestId('mr-no-scene')).toHaveCount(0)
  // a name sits over its piece, not in the corner it starts from
  const box = await app.getByTestId('mr-piece-api').boundingBox(), frame = await stage.boundingBox()
  expect(box.x - frame.x, 'the API\'s name is placed in the scene').toBeGreaterThan(100)
  // every piece has its name, whichever way the scene is shown
  for (const id of ['app', 'land', 'api', 'auth', 'pg', 'chain', 'pub', 'venue', 'ai', 'tg']) await expect(app.getByTestId(`mr-piece-${id}`)).toBeVisible()

  // a step says what happens and names its routes
  const say = app.getByTestId('mr-say')
  await expect(say).toContainText('THE WHOLE MAP')
  await expect(app.getByTestId('mr-step-7')).toContainText('THE BATCHES')
  await app.getByTestId('mr-step-5').click()
  await expect(app.getByTestId('mr-step-5')).toHaveAttribute('aria-pressed', 'true')
  await expect(say).toContainText('5 · CONFIRM')
  await expect(say).toContainText('POST /api/chain/confirm-package')
  // a piece says what it does; pressed again it lets go
  await app.getByTestId('mr-piece-chain').click()
  await expect(app.getByTestId('mr-piece')).toContainText('No owner, no administrative function')
  await app.getByTestId('mr-piece-chain').click()
  await expect(app.getByTestId('mr-piece')).toContainText('Press a piece')
  // the walk starts at the first step and can be stopped
  await app.getByTestId('mr-tour').click()
  await expect(say).toContainText('1 · SIGN IN')
  await expect(app.getByTestId('mr-tour')).toHaveText('■ STOP')
  await app.getByTestId('mr-tour').click()
  await expect(app.getByTestId('mr-tour')).toHaveText('▶ FOLLOW A TRADE')
  await app.getByTestId('mr-step-all').click()
  await expect(say).toContainText('THE WHOLE MAP')

  // the strip is the API's own answer: the version it reports, and the batches by their own names
  const health = app.getByTestId('mr-health')
  await expect(health).toHaveAttribute('data-state', 'answered')
  const res = await asked, answer = await res.json()
  expect(res.request().headers().authorization, 'the health answer is public: the page sends no token for it').toBeUndefined()
  await expect(health).toContainText(answer.version)
  await expect(health).toContainText('MIGRATIONS')
  await expectNoHorizontalOverflow(app.getByTestId('mr'), 'the system page')
  expectClean(problems)
})

test('methodology: a section reads as the document does, with its evidence, a worked table that reprices and references that lead', async ({ app, problems }) => {
  await app.goto('/methodology')
  const rail = app.getByTestId('mr-syllabus')
  for (let n = 1; n <= 19; n++) await expect(rail.getByTestId(`mr-go-${n}`)).toHaveCount(1)
  await expect(app.getByTestId('mr-version')).toHaveText(/^v\d+\.\d+$/)

  await rail.getByTestId('mr-go-12').click()
  await expect(app).toHaveURL(/\/methodology\/12$/)
  const sec = app.getByTestId('mr-section')
  await expect(sec).toHaveAttribute('data-section', '12')
  await expect(app.getByRole('heading', { level: 1, name: 'Currency and digital-asset forwards' })).toBeVisible()
  // formulas are set, numbered as the PDF numbers them, and no LaTeX is left on the page
  expect(await sec.locator('.katex').count()).toBeGreaterThan(5)
  await expect(sec.locator('.mr-eq').first()).toContainText('(24)')      // (20) until v1.14, (21) until v1.15: a new display in §9 moves every later one up
  const words = await sec.locator('.mr-prose').first().evaluate(el => { const c = el.cloneNode(true); c.querySelectorAll('.katex, code').forEach(x => x.remove()); return c.textContent })
  expect(words, 'no LaTeX command or stray dollar in the text').not.toMatch(/\\[a-zA-Z]+|\$/)
  expect(words).toContain('covered interest parity')

  // beside it: the inventory's rows for this section, its status, and its workbooks
  const ev = app.getByTestId('mr-evidence')
  await expect(ev.getByTestId('mr-status')).toHaveText('AN OUTSIDE VALIDATOR IS WANTED')
  await expect(ev.getByTestId('mr-model')).toHaveCount(4)        // the forward beyond the last quote has a row of its own since 0.22.0
  await expect(ev.getByTestId('mr-model').first()).toContainText('Reference comparisons')
  await expect(ev.getByTestId('mr-export-fx_forward')).toBeVisible()
  await expect(ev.getByTestId('mr-export-crypto_ndf')).toBeVisible()

  // the worked table: the fair forward of the sample inputs, repriced when the agreed price is typed over, a dash for nonsense
  const worked = app.getByTestId('mr-worked-ndf')
  await expect(worked.getByTestId('mr-ndf-F')).toHaveText('100,249.63')
  await expect(worked.getByTestId('mr-ndf-npv')).toHaveText('-499')
  await worked.getByTestId('mr-ndf-K').fill('99,000')
  await expect(worked.getByTestId('mr-ndf-npv')).toHaveText('12,372')
  await worked.getByTestId('mr-ndf-K').fill('abc')
  await expect(worked.getByTestId('mr-ndf-K')).toHaveAttribute('aria-invalid', 'true')
  await expect(worked.getByTestId('mr-ndf-npv')).toHaveText('—')
  await worked.getByRole('button', { name: 'RESET' }).click()
  await expect(worked.getByTestId('mr-ndf-npv')).toHaveText('-499')
  await expectNoHorizontalOverflow(app.getByTestId('mr'), 'a section with its evidence')

  // a reference in the text is a link (it has an address and takes the keyboard) and goes to the section it names
  const ref = sec.locator('a[data-sec="s13"]').first()
  await expect(ref).toHaveAttribute('href', '/methodology/13')
  await ref.focus()
  await app.keyboard.press('Enter')
  await expect(app).toHaveURL(/\/methodology\/13$/)
  await expect(app.locator('.ab-link', { hasText: 'METHODOLOGY' }), 'the top bar still says where you are').toHaveClass(/is-on/)
  await expect(app.getByRole('heading', { level: 1, name: 'FX options' })).toBeVisible()
  await expect(app.getByTestId('mr-evidence').getByTestId('mr-model')).toHaveCount(6)
  // the syllabus opens the section's own parts, and the pager walks on
  await rail.getByTestId('mr-go-17').click()
  await expect(rail.locator('.mr-sub')).toHaveCount(5)
  await rail.getByTestId('mr-go-10').click()
  await expect(app.getByTestId('mr-worked-cva').getByTestId('mr-cva-out')).not.toHaveText('—')
  await expect(app.getByTestId('mr-section').locator('.mr-eq').first()).toContainText('(18)')      // (14) until v1.14, (15) until v1.15

  // the reference table, the workbooks and the document's own page
  await rail.getByTestId('mr-go-18').click()
  await expect.poll(() => app.getByTestId('mr-section').locator('.mr-table tbody tr').count()).toBeGreaterThan(50)
  await expectNoHorizontalOverflow(app.getByTestId('mr'), 'the reference table')
  await rail.getByTestId('mr-go-replications').click()
  await expect.poll(() => app.getByTestId('mr-replications').locator('.doc-card').count()).toBeGreaterThan(8)
  await rail.getByTestId('mr-go-about').click()
  await expect(app.getByTestId('mr-about')).toContainText('Version history')
  await expect(app.getByTestId('mr-about')).toContainText('1.12 (10 November 2026)')
  await expect(app.getByTestId('mr-about')).toContainText('Hull, J. and White, A. (2012)')
  await app.getByTestId('mr-prev').click()
  await expect(app).toHaveURL(/\/methodology\/findings$/)
  await app.goBack()
  expectClean(problems)
})

test('methodology: a browser that cannot draw the scene is told so, and the pieces and steps are still there', async ({ app, problems }) => {
  await app.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/i.test(kind) ? null : real.call(this, kind, ...rest) }
  })
  await app.goto('/methodology')
  const stage = app.getByTestId('mr-stage')
  await expect(stage).toHaveAttribute('data-scene', 'off', { timeout: 20_000 })
  await expect(app.getByTestId('mr-no-scene')).toBeVisible()
  for (const id of ['app', 'api', 'pg', 'chain', 'venue']) await expect(app.getByTestId(`mr-piece-${id}`)).toBeVisible()
  await app.getByTestId('mr-step-4').click()
  await expect(app.getByTestId('mr-say')).toContainText('POST /api/book/package')
  await app.getByTestId('mr-piece-pg').click()
  await expect(app.getByTestId('mr-piece')).toContainText('row-level security')
  await expectNoHorizontalOverflow(app.getByTestId('mr'), 'the system page without the scene')
  // three.js says in the console that it could not make a context: that is the case under test, and the only thing allowed
  expect(problems.filter(x => !/WebGL|webgl|context/i.test(x)), `other problems:\n${problems.join('\n')}`).toEqual([])
})
