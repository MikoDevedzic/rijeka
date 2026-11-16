// How the system is built, as the methodology's first page draws it: the app a trader uses in the middle, the API
// behind it, each piece on the host it runs on, and three things followed through them step by step: a trade, a
// change to the code on its way to production, and what the scheduler does by itself. Every sentence here restates
// docs/architecture.md (the map the architect keeps); when the map changes, this changes with it.
// architecture.test.js holds each route named here to the API's own routers, the batch cadences to the scheduler's
// defaults, the six checks to the CI workflow's jobs and each gate to its definition in .claude/agents; the
// sentences themselves are held by the architect's reading.
//
// A colour says which kind of piece it is. Brass stays what it is everywhere in Rijeka: what is on chain.
export const KINDS = {
  people: { name: 'WHAT PEOPLE OPEN', css: 'var(--text)', line: 0xe9e3d3, body: 0x2b4a43, lit: 0x3d6258 },
  core:   { name: 'THE API', css: 'var(--cyan)', line: 0x7fd3cc, body: 0x1c4b49, lit: 0x27696a },
  store:  { name: 'WHERE IT IS KEPT', css: 'var(--blue)', line: 0x8fc1e6, body: 0x20405a, lit: 0x2d5a7d },
  chain:  { name: 'ON CHAIN', css: 'var(--accent-hi)', line: 0xf1d488, body: 0x4f4118, lit: 0x6e5a1f },
  feed:   { name: 'MARKET DATA COMING IN', css: 'var(--purple)', line: 0xc1a6ee, body: 0x393263, lit: 0x4f458a },
  other:  { name: 'OTHER SERVICES', css: 'var(--rf-basis)', line: 0xe8a6d0, body: 0x4a2f43, lit: 0x66405c },
  ship:   { name: 'HOW A CHANGE SHIPS', css: 'var(--up)', line: 0x8fe0ae, body: 0x1f4a35, lit: 0x2c6a4b },
}

// The hosts: what stands on a slab runs there. x, z: its middle; w, d: its size; side: its name stands beside it.
export const HOSTS = [
  { id: 'github', name: 'GITHUB', x: -3.55, z: -9.6, w: 26.5, d: 3.6 },
  { id: 'netlify', name: 'NETLIFY', x: -9.6, z: 3.4, w: 5.6, d: 4.4 },
  { id: 'browser', name: 'THE TRADER\'S BROWSER', x: 0, z: 5.0, w: 6.4, d: 3.6 },
  { id: 'render', name: 'RENDER', x: 0, z: -2.6, w: 7.0, d: 4.6, side: true },
  { id: 'supabase', name: 'SUPABASE', x: 9.9, z: -1.8, w: 6.2, d: 5.0 },
]

// The reviewers a change passes (CLAUDE.md, .claude/agents): each has one job and is called when a change touches
// its area. Each has a colour of its own, from the tokens, so that the figures in one row can be told apart; none is
// brass, which is what is on chain.
export const GATES = [
  { id: 'quinn', name: 'QUINN', role: 'Browser tester', css: 'var(--cyan)', line: 0x7fd3cc, note: 'Clicks through the real app on a local copy of the whole system before a change ships.' },
  { id: 'ada', name: 'ADA', role: 'Numbers guardian', css: 'var(--rf-vol)', line: 0xcfe08a, note: 'Runs the QuantLib reference suite, the Excel replications and the pinned sample book. Every number that moved is explained.' },
  { id: 'emmy', name: 'EMMY', role: 'Model validator', css: 'var(--purple)', line: 0xc1a6ee, note: 'Each calculation has a reference comparison, an Excel replication and a methodology section, or the model inventory says which is missing.' },
  { id: 'iris', name: 'IRIS', role: 'Design keeper', css: 'var(--rf-basis)', line: 0xe8a6d0, note: 'One way of setting type, figures and colour on every screen.' },
  { id: 'vera', name: 'VERA', role: 'Independent reviewer', css: 'var(--text-hi)', line: 0xf6f1e4, note: 'Reads the change cold, without the author\'s reasoning, and looks for what it breaks in code that already works.' },
  { id: 'magnus', name: 'MAGNUS', role: 'Security reviewer', css: 'var(--red)', line: 0xf0828c, note: 'Sign-in, roles, tenancy, keys, public endpoints and anything that shows user-supplied text.' },
  { id: 'nikola', name: 'NIKOLA', role: 'Architect', css: 'var(--blue)', line: 0x8fc1e6, note: 'Keeps this map true to the code, and each new piece in the pattern the system already has for its kind.' },
  { id: 'edgar', name: 'EDGAR', role: 'Database keeper', css: 'var(--amber)', line: 0xe9975a, note: 'Migrations are one feature each, safe to run again and locked down; the schema file agrees with them.' },
  { id: 'marco', name: 'MARCO', role: 'First-time visitor', css: 'var(--rf-fx)', line: 0x6fd0c0, note: 'Walks the app cold, as someone who has never seen it, before a release a newcomer will meet: a picture at every stop, read with ten minutes and no knowledge of the code. He reports what could not be worked out, and fixes nothing.' },
]
// The six checks GitHub runs on the commit that ships (.github/workflows/ci.yml: each is a job's name). They are
// the green of how a change ships, each lamp a step lighter than the one before: a colour a reviewer has would
// mean two things in one row.
export const CHECKS = ['backend tests', 'frontend build', 'registry contract tests', 'integration tests', 'browser journeys', 'self-host smoke']
  .map((name, i) => ({ name, css: 'var(--up)', line: 0x8fe0ae, tint: 0.6 + 0.08 * i }))

// p: where it stands (x across, z toward the reader); shape: what it is drawn as; h: how high its name sits; cy: where
// its joins meet it; big: drawn larger (the app, which the picture is built around); plain: named without a second
// line; agent: a reviewer, drawn as a figure; gate: its place in the line a change passes; css, line: a colour of its own
export const PIECES = [
  { id: 'app', kind: 'people', name: 'THE RIJEKA APP', sub: 'app.rijeka.app, in the trader\'s browser', p: [0, 5.0], shape: 'screen', h: 3.35, cy: 1.5, big: true,
    note: 'React with Vite, a static build served from Netlify. It talks to the API with the user\'s token and follows the trades table over realtime, so the blotter moves without a reload.' },
  { id: 'files', kind: 'people', name: 'APP FILES', sub: 'a static build', p: [-10.7, 2.6], shape: 'files', h: 1.5, cy: 0.6,
    note: 'The app built into static files. Netlify hands them to the browser and computes nothing: the app runs in the browser, and every figure on it comes from the API.' },
  { id: 'land', kind: 'people', name: 'PUBLIC SITE', sub: 'rijeka.app, the verifier', p: [-8.3, 4.5], shape: 'files', h: 1.2, cy: 0.45, small: true,
    note: 'The landing pages, the public tools and the verifier, deployed separately from the app. The verifier reads the registry directly; nothing in it trusts Rijeka\'s servers.' },
  { id: 'api', kind: 'core', name: 'THE API', sub: 'the engine: Python, one process', p: [0, -2.6], shape: 'core', h: 2.5, cy: 1.0,
    note: 'One FastAPI process, in the same region as the database. Pricing is numpy and scipy on the request path, with curve and trade caches. The scheduler runs the batches inside the same process: digital-asset marks every ten minutes; spots, news and digital-asset fixings every thirty; market data, marks, P&L, risk and credit every two hours, one row a day.' },
  { id: 'auth', kind: 'store', name: 'SIGN-IN', sub: 'Supabase Auth', p: [8.6, -3.0], shape: 'token', h: 1.0, cy: 0.4,
    note: 'Supabase Auth issues short-lived signed tokens. The API never sees a password: it checks each token against the public key.' },
  { id: 'pg', kind: 'store', name: 'DATABASE', sub: 'Postgres', p: [11.1, -1.0], shape: 'db', h: 1.9, cy: 0.75,
    note: 'Postgres, with row-level security on every table, so a firm reads only its own rows whichever road the request takes. A schema change reaches it only through the API\'s own migration runner, from an approved list.' },
  { id: 'chain', kind: 'chain', name: 'THE REGISTRY', sub: 'Sepolia', p: [10.8, 6.0], shape: 'blocks', h: 2.1, cy: 0.8,
    note: 'The registry contract on Sepolia. No owner, no administrative function. A confirmation is the keccak256 hash of the canonical record, signed by both parties under EIP-712.' },
  { id: 'pub', kind: 'feed', name: 'PUBLIC MARKET DATA', sub: 'central banks, treasuries', p: [-10.4, -2.6], shape: 'hex', h: 0.95, cy: 0.3,
    note: 'Rates from central banks and treasuries, FX spot from ECB reference rates, digital-asset spot from Coinbase. Curves are rebuilt every two hours, one row a day. On the hosted demo the rates and G10 FX vol surfaces are synthetic and labelled as such.' },
  { id: 'venue', kind: 'feed', name: 'DERIBIT', sub: 'option marks, forwards', p: [-5.6, -5.2], shape: 'hex', h: 0.95, cy: 0.3,
    note: 'Deribit\'s public API: option marks read at a quarter, a half and three quarters of the forward call delta for each expiry, the forward of each expiry, and the daily delivery price at 08:00 UTC, for BTC, ETH and SOL. Three requests every ten minutes.' },
  { id: 'ai', kind: 'other', name: 'ANTHROPIC API', sub: 'Prometheus, read-only tools', p: [4.9, -5.6], shape: 'hex', h: 0.95, cy: 0.3,
    note: 'Prometheus, the news summaries and the book brief. It reads the desk\'s tables through read-only tools and changes nothing.' },
  { id: 'tg', kind: 'other', name: 'TELEGRAM', sub: 'a mirror of trade cards', p: [5.9, 8.0], shape: 'hex', h: 0.95, cy: 0.3,
    note: 'A mirror of the messenger\'s trade cards, when a desk has it configured.' },
  { id: 'branch', kind: 'ship', name: 'A BRANCH', sub: 'one change', p: [-14.3, -9.4], shape: 'node', h: 1.15, cy: 0.5, plain: true,
    note: 'Every change is made on a branch. Nothing on a branch touches production.' },
  { id: 'patrick', kind: 'ship', name: 'PATRICK', sub: 'Product lead', p: [-15.7, -10.2], shape: 'agent', h: 1.6, cy: 0.9, agent: true, css: 'var(--text-mute)', line: 0x8a9f94,
    note: 'Holds the mission and ranks what would most strengthen it: what to do next, for whom, and what to stop. He proposes; the owner decides. He builds and ships nothing.' },
  { id: 'petra', kind: 'ship', name: 'PETRA', sub: 'Project manager', p: [-12.9, -10.2], shape: 'agent', h: 2.15, cy: 0.9, agent: true, css: 'var(--text-dim)', line: 0xa9b9ae,
    note: 'Records every proposal and decision, with its status, before work starts.' },
  ...GATES.map((g, i) => ({ id: g.id, kind: 'ship', name: g.name, sub: g.role, p: [-10.7 + 1.2 * i, -10.2], shape: 'agent', h: i % 2 ? 2.15 : 1.6, cy: 0.9, agent: true, gate: i, css: g.css, line: g.line, note: g.note })),
  { id: 'ci', kind: 'ship', name: 'SIX CHECKS', sub: 'on the commit that ships', p: [0.7, -9.4], shape: 'checks', h: 1.25, cy: 0.5, plain: true,
    note: 'Backend tests, frontend build, registry contract tests, integration tests, browser journeys and a self-host smoke test, run by GitHub on the commit that ships. All six must pass.' },
  { id: 'main', kind: 'ship', name: 'MAIN', sub: 'protected, forward only', p: [3.1, -9.4], shape: 'node', h: 1.15, cy: 0.5, plain: true,
    note: 'The branch production is built from. It is protected: it moves only forward, and only to a commit whose six checks passed.' },
  { id: 'jarvis', kind: 'ship', name: 'JARVIS', sub: 'Release manager', p: [4.8, -10.2], shape: 'agent', h: 2.15, cy: 0.9, agent: true, css: 'var(--up)', line: 0x8fe0ae,
    note: 'Follows the release checklist and reads the commit back from production before anything is called live.' },
  { id: 'release', kind: 'ship', name: 'RELEASE', sub: 'what the app is built from', p: [6.9, -9.4], shape: 'node', h: 1.15, cy: 0.5, plain: true,
    note: 'The branch the app is built from. When a change touches the API, it moves to the new commit only after the live API reports that commit; a change that leaves the API as it is, it follows at once. Either way the app never runs ahead of its API.' },
  { id: 'grace', kind: 'ship', name: 'GRACE', sub: 'Operations keeper', p: [8.5, -10.2], shape: 'agent', h: 2.15, cy: 0.9, agent: true, css: 'var(--text)', line: 0xe9e3d3,
    note: 'Holds what the hosted system runs on against what is asked of it: machine sizes, the database\'s memory and connections, the cost of each action, what the scheduler recorded. Read-only: a change of size is the owner\'s. She writes the account of an outage.' },
]

// each join, from the piece that asks to the piece that answers; lift: where the arc must clear what stands between;
// flat: a straight line along the ground (the line a change travels past the gates); at: where along it its words stand
export const JOINS = [
  { id: 'files_app', a: 'files', b: 'app', lift: 2.4, says: 'the app\'s files, once' },
  { id: 'app_api', a: 'app', b: 'api', lift: 2.2, says: 'HTTPS, the user\'s token' },
  { id: 'app_auth', a: 'app', b: 'auth', lift: 4.6, says: 'sign-in' },
  { id: 'pg_app', a: 'pg', b: 'app', lift: 5.6, at: 0.28, says: 'realtime, filtered by row-level security' },
  { id: 'app_pg', a: 'app', b: 'pg', lift: 3.0, at: 0.62, says: 'a firm\'s reference data, under row-level security' },
  { id: 'api_pg', a: 'api', b: 'pg', says: 'SQL' },
  { id: 'api_auth', a: 'api', b: 'auth', says: 'checks the token by public key' },
  { id: 'api_chain', a: 'api', b: 'chain', lift: 3.4, says: 'anchor, amend, terminate' },
  { id: 'api_ai', a: 'api', b: 'ai', says: 'read-only tools' },
  { id: 'api_tg', a: 'api', b: 'tg', lift: 4.4, says: '' },
  { id: 'api_pub', a: 'pub', b: 'api', says: 'rebuilt every 2 hours, spots' },
  { id: 'api_venue', a: 'venue', b: 'api', says: 'every 10 minutes' },
  { id: 'land_api', a: 'land', b: 'api', lift: 3.0, says: 'pulse, calendar, register' },
  { id: 'land_chain', a: 'land', b: 'chain', lift: 5.6, says: 'reads the registry directly' },
  { id: 'gate', a: 'branch', b: 'ci', flat: true, says: 'past each gate' },
  { id: 'ci_main', a: 'ci', b: 'main', says: '' },
  { id: 'main_api', a: 'main', b: 'api', says: 'Render rebuilds the API' },
  { id: 'api_rel', a: 'api', b: 'release', lift: 2.6, says: 'reports its commit' },
  { id: 'rel_files', a: 'release', b: 'files', lift: 6.4, says: 'Netlify rebuilds the app' },
]

// What can be followed. A step: k (its test id), name, the pieces and joins it uses, what it says, the routes it
// names; gates: the change is travelling past the gates; passed: the gates are behind it; checks: the six checks
// are running; checked: they have passed.
export const STORIES = [
  { id: 'trade', name: 'A TRADE', follow: 'FOLLOW A TRADE', lede: 'One trade, from the password to the block.', steps: [
      { k: '1', name: 'SIGN IN', pieces: ['files', 'app', 'auth', 'api'], joins: ['files_app', 'app_auth', 'app_api', 'api_auth'],
        say: 'The browser loads the app\'s files from Netlify, once. The app signs in and gets a short-lived token. Every request to the API carries it, and the API checks it against the sign-in service\'s public key. The API never sees a password.' },
      { k: '2', name: 'PRICE', pieces: ['app', 'api', 'pg'], joins: ['app_api', 'api_pg'],
        say: 'The ticket posts its terms. The pricer bootstraps the account\'s latest market snapshot and returns the value, the sensitivities and the cashflows. Nothing is saved.',
        routes: ['POST /price', 'POST /api/currency/forward/price', 'POST /api/currency/option/price'] },
      { k: '3', name: 'XVA', pieces: ['app', 'api', 'pg'], joins: ['app_api', 'api_pg'],
        say: 'The counterparty\'s netting set is simulated with the trade and without it, on the same paths. The difference, term by term, is the charge the desk quotes. The Monte Carlo runs inside the request.',
        routes: ['POST /api/xva/incremental'] },
      { k: '4', name: 'BOOK', pieces: ['app', 'api', 'pg'], joins: ['app_api', 'api_pg', 'pg_app'],
        say: 'The trade, its legs and its BOOKED event are written in one transaction. A package of legs is booked whole or not at all, under one trade ID with a leg ID for each. The blotter hears of it over realtime.',
        routes: ['POST /api/book/trade', 'POST /api/book/package'] },
      { k: '5', name: 'CONFIRM', pieces: ['app', 'api', 'chain', 'pg', 'tg'], joins: ['app_api', 'api_chain', 'api_pg', 'api_tg'],
        say: 'Both parties derive the same canonical record from their own bookings and each signs it. The API\'s relayer anchors the pair of signatures on the registry and pays the gas. The CONFIRMED event carries the transaction.',
        routes: ['POST /api/chain/confirm/{id}', 'POST /api/chain/confirm-package'] },
      { k: '6', name: 'VERIFY', pieces: ['land', 'chain'], joins: ['land_chain'],
        say: 'Anyone with the proof can check it. The verifier is a static page: it re-derives the record\'s hash and reads the registry itself. It asks Rijeka\'s servers for nothing.' },
      { k: '7', name: 'THE BATCHES', pieces: ['api', 'pub', 'venue', 'pg', 'ai'], joins: ['api_pub', 'api_venue', 'api_pg', 'api_ai'],
        say: 'Every two hours the scheduler rebuilds market data from public sources and stores, one row a day, a mark for each trade, the attributed P&L, the risk report and the counterparty-credit run. The venue\'s marks are read every ten minutes; spots, news and digital-asset fixings every thirty. Prometheus reads the same tables through read-only tools.' },
  ] },
  { id: 'change', name: 'A CHANGE', follow: 'FOLLOW A CHANGE', lede: 'A change to the code on its way to production, and who looks at it on the way.', steps: [
    { k: 'c1', name: 'PROPOSE', pieces: ['patrick', 'petra', 'branch'], joins: [],
      say: 'The product lead ranks what would most strengthen the mission, and the owner decides. A change then starts as a recorded decision and a branch. Nothing on a branch touches production.' },
    { k: 'c2', name: 'THE GATES', pieces: ['branch', ...GATES.map(g => g.id)], joins: ['gate'], gates: true,
      say: 'Each gate is a reviewer with one job, called when a change touches its area: the app in a real browser, the numbers, the models, the design, a cold read of the change, security, the architecture, the database, and a first look by someone who has never seen the app. What a gate finds is fixed or answered before the change goes on, and what it missed is written into its own instructions, so the next change is read by a reviewer that knows.' },
    { k: 'c3', name: 'SIX CHECKS', pieces: ['ci', 'main'], joins: ['ci_main'], passed: true, checks: true,
      say: 'GitHub runs six checks on the commit that ships: backend tests, frontend build, registry contract tests, integration tests, browser journeys and a self-host smoke test. Main is protected and moves only when all six pass.' },
    { k: 'c4', name: 'THE API DEPLOYS', pieces: ['main', 'api', 'pg'], joins: ['main_api', 'api_pg'], passed: true, checked: true,
      say: 'Render rebuilds the API from main when a change touches it. As it starts, the API applies the database changes on an approved list and nothing else.' },
    { k: 'c5', name: 'THE APP FOLLOWS', pieces: ['api', 'release', 'files'], joins: ['api_rel', 'rel_files'], passed: true, checked: true,
      say: 'When the change touched the API, the release branch moves to the new commit once the live API reports it; when it did not, the branch follows at once. Netlify rebuilds the app from that branch, so the app never runs ahead of its API.' },
    { k: 'c6', name: 'READ BACK', pieces: ['jarvis', 'api', 'files', 'app'], joins: ['files_app', 'app_api'], passed: true, checked: true,
      say: 'The release manager reads the commit back from the live API and the live app. Only then is the change called live.' },
    { k: 'c7', name: 'KEPT RUNNING', pieces: ['grace', 'api', 'pg'], joins: ['api_pg'], passed: true, checked: true,
      say: 'The operations keeper holds what the system runs on against what is asked of it: the machine sizes, the database\'s memory and connections, what each action costs the API\'s one CPU, what the scheduler recorded. She looks before a launch, after a change of host or size and when a release adds work, and writes the account of an outage the day it happens.' },
  ] },
  { id: 'clock', name: 'THE CLOCK', follow: 'FOLLOW THE CLOCK', lede: 'What the system does by itself, with nobody signed in. The scheduler runs inside the API.', steps: [
    { k: 't0', name: 'EVERY MINUTE', pieces: ['api', 'chain', 'pg'], joins: ['api_chain', 'api_pg'],
      say: 'Every pass of the scheduler\'s loop, about a minute: it follows a confirmation whose block had not arrived when the request returned, and finishes it when the chain has it. One cheap query when nothing is waiting; it needs a table the hosted demo does not have yet, and does nothing there.' },
    { k: 't1', name: 'EVERY 10 MINUTES', pieces: ['venue', 'api', 'pg'], joins: ['api_venue', 'api_pg'],
      say: 'Every ten minutes: three requests to the venue for option marks and forwards on BTC, ETH and SOL, and three for the spot, stored as the digital-asset surfaces.' },
    { k: 't2', name: 'EVERY 30 MINUTES', pieces: ['pub', 'api', 'pg', 'ai'], joins: ['api_pub', 'api_pg', 'api_ai'],
      say: 'Every thirty minutes: FX and digital-asset spot, the news feeds and their summaries, and the fixings of digital-asset trades that have reached their date.' },
    { k: 't3', name: 'EVERY 2 HOURS', pieces: ['pub', 'api', 'pg'], joins: ['api_pub', 'api_pg'],
      say: 'Every two hours: market data is rebuilt from central banks and treasuries, one row a day, and the day\'s marks, P&L, market risk and counterparty credit are computed and stored for each account that has that module switched on.' },
  ] },
]
// every step of every story, for what is true of all of them
export const STEPS = STORIES.flatMap(s => s.steps)

// The API's health answer (GET /api/ops/health), as the strip under the scene words it.
export const HEALTH_CHECKS = [
  ['news', 'NEWS'], ['spots', 'SPOTS'], ['market_data', 'CURVES AND VOLS'], ['crypto_marks', 'DIGITAL-ASSET MARKS'],
  ['crypto_fixings', 'DIGITAL-ASSET FIXINGS'], ['pnl', 'P&L'], ['risk', 'MARKET RISK'], ['ccr', 'COUNTERPARTY CREDIT'],
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "2026-11-10T23:50:22+00:00" → "23:50 UTC"; "2026-11-10" → "10 Nov"; anything else as it is; nothing → a dash
export function whenSaid(last) {
  if (last == null || last === '') return '—'
  const s = String(last)
  const t = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  if (t) return `${t[4]}:${t[5]} UTC`
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (d && MONTHS[Number(d[2]) - 1]) return `${Number(d[3])} ${MONTHS[Number(d[2]) - 1]}`
  return s
}
// the strip's cells from the health answer: [{ label, value, state: 'ok' | 'stale' | null }]; [] when there is no answer
export function healthCells(h) {
  if (!h || typeof h !== 'object') return []
  const m = h.migrations || {}
  const cells = [
    { label: 'VERSION', value: h.version || '—', state: null },
    { label: 'COMMIT', value: h.commit ? String(h.commit).slice(0, 7) : '—', state: null },
    { label: 'MIGRATIONS', value: Number.isFinite(m.applied) && Number.isFinite(m.approved) ? `${m.applied} of ${m.approved} applied` : '—',
      state: Number.isFinite(m.problems) && Number.isFinite(m.pending) ? (m.problems > 0 || m.pending > 0 ? 'stale' : 'ok') : null },
    { label: 'BROWSER ERRORS, 24H', value: h.client_errors && Number.isFinite(h.client_errors.last_24h) ? String(h.client_errors.last_24h) : '—', state: null },
  ]
  for (const [key, label] of HEALTH_CHECKS) {
    const c = h.checks && h.checks[key]
    if (c) cells.push({ label, value: whenSaid(c.last), state: c.ok ? 'ok' : 'stale' })
  }
  return cells
}
