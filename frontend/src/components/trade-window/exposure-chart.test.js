// trade-window/exposure-chart.test.js
// The labels under the exposure chart. Until 0.28.0 every run stepped monthly and the label was the point's index
// read as months; a currency or digital-asset ticket now steps weekly to a year, so the label is the point's own
// time. Run: npm test.
import { describe, it, expect } from 'vitest'
import { axisLabel } from './exposure-chart'

// the five labels the chart draws: at 0, 1/4, 1/2, 3/4 and the end of the grid
const five = (n, dt) => [0, 0.25, 0.5, 0.75, 1].map(f => axisLabel(Math.round(f * (n - 1)), n, dt))

describe('the exposure chart labels a point with its own time', () => {
  it('a swap on monthly steps reads as it always did, with or without a step length', () => {
    expect(five(12, 1 / 12)).toEqual(['1M', '4M', '7M', '9M', '12M'])
    expect(five(12, undefined)).toEqual(['1M', '4M', '7M', '9M', '12M'])
    expect(five(24, undefined)).toEqual(['1M', '7M', '13M', '18M', '24M'])
    expect(five(60, undefined)).toEqual(['0.1Y', '1.3Y', '2.6Y', '3.8Y', '5Y'])
    expect(five(120, 1 / 12).at(-1)).toBe('10Y')
  })
  it('a one-year ticket on 52 weekly steps ends at fifty-two weeks, not at 4.3 years', () => {
    expect(five(52, 1 / 52)).toEqual(['1W', '14W', '27W', '39W', '52W'])
    expect(five(53, 372 / 365 / 53).at(-1)).toBe('53W')
  })
  it('six months on 27 weekly steps ends at twenty-six weeks; three and one month are read in days', () => {
    expect(five(27, 183 / 365 / 27)).toEqual(['1W', '8W', '14W', '20W', '26W'])
    expect(five(13, 91 / 365 / 13)).toEqual(['7D', '28D', '49D', '70D', '91D'])
    expect(five(5, 1 / 12 / 5)).toEqual(['6D', '12D', '18D', '24D', '30D'])
  })
  it('beyond two years the labels are years', () => {
    expect(five(36, 1 / 12).at(-1)).toBe('3Y')
    expect(five(30, 1 / 12)).toEqual(['0.1Y', '0.7Y', '1.3Y', '1.9Y', '2.5Y'])
  })
})
