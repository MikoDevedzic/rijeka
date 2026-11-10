import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { RISK_FACTORS, ASSET_FACTOR, labelText, riskFactorOf } from './risk-factors'

describe('one colour per risk factor', () => {
  it('names the factor a label is for, on every product', () => {
    // the same factor under the names each ticket gives it
    for (const l of ['IR01', 'IR01 DISC', 'USD IR01', 'EUR IR01', 'IR01 · 1 bp', 'PV01', 'RHO']) expect(riskFactorOf(l), l).toBe('ir')
    expect(riskFactorOf('CRY01')).toBe('cry')
    expect(riskFactorOf('CRY01 · 1 % spot')).toBe('cry')
    expect(riskFactorOf('FX01')).toBe('fx')
    expect(riskFactorOf('CRYBASIS01')).toBe('basis')            // the basis, not the spot its name contains
    expect(riskFactorOf('IR01 USD / CRYBASIS01')).toBe('basis')
    expect(riskFactorOf('VEGA')).toBe('vol')
    expect(riskFactorOf('THETA · 1 day')).toBe('time')
  })
  it('leaves a value that is not a sensitivity unmarked', () => {
    for (const l of ['NET NPV', 'NET NPV USD', 'OPTION NPV', 'PREMIUM USD', 'DELTA', 'GAMMA', '', null, undefined]) expect(riskFactorOf(l), String(l)).toBeNull()
  })
  it('reads a label that is an element with its unit', () => {
    const el = { props: { children: ['IR01', { props: { children: [' · ', '1 bp'] } }] } }
    expect(labelText(el)).toBe('IR01 · 1 bp')
    expect(riskFactorOf(el)).toBe('ir')
    expect(labelText(false)).toBe(''); expect(labelText(7)).toBe('7')
  })
  it('an asset class takes the colour of the factor it mainly carries, and every colour is a token in the stylesheet', () => {
    expect(ASSET_FACTOR).toEqual({ RATES: 'ir', FX: 'fx', CRYPTO: 'cry' })
    const css = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'index.css'), 'utf8')
    const seen = new Set()
    for (const [k, f] of Object.entries(RISK_FACTORS)) {
      const m = css.match(new RegExp(`${f.token}:\\s*(#[0-9a-f]{6});`))
      expect(m, `${k}: ${f.token} is defined in index.css`).not.toBeNull()
      expect(seen.has(m[1]), `${k} has a colour of its own`).toBe(false)
      seen.add(m[1])
      expect(f.adds.length).toBeGreaterThan(10)
    }
    for (const k of Object.values(ASSET_FACTOR)) expect(RISK_FACTORS[k]).toBeTruthy()
  })
})
