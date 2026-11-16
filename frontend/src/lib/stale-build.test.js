// A page of a build this tab is not running: told from a fault of the page, and reloaded only when nothing is lost.
import { describe, it, expect } from 'vitest'
import { RELOAD_GAP_MS, isStaleBuild, shouldReload } from './stale-build'

describe('isStaleBuild', () => {
  it('knows each browser\'s words for a page file that is no longer there', () => {
    expect(isStaleBuild(new TypeError('Failed to fetch dynamically imported module: https://app.rijeka.app/assets/RiskPage-DqcMWrxG.js'))).toBe(true)     // Chrome
    expect(isStaleBuild(new TypeError('error loading dynamically imported module: https://app.rijeka.app/assets/RiskPage-DqcMWrxG.js'))).toBe(true)       // Firefox
    expect(isStaleBuild(new TypeError('Importing a module script failed.'))).toBe(true)                                                                   // Safari
    expect(isStaleBuild(new Error('Unable to preload CSS for /assets/RiskPage-abc.css'))).toBe(true)                                                       // the page's stylesheet
    expect(isStaleBuild(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true)                                                     // the shell answered in the file's place
    expect(isStaleBuild('Failed to fetch dynamically imported module: x')).toBe(true)
  })
  it('does not take a fault of the page for it', () => {
    expect(isStaleBuild(new TypeError("Cannot read properties of undefined (reading 'npv')"))).toBe(false)
    expect(isStaleBuild(new ReferenceError("Cannot access 'hn' before initialization"))).toBe(false)
    expect(isStaleBuild(new TypeError('Failed to fetch'))).toBe(false)                    // a request that failed is not a page file
    expect(isStaleBuild(null)).toBe(false); expect(isStaleBuild(undefined)).toBe(false); expect(isStaleBuild({})).toBe(false)
  })
})

describe('shouldReload', () => {
  const now = 1_800_000_000_000
  it('reloads by itself only when no trade window is open', () => {
    expect(shouldReload({ now, last: null, windows: 0 })).toBe(true)
    expect(shouldReload({ now, last: null, windows: 1 })).toBe(false)                       // a ticket being typed is not thrown away
    expect(shouldReload({ now, last: null, windows: 3 })).toBe(false)
  })
  it('and not twice in a minute: a file that is truly missing asks, it does not loop', () => {
    expect(shouldReload({ now, last: now - 5_000, windows: 0 })).toBe(false)
    expect(shouldReload({ now, last: now - RELOAD_GAP_MS - 1, windows: 0 })).toBe(true)
    expect(shouldReload({ now, last: NaN, windows: 0 })).toBe(true)
  })
  it('never without a clock', () => {
    expect(shouldReload()).toBe(false); expect(shouldReload({ windows: 0 })).toBe(false)
  })
})
