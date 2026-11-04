import { describe, it, expect } from 'vitest'
import { normaliseCalibration } from './calibration'

const basket = [{ expiry_y: 1, tenor_y: 5, mkt_vol_bp: 80, mdl_vol_bp: 80.4, error_bp: 0.4 }]

describe('normaliseCalibration', () => {
  it('passes a calibrate response through unchanged', () => {
    const d = { a: 0.03, fit_details: basket, converged: true, iterations: 5 }
    expect(normaliseCalibration(d)).toBe(d)
  })
  it('unwraps the stored object shape and lifts its fields', () => {
    const d = { a: 0.03, fit_rmse_bp: 0.6, fit_details: { basket, converged: true, iterations: 7, snap_date: '2026-11-03' } }
    const n = normaliseCalibration(d)
    expect(n.fit_details).toEqual(basket)
    expect(n.converged).toBe(true)
    expect(n.iterations).toBe(7)
    expect(n.snap_date).toBe('2026-11-03')
    expect(n.fit_rmse_bp).toBe(0.6)
    expect(() => n.fit_details.map(r => r.expiry_y)).not.toThrow()
  })
  it('keeps top-level fields over nested ones and gives an empty list for garbage', () => {
    expect(normaliseCalibration({ converged: false, fit_details: { basket: 'x', converged: true } }).converged).toBe(false)
    expect(normaliseCalibration({ fit_details: { basket: 'x' } }).fit_details).toEqual([])
    expect(normaliseCalibration({ fit_details: null }).fit_details).toEqual([])
    expect(normaliseCalibration(null)).toBeNull()
  })
})
