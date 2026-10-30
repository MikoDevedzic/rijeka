// lib/usage.js — the usage beacon. No cookies, nothing stored in the browser, no third party:
// a page view or a funnel click is posted to the API, which counts it under a daily-rotating
// hash of address and user agent. Never throws, never blocks.
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const RELEASE = import.meta.env?.VITE_COMMIT || 'dev'
let last = ''

export function hit(event, route) {
  try {
    const r = route || window.location.pathname
    const key = `${event}|${r}`
    if (event === 'view' && key === last) return            // the same route twice in a row is one view
    last = key
    const body = JSON.stringify({ event, route: r, release: RELEASE })
    const url = `${API}/api/public/hit`
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch { /* ignore: the beacon must never affect the page */ }
}
