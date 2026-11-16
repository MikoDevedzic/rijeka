// A page of a build this tab is not running: told from a fault of the page, and reloaded only when nothing is lost.
import { describe, it, expect } from 'vitest'
import { RELOAD_GAP_MS, buildMoved, isStaleBuild, loadWords, shouldReload, typedFields } from './stale-build'

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
  it('nor while a message is being typed in the messenger', () => {
    expect(shouldReload({ now, last: null, windows: 0, typed: 1 })).toBe(false)
    expect(shouldReload({ now, last: null, windows: 0, typed: 0 })).toBe(true)
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

describe('buildMoved', () => {
  const host = (body, ok = true) => async () => ({ ok, json: async () => body })
  it('is a release only when the host serves another build than this tab runs', async () => {
    expect(await buildMoved({ release: 'aaa', fetcher: host({ commit: 'bbb' }), online: true })).toBe(true)
    expect(await buildMoved({ release: 'aaa', fetcher: host({ commit: 'aaa' }), online: true })).toBe(false)     // the same build: the file is missing for another reason
  })
  it('does not know when the host cannot be asked, and that is not a release', async () => {
    expect(await buildMoved({ release: 'aaa', fetcher: host({ commit: 'bbb' }), online: false })).toBe(null)     // offline: not asked
    expect(await buildMoved({ release: 'aaa', fetcher: async () => { throw new TypeError('Failed to fetch') }, online: true })).toBe(null)
    expect(await buildMoved({ release: 'aaa', fetcher: host({ commit: 'bbb' }, false), online: true })).toBe(null)
    expect(await buildMoved({ release: 'aaa', fetcher: host({}), online: true })).toBe(null)
    expect(await buildMoved({ release: 'aaa', fetcher: async () => ({ ok: true, json: async () => { throw new SyntaxError('<') } }), online: true })).toBe(null)   // the shell answered
    expect(await buildMoved({ release: 'aaa', fetcher: null, online: true })).toBe(null)
  })
  it('asks for the file fresh, never from a cache', async () => {
    let asked = null
    await buildMoved({ release: 'aaa', online: true, fetcher: async (url, opts) => { asked = { url, opts }; return { ok: true, json: async () => ({ commit: 'aaa' }) } } })
    expect(asked.url).toMatch(/^\/version\.json\?t=\d+$/); expect(asked.opts.cache).toBe('no-store')
  })
})

describe('typedFields', () => {
  const root = (fields) => ({ querySelectorAll: () => fields })
  it('counts what is typed in the messenger, not its switches or empty fields', () => {
    expect(typedFields(root([{ type: 'textarea', value: 'pay 5y at' }, { type: 'text', value: '   ' }, { type: 'checkbox', value: 'on' }, { type: 'search', value: 'acme' }]))).toBe(2)
    expect(typedFields(root([]))).toBe(0)
    expect(typedFields(null)).toBe(0)
  })
})

describe('loadWords', () => {
  it('a release is called a release, and says what a reload throws away before it says anything else', () => {
    const page = loadWords('page', 'moved', true)
    expect(page.title).toBe('Rijeka was updated while this window was open')
    expect(page.text).toMatch(/^Before you reload: a trade window that is open closes with the reload, and a message being typed is lost/)
    expect(loadWords('page', 'moved', false).text).toMatch(/^This page belongs to the new version, and reloading a moment ago did not bring it/)
    expect(loadWords('tab', 'moved', true).text).toMatch(/the rest of the window works as it did/)
    expect(loadWords('window', 'moved', true).text).toMatch(/what was typed in the window was not kept/)     // it does not ask to save what is already gone
  })
  it('a file that did not arrive for another reason is not called an update', () => {
    for (const scope of ['page', 'tab', 'window', 'widget']) {
      const w = loadWords(scope, 'unreachable', true)
      expect(w.title).toMatch(/could not be loaded$/); expect(w.text).not.toMatch(/new version|updated/)
      expect(w.text).toMatch(/Nothing was booked or changed by this\./)
    }
    expect(loadWords('page', 'unreachable', false).text).toMatch(/Reload to try again\.$/)
    expect(loadWords('page', 'unreachable', true).text).toMatch(/Reload to try again; a trade window that is open closes with the reload/)
  })
})
