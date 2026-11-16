// lib/stale-build.js — a page that belongs to a build this tab is not running.
//
// Each page is a file of its own, named by the build that made it, and fetched when the page is first opened. A
// release replaces every such file. A tab opened before the release still asks for the old name, the host answers
// with the app's shell instead of a script, and the browser says it could not load the module. That is not a fault
// of the page: the desk was updated while the window was open, and a reload gets the new build. (The bar that says
// a newer version is live looks every ten minutes: a page opened sooner after a release than that met a raw error.)
//
//   isStaleBuild(error)                    the browser's words for "that file of code is not there" (Chrome, Safari, Firefox)
//   shouldReload({ now, last, windows })   reload without asking: only when no trade window is open (nothing typed is
//                                          lost) and this tab has not just reloaded for the same reason (a file that
//                                          is truly missing must not reload for ever)
const WORDS = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|is not a valid javascript mime type/i
export const RELOAD_GAP_MS = 60 * 1000
export const RELOADED_KEY = 'rijeka.reloaded-for-build'

export function isStaleBuild(error) {
  const text = `${error?.name || ''} ${error?.message || (typeof error === 'string' ? error : '')}`
  return WORDS.test(text)
}

export function shouldReload({ now, last, windows } = {}) {
  if (!Number.isFinite(now) || Number(windows) > 0) return false
  return !(Number.isFinite(last) && now - last < RELOAD_GAP_MS)
}
