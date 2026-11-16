// lib/stale-build.js — a page that belongs to a build this tab is not running.
//
// Each page is a file of its own, named by the build that made it, and fetched when the page is first opened. A
// release replaces every such file. A tab opened before the release still asks for the old name, the host answers
// with the app's shell instead of a script, and the browser says it could not load the module. That is not a fault
// of the page: the desk was updated while the window was open, and a reload gets the new build. (The bar that says
// a newer version is live looks every ten minutes: a page opened sooner after a release than that met a raw error.)
//
//
// The browser says the same words when the connection drops, or when a file is truly missing from the server. So
// the words alone are not taken for a release: the host is asked which build it serves (/version.json, as the bar
// that announces a new version does), and only another build than this tab's is a release.
//
//   isStaleBuild(error)                    the browser's words for "that file of code is not there" (Chrome, Safari, Firefox)
//   buildMoved({ release, fetcher })       true: the host serves another build (a release). false: it serves this one,
//                                          so the file is missing for another reason. null: it could not be asked.
//   typedFields(root)                      how many of the messenger's fields have something typed in them
//   loadWords(scope, build, holds)         the title and the words of the card, by what the host said and where the file was missing
//   shouldReload({ now, last, windows, typed })
//                                          reload without asking: only when no trade window is open and no message is
//                                          being typed (nothing is lost), and this tab has not just reloaded for the
//                                          same reason (a file that is truly missing must not reload for ever)
const WORDS = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|is not a valid javascript mime type/i
const RELEASE = import.meta.env?.VITE_COMMIT || 'dev'
export const RELOAD_GAP_MS = 60 * 1000
export const ASK_MS = 4000
export const RELOADED_KEY = 'rijeka.reloaded-for-build'

export function isStaleBuild(error) {
  const text = `${error?.name || ''} ${error?.message || (typeof error === 'string' ? error : '')}`
  return WORDS.test(text)
}

export async function buildMoved({ release = RELEASE, fetcher = globalThis.fetch, online = globalThis.navigator?.onLine !== false, wait = ASK_MS } = {}) {
  if (!online || typeof fetcher !== 'function') return null
  const stop = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => stop?.abort(), wait)
  try {
    const r = await fetcher('/version.json?t=' + Date.now(), { cache: 'no-store', signal: stop?.signal })
    if (!r?.ok) return null
    const { commit } = await r.json()
    return typeof commit === 'string' && commit ? commit !== release : null
  } catch { return null } finally { clearTimeout(timer) }
}

// the messenger outlives a move between pages (a page's own form is left behind by the move itself), so what is
// typed in it is what a reload at that moment would throw away
const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'hidden'])
export function typedFields(root = globalThis.document) {
  try {
    return [...root.querySelectorAll('.ms-window textarea, .ms-window input')]
      .filter(el => !NOT_TYPED.has(el.type) && String(el.value || '').trim()).length
  } catch { return 0 }
}

export function shouldReload({ now, last, windows, typed = 0 } = {}) {
  if (!Number.isFinite(now) || Number(windows) > 0 || Number(typed) > 0) return false
  return !(Number.isFinite(last) && now - last < RELOAD_GAP_MS)
}

const SAFE = 'Nothing was booked or changed by this.'
const KEEP = 'a trade window that is open closes with the reload, and a message being typed is lost, so book, send or note them first'
const THING = { window: 'window', page: 'page', widget: 'messenger', tab: 'tab' }

// What a file that did not arrive is called, by what the host said and by where it was missing.
export function loadWords(scope, build, holds) {
  const thing = THING[scope] || 'page'
  if (build === 'moved') {
    const title = 'Rijeka was updated while this window was open'
    if (scope === 'window') return { title, text: `A part of this trade window belongs to the new version and could not be opened, and what was typed in the window was not kept. Reload to get the new version. ${SAFE}` }
    if (scope === 'tab') return { title, text: `Before you reload: this trade window closes with the reload, so book or note what is in it first. This tab belongs to the new version; the rest of the window works as it did. ${SAFE}` }
    if (holds) return { title, text: `Before you reload: ${KEEP}. This ${thing} belongs to the new version. ${SAFE}` }
    return { title, text: `This ${thing} belongs to the new version, and reloading a moment ago did not bring it. Reload to try again. ${SAFE}` }
  }
  const title = scope === 'widget' ? 'The messenger could not be loaded' : `This ${thing} could not be loaded`
  const why = 'Its file did not arrive: the connection may have dropped, or the file is not on the server.'
  if (scope === 'window') return { title, text: `${why} What was typed in the window was not kept. ${SAFE} Reload to try again.` }
  if (scope === 'tab') return { title, text: `${why} The rest of the window works as it did. ${SAFE} Reload to try again; this trade window closes with the reload, so book or note what is in it first.` }
  return { title, text: `${why} ${SAFE} Reload to try again${holds ? `; ${KEEP}` : ''}.` }
}
