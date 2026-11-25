// lib/guest.js — a guest: a visitor with no account, who prices a trade and reads, and nothing else.
//
// A guest holds no sign-in. The API gives the browser a pass of its own (POST /api/public/guest: half an hour,
// written nowhere on the server) and answers a guest only on the routes it allows (backend/middleware/guest.py).
// The pass is kept for the tab (sessionStorage) and is given to the app in the shape of a session, so that every
// call that reads "the session's token" sends it (lib/supabase.js). It is not a Supabase token: the database's
// own interface is never asked anything in a guest's name, and would refuse it.
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const KEY = 'rijeka.guest'
const RENEW_UNDER = 120                         // seconds left at which the next call takes a new pass first

let pass = null                                 // { token, expires_at }
let taking = null

function read() {
  if (pass) return pass
  try { pass = JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { pass = null }
  if (pass && !(pass.token && pass.expires_at)) pass = null
  return pass
}

export function isGuest() { return !!read() }

// Whether this instance takes guests: asked by the door before it offers the way in.
export async function guestsTaken() {
  try {
    const r = await fetch(API + '/api/public/guest')
    return r.ok && (await r.json()).enabled === true
  } catch { return false }
}

async function take() {
  const r = await fetch(API + '/api/public/guest', { method: 'POST' })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const e = new Error(body?.detail || 'The guest desk is not available just now.')
    e.status = r.status
    throw e
  }
  const b = await r.json()
  pass = { token: b.token, expires_at: b.expires_at }
  try { sessionStorage.setItem(KEY, JSON.stringify(pass)) } catch { /* ignore: the pass then lasts as long as the page */ }
  return pass
}

export const GUEST_USER = { id: 'guest', email: null, is_guest: true, user_metadata: { role: 'viewer' }, app_metadata: {} }
export const GUEST_PROFILE = { id: 'guest', trader_id: 'GUEST', role: 'viewer', email: null, is_guest: true }

function shaped(p) {
  return { access_token: p.token, token_type: 'bearer', expires_at: p.expires_at, user: GUEST_USER, is_guest: true }
}

export function guestSession() { const p = read(); if (p) watchForAnEndedPass(); return p ? shaped(p) : null }

// The guest's session with a pass that has time on it. One renewal at a time; if it fails the old pass is used
// until it ends, and the API then says so.
export async function freshGuestSession() {
  const p = read()
  if (!p) return null
  if (p.expires_at - Date.now() / 1000 < RENEW_UNDER) {
    taking = taking || take().finally(() => { taking = null })
    try { await taking } catch { /* the old pass, for as long as it lasts */ }
  }
  return guestSession()
}

// A pass is signed by the API process that gave it, with a secret that process made when it started. When the API
// restarts (a release), every pass ends before its time and the next call is answered 401. A guest should not meet
// that: the call that was refused takes one new pass and is sent once more. This watches the page's own requests
// only while the tab is a guest's, and only an API call that carried the guest's pass and came back 401 is touched.
let watching = false
function authOf(input, init) {
  const h = init?.headers ?? (typeof input === 'object' ? input?.headers : null)
  if (!h) return ''
  if (typeof h.get === 'function') return h.get('Authorization') || ''
  return h.Authorization || h.authorization || ''
}
function withAuth(init, value) {
  const headers = new Headers(init?.headers || {})
  headers.set('Authorization', value)
  return { ...(init || {}), headers }
}
export function watchForAnEndedPass(target = globalThis) {
  if (watching || typeof target.fetch !== 'function') return
  watching = true
  const send = target.fetch.bind(target)
  target.fetch = async (input, init) => {
    const res = await send(input, init)
    const mine = pass && res.status === 401 && typeof input === 'string' && input.startsWith(API)
      && authOf(input, init) === 'Bearer ' + pass.token && (init?.body == null || typeof init.body === 'string')
    if (!mine) return res
    try {
      taking = taking || take().finally(() => { taking = null })
      await taking
    } catch { return res }                               // no new pass to be had: the refusal stands, and is shown
    return send(input, withAuth(init, 'Bearer ' + pass.token))
  }
}

export async function enterAsGuest() { await take(); watchForAnEndedPass(); return guestSession() }

export function leaveGuest() {
  pass = null
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

// Where a guest may be. Everything else in the app belongs to an account.
export const GUEST_HOME = '/guest'
export function guestMayOpen(pathname) {
  return pathname === GUEST_HOME || pathname === '/roadmap' || pathname === '/methodology' || pathname.startsWith('/methodology/')
}
