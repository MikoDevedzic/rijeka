// lib/version.js — a tab that stays open keeps running the build it loaded, against an API that has
// moved on. The page cannot reload itself without losing the user's windows, so it asks: every ten
// minutes and whenever the tab comes back into view, fetch /version.json (written at build time,
// never cached) and compare it with the commit baked into this bundle.
const RELEASE = import.meta.env?.VITE_COMMIT || 'dev'
const PERIOD_MS = 10 * 60 * 1000

export function currentRelease() { return RELEASE }

/** Calls onNewer(liveCommit) once when the deployed build differs from this one. Returns a stop function. */
export function watchVersion(onNewer) {
  if (RELEASE === 'dev') return () => {}
  let stopped = false, told = false
  const check = async () => {
    if (stopped || told || document.visibilityState === 'hidden') return
    try {
      const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      if (!r.ok) return
      const { commit } = await r.json()
      if (commit && commit !== 'dev' && commit !== RELEASE) { told = true; onNewer(commit) }
    } catch { /* offline or a transient edge error: try again next period */ }
  }
  const timer = setInterval(check, PERIOD_MS)
  const onVisible = () => { if (document.visibilityState === 'visible') check() }
  document.addEventListener('visibilitychange', onVisible)
  setTimeout(check, 30 * 1000)
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
}
