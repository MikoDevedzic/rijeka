// lib/errors.js
// ────────────────────────────────────────────────────────────────────────────────────
// Uncaught browser errors reach the operator. window errors, unhandled promise
// rejections and React boundary catches are posted to the API's in-memory log
// (POST /api/ops/client-error), which the health page summarises. Duplicates
// within ten seconds are sent once; nothing here can throw into the app; no
// token or storage is read, so a report can never carry a session.
// ────────────────────────────────────────────────────────────────────────────────────
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const RELEASE = import.meta.env?.VITE_COMMIT || 'dev'
const DEDUPE_MS = 10_000
const MAX_FIELD = 4000

let installed = false
const recent = new Map()          // fingerprint -> last sent (ms)

function payload(error, source, extra = {}) {
  const message = String(error?.message || error || 'unknown error').slice(0, 500)
  const stack = String(error?.stack || extra.stack || '').slice(0, MAX_FIELD)
  return {
    message, stack, source,
    url: String(window.location.href).slice(0, 300),
    route: window.location.pathname,
    user_agent: String(navigator.userAgent || '').slice(0, 200),
    release: RELEASE,
    at: new Date().toISOString(),
  }
}

function send(body) {
  try {
    const key = `${body.message}|${body.stack.slice(0, 200)}`
    const now = Date.now()
    if (recent.get(key) && now - recent.get(key) < DEDUPE_MS) return
    recent.set(key, now)
    if (recent.size > 50) for (const k of [...recent.keys()].slice(0, 25)) recent.delete(k)
    const json = JSON.stringify(body)
    const url = `${API}/api/ops/client-error`
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {})
  } catch { /* reporting must never add an error of its own */ }
}

/** Report one error from anywhere in the app (the error boundary uses it). */
export function report(error, source = 'window', extra = {}) {
  try { send(payload(error, source, extra)) } catch { /* never throw */ }
}

/** Install the window and promise handlers once. Safe to call more than once. */
export function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    const err = e?.error || e?.message
    report(err, 'window', { stack: e?.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '' })
  })
  window.addEventListener('unhandledrejection', (e) => report(e?.reason, 'promise'))
}
