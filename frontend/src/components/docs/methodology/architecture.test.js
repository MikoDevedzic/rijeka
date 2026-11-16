// The system page names routes, says how often the batches run, names the six checks a commit must pass and the
// reviewers a change goes by. Each is read here from its own source (the API, the scheduler, the CI workflow, the
// reviewers' definitions), so the page cannot go on naming a route that was renamed, a cadence that was changed, a
// check that was dropped or a reviewer who is not there.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHECKS, GATES, HOSTS, JOINS, PIECES, STEPS, STORIES } from './architecture-data'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const BACKEND = path.join(ROOT, 'backend')
const read = (f) => fs.readFileSync(path.join(BACKEND, f), 'utf8')
// each route the page names: the router file, the prefix the app mounts it under, the decorator's own path
const ROUTES = {
  'POST /price': ['api/routes/pricer.py', '', '/price'],
  'POST /api/currency/forward/price': ['api/routes/currencies.py', '/api/currency', '/forward/price'],
  'POST /api/currency/option/price': ['api/routes/currencies.py', '/api/currency', '/option/price'],
  'POST /api/xva/incremental': ['api/routes/xva.py', '/api/xva', '/incremental'],
  'POST /api/book/trade': ['api/routes/booking.py', '/api/book', '/trade'],
  'POST /api/book/package': ['api/routes/booking.py', '/api/book', '/package'],
  'POST /api/chain/confirm/{id}': ['api/routes/chain.py', '/api/chain', '/confirm/{trade_id}'],
  'POST /api/chain/confirm-package': ['api/routes/chain.py', '/api/chain', '/confirm-package'],
}
const step = (k) => STEPS.find(s => s.k === k)

describe('how the system is built, against the API', () => {
  it('every route a step names is a route the API has, under the prefix it is mounted at', () => {
    const named = STEPS.flatMap(s => s.routes || [])
    expect(named.sort()).toEqual(Object.keys(ROUTES).sort())
    const main = read('main.py')
    for (const [name, [file, prefix, sub]] of Object.entries(ROUTES)) {
      const src = read(file)
      expect(src, `${name}: @router.post("${sub}") in ${file}`).toMatch(new RegExp(`@router\\.post\\(\\s*["']${sub.replace(/[{}/]/g, '\\$&')}["']`))
      if (prefix) expect(src.includes(`prefix="${prefix}"`) || main.includes(`prefix="${prefix}"`), `${name}: the prefix ${prefix}`).toBe(true)
    }
  })
  it('says the batches run as the scheduler runs them by default', () => {
    const sched = read('scheduler.py')
    const def = (name) => Number((new RegExp(`${name}["'],\\s*["']?([0-9.]+)`).exec(sched) || [])[1])
    expect(def('RIJEKA_SCHEDULER_DAILY_HOURS'), 'market data, marks, P&L, risk and credit').toBe(2)
    expect(def('RIJEKA_SCHEDULER_MINUTES'), 'spots, news, summaries, fixings').toBe(30)
    expect(def('RIJEKA_SCHEDULER_MARKS_MINUTES'), 'the venue\'s marks').toBe(10)
    const api = PIECES.find(p => p.id === 'api').note, batches = step('7').say
    for (const text of [api, batches]) {
      expect(text).toMatch(/every two hours/i)
      expect(text).toMatch(/every ten minutes/i)
      expect(text).toMatch(/every thirty/i)
    }
    expect(PIECES.find(p => p.id === 'pub').note).toMatch(/every two hours/)
    // the clock tells the same three cadences, one a step
    expect(step('t1').say).toMatch(/every ten minutes/i)
    expect(step('t2').say).toMatch(/every thirty minutes/i)
    expect(step('t3').say).toMatch(/every two hours/i)
    expect(JOINS.find(j => j.id === 'api_venue').says).toBe('every 10 minutes')
    expect(JOINS.find(j => j.id === 'api_pub').says).toMatch(/every 2 hours/)
  })
})

describe('the clock, against the scheduler', () => {
  it('each step of the clock names the jobs of one of the scheduler\'s groups', () => {
    const sched = read('scheduler.py')
    const group = (g) => [...sched.matchAll(new RegExp(`\\(\\s*["'](\\w+)["'],\\s*["']${g}["'],\\s*lambda`, 'g'))].map(m => m[1]).sort()      // a job: its name, its group, what it runs
    expect(group('every_cycle')).toEqual(['chain_reconcile', 'health_alerts'])
    expect(group('marks')).toEqual(['crypto_marks'])
    expect(group('half_hourly')).toEqual(['crypto_fixings', 'news', 'spots', 'summaries'])
    expect(group('daily')).toEqual(['ccr', 'market_data', 'pnl', 'risk'])
    // what each step says of its group: a word for each job
    for (const [k, words] of [['t0', ['confirmation', 'problem']], ['t1', ['marks', 'forwards', 'spot']], ['t2', ['spot', 'news', 'summaries', 'fixings']], ['t3', ['market data', 'P&L', 'market risk', 'counterparty credit']]]) {
      for (const w of words) expect(step(k).say.toLowerCase(), `${k}: ${w}`).toContain(w.toLowerCase())
    }
    expect(step('t3').say, 'a batch runs for the accounts that have its module on, not for every book').toMatch(/module switched on/)
  })
})

describe('how a change ships, against the repository', () => {
  it('the six checks are the six jobs of the CI workflow, by name', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const jobs = [...ci.slice(ci.indexOf('\njobs:')).matchAll(/^ {4}name: (.+)$/gm)].map(m => m[1].trim())
    expect(CHECKS.map(c => c.name).sort()).toEqual(jobs.sort())
    expect(CHECKS).toHaveLength(6)
    for (const c of CHECKS) { expect(step('c3').say, c.name).toContain(c.name.replace(' smoke', '')); expect(PIECES.find(p => p.id === 'ci').note.toLowerCase(), c.name).toContain(c.name.replace(' smoke', '')) }
  })
  it('each reviewer drawn has a definition, and none that has one is left out', () => {
    const defined = fs.readdirSync(path.join(ROOT, '.claude/agents')).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort()
    const drawn = PIECES.filter(p => p.agent).map(p => p.id).sort()
    expect(drawn).toEqual(defined)
    expect(GATES.map(g => g.id)).toEqual(PIECES.filter(p => p.gate != null).sort((a, b) => a.gate - b.gate).map(p => p.id))
    // brass is what is on chain, everywhere in Rijeka: no reviewer and no check takes it
    for (const x of [...GATES, ...CHECKS, ...PIECES.filter(p => p.agent)]) { expect(x.css, x.name).not.toMatch(/accent|chain/); expect(x.line, x.name).not.toBe(0xf1d488) }
  })
})

describe('the picture holds together', () => {
  it('every join and every step names pieces and joins that are there', () => {
    const ids = new Set(PIECES.map(p => p.id)), joins = new Set(JOINS.map(j => j.id))
    expect(ids.size).toBe(PIECES.length); expect(joins.size).toBe(JOINS.length)
    for (const j of JOINS) { expect(ids.has(j.a), j.id).toBe(true); expect(ids.has(j.b), j.id).toBe(true) }
    for (const s of STEPS) { for (const p of s.pieces) expect(ids.has(p), `${s.k}: ${p}`).toBe(true); for (const j of s.joins) expect(joins.has(j), `${s.k}: ${j}`).toBe(true) }
    expect(new Set(STEPS.map(s => s.k)).size, 'a step\'s key is its own').toBe(STEPS.length)
    expect(STORIES.map(s => s.id)).toEqual(['trade', 'change', 'clock'])
  })
  it('a piece that runs on a host stands on that host\'s slab, and no other piece does', () => {
    const on = (p) => HOSTS.filter(h => Math.abs(p.p[0] - h.x) <= h.w / 2 && Math.abs(p.p[1] - h.z) <= h.d / 2).map(h => h.id)
    const where = { app: 'browser', files: 'netlify', land: 'netlify', api: 'render', auth: 'supabase', pg: 'supabase' }
    for (const p of PIECES) expect(on(p), p.id).toEqual(p.kind === 'ship' ? ['github'] : where[p.id] ? [where[p.id]] : [])
  })
})
