// The system page names routes and says how often the batches run. Both are read here from the API's own
// source, so the page cannot go on naming a route that was renamed or a cadence that was changed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PIECES, STEPS } from './architecture-data'

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../backend')
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
    const api = PIECES.find(p => p.id === 'api').note, batches = STEPS.find(s => s.k === '7').say
    for (const text of [api, batches]) {
      expect(text).toMatch(/every two hours/i)
      expect(text).toMatch(/every ten minutes/i)
      expect(text).toMatch(/every thirty/i)
    }
    expect(PIECES.find(p => p.id === 'pub').note).toMatch(/every two hours/)
  })
})
