import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { priceable, priceRequest, styleFields, styleSends, seedLevels, roundLevel, seedVolPct, surfaceAtmPct, yearsTo, annualisedBasis, forwardCaption, ticketToday, isIsoDate,
         tenorDate, tenorOf, tenorLabel, firstDate, lastDate, holdToLast,
         TENORS, MAX_CRYPTO_TENOR, MAX_CRYPTO_FORWARD_TENOR, CRYPTO_LIMIT_NOTE, CRYPTO_FORWARD_LIMIT_NOTE, tenorsFor, SPOT_HINT, STYLES, MAX_FUNDING_PCT, GATED_STYLES, NOT_A_NUMBER,
         parseNumber, formatInput, formatRead, readNumbers, unreadable, overrideNote, quoteFor, failureText, createTicketPricer,
         tenorDates, tenorDateFor, tenorSettlement, closedWhy, isBusinessDay, addBusinessDays, rollDate, rollRule, rolledTag, spotDateFor, spotLagLabel, bookedNotional, dateCap,
         bookedStrike, apiRoundsStrike, notionalSent, numbersSent, crybasis01, premiumLine, optionSentence, SENS_UNITS } from './fx-ticket'

const TODAY = '2026-11-09'
// synthetic pair rows in the shape of GET /api/currency/pairs
const BTC = { pair: 'BTCUSD', base: 'BTC', quote: 'USD', crypto: true, spot: 74747.9, spot_as_of: '2026-11-09', pip: 1 }
const EUR = { pair: 'EURUSD', base: 'EUR', quote: 'USD', crypto: false, spot: 1.085, spot_as_of: '2026-11-09', pip: 1e-4 }
// the form as the panel holds it when a ticket opens
const FORM = { strike: '', spotOv: '', fundOv: '', optType: 'CALL', expiry: '2027-02-09', optSettle: '', volOv: '', style: 'EUROPEAN', payout: '100000',
               payoutCcy: 'QUOTE', barrierType: 'UP_OUT', barrier: '', lowerB: '', upperB: '', rebate: '', touchType: 'ONE_TOUCH', payAtHit: false, direction: 'BUY' }
const fwd = (over = {}) => ({ ...FORM, option: false, shape: 'NDF', crypto: true, pair: 'BTCUSD', notional: 10, settlement: '2027-02-09', cashSettled: true, cur: BTC, today: TODAY, ...over })
const opt = (over = {}) => ({ ...FORM, option: true, shape: 'OPTION', crypto: true, pair: 'BTCUSD', notional: 10, settlement: '2027-02-09', cashSettled: true, cur: BTC, today: TODAY, ...over })
const fxFwd = (over = {}) => fwd({ shape: 'FORWARD', crypto: false, pair: 'EURUSD', notional: 10_000_000, cashSettled: false, cur: EUR, ...over })
const fxOpt = (over = {}) => opt({ crypto: false, pair: 'EURUSD', notional: 10_000_000, cashSettled: false, cur: EUR, ...over })
const ok = (t) => priceable(t).ok
const why = (t) => priceable(t).why

describe('the request that prices the ticket', () => {
  it('a forward on its defaults sends the pair, the shape, the notional, the direction and the date, and no override', () => {
    expect(priceRequest(fwd())).toEqual({ path: '/api/currency/forward/price',
      body: { pair: 'BTCUSD', shape: 'NDF', base_notional: 10, direction: 'BUY', settlement_date: '2027-02-09' } })
  })
  it('an override is sent, a default is not: K, spot and funding', () => {
    expect(priceRequest(fwd({ strike: '75000', spotOv: '74000', fundOv: '-1.5' })).body).toEqual(
      { pair: 'BTCUSD', shape: 'NDF', base_notional: 10, direction: 'BUY', settlement_date: '2027-02-09', forward_rate: 75000, spot: 74000, base_rate_pct: -1.5 })
  })
  it('a spot trade sends no date, and a currency pair never sends a funding rate', () => {
    const b = priceRequest(fxFwd({ shape: 'SPOT', fundOv: '3' })).body
    expect(b).toEqual({ pair: 'EURUSD', shape: 'SPOT', base_notional: 10_000_000, direction: 'BUY' })
  })
  it('an option on its defaults is struck by the API: no strike, no spot, no vol', () => {
    expect(priceRequest(opt())).toEqual({ path: '/api/currency/option/price',
      body: { pair: 'BTCUSD', option_type: 'CALL', base_notional: 10, expiry_date: '2027-02-09', direction: 'BUY', settlement_type: 'NON_DELIVERABLE', style: 'EUROPEAN' } })
  })
  it('the option\'s overrides and its own settlement date travel when typed', () => {
    const b = priceRequest(fxOpt({ strike: '1.10', spotOv: '1.09', volOv: '8.5', optSettle: '2027-02-11' })).body
    expect(b).toMatchObject({ settlement_type: 'DELIVERABLE', strike: 1.1, spot: 1.09, vol_pct: 8.5, settlement_date: '2027-02-11' })
  })
})

// The form keeps what was typed for another style, and hides the field. What is hidden does not travel.
describe('which fields a style sends', () => {
  // everything typed, under every style: a strike, a payout, a barrier, a rebate, both levels, paid at hit
  const FULL = { strike: '70000', payout: '250000', payoutCcy: 'BASE', barrierType: 'DOWN_IN', barrier: '60000', rebate: '12', lowerB: '65000', upperB: '85000', touchType: 'ONE_TOUCH', payAtHit: true }
  const sent = (over) => priceRequest(opt({ ...FULL, ...over })).body
  const STYLE_KEYS = ['payout', 'payout_currency', 'barrier_type', 'barrier', 'rebate', 'lower', 'upper', 'touch_type', 'pay_at_hit']
  const styleKeys = (b) => STYLE_KEYS.filter(k => k in b)

  it('EUROPEAN: the strike and nothing of another style', () => {
    const b = sent({ style: 'EUROPEAN' })
    expect(b.strike).toBe(70000)
    expect(styleKeys(b)).toEqual([])
  })
  it('AMERICAN: the strike and nothing of another style', () => {
    const b = sent({ style: 'AMERICAN' })
    expect(b.strike).toBe(70000)
    expect(styleKeys(b)).toEqual([])
  })
  it('DIGITAL: the strike and the payout; no barrier, no rebate, no levels', () => {
    const b = sent({ style: 'DIGITAL' })
    expect(b.strike).toBe(70000)
    expect(styleKeys(b)).toEqual(['payout', 'payout_currency'])
    expect(b).toMatchObject({ payout: 250000, payout_currency: 'BASE' })
  })
  it('BARRIER: the strike, the type, one level and the rebate; no payout, no second level', () => {
    const b = sent({ style: 'BARRIER' })
    expect(b.strike).toBe(70000)
    expect(styleKeys(b)).toEqual(['barrier_type', 'barrier', 'rebate'])
    expect(b).toMatchObject({ barrier_type: 'DOWN_IN', barrier: 60000, rebate: 12 })
    expect('rebate' in sent({ style: 'BARRIER', rebate: '' })).toBe(false)
  })
  it('DOUBLE BARRIER: the strike, knock-in or knock-out and both levels; no single barrier, no rebate, no payout', () => {
    const b = sent({ style: 'DOUBLE_BARRIER' })
    expect(b.strike).toBe(70000)
    expect(styleKeys(b)).toEqual(['barrier_type', 'lower', 'upper'])
    expect(b).toMatchObject({ barrier_type: 'KNOCK_OUT', lower: 65000, upper: 85000 })       // a single-barrier type left in the form is not a double's
    expect(sent({ style: 'DOUBLE_BARRIER', barrierType: 'KNOCK_IN' }).barrier_type).toBe('KNOCK_IN')
  })
  it('TOUCH: no strike, whatever the form still holds; the payout, the type and one level', () => {
    const b = sent({ style: 'TOUCH' })
    expect('strike' in b, 'a touch has no strike').toBe(false)
    expect(styleKeys(b)).toEqual(['payout', 'payout_currency', 'barrier', 'touch_type', 'pay_at_hit'])
    expect(b).toMatchObject({ touch_type: 'ONE_TOUCH', barrier: 60000, pay_at_hit: true })
  })
  it('TOUCH, double: both levels and no single barrier; paid at hit is a one-touch\'s alone', () => {
    const b = sent({ style: 'TOUCH', touchType: 'DOUBLE_NO_TOUCH' })
    expect('strike' in b).toBe(false)
    expect(styleKeys(b)).toEqual(['payout', 'payout_currency', 'lower', 'upper', 'touch_type', 'pay_at_hit'])
    expect(b.pay_at_hit, 'the chips are hidden for this type').toBe(false)
    expect(sent({ style: 'TOUCH', touchType: 'NO_TOUCH' }).pay_at_hit).toBe(false)
  })
  it('the list is the one the booking reads: styleFields is the request\'s style block, and styleSends says whether there is a strike', () => {
    for (const style of STYLES) {
      const t = opt({ ...FULL, style })
      const { style: s, ...rest } = styleFields(t)
      expect(s).toBe(style)
      expect(priceRequest(t).body).toMatchObject(rest)
      expect('strike' in priceRequest(t).body).toBe(styleSends(style, t.touchType).strike)
    }
    expect(STYLES.filter(s => !styleSends(s).strike)).toEqual(['TOUCH'])
  })
  it('a leftover strike under a touch does not stop the automatic price either', () => {
    expect(ok(opt({ style: 'TOUCH', strike: '0', barrier: '82200' }))).toBe(true)
    expect(ok(opt({ style: 'DIGITAL', strike: '0' }))).toBe(false)
  })
})

describe('may the automatic pricing send these terms', () => {
  it('the ticket as it opens is priceable: both products, both asset classes', () => {
    for (const t of [fwd(), opt(), fxFwd(), fxOpt(), fxFwd({ shape: 'SPOT' }), fxFwd({ shape: 'NDF' })]) expect(priceable(t)).toEqual({ ok: true, why: '' })
  })
  it('nothing before the pairs arrive, or for a pair they do not list', () => {
    expect(ok(fwd({ cur: undefined }))).toBe(false)
    expect(ok(fwd({ pair: 'ETHUSD' }))).toBe(false)
  })
  it('no stored spot and no override: one line, snap spot to price', () => {
    expect(priceable(fwd({ cur: { ...BTC, spot: null } }))).toEqual({ ok: false, why: SPOT_HINT })
    expect(why(opt({ cur: { ...BTC, spot: 0 } }))).toBe('snap spot to price')
    // a typed spot prices where none is stored (the API takes the override)
    expect(ok(fwd({ cur: { ...BTC, spot: null }, spotOv: '74000' }))).toBe(true)
  })
  it('a spot override must be a number above zero (gt=0)', () => {
    for (const spotOv of ['0', '.', '1.2.3']) expect(ok(fwd({ spotOv })), spotOv).toBe(false)
  })
  it('the notional: above zero and finite (gt=0)', () => {
    for (const notional of ['', 0, -5, NaN, Infinity, 1e16]) expect(ok(fwd({ notional })), String(notional)).toBe(false)
    expect(ok(fwd({ notional: 0.001 }))).toBe(true)
  })
  it('a forward settles after today; a spot trade has no date to check', () => {
    expect(ok(fwd({ settlement: TODAY }))).toBe(false)
    expect(ok(fwd({ settlement: '2026-11-08' }))).toBe(false)
    expect(ok(fwd({ settlement: '2026-11-10' }))).toBe(true)
    for (const settlement of ['', '2027-02-30', '0202-11-10', 'soon']) expect(ok(fwd({ settlement })), settlement).toBe(false)
    expect(ok(fxFwd({ shape: 'SPOT', settlement: '' }))).toBe(true)
    expect(ok(fxFwd({ shape: 'SWAP' }))).toBe(false)
  })
  it('a forward\'s K and funding: a number when typed, the funding rate within reason', () => {
    expect(ok(fwd({ strike: '.' }))).toBe(false)
    expect(ok(fwd({ strike: '0' }))).toBe(true)                    // the API takes any K
    expect(ok(fwd({ fundOv: '-' }))).toBe(false)
    expect(ok(fwd({ fundOv: '-2.5' }))).toBe(true)
    expect(ok(fwd({ fundOv: String(MAX_FUNDING_PCT + 1) }))).toBe(false)
    expect(ok(fxFwd({ fundOv: '-' })), 'a currency pair sends no funding rate').toBe(true)
  })
  it('an option expires after today, and settles on or after its expiry', () => {
    expect(ok(opt({ expiry: TODAY }))).toBe(false)
    expect(ok(opt({ expiry: '2026-11-10' }))).toBe(true)
    expect(ok(opt({ expiry: '' }))).toBe(false)
    expect(ok(opt({ optSettle: '2027-02-08' }))).toBe(false)
    expect(ok(opt({ optSettle: '2027-02-09' }))).toBe(true)
    expect(ok(opt({ optType: 'STRADDLE' }))).toBe(false)
  })
  it('a typed strike and a typed vol are above zero (gt=0), and within what prices as it is typed', () => {
    expect(ok(opt({ strike: '0' }))).toBe(false)
    expect(ok(opt({ strike: '75000' }))).toBe(true)
    expect(ok(opt({ volOv: '0' }))).toBe(false)
    expect(ok(opt({ volOv: '55' }))).toBe(true)
  })
  it('the limits of this file\'s own hold back the tree and the barrier formulas, not a European or a digital', () => {
    expect(GATED_STYLES).toEqual(['AMERICAN', 'BARRIER', 'DOUBLE_BARRIER', 'TOUCH'])
    // a strike far from spot, a vol of 1 %: closed forms the API prices
    for (const style of ['EUROPEAN', 'DIGITAL']) {
      expect(ok(opt({ style, strike: '7' })), `${style} far strike`).toBe(true)
      expect(ok(opt({ style, volOv: '1' })), `${style} low vol`).toBe(true)
      expect(ok(opt({ style, volOv: '5000' })), `${style} high vol`).toBe(true)
      expect(ok(fxOpt({ style, expiry: '2026-11-16', strike: '0.5', volOv: '7.5' })), `${style} many standard deviations`).toBe(true)
    }
    expect(ok(opt({ style: 'AMERICAN', strike: '7' })), 'the first digit of 75,000 on a tree').toBe(false)
    expect(ok(opt({ style: 'AMERICAN', volOv: '1' }))).toBe(false)
    expect(ok(opt({ style: 'AMERICAN', volOv: '5000' }))).toBe(false)
    expect(ok(opt({ style: 'BARRIER', barrier: '82200', strike: '7' }))).toBe(false)
    expect(ok(opt({ style: 'TOUCH', barrier: '82200', volOv: '1' }))).toBe(false)
  })
  it('a digital and a touch need a payout above zero', () => {
    expect(ok(opt({ style: 'DIGITAL' }))).toBe(true)
    for (const payout of ['', '0', '.']) expect(ok(opt({ style: 'DIGITAL', payout })), payout).toBe(false)
    expect(ok(opt({ style: 'TOUCH', barrier: '82200', payout: '' }))).toBe(false)
  })
  it('a barrier: a type, a level, and the level on the side of spot its type needs', () => {
    expect(why(opt({ style: 'BARRIER' }))).toBe('enter a barrier level')
    expect(ok(opt({ style: 'BARRIER', barrier: '82200' }))).toBe(true)
    expect(why(opt({ style: 'BARRIER', barrier: '70000' }))).toBe('an up barrier must be above spot')
    expect(ok(opt({ style: 'BARRIER', barrier: '74747.9' })), 'at spot is not above it').toBe(false)
    expect(ok(opt({ style: 'BARRIER', barrierType: 'UP_IN', barrier: '82200' }))).toBe(true)
    expect(ok(opt({ style: 'BARRIER', barrierType: 'DOWN_OUT', barrier: '67300' }))).toBe(true)
    expect(why(opt({ style: 'BARRIER', barrierType: 'DOWN_IN', barrier: '82200' }))).toBe('a down barrier must be below spot')
    expect(ok(opt({ style: 'BARRIER', barrierType: 'KNOCK_OUT', barrier: '82200' })), 'a double\'s type for one render').toBe(false)
    // the side is judged against the spot the API will use: the override when there is one
    expect(ok(opt({ style: 'BARRIER', barrier: '82200', spotOv: '90000' }))).toBe(false)
    expect(ok(opt({ style: 'BARRIER', barrier: '82200', rebate: '5' }))).toBe(true)
    expect(ok(opt({ style: 'BARRIER', barrier: '82200', rebate: '.' }))).toBe(false)
  })
  it('a double barrier: both levels, spot strictly between them', () => {
    expect(ok(opt({ style: 'DOUBLE_BARRIER' }))).toBe(false)
    expect(ok(opt({ style: 'DOUBLE_BARRIER', lowerB: '67300', upperB: '82200' }))).toBe(true)
    expect(ok(opt({ style: 'DOUBLE_BARRIER', lowerB: '67300' }))).toBe(false)
    expect(ok(opt({ style: 'DOUBLE_BARRIER', lowerB: '76000', upperB: '82200' }))).toBe(false)
    expect(ok(opt({ style: 'DOUBLE_BARRIER', lowerB: '67300', upperB: '74747.9' }))).toBe(false)
  })
  it('a touch: one level away from spot, or two with spot between them', () => {
    expect(ok(opt({ style: 'TOUCH' }))).toBe(false)
    expect(ok(opt({ style: 'TOUCH', barrier: '82200' }))).toBe(true)
    expect(ok(opt({ style: 'TOUCH', barrier: '67300' })), 'either side').toBe(true)
    expect(why(opt({ style: 'TOUCH', barrier: '74747.9' }))).toBe('the barrier must be away from spot')
    expect(ok(opt({ style: 'TOUCH', touchType: 'DOUBLE_NO_TOUCH', barrier: '82200' }))).toBe(false)
    expect(ok(opt({ style: 'TOUCH', touchType: 'DOUBLE_NO_TOUCH', lowerB: '67300', upperB: '82200' }))).toBe(true)
    expect(ok(opt({ style: 'TOUCH', touchType: 'LOOKBACK', barrier: '82200' }))).toBe(false)
  })
  it('a level many standard deviations from spot is not priced as it is typed, when a vol is known', () => {
    const week = { expiry: '2026-11-16' }
    expect(ok(fxOpt({ ...week, style: 'AMERICAN', strike: '0.5', volOv: '7.5' }))).toBe(false)
    expect(ok(fxOpt({ ...week, style: 'AMERICAN', strike: '1.09', volOv: '7.5' }))).toBe(true)
    expect(ok(fxOpt({ ...week, style: 'AMERICAN', strike: '0.5', volHint: 7.5 })), 'the vol of the last quote').toBe(false)
    expect(ok(fxOpt({ ...week, style: 'AMERICAN', strike: '0.5' })), 'no vol known: the static range alone').toBe(true)
  })
  it('every reason is a few plain words, with no em dash', () => {
    const cases = [fwd({ cur: undefined }), fwd({ notional: '' }), fwd({ settlement: TODAY }), opt({ expiry: TODAY }), opt({ style: 'BARRIER' }),
                   opt({ style: 'DOUBLE_BARRIER' }), opt({ style: 'TOUCH' }), opt({ strike: '0' }), opt({ volOv: '0' }), fwd({ settlement: '2037-01-01' }), opt({ expiry: '2031-01-01' })]
    for (const t of cases) {
      const r = priceable(t)
      expect(r.ok).toBe(false)
      expect(r.why.length).toBeGreaterThan(5)
      expect(r.why).not.toMatch(/—|undefined|NaN/)
    }
  })
})

// The seeds were 10 % either side of spot whatever the vol and the expiry: a three-month double knock-out on a 55 %
// vol asset was then certain to knock, worth a dollar with every greek zero. They are on the option's own scale now.
describe('the levels a style is given when it is chosen', () => {
  const BTCISH = { spot: 107000, forward: 108000, vol: 0.55, years: 0.25 }            // w = 0.55·√0.25 = 0.275
  const EURISH = { spot: 1.085, forward: 1.089, vol: 0.072, years: 0.25 }            // w = 0.036
  it('three significant figures: the nearest, or the next one up or down', () => {
    expect(roundLevel(82222.69)).toBe('82200')
    expect(roundLevel(1.1935)).toBe('1.19')
    expect(roundLevel(142185, 'up')).toBe('143000')
    expect(roundLevel(82034, 'down')).toBe('82000')
    expect(roundLevel(119000, 'up'), 'a level already on a step stays on it').toBe('119000')
    expect(roundLevel(1.05, 'down')).toBe('1.05')
    expect(roundLevel(74749, 'up')).toBe('74800')
    expect(roundLevel(0.04213, 'down')).toBe('0.0421')
    expect(roundLevel(0)).toBe('')
    expect(roundLevel(NaN, 'up')).toBe('')
  })
  it('BTC-like, 3M at 55 %: a single level one σ√T from the forward, a double 1.5 either side', () => {
    // F·e^(±0.275) = 142,185 and 82,034; F·e^(±0.4125) = 163,145 and 71,495; each rounded away from spot
    expect(seedLevels({ style: 'BARRIER', barrierType: 'UP_OUT', ...BTCISH })).toEqual({ barrier: '143000' })
    expect(seedLevels({ style: 'BARRIER', barrierType: 'UP_IN', ...BTCISH })).toEqual({ barrier: '143000' })
    expect(seedLevels({ style: 'BARRIER', barrierType: 'DOWN_OUT', ...BTCISH })).toEqual({ barrier: '82000' })
    expect(seedLevels({ style: 'BARRIER', barrierType: 'DOWN_IN', ...BTCISH })).toEqual({ barrier: '82000' })
    expect(seedLevels({ style: 'DOUBLE_BARRIER', barrierType: 'KNOCK_OUT', ...BTCISH })).toEqual({ lower: '71400', upper: '164000' })
    expect(seedLevels({ style: 'TOUCH', touchType: 'ONE_TOUCH', ...BTCISH })).toEqual({ barrier: '143000' })
    expect(seedLevels({ style: 'TOUCH', touchType: 'DOUBLE_NO_TOUCH', ...BTCISH })).toEqual({ lower: '71400', upper: '164000' })
  })
  it('EURUSD-like, 3M at 7.2 %: the same rule on a much smaller scale', () => {
    // F·e^(±0.036) = 1.1289 and 1.0505; F·e^(±0.054) = 1.1494 and 1.0317
    expect(seedLevels({ style: 'BARRIER', barrierType: 'UP_OUT', ...EURISH })).toEqual({ barrier: '1.13' })
    expect(seedLevels({ style: 'BARRIER', barrierType: 'DOWN_OUT', ...EURISH })).toEqual({ barrier: '1.05' })
    expect(seedLevels({ style: 'DOUBLE_BARRIER', ...EURISH })).toEqual({ lower: '1.03', upper: '1.15' })
    expect(seedLevels({ style: 'TOUCH', touchType: 'NO_TOUCH', ...EURISH })).toEqual({ barrier: '1.13' })
    expect(seedLevels({ style: 'TOUCH', touchType: 'DOUBLE_ONE_TOUCH', ...EURISH })).toEqual({ lower: '1.03', upper: '1.15' })
  })
  it('the levels move with the vol and with the expiry', () => {
    const up = (over) => Number(seedLevels({ style: 'BARRIER', barrierType: 'UP_OUT', ...BTCISH, ...over }).barrier)
    expect(up({ vol: 0.8 })).toBeGreaterThan(up({}))
    expect(up({ years: 1 })).toBeGreaterThan(up({}))
    expect(up({ years: 7 / 365 })).toBeLessThan(up({}))
    expect(up({ years: 7 / 365 })).toBeGreaterThan(BTCISH.spot)
  })
  it('without a forward the scale is laid on spot; without a spot, a vol or an expiry there is nothing to lay it on', () => {
    expect(seedLevels({ style: 'BARRIER', barrierType: 'UP_OUT', spot: 108000, vol: 0.55, years: 0.25 })).toEqual({ barrier: '143000' })
    for (const missing of [{ spot: null }, { vol: null }, { vol: 0 }, { years: null }, { years: 0 }])
      expect(seedLevels({ style: 'DOUBLE_BARRIER', ...BTCISH, ...missing })).toEqual({})
  })
  it('a style with no level is given nothing', () => {
    for (const style of ['EUROPEAN', 'AMERICAN', 'DIGITAL']) expect(seedLevels({ style, ...BTCISH })).toEqual({})
  })
  it('a level is always on its side of spot, however small the scale or far the forward', () => {
    for (const [spot, forward] of [[1.085, 1.0851], [1.085, 1.2], [1.085, 0.95], [74747.9, 74748], [150.25, 149.9]]) {
      for (const [vol, years] of [[0.001, 1 / 365], [0.05, 1 / 365], [0.6, 0.25], [1.5, 2], [5, 50]]) {
        const one = seedLevels({ style: 'BARRIER', barrierType: 'UP_OUT', spot, forward, vol, years }), dn = seedLevels({ style: 'BARRIER', barrierType: 'DOWN_IN', spot, forward, vol, years })
        const two = seedLevels({ style: 'DOUBLE_BARRIER', spot, forward, vol, years })
        expect(Number(one.barrier), `${spot} ${forward} ${vol} ${years} up`).toBeGreaterThan(spot)
        expect(Number(dn.barrier), `${spot} ${forward} ${vol} ${years} down`).toBeLessThan(spot)
        expect(Number(two.lower)).toBeLessThan(spot)
        expect(Number(two.upper)).toBeGreaterThan(spot)
      }
    }
  })
  it('every seeded level passes priceable: each style and type, each kind of spot, a week to two years, calm to wild', () => {
    const markets = [[opt, BTC, 1.0138], [fxOpt, EUR, 1.0037], [fxOpt, { ...EUR, pair: 'USDJPY', spot: 150.25 }, 0.99], [opt, { ...BTC, pair: 'SOLUSD', spot: 0.0421 }, 1.02]]
    const expiries = ['2026-11-16', '2027-02-09', '2028-11-09']
    for (const [make, cur, carry] of markets) {
      for (const expiry of expiries) {
        for (const volPct of [5, 7.2, 55, 150]) {
          for (const style of STYLES) {
            for (const barrierType of style === 'BARRIER' ? ['UP_OUT', 'UP_IN', 'DOWN_OUT', 'DOWN_IN'] : style === 'DOUBLE_BARRIER' ? ['KNOCK_OUT', 'KNOCK_IN'] : ['UP_OUT']) {
              for (const touchType of style === 'TOUCH' ? ['ONE_TOUCH', 'NO_TOUCH', 'DOUBLE_ONE_TOUCH', 'DOUBLE_NO_TOUCH'] : ['ONE_TOUCH']) {
                const s = seedLevels({ style, barrierType, touchType, spot: cur.spot, forward: cur.spot * carry, vol: volPct / 100, years: yearsTo(expiry, TODAY) })
                const t = make({ pair: cur.pair, cur, expiry, style, barrierType, touchType, barrier: s.barrier || '', lowerB: s.lower || '', upperB: s.upper || '', volHint: volPct })
                expect(priceable(t), `${cur.pair} ${expiry} ${volPct}% ${style} ${barrierType} ${touchType} ${JSON.stringify(s)}`).toEqual({ ok: true, why: '' })
              }
            }
          }
        }
      }
    }
  })
  it('the vol the scale uses: the quote\'s, else the surface\'s ATM at the expiry, else the pair\'s default level', () => {
    const surface = { vol_surface: { grid: { '1M': { ATM: 50 }, '3M': { ATM: 56, RR25: -2 }, '1Y': { ATM: 60 } } } }
    expect(seedVolPct({ quoteVolPct: 52.3, cur: surface, pair: 'BTCUSD', years: 0.25 })).toBe(52.3)
    expect(seedVolPct({ quoteVolPct: null, cur: surface, pair: 'BTCUSD', years: 0.25 })).toBe(56)
    expect(surfaceAtmPct(surface, 1 / 12 + (0.25 - 1 / 12) / 2), 'linear in time between tenors').toBeCloseTo(53, 10)
    expect(surfaceAtmPct(surface, 1 / 365), 'flat before the first tenor').toBe(50)
    expect(surfaceAtmPct(surface, 5), 'flat beyond the last').toBe(60)
    expect(surfaceAtmPct({ vol_surface: null }, 0.25)).toBeNull()
    expect(surfaceAtmPct({ vol_surface: { grid: {} } }, 0.25)).toBeNull()
    expect(seedVolPct({ cur: { vol_surface: null }, pair: 'EURUSD', years: 0.25 })).toBe(7.5)
    expect(seedVolPct({ cur: undefined, pair: 'BTCUSD', years: 0.25 })).toBe(10)
  })
  it('years to a date, ACT/365; none for a date that is not after today', () => {
    expect(yearsTo('2027-11-09', TODAY)).toBe(1)
    expect(yearsTo('2026-11-16', TODAY)).toBeCloseTo(7 / 365, 12)
    expect(yearsTo(TODAY, TODAY)).toBeNull()
    expect(yearsTo('', TODAY)).toBeNull()
  })
})

describe('the forward and its basis over spot', () => {
  it('the annualised basis is ln(F/S)/T', () => {
    expect(annualisedBasis(75781.53, 74747.9, 0.25)).toBeCloseTo(Math.log(75781.53 / 74747.9) / 0.25, 12)
    expect(annualisedBasis(74747.9, 74747.9, 0.25)).toBe(0)
    expect(annualisedBasis(74000, 74747.9, 0.5)).toBeLessThan(0)
  })
  it('nothing when a figure is missing or not positive', () => {
    for (const [f, s, t] of [[null, 1, 1], [1, null, 1], [1, 1, null], [1, 1, 0], [0, 1, 1], [1, -1, 1], [NaN, 1, 1]]) expect(annualisedBasis(f, s, t)).toBeNull()
  })
  // The head of a crypto derivatives desk, 9 November 2026: a forward is quoted FX-style, as points over spot with a sign.
  it('a digital asset above spot: the points in the quote currency, signed, and the basis a year', () => {
    expect(forwardCaption({ forward: 75781.53, spot: 74747.9, t: 0.25, crypto: true })).toEqual({ points: 'points +1,033.63', basis: '5.5 % a year' })
    expect(forwardCaption({ forward: 108216.36, spot: 108000, t: 0.25, crypto: true })).toEqual({ points: 'points +216.36', basis: '0.8 % a year' })
  })
  it('below spot the points carry a minus and say under spot', () => {
    expect(forwardCaption({ forward: 107783.64, spot: 108000, t: 0.25, crypto: true })).toEqual({ points: 'points −216.36 under spot', basis: '−0.8 % a year' })
    expect(forwardCaption({ forward: 1.08377, spot: 1.085, t: 0.25, crypto: false, pip: 1e-4 })).toEqual({ points: '−12.3 pips under spot', basis: '−0.5 % a year' })
  })
  it('a currency pair: forward points in pips to one decimal, by the pair\'s pip', () => {
    expect(forwardCaption({ forward: 1.09023, spot: 1.085, t: 0.25, crypto: false, pip: 1e-4 })).toEqual({ points: '+52.3 pips', basis: '1.9 % a year' })
    expect(forwardCaption({ forward: 1.085424, spot: 1.085, t: 0.25, crypto: false, pip: 1e-4 })).toEqual({ points: '+4.2 pips', basis: '0.2 % a year' })
    expect(forwardCaption({ forward: 148.75, spot: 150.25, t: 0.5, crypto: false, pip: 0.01 })).toEqual({ points: '−150.0 pips under spot', basis: '−2.0 % a year' })
  })
  it('a forward at spot has no sign; without a time there is no basis; before a price there is no line', () => {
    expect(forwardCaption({ forward: 74747.9, spot: 74747.9, t: 0.25, crypto: true })).toEqual({ points: 'points 0.00', basis: '0.0 % a year' })
    expect(forwardCaption({ forward: 74747.899, spot: 74747.9, t: 0.25, crypto: true }).points, 'a difference that rounds to nothing is not under').toBe('points 0.00')
    expect(forwardCaption({ forward: 75000, spot: 74747.9, t: null, crypto: true }).basis).toBeNull()
    expect(forwardCaption({ forward: null, spot: 74747.9, t: 0.25, crypto: true })).toBeNull()
  })
  it('one shape for every forward: points, a sign, under spot only below it', () => {
    for (const forward of [70000, 74747.9, 80000]) expect(forwardCaption({ forward, spot: 74747.9, t: 0.25, crypto: true }).points).toMatch(/^points [+−]?[\d,.]+( under spot)?$/)
    for (const forward of [1.08, 1.085, 1.09]) expect(forwardCaption({ forward, spot: 1.085, t: 0.25, crypto: false, pip: 1e-4 }).points).toMatch(/^[+−]?[\d,.]+ pips( under spot)?$/)
  })
})

describe('today, for the check', () => {
  it('the later of the browser\'s date and the UTC date', () => {
    const d = new Date('2026-11-09T12:00:00Z')
    expect(isIsoDate(ticketToday(d))).toBe(true)
    expect(ticketToday(d) >= '2026-11-09').toBe(true)
    expect(ticketToday(d) <= '2026-11-10').toBe(true)
  })
  it('a date is a day that exists', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isIsoDate('2027-2-9')).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })
})

// The owner, 9 November 2026: the tenor stayed at 2Y beside a date five years out.
describe('the tenor tells the truth about the date', () => {
  it('a tenor\'s date: weeks as days, months and years on the calendar', () => {
    expect(tenorDate('1W', TODAY)).toBe('2026-11-16')
    expect(tenorDate('2W', TODAY)).toBe('2026-11-23')
    expect(tenorDate('3M', TODAY)).toBe('2027-02-09')
    expect(tenorDate('18M', TODAY)).toBe('2028-05-09')
    expect(tenorDate('2Y', TODAY)).toBe('2028-11-09')
    expect(tenorDate('SPOT', TODAY)).toBeNull()
    expect(tenorDate('3M', 'today')).toBeNull()
  })
  it('a date on a standard tenor is that tenor, for every tenor of the list', () => {
    for (const t of TENORS) expect(tenorOf(tenorDate(t, TODAY), TODAY), t).toBe(t)
  })
  it('one day off is no tenor', () => {
    expect(tenorOf('2027-02-10', TODAY)).toBeNull()
    expect(tenorOf('2027-02-08', TODAY)).toBeNull()
    expect(tenorOf('2028-11-10', TODAY)).toBeNull()
    expect(tenorOf('', TODAY)).toBeNull()
    expect(tenorOf('2027-02-30', TODAY)).toBeNull()
  })
  it('a date on none is CUSTOM with its length by actual days: days under 60, months under two years, years beyond', () => {
    expect(tenorLabel('2026-11-10', TODAY)).toBe('CUSTOM · 1 day')
    expect(tenorLabel('2027-01-07', TODAY)).toBe('CUSTOM · 59 days')
    expect(tenorLabel('2027-01-08', TODAY)).toBe('CUSTOM · 2.0 months')            // 60 days
    expect(tenorLabel('2027-02-10', TODAY)).toBe('CUSTOM · 3.1 months')            // 93 days
    expect(tenorLabel('2028-11-07', TODAY)).toBe('CUSTOM · 24.0 months')           // 729 days
    expect(tenorLabel('2028-11-08', TODAY)).toBe('CUSTOM · 2.0 years')            // 730 days
    expect(tenorLabel('2031-11-09', TODAY)).toBe('CUSTOM · 5.0 years')
    expect(tenorLabel(TODAY, TODAY)).toBe('CUSTOM')
    expect(tenorLabel('2026-01-01', TODAY)).toBe('CUSTOM')
    expect(tenorLabel('', TODAY)).toBe('CUSTOM')
  })
  it('leap day: a year from 29 February runs into 1 March, and the tenor still reads 1Y there', () => {
    expect(tenorDate('1Y', '2028-02-29')).toBe('2029-03-01')
    expect(tenorOf('2029-03-01', '2028-02-29')).toBe('1Y')
    expect(tenorOf('2029-02-28', '2028-02-29')).toBeNull()
    expect(tenorDate('1M', '2028-01-29')).toBe('2028-02-29')
    expect(tenorDate('3M', '2027-11-29')).toBe('2028-02-29')
    expect(tenorOf('2028-02-29', '2027-11-29')).toBe('3M')
  })
  it('month end: a month from the 31st runs into the next month, as the select has always made it', () => {
    expect(tenorDate('1M', '2027-01-31')).toBe('2027-03-03')
    expect(tenorOf('2027-03-03', '2027-01-31')).toBe('1M')
    expect(tenorOf('2027-02-28', '2027-01-31')).toBeNull()
    expect(tenorDate('2M', '2027-01-31')).toBe('2027-03-31')
    expect(tenorDate('1M', '2027-03-31')).toBe('2027-05-01')
    expect(tenorDate('6M', '2026-08-31')).toBe('2027-03-03')
    // every tenor from a month end still finds itself
    for (const today of ['2027-01-31', '2026-08-31', '2028-02-29', '2026-12-31'])
      for (const t of TENORS) expect(tenorOf(tenorDate(t, today), today), `${t} from ${today}`).not.toBeNull()
  })
})

describe('the last date a digital asset prices to', () => {
  const LIMIT = '2028-11-09'
  it('an option two years from today and a forward ten for a digital asset, none for a currency pair; the first date is tomorrow', () => {
    expect(MAX_CRYPTO_TENOR).toBe('2Y')
    expect(MAX_CRYPTO_FORWARD_TENOR).toBe('10Y')
    expect(lastDate({ crypto: true, today: TODAY })).toBe(LIMIT)
    expect(lastDate({ crypto: true, today: TODAY, option: true })).toBe(LIMIT)
    expect(lastDate({ crypto: true, today: TODAY, option: false })).toBe('2036-11-09')
    expect(lastDate({ crypto: false, today: TODAY })).toBeNull()
    expect(lastDate({ crypto: false, today: TODAY, option: false })).toBeNull()
    // the tenors offered: a digital asset's option stops at its last vol tenor, everything else goes to ten years
    expect(tenorsFor({ crypto: true, option: true }).at(-1)).toBe('2Y')
    expect(tenorsFor({ crypto: true, option: false }).at(-1)).toBe('10Y')
    expect(tenorsFor({ crypto: false, option: true })).toEqual(TENORS)
    expect(TENORS.slice(-5)).toEqual(['3Y', '4Y', '5Y', '7Y', '10Y'])
    expect(firstDate(TODAY)).toBe('2026-11-10')
    expect(firstDate('2026-12-31')).toBe('2027-01-01')
  })
  it('a typed date beyond it is brought back to it, and says it was', () => {
    expect(holdToLast('2031-11-09', LIMIT)).toEqual({ date: LIMIT, hit: true })
    expect(holdToLast('2028-11-10', LIMIT)).toEqual({ date: LIMIT, hit: true })
    expect(holdToLast(LIMIT, LIMIT)).toEqual({ date: LIMIT, hit: false })
    expect(holdToLast('2027-02-09', LIMIT)).toEqual({ date: '2027-02-09', hit: false })
    expect(holdToLast('2031-11-09', null), 'a currency pair has no last date').toEqual({ date: '2031-11-09', hit: false })
    expect(holdToLast('', LIMIT)).toEqual({ date: '', hit: false })
  })
  it('at the limit a digital asset prices; a day beyond, the automatic pricing sends nothing and says why', () => {
    expect(ok(fwd({ settlement: LIMIT }))).toBe(true)
    expect(ok(opt({ expiry: LIMIT }))).toBe(true)
    // a forward prices beyond the two years the option stops at, to ten; a day beyond ten it does not
    expect(ok(fwd({ settlement: '2028-11-10' }))).toBe(true)
    expect(ok(fwd({ settlement: '2036-11-09' }))).toBe(true)
    expect(priceable(fwd({ settlement: '2036-11-10' }))).toEqual({ ok: false, why: CRYPTO_FORWARD_LIMIT_NOTE })
    expect(priceable(opt({ expiry: '2028-11-10' }))).toEqual({ ok: false, why: CRYPTO_LIMIT_NOTE })
    expect(priceable(opt({ expiry: '2031-11-09' }))).toEqual({ ok: false, why: CRYPTO_LIMIT_NOTE })
    expect(CRYPTO_LIMIT_NOTE).toBe('a digital-asset option prices to 2Y: the vol surface ends there')
    expect(CRYPTO_FORWARD_LIMIT_NOTE).toBe('a digital-asset forward prices to 10Y; beyond the quoted tenors it is implied, and marked so')
  })
  it('a currency pair is not limited: five years out prices and is the 5Y tenor; six reads CUSTOM · 6.0 years', () => {
    expect(ok(fxFwd({ settlement: '2031-11-09' }))).toBe(true)
    expect(ok(fxOpt({ expiry: '2031-11-09' }))).toBe(true)
    expect(tenorOf('2031-11-09', TODAY)).toBe('5Y')
    expect(ok(fxFwd({ settlement: '2032-11-09' }))).toBe(true)
    expect(tenorOf('2032-11-09', TODAY)).toBeNull()
    expect(tenorLabel('2032-11-09', TODAY)).toBe('CUSTOM · 6.0 years')
  })
})

// Vera, 9 November 2026: defaults were written in the browser's locale and read back as en-US, so in a
// comma-decimal browser a spot of 1,08345 edited by one digit became 108346, priced and could be booked.
describe('one way of reading a number, which refuses what it cannot read', () => {
  const read = (text, signed) => parseNumber(text, { signed })
  it('the reviewer\'s cases', () => {
    expect(read('1,08345')).toEqual({ state: 'invalid', value: NaN })
    expect(read('108,250.5')).toEqual({ state: 'ok', value: 108250.5 })
    expect(read('1.2.3')).toEqual({ state: 'invalid', value: NaN })
    expect(read('.')).toEqual({ state: 'invalid', value: NaN })
    expect(read('-1,35', true)).toEqual({ state: 'invalid', value: NaN })
    expect(read('1e5')).toEqual({ state: 'invalid', value: NaN })
    expect(read('  108250 ')).toEqual({ state: 'ok', value: 108250 })
    expect(read('')).toEqual({ state: 'empty', value: null })
  })
  it('a comma groups only as en-US groups, before any point', () => {
    expect(read('108,250').value).toBe(108250)
    expect(read('10,000,000').value).toBe(10000000)
    expect(read('1,234.5').value).toBe(1234.5)
    for (const text of ['1,08', '1,0834', '1234,567', '1.234,5', '1,23,456', ',123', '1,', '1,234,56', '12,3456']) expect(read(text).state, text).toBe('invalid')
  })
  it('a minus only where the field is signed; a point at either end; nothing else', () => {
    expect(read('-1.35', true)).toEqual({ state: 'ok', value: -1.35 })
    expect(read('-1.35').state).toBe('invalid')
    expect(read('−1.35', true).value, 'the minus the ticket itself prints').toBe(-1.35)
    expect(read('.5').value).toBe(0.5)
    expect(read('5.').value).toBe(5)
    for (const text of ['-', '--1', '1-', '+1', '1 000', '0x10', 'Infinity', 'NaN', '1.0e3', '١٢٣']) expect(read(text, true).state, text).toBe('invalid')
    expect(read('   ').state).toBe('empty')
    expect(read(null).state).toBe('empty')
  })
  it('a number is itself; one that is not finite, or negative where no minus is taken, is not read', () => {
    expect(read(12.5)).toEqual({ state: 'ok', value: 12.5 })
    expect(read(-5).state).toBe('invalid')
    expect(read(-5, true).value).toBe(-5)
    expect(read(NaN).state).toBe('invalid')
    expect(read(Infinity).state).toBe('invalid')
  })
  it('every number of the form is read by it, and only the fields the ticket sends can stop it', () => {
    const n = readNumbers(opt({ notional: '10,000', strike: '1,08', volOv: '55', fundOv: '-2' }))
    expect(n.notional).toEqual({ given: true, value: 10000, invalid: false })
    expect(n.strike).toEqual({ given: true, value: NaN, invalid: true })
    expect(n.spotOv).toEqual({ given: false, value: NaN, invalid: false })
    expect(unreadable(opt({ strike: '1,08' }))).toEqual({ field: 'strike', why: `the strike is ${NOT_A_NUMBER}` })
    expect(unreadable(fwd({ strike: '1.2.3' })).why).toBe('the price K is not a number: use a point for decimals')
    expect(unreadable(fxFwd({ strike: '.' })).why).toBe('the rate K is not a number: use a point for decimals')
    expect(unreadable(opt({ style: 'TOUCH', strike: '1,08', barrier: '82200' })), 'a touch sends no strike').toBeNull()
    expect(unreadable(opt({ barrier: '8,2' })), 'a European sends no barrier').toBeNull()
    expect(unreadable(opt({ style: 'BARRIER', barrier: '8,2' })).field).toBe('barrier')
    expect(unreadable(opt({ fundOv: '1,5' })), 'an option sends no funding rate').toBeNull()
    expect(unreadable(fxFwd({ fundOv: '1,5' })), 'nor does a currency pair').toBeNull()
    expect(unreadable(fwd({ fundOv: '1,5' })).field).toBe('fundOv')
    expect(unreadable(fwd())).toBeNull()
  })
  it('nothing is priced on a number that cannot be read: every field, said in words, and marked so that not even PRICE sends it', () => {
    const cases = [fwd({ notional: '1,5' }), fwd({ strike: '.' }), fwd({ strike: '1.2.3' }), fwd({ spotOv: '74,7' }), fwd({ fundOv: '-1,35' }), opt({ strike: '1,08345' }), opt({ volOv: '55,5' }),
                   opt({ style: 'DIGITAL', payout: '1e5' }), opt({ style: 'BARRIER', barrier: '82,2' }), opt({ style: 'BARRIER', barrier: '82200', rebate: '0,5' }),
                   opt({ style: 'DOUBLE_BARRIER', lowerB: '67,3', upperB: '82200' }), opt({ style: 'DOUBLE_BARRIER', lowerB: '67300', upperB: '82.2.0' })]
    for (const t of cases) {
      const r = priceable(t)
      expect(r.ok, JSON.stringify(r)).toBe(false)
      expect(r.unreadable).toBe(true)
      expect(r.why).toMatch(/ is not a number: use a point for decimals$/)
    }
    expect(priceable(fwd({ settlement: TODAY })).unreadable, 'a refusal of another kind is not this one').toBeUndefined()
  })
  it('a number read in a comma-decimal hand is never sent as the number it was not: the request holds no value for it', () => {
    const b = priceRequest(fwd({ spotOv: '1,08345', strike: '.' })).body
    expect(Number.isNaN(b.spot)).toBe(true)
    expect(Number.isNaN(b.forward_rate)).toBe(true)
    expect(JSON.parse(JSON.stringify(b)).spot).toBeNull()
    expect(priceRequest(fwd({ notional: '10,000', strike: '75,000.50' })).body).toMatchObject({ base_notional: 10000, forward_rate: 75000.5 })
  })
})

describe('what the ticket writes does not depend on the browser\'s locale', () => {
  const native = Number.prototype.toLocaleString
  afterEach(() => { Number.prototype.toLocaleString = native })
  // a browser whose own locale writes a comma for the decimal: a call that names no locale gets German
  const german = () => { Number.prototype.toLocaleString = function (locale, options) { return new Intl.NumberFormat(locale ?? 'de-DE', options).format(this) } }
  it('the stand-in really is a comma-decimal locale', () => {
    german()
    expect((1.08345).toLocaleString(undefined, { maximumFractionDigits: 5 })).toBe('1,08345')
    expect((108250.5).toLocaleString()).toBe('108.250,5')
  })
  it('into a field: digits and a point, no grouping, and it reads back as the same number', () => {
    german()
    expect(formatInput(1.08345, 5)).toBe('1.08345')
    expect(formatInput(74747.9, 2)).toBe('74747.90')
    expect(formatInput(-1.35, 2)).toBe('-1.35')
    expect(formatInput(10000000, 0)).toBe('10000000')
    expect(formatInput(null)).toBe('')
    for (const [x, dp] of [[1.08345, 5], [74747.9, 2], [150.253, 3], [-1.35, 2], [0, 2], [108250.5, 2], [52.3456, 2]]) {
      const text = formatInput(x, dp)
      expect(text, text).toMatch(/^-?\d+(\.\d+)?$/)
      expect(parseNumber(text, { signed: true })).toEqual({ state: 'ok', value: Number(x.toFixed(dp)) })
    }
  })
  it('read-only text: grouped, en-US', () => {
    german()
    expect(formatRead(108250.5, 2)).toBe('108,250.50')
    expect(formatRead(1.08345, 5)).toBe('1.08345')
    expect(formatRead(null)).toBe('—')
    expect(forwardCaption({ forward: 75781.53, spot: 74747.9, t: 0.25, crypto: true })).toEqual({ points: 'points +1,033.63', basis: '5.5 % a year' })
    expect(tenorLabel('2027-02-10', TODAY)).toBe('CUSTOM · 3.1 months')
    expect(roundLevel(82222.69)).toBe('82200')
    expect(seedLevels({ style: 'DOUBLE_BARRIER', spot: 1.085, forward: 1.089, vol: 0.072, years: 0.25 })).toEqual({ lower: '1.03', upper: '1.15' })
  })
  it('no file of the ticket formats a number without naming the locale', () => {
    const here = path.dirname(new URL(import.meta.url).pathname)
    for (const file of ['fx-ticket.js', 'defaulted-input.js', 'DefaultedInput.jsx', 'FxCryptoPanel.jsx']) {
      const src = fs.readFileSync(path.join(here, file), 'utf8')
      const calls = src.match(/toLocaleString\([^)]*/g) || []
      for (const c of calls) expect(c, `${file}: ${c}`).toMatch(/^toLocaleString\('en-US'/)
      expect(src, `${file} uses Intl.NumberFormat without a locale`).not.toMatch(/NumberFormat\(\s*(\)|undefined)/)
      expect(src, `${file} strips a typed number down to digits`).not.toMatch(/replace\(\/\[\^0-9/)
    }
  })
})

describe('an input of the user\'s own is said to be one', () => {
  it('spot, vol and the implied rate, each where the ticket uses it', () => {
    expect(overrideNote(fwd())).toBeNull()
    expect(overrideNote(fwd({ spotOv: '74000' }))).toBe('Priced with your own spot: the booked trade is revalued on the stored market, so its value in the blotter will differ.')
    expect(overrideNote(fwd({ spotOv: '74000', fundOv: '3' }))).toBe('Priced with your own spot and implied rate: the booked trade is revalued on the stored market, so its value in the blotter will differ.')
    expect(overrideNote(opt({ volOv: '60' }))).toMatch(/^Priced with your own vol: /)
    expect(overrideNote(opt({ spotOv: '74000', volOv: '60' }))).toMatch(/^Priced with your own spot and vol: /)
  })
  it('not for a field the ticket does not use, a number it cannot read, or the strike (a term of the trade, kept on it)', () => {
    expect(overrideNote(opt({ fundOv: '3' }))).toBeNull()
    expect(overrideNote(fwd({ volOv: '60' }))).toBeNull()
    expect(overrideNote(fxFwd({ fundOv: '3' }))).toBeNull()
    expect(overrideNote(fwd({ spotOv: '74,0' }))).toBeNull()
    expect(overrideNote(fwd({ strike: '75000' }))).toBeNull()
  })
})

describe('a quote travels with the key of the terms it priced', () => {
  it('it is the quote of the terms on screen only while the keys are the same', () => {
    const quote = { npv: 1 }
    expect(quoteFor({ quote, key: 'A' }, 'A')).toBe(quote)
    expect(quoteFor({ quote, key: 'A' }, 'B')).toBeNull()
    expect(quoteFor({ quote, key: null }, null)).toBeNull()
    expect(quoteFor({ quote: null, key: 'A' }, 'A')).toBeNull()
    expect(quoteFor(null, 'A')).toBeNull()
  })
  it('a failure with no words gets plain ones; the API\'s own are kept', () => {
    expect(failureText(new Error('500'))).toMatch(/did not come back \(HTTP 500\)/)
    expect(failureText(new Error('Failed to fetch'))).toMatch(/could not be reached/)
    expect(failureText(new Error('USD_SOFR: no snapshot'))).toBe('USD_SOFR: no snapshot')
  })
})

// The pricing of the ticket with no browser in it: a hand-wound timer and answers that arrive when the test says.
describe('the ticket\'s pricing: which answer lands, and what BOOK may book', () => {
  const desk = ({ debounceMs = 400 } = {}) => {
    const timers = [], sent = [], pricedCalls = [], errors = [], states = []
    const pricer = createTicketPricer({
      debounceMs,
      setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t },
      clearTimer: (t) => { if (t) t.live = false },
      send: (request, signal) => new Promise((resolve, reject) => { sent.push({ request, signal, resolve, reject }) }),
      onChange: (s) => states.push(s), onPriced: (q, meta) => pricedCalls.push([q, meta]), onError: (m) => errors.push(m),
    })
    const tick = () => { const due = timers.filter(t => t.live); for (const t of due) { t.live = false; t.fn() } return due.length }       // the debounce runs out
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
    const terms = (key, over = {}) => ({ key, ident: 'CRYPTO|CRYPTO_FORWARD|BTCUSD', ready: true, request: { path: '/price', body: { key } }, check: () => ({ ok: true, why: '' }), ...over })
    // a ticket that has priced `key` and is at rest
    const pricedAt = async (key, quote) => { pricer.setTerms(terms(key)); tick(); sent.at(-1).resolve(quote); await flush() }
    return { pricer, timers, sent, pricedCalls, errors, states, tick, flush, terms, pricedAt }
  }
  const QA = { npv: 1, forward: 100 }, QB = { npv: 2, forward: 200 }

  it('nothing is sent until the debounce runs out, and one request for a run of changes', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A1')); d.pricer.setTerms(d.terms('A2')); d.pricer.setTerms(d.terms('A3'))
    expect(d.sent.length).toBe(0)
    expect(d.timers.at(-1).ms).toBe(400)
    expect(d.pricer.state().pending).toBe(true)
    expect(d.tick(), 'only the last change\'s timer is alive').toBe(1)
    expect(d.sent.map(s => s.request.body.key)).toEqual(['A3'])
    d.sent[0].resolve(QA); await d.flush()
    expect(d.pricer.state()).toMatchObject({ quote: QA, quoteKey: 'A3', pending: false, note: null })
  })
  it('an older answer that arrives after a newer one is dropped, and its request was aborted', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A')); d.tick()
    d.pricer.setTerms(d.terms('B')); d.tick()
    expect(d.sent.map(s => s.request.body.key)).toEqual(['A', 'B'])
    expect(d.sent[0].signal.aborted, 'the earlier request is aborted when the terms change').toBe(true)
    d.sent[1].resolve(QB); await d.flush()
    expect(d.pricer.state()).toMatchObject({ quote: QB, quoteKey: 'B' })
    d.sent[0].resolve(QA); await d.flush()                       // the old answer, late
    expect(d.pricer.state(), 'the late answer changes nothing').toMatchObject({ quote: QB, quoteKey: 'B', pending: false })
    expect(d.pricedCalls.filter(([q]) => q === QA)).toEqual([])
  })
  it('an older answer that arrives first is dropped too, and a late failure of it says nothing', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A')); d.tick()
    d.pricer.setTerms(d.terms('B')); d.tick()
    d.sent[0].reject(new Error('the USD curve does not build')); await d.flush()
    expect(d.pricer.state()).toMatchObject({ quote: null, pending: true, note: null })
    d.sent[1].resolve(QB); await d.flush()
    expect(d.pricer.state()).toMatchObject({ quote: QB, quoteKey: 'B', note: null })
    expect(d.errors).toEqual([])
  })
  it('while a price is owed the window keeps the last quote, marked stale; a quote of another product or pair goes at once', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    d.pricer.setTerms(d.terms('B'))
    expect(d.pricedCalls.at(-1)).toEqual([QA, { stale: true }])
    expect(d.pricer.state()).toMatchObject({ quote: QA, quoteKey: 'A', pending: true })
    expect(d.pricer.held(), 'it is not the quote of the terms on screen').toBeNull()
    d.pricer.setTerms(d.terms('C', { ident: 'CRYPTO|CRYPTO_OPTION|BTCUSD' }))
    expect(d.pricer.state().quote).toBeNull()
    expect(d.pricedCalls.at(-1)).toEqual([null, undefined])
  })
  it('terms the check refuses are never sent by the automatic pricing: no quote is left, and the reason is', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    d.pricer.setTerms(d.terms('B', { check: () => ({ ok: false, why: 'enter a notional above zero' }) })); d.tick(); await d.flush()
    expect(d.sent.length).toBe(1)
    expect(d.pricer.state()).toMatchObject({ quote: null, pending: false, note: { kind: 'why', text: 'enter a notional above zero' } })
    expect(d.pricedCalls.at(-1)[0]).toBeNull()
  })
  it('a failed automatic price is a note beside the valuation, not an error for the window', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A')); d.tick(); d.sent[0].reject(new Error('the USD curve does not build')); await d.flush()
    expect(d.pricer.state()).toMatchObject({ quote: null, pending: false, note: { kind: 'error', text: 'the USD curve does not build' } })
    expect(d.errors).toEqual([])
  })
  it('settled() answers only after the price that is owed has landed', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A'))
    let got = 'not yet'
    d.pricer.settled().then(h => { got = h })
    await d.flush(); expect(got, 'inside the debounce').toBe('not yet')
    d.tick(); await d.flush(); expect(got, 'in flight').toBe('not yet')
    d.pricer.setTerms(d.terms('B')); await d.flush(); expect(got, 'the terms changed again: still owed').toBe('not yet')
    d.tick(); d.sent[1].resolve(QB); await d.flush()
    expect(got).toEqual({ quote: QB, key: 'B' })
    expect(await d.pricer.settled(), 'at rest it answers at once').toEqual({ quote: QB, key: 'B' })
  })
  it('PRICE sends at once, whatever the check thinks, and reports a refusal to the window as well', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A', { check: () => ({ ok: false, why: 'a vol outside 2 to 500 % is not priced as you type: press PRICE' }) }))
    const p = d.pricer.force()
    expect(d.sent.length, 'no debounce for PRICE').toBe(1)
    expect(d.tick(), 'the automatic price it overtook is called off').toBe(0)
    d.sent[0].reject(new Error('vol must be positive'))
    expect(await p).toBeNull()
    expect(d.errors).toEqual(['vol must be positive'])
    expect(d.pricer.state().note).toEqual({ kind: 'error', text: 'vol must be positive' })
  })
  it('not even PRICE sends a number that cannot be read', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A', { check: () => ({ ok: false, why: 'the spot is not a number: use a point for decimals', unreadable: true }) }))
    expect(await d.pricer.force()).toBeNull()
    expect(d.sent.length).toBe(0)
    expect(d.pricer.state().note).toEqual({ kind: 'why', text: 'the spot is not a number: use a point for decimals' })
    expect(d.errors).toEqual([])
  })
  it('PRICE on a quote that is current keeps it current while its refresh is in flight, and identical figures keep the same object', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    const p = d.pricer.force()
    expect(d.pricer.held()).toEqual({ quote: QA, key: 'A' })
    expect(await d.pricer.book(), 'BOOK meanwhile books the quote on screen: it is the quote of these terms').toEqual({ action: 'book', quote: QA, key: 'A' })
    d.sent.at(-1).resolve({ ...QA })
    expect(await p).toBe(QA)
    expect(d.pricer.state().quote, 'the same object, so nothing downstream starts over').toBe(QA)
  })
  it('BOOK at rest on a quote of the terms on screen books it, with its key', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    expect(await d.pricer.book()).toEqual({ action: 'book', quote: QA, key: 'A' })
    expect(d.sent.length, 'nothing more is asked of the API').toBe(1)
  })
  it('BOOK inside the debounce does not book figures nobody has seen: it waits, shows them, and books on the second press', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    d.pricer.setTerms(d.terms('B'))                              // a term typed; the old quote is still on screen, stale
    let decision = 'waiting'
    d.pricer.book().then(x => { decision = x })
    await d.flush(); expect(decision, 'nothing is booked on the stale quote').toBe('waiting')
    d.tick(); await d.flush(); expect(decision).toBe('waiting')
    d.sent.at(-1).resolve(QB); await d.flush()
    expect(decision).toEqual({ action: 'review' })
    expect(d.pricer.state()).toMatchObject({ quote: QB, quoteKey: 'B', review: true, pending: false })
    expect(await d.pricer.book(), 'the second press, on figures that were on screen').toEqual({ action: 'book', quote: QB, key: 'B' })
    expect(d.pricer.state().review).toBe(false)
  })
  it('BOOK inside the debounce on terms the check refuses stops with the reason, and nothing is sent', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    d.pricer.setTerms(d.terms('B', { check: () => ({ ok: false, why: 'a vol outside 2 to 500 % is not priced as you type: press PRICE' }) }))
    const booking = d.pricer.book()
    d.tick()
    expect(await booking).toEqual({ action: 'stop', why: 'a vol outside 2 to 500 % is not priced as you type: press PRICE' })
    expect(d.sent.length, 'BOOK never forces a price for terms the automatic pricing refuses').toBe(1)
    expect(d.pricer.state()).toMatchObject({ quote: null, note: { kind: 'why', text: 'a vol outside 2 to 500 % is not priced as you type: press PRICE' } })
  })
  it('BOOK with nothing priced and nothing owed asks once and shows the answer; refused terms are not asked for at all', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A')); d.tick(); d.sent[0].reject(new Error('502')); await d.flush()        // the automatic price failed
    const booking = d.pricer.book()
    expect(d.sent.length).toBe(2)
    d.sent[1].resolve(QA)
    expect(await booking).toEqual({ action: 'review' })
    expect(d.pricer.state().review).toBe(true)

    const e = desk()
    e.pricer.setTerms(e.terms('A', { check: () => ({ ok: false, why: 'enter a barrier level' }) })); e.tick(); await e.flush()
    expect(await e.pricer.book()).toEqual({ action: 'stop', why: 'enter a barrier level' })
    expect(e.sent.length).toBe(0)
  })
  it('when the API refuses the price BOOK asked for, BOOK stops with the API\'s own words', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A')); d.tick(); d.sent[0].reject(new Error('500')); await d.flush()
    const booking = d.pricer.book()
    d.sent[1].reject(new Error('a down barrier must be below spot'))
    expect(await booking).toEqual({ action: 'stop', why: 'a down barrier must be below spot' })
    expect(d.pricer.state().note).toEqual({ kind: 'error', text: 'a down barrier must be below spot' })
    expect(d.errors, 'and the window is not told "Price it first"').toEqual([])
  })
  it('a change of the terms takes back the "press BOOK again": the figures it was about are gone', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    d.pricer.setTerms(d.terms('B')); const booking = d.pricer.book(); d.tick(); d.sent.at(-1).resolve(QB); await booking
    expect(d.pricer.state().review).toBe(true)
    d.pricer.setTerms(d.terms('C'))
    expect(d.pricer.state().review).toBe(false)
  })
  it('before the pairs arrive nothing is owed and nothing is booked; once gone, nothing lands and nobody is left waiting', async () => {
    const d = desk()
    d.pricer.setTerms(d.terms('A', { ready: false }))
    expect(d.pricer.state().pending).toBe(false)
    expect(await d.pricer.book()).toEqual({ action: 'stop', why: 'loading the pairs' })
    d.pricer.setTerms(d.terms('B')); d.tick()
    const waiting = d.pricer.settled()
    const seen = d.states.length
    d.pricer.dispose()
    expect(await waiting).toBeNull()
    d.sent.at(-1).resolve(QB); await d.flush()
    expect(d.states.length, 'no state after the panel is gone').toBe(seen)
  })
  it('the same terms again change nothing: no second debounce, no stale flag', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    const calls = d.pricedCalls.length
    d.pricer.setTerms(d.terms('A'))
    expect(d.pricer.state().pending).toBe(false)
    expect(d.pricedCalls.length).toBe(calls)
    expect(d.tick()).toBe(0)
  })
  it('terms that only add the default K the quote gave are sent at once, not after the debounce, and the last figures are marked stale meanwhile', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    d.pricer.setTerms(d.terms('A+K', { refine: true }))
    expect(d.sent.map(s => s.request.body.key), 'no timer: the request is already out').toEqual(['A', 'A+K'])
    expect(d.timers.filter(t => t.live)).toEqual([])
    expect(d.pricedCalls.at(-1)).toEqual([QA, { stale: true }])
    d.sent.at(-1).resolve(QB); await d.flush()
    expect(d.pricer.state()).toMatchObject({ quote: QB, quoteKey: 'A+K', pending: false })
  })
  it('a refinement the check refuses is not sent either', async () => {
    const d = desk()
    await d.pricedAt('A', QA)
    d.pricer.setTerms(d.terms('A+K', { refine: true, check: () => ({ ok: false, why: 'no' }) }))
    expect(d.sent.length).toBe(1)
    expect(d.pricer.state()).toMatchObject({ quote: null, pending: false, note: { kind: 'why', text: 'no' } })
  })
  it('the default timer is the real one', async () => {
    vi.useFakeTimers()
    try {
      const sent = []
      const pricer = createTicketPricer({ send: (request) => { sent.push(request); return Promise.resolve(QA) } })
      pricer.setTerms({ key: 'A', ident: 'x', ready: true, request: { path: '/p', body: {} }, check: () => ({ ok: true, why: '' }) })
      vi.advanceTimersByTime(399); expect(sent.length).toBe(0)
      vi.advanceTimersByTime(1); expect(sent.length).toBe(1)
      await vi.runAllTimersAsync()
      expect(pricer.held()).toEqual({ quote: QA, key: 'A' })
    } finally { vi.useRealTimers() }
  })
})

// ── The head of a crypto derivatives desk walked the ticket (9 November 2026) ──────────────────────────────────────
// A pairs answer that carries the API's dates: its calendar, its spot date and the dates it settles each tenor on.
const CAL = { name: 'NEW_YORK', holidays: ['2027-02-15', '2027-01-18'], weekend: ['SAT', 'SUN'] }
const BTC_DATED = { ...BTC, calendar: CAL, spot_date: '2026-11-09', spot_lag_business_days: 0,
  tenor_dates: { forward: { '1W': '2026-11-16', '3M': '2027-02-09', '2Y': '2028-11-09' },
                 option: { '1W': { expiry: '2026-11-16', settlement: '2026-11-17' }, '3M': { expiry: '2027-02-09', settlement: '2027-02-10' }, '2Y': { expiry: '2028-11-09', settlement: '2028-11-10' } } } }
const EUR_DATED = { ...EUR, calendar: { name: 'TARGET+NEW_YORK', holidays: ['2027-02-15'], weekend: ['SAT', 'SUN'] }, spot_date: '2026-11-11', spot_lag_business_days: 2,
  tenor_dates: { forward: { '3M': '2027-02-11' }, option: { '3M': { expiry: '2027-02-09', settlement: '2027-02-11' } } } }

describe('the dates come from the API when it gives them', () => {
  it('the tenor dates of each product, and nothing from an older answer', () => {
    expect(tenorDates(BTC_DATED, 'FORWARD')).toEqual({ '1W': '2026-11-16', '3M': '2027-02-09', '2Y': '2028-11-09' })
    expect(tenorDates(BTC_DATED, 'OPTION')).toEqual({ '1W': '2026-11-16', '3M': '2027-02-09', '2Y': '2028-11-09' })
    expect(tenorDates(BTC, 'FORWARD')).toBeNull()
    expect(tenorDates(null, 'OPTION')).toBeNull()
    expect(tenorDates({ tenor_dates: { forward: { '3M': 'soon' } } }, 'FORWARD'), 'a date that is no date is left out').toBeNull()
    expect(tenorSettlement(BTC_DATED, '3M')).toBe('2027-02-10')
    expect(tenorSettlement(BTC_DATED, '6M')).toBeNull()
    expect(tenorSettlement(BTC, '3M')).toBeNull()
  })
  it('a tenor\'s date is the API\'s where it gave one, else the calendar\'s; a date is matched against the same', () => {
    const d = tenorDates(EUR_DATED, 'FORWARD')
    expect(tenorDateFor('3M', TODAY, d)).toBe('2027-02-11')
    expect(tenorDateFor('6M', TODAY, d)).toBe(tenorDate('6M', TODAY))
    expect(tenorDateFor('3M', TODAY, null)).toBe('2027-02-09')
    expect(tenorOf('2027-02-11', TODAY, d)).toBe('3M')
    expect(tenorOf('2027-02-09', TODAY, d), 'the calendar\'s 3M is no tenor once the API\'s dates are here').toBeNull()
    expect(tenorOf('2027-02-09', TODAY)).toBe('3M')
    expect(lastDate({ crypto: true, today: TODAY, dates: { '2Y': '2028-11-10' } })).toBe('2028-11-10')
    expect(lastDate({ crypto: true, today: TODAY })).toBe('2028-11-09')
  })
  it('the spot date and its lag: the API\'s, else today for a digital asset (T+0) and two weekdays on for a pair', () => {
    expect(spotDateFor({ cur: BTC_DATED, crypto: true, today: TODAY })).toBe('2026-11-09')
    expect(spotDateFor({ cur: EUR_DATED, crypto: false, today: TODAY })).toBe('2026-11-11')
    expect(spotDateFor({ cur: BTC, crypto: true, today: '2026-11-13' })).toBe('2026-11-13')               // a digital asset's quoted spot settles at once
    expect(spotDateFor({ cur: EUR, crypto: false, today: '2026-11-13' })).toBe('2026-11-17')              // a Friday: two weekdays on is Tuesday
    expect(spotLagLabel({ cur: BTC_DATED, crypto: true })).toBe('T+0')
    expect(spotLagLabel({ cur: EUR_DATED, crypto: false })).toBe('T+2')
    expect(spotLagLabel({ cur: { ...EUR_DATED, spot_lag_business_days: 1 }, crypto: false }), 'USDCAD-style T+1 from the API').toBe('T+1')
    expect(spotLagLabel({ cur: BTC, crypto: true })).toBe('T+0')
    expect(spotLagLabel({ cur: EUR, crypto: false })).toBe('T+2')
  })
})

describe('a typed date is rolled by the API\'s rule', () => {
  it('a business day is a weekday that is no holiday on the calendar; no calendar means the weekend alone', () => {
    expect(closedWhy('2027-02-13', CAL)).toBe('Saturday')
    expect(closedWhy('2027-02-14', CAL)).toBe('Sunday')
    expect(closedWhy('2027-02-15', CAL)).toBe('holiday')
    expect(closedWhy('2027-02-16', CAL)).toBeNull()
    expect(closedWhy('2027-02-15', null), 'without the calendar a holiday is a business day').toBeNull()
    expect(closedWhy('2027-02-13', null)).toBe('Saturday')
    expect(isBusinessDay('2027-02-16', CAL)).toBe(true)
    expect(isBusinessDay('not a date', CAL)).toBe(false)
    expect(closedWhy('2027-02-12', { weekend: ['FRI', 'SAT'] }), 'a calendar with its own weekend').toBe('Friday')
  })
  it('business days strictly after a date', () => {
    expect(addBusinessDays('2027-02-12', 1, CAL), 'Friday + 1: the Monday is a holiday, so Tuesday').toBe('2027-02-16')
    expect(addBusinessDays('2027-02-09', 1, CAL)).toBe('2027-02-10')
    expect(addBusinessDays('2027-02-11', 2, CAL), 'Thursday + 2 over a weekend and a holiday').toBe('2027-02-16')
    expect(addBusinessDays('2027-02-12', 1, null), 'without the calendar the holiday counts').toBe('2027-02-15')
    expect(addBusinessDays('x', 1, CAL)).toBeNull()
  })
  it('FOLLOWING rolls on; MODIFIED FOLLOWING rolls back when the next business day is in the next month; NONE leaves it', () => {
    expect(rollDate('2027-02-13', 'FOLLOWING', CAL)).toEqual({ date: '2027-02-16', rolled: true, from: '2027-02-13', why: 'Saturday' })
    expect(rollDate('2027-02-15', 'FOLLOWING', CAL)).toEqual({ date: '2027-02-16', rolled: true, from: '2027-02-15', why: 'holiday' })
    expect(rollDate('2027-02-16', 'FOLLOWING', CAL)).toEqual({ date: '2027-02-16', rolled: false, from: null, why: null })
    // 31 January 2027 is a Sunday: following is 1 February, modified following the Friday before
    expect(rollDate('2027-01-31', 'FOLLOWING', CAL).date).toBe('2027-02-01')
    expect(rollDate('2027-01-31', 'MODIFIED_FOLLOWING', CAL)).toEqual({ date: '2027-01-29', rolled: true, from: '2027-01-31', why: 'Sunday' })
    expect(rollDate('2027-02-13', 'MODIFIED_FOLLOWING', CAL).date, 'inside the month it is following').toBe('2027-02-16')
    expect(rollDate('2027-02-13', 'NONE', CAL)).toEqual({ date: '2027-02-13', rolled: false, from: null, why: null })
    expect(rollDate('', 'FOLLOWING', CAL).rolled).toBe(false)
  })
  it('each date of the ticket has its rule: FX modified following, a digital asset settles following and expires on any day', () => {
    expect(rollRule({ crypto: false, which: 'settlement' })).toBe('MODIFIED_FOLLOWING')
    expect(rollRule({ crypto: false, which: 'expiry' })).toBe('MODIFIED_FOLLOWING')
    expect(rollRule({ crypto: true, which: 'settlement' })).toBe('FOLLOWING')
    expect(rollRule({ crypto: true, which: 'expiry' })).toBe('NONE')
  })
  it('the ticket says what it did, under the field', () => {
    expect(rolledTag(rollDate('2027-02-13', 'FOLLOWING', CAL))).toBe('rolled from 2027-02-13 (Saturday)')
    expect(rolledTag(rollDate('2027-02-15', 'FOLLOWING', CAL))).toBe('rolled from 2027-02-15 (holiday)')
    expect(rolledTag(rollDate('2027-02-16', 'FOLLOWING', CAL))).toBeNull()
    expect(rolledTag(null)).toBeNull()
  })
  it('the check holds a digital asset to the API\'s last date when it gave one', () => {
    expect(ok(fwd({ cur: BTC_DATED, settlement: '2028-11-09' }))).toBe(true)
    expect(ok(fwd({ cur: BTC_DATED, settlement: '2028-11-10' })), 'a forward is not held to the option\'s two years').toBe(true)
    expect(ok(opt({ cur: { ...BTC_DATED, tenor_dates: { ...BTC_DATED.tenor_dates, option: { '2Y': { expiry: '2028-11-10', settlement: '2028-11-13' } } } }, expiry: '2028-11-10' })), 'the option\'s own last date').toBe(true)
  })
})

describe('K is booked as it is shown', () => {
  it('the forward to the pair\'s decimals, as a number', () => {
    expect(bookedStrike(75781.5312, 2)).toBe(75781.53)
    expect(bookedStrike(75781.535, 2)).toBe(75781.54)
    expect(bookedStrike(1.0852345, 5)).toBe(1.08523)
    expect(bookedStrike('150.2534', 3)).toBe(150.253)
    expect(bookedStrike(null, 2)).toBeNull()
    expect(bookedStrike('—', 2)).toBeNull()
  })
  it('a blank K asks the API to strike at the forward rounded to the pair\'s decimals (strike_dp); a typed K sends no such ask', () => {
    expect(priceRequest(fwd({ strikeDp: 2 })).body).toMatchObject({ strike_dp: 2 })
    expect('forward_rate' in priceRequest(fwd({ strikeDp: 2 })).body).toBe(false)
    expect(priceRequest(fxFwd({ strikeDp: 5, strike: '1.10' })).body).toMatchObject({ forward_rate: 1.1 })
    expect('strike_dp' in priceRequest(fxFwd({ strikeDp: 5, strike: '1.10' })).body).toBe(false)
    expect(priceRequest(opt({ strikeDp: 2 })).body).toMatchObject({ strike_dp: 2 })
    expect('strike_dp' in priceRequest(opt({ strikeDp: 2, strike: '70000' })).body).toBe(false)
    expect('strike_dp' in priceRequest(opt({ strikeDp: 2, style: 'TOUCH' })).body, 'a touch has no strike to round').toBe(false)
    expect('strike_dp' in priceRequest(fwd({ strikeDp: null })).body).toBe(false)
    expect('strike_dp' in priceRequest(fwd({ strikeDp: 2.5 })).body).toBe(false)
    expect(priceRequest(fwd({ strikeDp: 0 })).body.strike_dp, 'zero decimals is an ask too').toBe(0)
    expect(ok(fwd({ strikeDp: 2 }))).toBe(true)
  })
  it('an older API that ignores strike_dp is seen from its answer, and the ticket then sends the rounded forward itself', () => {
    const sent = { strikeDp: true, defaultK: null }
    expect(apiRoundsStrike({ shape: 'NDF', forward: 75781.5312, forward_rate: 75781.53 }, sent, 2)).toBe(true)
    expect(apiRoundsStrike({ shape: 'NDF', forward: 75781.5312, forward_rate: 75781.5312 }, sent, 2)).toBe(false)
    expect(apiRoundsStrike({ shape: 'OPTION', forward: 75781.5312, strike: 75781.53 }, sent, 2)).toBe(true)
    expect(apiRoundsStrike({ shape: 'OPTION', forward: 75781.5312, strike: 75781.5312 }, sent, 2)).toBe(false)
    expect(apiRoundsStrike({ shape: 'NDF', forward: 75781.5312, forward_rate: 75781.5312 }, { strikeDp: false, defaultK: null }, 2), 'a request that did not ask says nothing').toBeNull()
    expect(apiRoundsStrike({ shape: 'NDF', forward: 75781.5312, forward_rate: 75781.53 }, { strikeDp: true, defaultK: 75781.53 }, 2), 'nor one that sent the K itself').toBeNull()
    expect(apiRoundsStrike({ shape: 'NDF', forward: 75781.5312 }, sent, 2), 'nor an answer with no K').toBeNull()
    expect(apiRoundsStrike(null, sent, 2)).toBeNull()
    // the fallback: the rounded forward as the K, in place of the ask
    expect(priceRequest(fwd({ strikeDp: 2, defaultK: 75781.53 })).body).toMatchObject({ forward_rate: 75781.53 })
    expect('strike_dp' in priceRequest(fwd({ strikeDp: 2, defaultK: 75781.53 })).body).toBe(false)
  })
  it('the fallback K travels in the request once the forward is known, and a typed K wins over it', () => {
    expect(priceRequest(fwd()).body.forward_rate, 'before a price: the API strikes at the forward').toBeUndefined()
    expect(priceRequest(fwd({ defaultK: 75781.53 })).body.forward_rate).toBe(75781.53)
    expect(priceRequest(fwd({ defaultK: 75781.53, strike: '75000' })).body.forward_rate).toBe(75000)
    expect(priceRequest(fwd({ defaultK: 0 })).body.forward_rate, 'no K below or at zero').toBeUndefined()
    expect(priceRequest(opt({ defaultK: 75781.53 })).body.strike).toBe(75781.53)
    expect(priceRequest(opt({ defaultK: 75781.53, strike: '70000' })).body.strike).toBe(70000)
    expect('strike' in priceRequest(opt({ defaultK: 75781.53, style: 'TOUCH' })).body, 'a touch has no strike, default or not').toBe(false)
    expect(ok(fwd({ defaultK: 75781.53 }))).toBe(true)
  })
})

describe('a digital or a touch pays an amount: its notional is neither read nor sent, and the payout is booked', () => {
  it('the notional field is not among the numbers a payout style sends, and the API gets 1', () => {
    expect(numbersSent(opt({ style: 'DIGITAL' }))).not.toContain('notional')
    expect(numbersSent(opt({ style: 'TOUCH' }))).not.toContain('notional')
    expect(numbersSent(opt({ style: 'BARRIER' }))).toContain('notional')
    expect(notionalSent(opt({ style: 'DIGITAL', notional: '25000000' })), 'the hidden cell\'s number never travels').toBe(1)
    expect(notionalSent(opt({ style: 'TOUCH', notional: '1,5' })), 'a hidden notional that cannot be read does not stop the price').toBe(1)
    expect(notionalSent(opt({ style: 'TOUCH', notional: '' }))).toBe(1)
    expect(notionalSent(opt({ style: 'EUROPEAN', notional: '' }))).toBeNaN()
    expect(notionalSent(fwd({ notional: '12,500' }))).toBe(12500)
    expect(unreadable(opt({ style: 'TOUCH', notional: '1,5', barrier: '80000' }))).toBeNull()
    expect(ok(opt({ style: 'DIGITAL', notional: '', payout: '100000' }))).toBe(true)
    expect(ok(opt({ style: 'TOUCH', notional: 'abc', payout: '100000', barrier: '80000' })), 'the check does not judge the hidden notional').toBe(true)
    expect(priceRequest(opt({ style: 'DIGITAL', notional: '25000000' })).body.base_notional).toBe(1)
    expect(priceRequest(opt({ style: 'TOUCH', notional: '10' })).body.base_notional).toBe(1)
    expect(why(opt({ notional: '' }))).toBe('enter a notional above zero')
  })
  it('the record\'s notional is the payout in its currency for a payout style, the base notional in base otherwise', () => {
    const ccy = { base: 'EUR', quote: 'USD' }
    expect(bookedNotional(fxOpt({ style: 'TOUCH', notional: '25000000', payout: '1000000', payoutCcy: 'QUOTE' }), ccy)).toEqual({ amount: 1000000, currency: 'USD', payoutStyle: true })
    expect(bookedNotional(fxOpt({ style: 'DIGITAL', notional: '25000000', payout: '2', payoutCcy: 'BASE' }), ccy)).toEqual({ amount: 2, currency: 'EUR', payoutStyle: true })
    expect(bookedNotional(fxOpt({ style: 'EUROPEAN', notional: '25000000', payout: '1000000' }), ccy)).toEqual({ amount: 25000000, currency: 'EUR', payoutStyle: false })
    expect(bookedNotional(fwd({ notional: '10', payout: '1000000' }), { base: 'BTC', quote: 'USD' })).toEqual({ amount: 10, currency: 'BTC', payoutStyle: false })
    expect(bookedNotional(fxOpt({ style: 'TOUCH', payout: '1,0' }), ccy).amount, 'a payout that cannot be read is no amount').toBeNaN()
  })
})

describe('the cap a typed date is held to', () => {
  it('a settlement or an expiry to the last tenor; the option\'s own settlement to none', () => {
    expect(dateCap('settlement', '2028-11-09')).toBe('2028-11-09')
    expect(dateCap('expiry', '2028-11-09')).toBe('2028-11-09')
    expect(dateCap('optSettle', '2028-11-09')).toBeNull()
    expect(dateCap('settlement', null)).toBeNull()
    expect(holdToLast('2028-11-10', dateCap('optSettle', '2028-11-09'))).toEqual({ date: '2028-11-10', hit: false })
    expect(holdToLast('2028-11-10', dateCap('settlement', '2028-11-09'))).toEqual({ date: '2028-11-09', hit: true })
  })
})

describe('the sensitivities by the desk\'s names', () => {
  it('CRYBASIS01 is the API\'s field, else the negative of FUND01 (an older API), else nothing', () => {
    expect(crybasis01({ crybasis01: 12.5, fund01: -12.5 })).toBe(12.5)
    expect(crybasis01({ fund01: -20.4 })).toBe(20.4)
    expect(crybasis01({ ir01_base: 20.4 })).toBe(-20.4)
    expect(crybasis01({ crybasis01: 0, fund01: 5 }), 'a zero from the API is a zero').toBe(0)
    expect(crybasis01({})).toBeNull()
    expect(crybasis01(null)).toBeNull()
  })
  it('each name has its unit', () => {
    expect(SENS_UNITS).toEqual({ CRY01: '1 % spot', FX01: '1 % spot', IR01: '1 bp', CRYBASIS01: '1 bp basis', VEGA: '1 pt', THETA: '1 day' })
  })
})

describe('the premium of an option, in one line', () => {
  const Q = { shape: 'OPTION', style: 'EUROPEAN', direction: 'BUY', npv: 12345.678, base_notional: 10, spot: 74747.9, quote_currency: 'USD', base_currency: 'BTC' }
  it('a vanilla: the amount, paid or received, as a share of the notional at spot and per unit of base', () => {
    expect(premiumLine(Q, 2)).toBe('Premium 12,345.68 USD paid · 1.65 % of the USD notional at spot · 1,234.57 per BTC')
    expect(premiumLine({ ...Q, direction: 'SELL', npv: -12345.678 }, 2)).toBe('Premium 12,345.68 USD received · 1.65 % of the USD notional at spot · 1,234.57 per BTC')
    expect(premiumLine({ ...Q, style: 'AMERICAN' }, 2)).toMatch(/% of the USD notional at spot/)
    expect(premiumLine({ ...Q, style: 'BARRIER' }, 2)).toMatch(/% of the USD notional at spot/)
    expect(premiumLine({ ...Q, base_notional: 10_000_000, spot: 1.085, npv: 123456.7, quote_currency: 'USD', base_currency: 'EUR' }, 5)).toBe('Premium 123,456.70 USD paid · 1.14 % of the USD notional at spot · 0.01235 per EUR')
  })
  it('a digital or a touch: as a share of the payout (a payout in base, at spot)', () => {
    expect(premiumLine({ ...Q, style: 'DIGITAL', npv: 41234.5, payout: 100000, payout_currency: 'QUOTE' })).toBe('Premium 41,234.50 USD paid · 41.23 % of the payout')
    expect(premiumLine({ ...Q, style: 'TOUCH', direction: 'SELL', npv: -41234.5, payout: 100000, payout_currency: 'QUOTE' })).toBe('Premium 41,234.50 USD received · 41.23 % of the payout')
    expect(premiumLine({ ...Q, style: 'TOUCH', npv: 37373.95, payout: 1, payout_currency: 'BASE' })).toBe('Premium 37,373.95 USD paid · 50.00 % of the payout')
    expect(premiumLine({ ...Q, style: 'DIGITAL', npv: 100, payout: null }), 'no payout known: the amount alone').toBe('Premium 100.00 USD paid')
  })
  it('nothing for a forward or before a price', () => {
    expect(premiumLine({ shape: 'NDF', npv: 5 })).toBeNull()
    expect(premiumLine(null)).toBeNull()
    expect(premiumLine({ ...Q, npv: NaN })).toBeNull()
  })
})

describe('what the option is, in one sentence', () => {
  const base = { direction: 'BUY', optType: 'CALL', base: 'BTC', quote: 'USD', payout: 100000, payoutCcy: 'QUOTE', strike: 75781.53, barrier: 82200, lower: 65000, upper: 85000, expiry: '2027-02-09', fmt: (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
  const say = (over) => optionSentence({ ...base, ...over })
  it('a touch says what is received, when, and never mentions a call, a put or a notional', () => {
    expect(say({ style: 'TOUCH', touchType: 'ONE_TOUCH' })).toBe('we receive 100,000 USD if BTC touches 82,200.00 before 2027-02-09')
    expect(say({ style: 'TOUCH', touchType: 'NO_TOUCH' })).toBe('we receive 100,000 USD if BTC never touches 82,200.00 before 2027-02-09')
    expect(say({ style: 'TOUCH', touchType: 'DOUBLE_NO_TOUCH' })).toBe('we receive 100,000 USD if BTC stays between 65,000.00 and 85,000.00 before 2027-02-09')
    expect(say({ style: 'TOUCH', touchType: 'DOUBLE_ONE_TOUCH' })).toBe('we receive 100,000 USD if BTC leaves the range 65,000.00 to 85,000.00 before 2027-02-09')
    expect(say({ style: 'TOUCH', touchType: 'ONE_TOUCH', direction: 'SELL' })).toBe('we pay 100,000 USD if BTC touches 82,200.00 before 2027-02-09')
    expect(say({ style: 'TOUCH', touchType: 'ONE_TOUCH', payoutCcy: 'BASE', payout: 2 })).toBe('we receive 2 BTC if BTC touches 82,200.00 before 2027-02-09')
    expect(say({ style: 'TOUCH', touchType: 'ONE_TOUCH', barrier: NaN })).toBe('we receive 100,000 USD if BTC touches the barrier before 2027-02-09')
    for (const tt of ['ONE_TOUCH', 'NO_TOUCH', 'DOUBLE_ONE_TOUCH', 'DOUBLE_NO_TOUCH']) expect(say({ style: 'TOUCH', touchType: tt })).not.toMatch(/buy|sell|right|notional/)
  })
  it('a digital says above or below the strike at expiry', () => {
    expect(say({ style: 'DIGITAL' })).toBe('we receive 100,000 USD if BTC is above 75,781.53 at expiry')
    expect(say({ style: 'DIGITAL', optType: 'PUT', direction: 'SELL' })).toBe('we pay 100,000 USD if BTC is below 75,781.53 at expiry')
    expect(say({ style: 'DIGITAL', strike: null })).toBe('we receive 100,000 USD if BTC is above the strike at expiry')
  })
  it('a vanilla, an American and the barriers', () => {
    expect(say({ style: 'EUROPEAN' })).toBe('we hold the right to buy BTC against USD')
    expect(say({ style: 'EUROPEAN', direction: 'SELL', optType: 'PUT' })).toBe('we write the right to sell BTC against USD')
    expect(say({ style: 'AMERICAN' })).toBe('we hold the right to buy BTC against USD, exercisable any day to 2027-02-09')
    expect(say({ style: 'BARRIER', barrierType: 'UP_OUT' })).toBe('we hold the right to buy BTC against USD; knocked out if BTC trades above 82,200.00 before expiry')
    expect(say({ style: 'BARRIER', barrierType: 'DOWN_IN', barrier: 60000 })).toBe('we hold the right to buy BTC against USD; knocked in if BTC trades below 60,000.00 before expiry')
    expect(say({ style: 'DOUBLE_BARRIER', barrierType: 'KNOCK_OUT' })).toBe('we hold the right to buy BTC against USD; knocked out if BTC trades through 65,000.00 or 85,000.00 before expiry')
    expect(say({ style: 'DOUBLE_BARRIER', barrierType: 'KNOCK_IN' })).toMatch(/^we hold the right to buy BTC against USD; knocked in if/)
  })
})
