// lib/activity.js — what only the browser knows a person did, said to the API (POST /api/me/activity).
//
// The API counts, per account and day, which kinds of thing an account does (backend/activity/). Most of it the API
// sees for itself. Two things it cannot tell from a request: that a person opened a page (the app also reads the
// same data by itself, on a timer and on the home page), and that a person pressed PRICE (a ticket also prices as
// it is typed). So the app says those two, and only those:
//
//   viewed(route, account)   a page was opened. The API keeps the page's family (blotter, market risk ...), never
//                            the address. The same page twice in a row is one opening.
//   priced(assetClass)       PRICE was pressed in a trade window: rates, fx or crypto.
//
//   signedIn(token)          the session's token, told by the app's shell (App.jsx) whenever it changes; '' signs out
//
// Signed in only: without a session nothing is sent. Never throws, never waits, never shows an error: the record
// is the operator's, and the desk must not notice it.
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
let last = ''
let bearer = ''

export function signedIn(token) { bearer = token || '' }

export function say(event, fields = {}, { token, send = globalThis.fetch } = {}) {
  try {
    const auth = token ?? bearer
    if (!auth || typeof send !== 'function') return false
    Promise.resolve(send(`${API}/api/me/activity`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: JSON.stringify({ event, ...fields }),
    })).catch(() => {})
    return true
  } catch { return false }
}

export function viewed(route, account, opts) {
  const key = `${account || ''}|${route || ''}`
  if (!account || !route || key === last) return false
  last = key
  return say('view', { route }, opts)
}

export function priced(assetClass, opts) {
  return say('priced', { detail: String(assetClass || '').toLowerCase() }, opts)
}

export function _forgetForTests() { last = ''; bearer = '' }
