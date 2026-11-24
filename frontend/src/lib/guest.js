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

export function guestSession() { const p = read(); return p ? shaped(p) : null }

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

export async function enterAsGuest() { await take(); return guestSession() }

export function leaveGuest() {
  pass = null
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

// Where a guest may be. Everything else in the app belongs to an account.
export const GUEST_HOME = '/guest'
export function guestMayOpen(pathname) {
  return pathname === GUEST_HOME || pathname === '/roadmap' || pathname === '/methodology' || pathname.startsWith('/methodology/')
}
