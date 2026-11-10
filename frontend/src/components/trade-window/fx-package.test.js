import { describe, it, expect } from 'vitest'
import { closedForm, legRisk, legShocks, legWords, packageFlows, packageGap, packageRisk, packageView, payoffAtForward, repricePackage } from './fx-package'
import { TENOR_DAYS, reprice } from './fx-scenario'
import { packageSheetModel } from './fx-export'

// a strip of cash-settled BTC forwards, a month apart, each as the pricing route answers it
const fwd = (over = {}) => ({
  shape: 'FORWARD', direction: 'SELL', pair: 'BTCUSD', base_currency: 'BTC', quote_currency: 'USD', base_notional: 5,
  spot: 100000, forward: 100800, forward_rate: 100500, df_quote: 0.9965, df_base: 0.9885, t: 30 / 365,
  valuation_date: '2026-11-10', settlement_date: '2026-12-10',
  npv: -5 * (100800 - 100500) * 0.9965, spot01: -5000, ir01: 1.2, crybasis01: -4.1, theta: 12,
  ...over,
})
const strip = [
  fwd(),
  fwd({ settlement_date: '2027-01-10', t: 61 / 365, forward: 101600, forward_rate: 101600, df_quote: 0.993, npv: 0, spot01: -5040, ir01: 0, crybasis01: -8.4, theta: 0 }),
  fwd({ direction: 'BUY', settlement_date: '2027-02-10', t: 92 / 365, forward: 102400, forward_rate: 102000, df_quote: 0.9895, npv: 5 * 400 * 0.9895, spot01: 5080, ir01: -5, crybasis01: 12.8, theta: -20 }),
]
const opt = (over = {}) => ({
  shape: 'OPTION', style: 'EUROPEAN', option_type: 'CALL', direction: 'BUY', pair: 'BTCUSD', base_currency: 'BTC', quote_currency: 'USD', base_notional: 10,
  spot: 100000, forward: 100800, strike: 105000, df_quote: 0.9965, t_settle: 30 / 365, t_expiry: 30 / 365, vol_pct: 45,
  valuation_date: '2026-11-10', settlement_date: '2026-12-10', expiry_date: '2026-12-10', settlement_type: 'NON_DELIVERABLE',
  npv: 31000, spot01: 3900, ir01: -2, crybasis01: 9, theta: -700, vega: 1100,
  ...over,
})

describe('the package as the ticket holds it', () => {
  const legs = [{ id: 'a' }, { id: 'b' }]
  it('is nothing without further legs, and whole only when every leg is priced for the terms it shows', () => {
    expect(packageView(strip[0], [], {})).toBeNull()
    const whole = packageView(strip[0], legs, { a: { quote: strip[1], pending: false }, b: { quote: strip[2], pending: false } })
    expect(whole).toMatchObject({ n: 3, pending: false, failed: [] })
    expect(whole.quotes).toEqual(strip)
    expect(packageGap(whole)).toBeNull()
  })
  it('a leg on its way, a leg that failed and a ticket without a price each leave the package unsummed, and say which', () => {
    // a leg being repriced still holds its last quote: that quote is not the leg's, and is not summed
    const waiting = packageView(strip[0], legs, { a: { quote: strip[1], pending: true }, b: { quote: strip[2], pending: false } })
    expect(waiting.quotes).toBeNull()
    expect(waiting.each).toEqual([strip[0], null, strip[2]])
    expect(packageGap(waiting)).toBe('a leg is being priced')
    const failed = packageView(strip[0], legs, { a: { quote: null, error: 'no curve', pending: false }, b: { quote: strip[2], pending: false } })
    expect(failed.failed).toEqual([2])
    expect(packageGap(failed)).toBe('leg 2 could not be priced')
    expect(packageView(strip[0], legs, {}).pending).toBe(true)                   // a leg the table has not heard of yet
    expect(packageGap(packageView(null, legs, { a: { quote: strip[1], pending: false }, b: { quote: strip[2], pending: false } }))).toBe('the ticket is being priced')
  })
})

describe('the footer over a package', () => {
  it('sums each figure over the legs', () => {
    const t = packageRisk(strip)
    expect(t.n).toBe(3)
    expect(t.options).toBe('NONE')
    expect(t.npv).toBeCloseTo(strip[0].npv + strip[2].npv, 6)
    expect(t.spot01).toBe(-5000 - 5040 + 5080)
    expect(t.ir01).toBeCloseTo(1.2 - 5, 9)
    expect(t.crybasis01).toBeCloseTo(-4.1 - 8.4 + 12.8, 9)
    expect(t.theta).toBe(-8)
    expect(t.vega).toBe(0)
  })
  it('reads an older answer by the names it used, and a figure it lacks as nothing', () => {
    const old = { shape: 'FORWARD', npv: 10, delta_quote_per_pct: 7, rho_quote_per_bp: 2, rho_base_per_bp: -3 }
    expect(legRisk(old)).toMatchObject({ npv: 10, spot01: 7, ir01: 2, irQuote: 2, irBase: -3, crybasis01: 3, theta: 0, vega: 0 })
    expect(legRisk({ shape: 'FORWARD', npv: 1, vega: 99 }).vega).toBe(0)        // a forward has no vega, whatever the answer says
  })
  it('says whether the legs are all options, some or none, and gives nothing for a package with a leg missing', () => {
    expect(packageRisk([opt(), opt({ direction: 'SELL', npv: -12000 })]).options).toBe('ALL')
    expect(packageRisk([strip[0], opt()]).options).toBe('SOME')
    expect(packageRisk([strip[0], null])).toBeNull()
    expect(packageRisk([])).toBeNull()
  })
})

describe('the CASHFLOWS tab over a package', () => {
  it('a strip: each leg at (F − K) × N, its present value its NPV, one date each, the package their sum', () => {
    const f = packageFlows(strip, { crypto: true })
    expect(f.legs.map(l => l.amount)).toEqual([-5 * 300, 0, 5 * 400])
    for (const [i, l] of f.legs.entries()) expect(l.pv).toBeCloseTo(strip[i].npv, 6)
    expect(f.legs.every(l => l.cash && l.exchange === null && l.premium === null)).toBe(true)
    expect(f.premium).toBeNull()
    expect(f.amount).toBe(500)
    expect(f.npv).toBeCloseTo(strip[0].npv + strip[2].npv, 6)
    expect(f.dates.map(d => d.date)).toEqual(['2026-12-10', '2027-01-10', '2027-02-10'])
    expect(f.dates.map(d => d.legs)).toEqual([[1], [2], [3]])
  })
  it('legs that settle on one date are netted on it', () => {
    const f = packageFlows([strip[0], fwd({ direction: 'BUY', base_notional: 2, npv: 2 * 300 * 0.9965 })], { crypto: true })
    expect(f.dates).toHaveLength(1)
    expect(f.dates[0]).toMatchObject({ date: '2026-12-10', legs: [1, 2], amount: -1500 + 600 })
  })
  it('a collar: the premiums net on the trade date, the payoffs at today\'s forward on the settlement date', () => {
    const put = opt({ option_type: 'PUT', strike: 102000, npv: 30000 }), call = opt({ direction: 'SELL', strike: 100000, npv: -42000 })
    const f = packageFlows([put, call], { crypto: true })
    expect(f.legs[0].premium).toBe(-30000)                      // bought: paid
    expect(f.legs[1].premium).toBe(42000)                       // sold: received
    expect(f.premium).toBe(12000)
    expect(f.legs[0].amount).toBe(10 * (102000 - 100800))       // the put is in the money at today's forward
    expect(f.legs[1].amount).toBe(-10 * (100800 - 100000))      // the call sold is too, against the desk
    expect(f.npv).toBe(-12000)
    expect(f.dates.map(d => d.date)).toEqual(['2026-11-10', '2026-12-10'])
    expect(f.dates[0]).toMatchObject({ premium: 12000, amount: null, legs: [1, 2] })
    expect(f.dates[1]).toMatchObject({ premium: null, amount: 12000 - 8000 })
  })
  it('a digital pays its payout only through the strike at today\'s forward; a touch is not a fixing\'s to pay', () => {
    expect(payoffAtForward(opt({ style: 'DIGITAL', strike: 100000, payout: 50000, payout_currency: 'QUOTE' }))).toBe(50000)
    expect(payoffAtForward(opt({ style: 'DIGITAL', strike: 101000, payout: 50000, payout_currency: 'QUOTE' }))).toBe(0)
    expect(payoffAtForward(opt({ style: 'DIGITAL', strike: 100000, payout: 1, payout_currency: 'BASE', direction: 'SELL' }))).toBe(-100800)
    expect(payoffAtForward(opt({ style: 'TOUCH', payout: 50000 }))).toBe(0)
  })
  it('a deliverable currency forward exchanges both principals, known today', () => {
    const eur = { shape: 'FORWARD', direction: 'BUY', pair: 'EURUSD', base_currency: 'EUR', quote_currency: 'USD', base_notional: 1e6, quote_notional: 1.08e6,
      forward: 1.0825, forward_rate: 1.08, df_quote: 0.99, settlement_date: '2027-02-12', valuation_date: '2026-11-10', npv: 2475 }
    const f = packageFlows([eur, { ...eur, direction: 'SELL', base_notional: 4e5, quote_notional: 4.32e5, npv: -990 }])
    expect(f.legs[0].exchange).toEqual({ base: 1e6, quote: -1.08e6 })
    expect(f.legs[0].amount).toBeCloseTo(2500, 6)
    expect(f.dates[0]).toMatchObject({ base: 6e5, quote: -6.48e5 })
    expect(f.dates[0].amount).toBeCloseTo(1500, 6)
  })
  it('says a leg in a few words', () => {
    const f = packageFlows([strip[0], opt({ style: 'BARRIER' }), opt({ style: 'TOUCH', strike: null })], { crypto: true })
    const fmt = (n, d) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
    expect(legWords(f.legs[0], { base: 'BTC', fmt })).toBe('SELL 5 BTC FORWARD @ 100,500.00')
    expect(legWords(f.legs[1], { base: 'BTC', fmt })).toBe('BUY 10 BTC CALL @ 105,000.00 (BARRIER)')
    expect(legWords(f.legs[2], { base: 'BTC', fmt })).toBe('BUY 10 BTC TOUCH')
  })
  it('is nothing with a leg missing', () => {
    expect(packageFlows([strip[0], null])).toBeNull()
    expect(packageFlows([])).toBeNull()
  })
  it('the workbook carries every leg, the dates and the totals as sums', () => {
    const put = opt({ option_type: 'PUT', strike: 102000, npv: 30000 })
    const quotes = [strip[0], put]
    const flows = packageFlows(quotes, { crypto: true })
    const m = packageSheetModel({ quotes, flows, crypto: true, dp: 2 })
    expect(m.title).toMatch(/package of 2 legs/)
    expect(m.meta.find(r => r[0] === 'NET PREMIUM')[1].v).toBe(-30000)
    const [legs, dates, market] = m.tables
    expect(legs.rows).toHaveLength(2)
    expect(legs.rows[0].slice(0, 3)).toEqual([1, 'SELL', 'FORWARD'])
    expect(legs.rows[1][2]).toBe('PUT')
    expect(legs.rows[0][9].f(12)).toBe('H12*I12')                 // present value at the forward = amount × discount factor
    expect(legs.total[10]).toMatchObject({ v: flows.npv, sum: 'K' })
    expect(dates.rows.map(r => r[0])).toEqual(['2026-11-10', '2026-12-10'])
    expect(market.rows).toHaveLength(2)
  })
})

describe('one scenario over every leg', () => {
  const s = (over = {}) => ({ spotPct: 0, quoteBp: 0, baseBp: 0, volPts: 0, pip: 1, crypto: true, moved: { '1M': 0, '2M': 0, '3M': 0 }, tenorDays: TENOR_DAYS, lag: 0,
    quotePillars: [], quoteOwn: {}, basePillars: [], baseOwn: {}, ...over })
  it('with no shock is each leg\'s own closed form, summed', () => {
    const r = repricePackage(strip, s())
    expect(r.rows).toHaveLength(3)
    expect(r.npv).toBeCloseTo(strip.reduce((a, q) => a + reprice(q).npv, 0), 6)
    expect(repricePackage(strip, null).npv).toBeCloseTo(r.npv, 9)
  })
  it('a spot shock reaches every leg in full', () => {
    const r = repricePackage(strip, s({ spotPct: 5 }))
    expect(r.npv).toBeCloseTo(strip.reduce((a, q) => a + reprice(q, { spotPct: 5 }).npv, 0), 6)
  })
  it('a move of the forward curve is read at each leg\'s own date', () => {
    const scen = s({ moved: { '1M': 100, '2M': 300, '3M': 300 } })
    expect(legShocks(strip[0], scen).dPoints).toBeCloseTo(100, 9)                // 30 days: the 1M tenor
    expect(legShocks(strip[1], scen).dPoints).toBeCloseTo(300, 9)                // 61 days: the 2M tenor
    expect(legShocks(strip[2], scen).dPoints).toBeCloseTo(300, 9)
    const r = repricePackage(strip, scen)
    // SELL 5 at +100, SELL 5 at +300, BUY 5 at +300, each discounted on its own date
    expect(r.npv - repricePackage(strip, null).npv).toBeCloseTo(-5 * 100 * 0.9965 - 5 * 300 * 0.993 + 5 * 300 * 0.9895, 6)
  })
  it('a shock on one rate pillar reaches the legs the engine\'s curve would carry it to, each by its own amount', () => {
    const pillars = [{ date: '2026-12-10', t: 30 / 365, zero_pct: 4 }, { date: '2027-02-10', t: 92 / 365, zero_pct: 4 }]
    const scen = s({ quotePillars: pillars, quoteOwn: { '2027-02-10': 50 } })
    expect(legShocks(strip[0], scen).quoteBp).toBeCloseTo(0, 9)                  // at the first pillar: untouched
    expect(legShocks(strip[2], scen).quoteBp).toBeCloseTo(50, 9)                 // at the shocked pillar: in full
    const mid = legShocks(strip[1], scen).quoteBp                                // between: by the engine's rule, not the average
    expect(mid).toBeCloseTo(0.5 * 50 * (92 / 365) / (61 / 365), 6)
    // a flat shock is added to it
    expect(legShocks(strip[1], s({ quoteBp: 10, quotePillars: pillars, quoteOwn: { '2027-02-10': 50 } })).quoteBp).toBeCloseTo(10 + mid, 9)
  })
  it('a digital asset\'s basis shock is the negative of its carry rate; a currency pair\'s base rate is itself', () => {
    expect(legShocks(strip[0], s({ baseBp: 25 })).baseBp).toBe(-25)
    expect(legShocks(strip[0], s({ baseBp: 25, crypto: false })).baseBp).toBe(25)
  })
  it('one factor alone, and a ladder\'s column on top of the scenario', () => {
    const scen = s({ spotPct: 2, quoteBp: 30, moved: { '1M': 50, '2M': 50, '3M': 50 } })
    const base = repricePackage(strip, null).npv
    const spotOnly = repricePackage(strip, scen, { only: ['spotPct'] }).npv
    expect(spotOnly).toBeCloseTo(repricePackage(strip, s({ spotPct: 2 })).npv, 6)
    const all = repricePackage(strip, scen).npv
    const parts = ['spotPct', 'quoteBp', 'dPoints'].map(k => repricePackage(strip, scen, { only: [k] }).npv - base)
    expect(Math.abs(all - base - parts.reduce((a, b) => a + b, 0))).toBeLessThan(Math.abs(all - base) * 0.05 + 1)      // what is left is the cross term
    expect(repricePackage(strip, scen, { extra: { spotPct: 1 } }).npv).toBeCloseTo(repricePackage(strip, s({ spotPct: 3, quoteBp: 30, moved: { '1M': 50, '2M': 50, '3M': 50 } })).npv, 6)
  })
  it('an option leg takes the vol shock; a forward leg does not', () => {
    const quotes = [strip[0], opt()]
    const up = repricePackage(quotes, s({ volPts: 2 }))
    const flat = repricePackage(quotes, s())
    expect(up.rows[0].npv).toBeCloseTo(flat.rows[0].npv, 9)
    expect(up.rows[1].npv).toBeGreaterThan(flat.rows[1].npv)
  })
  it('a leg of a style the engine reprices itself leaves the package unpriced here, not priced without it', () => {
    expect(closedForm(opt({ style: 'BARRIER' }))).toBe(false)
    expect(closedForm(opt())).toBe(true)
    expect(closedForm(strip[0])).toBe(true)
    expect(repricePackage([strip[0], opt({ style: 'BARRIER' })], s())).toBeNull()
    expect(repricePackage([strip[0], opt({ style: 'AMERICAN' })], null)).toBeNull()
    expect(repricePackage([], s())).toBeNull()
  })
})
