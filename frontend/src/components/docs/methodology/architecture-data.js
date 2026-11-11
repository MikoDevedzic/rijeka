// How the system is built, as the methodology's first page draws it: the pieces, what joins them, and a trade's
// way through. Every sentence here restates docs/architecture.md (the map the architect keeps); when the map
// changes, this changes with it (architecture.test.js holds the names of the routes to the API's own).
//
// A colour says which kind of piece it is. Brass stays what it is everywhere in Rijeka: what is on chain.
export const KINDS = {
  people: { name: 'WHAT PEOPLE OPEN', css: 'var(--text)', line: 0xe9e3d3, body: 0x2b4a43, lit: 0x3d6258 },
  core:   { name: 'THE API', css: 'var(--cyan)', line: 0x7fd3cc, body: 0x1c4b49, lit: 0x27696a },
  store:  { name: 'WHERE IT IS KEPT', css: 'var(--blue)', line: 0x8fc1e6, body: 0x20405a, lit: 0x2d5a7d },
  chain:  { name: 'ON CHAIN', css: 'var(--accent-hi)', line: 0xf1d488, body: 0x4f4118, lit: 0x6e5a1f },
  feed:   { name: 'MARKET DATA COMING IN', css: 'var(--purple)', line: 0xc1a6ee, body: 0x393263, lit: 0x4f458a },
  other:  { name: 'OTHER SERVICES', css: 'var(--rf-basis)', line: 0xe8a6d0, body: 0x4a2f43, lit: 0x66405c },
}

// p: where it stands (x across, z toward the reader); shape: what it is drawn as; h: how high its name sits; cy: where its joins meet it
export const PIECES = [
  { id: 'app', kind: 'people', name: 'THE APP', sub: 'app.rijeka.app', p: [-7.2, -2.4], shape: 'screen', h: 2.45, cy: 1.2,
    note: 'React with Vite, a static build served from Netlify. It talks to the API with the user\'s token and follows the trades table over realtime, so the blotter moves without a reload.' },
  { id: 'land', kind: 'people', name: 'PUBLIC SITE + VERIFIER', sub: 'rijeka.app', p: [-7.6, 3.4], shape: 'screen', small: true, h: 2.0, cy: 1.0,
    note: 'The landing pages, the public tools and the verifier, deployed separately from the app. The verifier reads the registry directly; nothing in it trusts Rijeka\'s servers.' },
  { id: 'api', kind: 'core', name: 'THE API', sub: 'FastAPI, one process', p: [0, 0], shape: 'core', h: 2.75, cy: 1.0,
    note: 'One FastAPI process, in the same region as the database. Pricing is numpy and scipy on the request path, with curve and trade caches. The scheduler runs the batches inside the same process: digital-asset marks every ten minutes, spots and news every thirty, the day\'s marks, P&L, risk and credit once a day.' },
  { id: 'auth', kind: 'store', name: 'SIGN-IN', sub: 'Supabase Auth', p: [4.6, -5.8], shape: 'token', h: 0.95, cy: 0.4,
    note: 'Supabase Auth issues short-lived signed tokens. The API never sees a password: it checks each token against the public key.' },
  { id: 'pg', kind: 'store', name: 'DATABASE', sub: 'Postgres', p: [8.6, -2.6], shape: 'db', h: 1.85, cy: 0.75,
    note: 'Postgres, with row-level security on every table, so a firm reads only its own rows whichever road the request takes. A schema change reaches it only through the API\'s own migration runner, from an approved list.' },
  { id: 'chain', kind: 'chain', name: 'THE REGISTRY', sub: 'Sepolia', p: [6.4, 1.9], shape: 'blocks', h: 2.0, cy: 0.8,
    note: 'The registry contract on Sepolia. No owner, no administrative function. A confirmation is the keccak256 hash of the canonical record, signed by both parties under EIP-712.' },
  { id: 'pub', kind: 'feed', name: 'PUBLIC MARKET DATA', sub: 'central banks, treasuries', p: [-3.6, 6.2], shape: 'hex', h: 0.9, cy: 0.3,
    note: 'Rates from central banks and treasuries, FX spot from ECB reference rates, digital-asset spot from Coinbase. Curves are rebuilt every two hours, one row a day. On the hosted demo the rates and G10 FX vol surfaces are synthetic and labelled as such.' },
  { id: 'venue', kind: 'feed', name: 'DERIBIT', sub: 'option marks, forwards', p: [0.3, 6.8], shape: 'hex', h: 0.9, cy: 0.3,
    note: 'Deribit\'s public API: option marks read at 25 and 50 delta for each expiry, the forward of each expiry, and the daily delivery price at 08:00 UTC, for BTC, ETH and SOL. Three requests every ten minutes.' },
  { id: 'ai', kind: 'other', name: 'ANTHROPIC API', sub: 'Prometheus, read-only tools', p: [4.2, 6.6], shape: 'hex', h: 0.9, cy: 0.3,
    note: 'Prometheus, the news summaries and the book brief. It reads the desk\'s tables through read-only tools and changes nothing.' },
  { id: 'tg', kind: 'other', name: 'TELEGRAM', sub: 'a mirror of trade cards', p: [9.4, 5.6], shape: 'hex', h: 0.9, cy: 0.3,
    note: 'A mirror of the messenger\'s trade cards, when a desk has it configured.' },
]

// each join, from the piece that asks to the piece that answers; lift: where the arc must clear what stands between
export const JOINS = [
  { id: 'app_api', a: 'app', b: 'api', says: 'HTTPS, the user\'s token' },
  { id: 'app_auth', a: 'app', b: 'auth', lift: 3.0, says: 'sign-in' },
  { id: 'pg_app', a: 'pg', b: 'app', lift: 3.6, says: 'realtime, filtered by row-level security' },
  { id: 'api_pg', a: 'api', b: 'pg', says: 'SQL' },
  { id: 'api_auth', a: 'api', b: 'auth', says: 'checks the token by public key' },
  { id: 'api_chain', a: 'api', b: 'chain', says: 'anchor, amend, terminate' },
  { id: 'api_ai', a: 'api', b: 'ai', says: 'read-only tools' },
  { id: 'api_tg', a: 'api', b: 'tg', lift: 2.2, says: '' },
  { id: 'api_pub', a: 'pub', b: 'api', says: 'daily rebuild, spots' },
  { id: 'api_venue', a: 'venue', b: 'api', says: 'every 10 minutes' },
  { id: 'land_api', a: 'land', b: 'api', says: 'pulse, calendar, register' },
  { id: 'land_chain', a: 'land', b: 'chain', lift: 5.2, says: 'reads the registry directly' },
]

export const STEPS = [
  { k: '1', name: 'SIGN IN', pieces: ['app', 'auth', 'api'], joins: ['app_auth', 'app_api', 'api_auth'],
    say: 'The app signs in and gets a short-lived token. Every request to the API carries it, and the API checks it against the sign-in service\'s public key. The API never sees a password.' },
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
  { k: '7', name: 'EVERY NIGHT', pieces: ['api', 'pub', 'venue', 'pg', 'ai'], joins: ['api_pub', 'api_venue', 'api_pg', 'api_ai'],
    say: 'The scheduler rebuilds market data from public sources and the venue\'s marks, then stores a mark for each trade, the attributed P&L, the risk report and the counterparty-credit run. Prometheus reads the same tables through read-only tools.' },
]

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
