// lib/demo.js
// ─────────────────────────────────────────────────────────────────────
// Hosted-demo workspace: once per browser session, ask the backend to make
// sure this account has an own entity, the demo counterparty, market data
// and the trader role (POST /api/demo/provision is idempotent). When the
// role claim changed, the JWT is refreshed so booking/confirm routes see it.
// Returns the provisioning result; the auth store keeps it as `demo`.
//
// Called OUTSIDE supabase's onAuthStateChange callback (deferred), because
// refreshSession() takes the same navigator.locks lock as getSession() and
// would hang if re-entered from the callback.
// ─────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const KEY = 'rijeka.demo.provisioned'
let inflight = null   // initAuth and SIGNED_IN both fire on a fresh sign-in; one request serves both

export function provisionDemo(session) {
  const uid = session?.user?.id
  if (!uid || !session?.access_token) return Promise.resolve(null)
  // Already done in this browser session: restore the result for the banner
  // and still make sure the JWT carries the role the server granted.
  let cached = null
  try { cached = JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { /* ignore: sessionStorage unavailable or corrupt */ }
  if (cached?.uid === uid && cached.out) {
    _syncRole(session, cached.out)
    return Promise.resolve(cached.out)
  }
  if (!inflight) inflight = _provision(session).finally(() => { inflight = null })
  return inflight
}

// Refresh the JWT when the server changed the role claim, or when this token
// predates a change (e.g. provisioned from another tab or session). Fire and
// forget, with a timeout: refreshSession() queues behind supabase's auth
// lock and can hang (see lib/session.js); the result must never wait on it.
// If it does not go through, the next scheduled token refresh picks up the
// claim; new sign-ups already carry role=trader from signUp().
function _syncRole(session, out) {
  const jwtRole = session.user?.user_metadata?.role
  if (!(out?.role_changed || (out?.role && out.role !== jwtRole))) return
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('refreshSession timeout')), 5000))
  Promise.race([supabase.auth.refreshSession(), timeout])
    .catch(e => console.warn('[demo] token refresh deferred:', e?.message))
}

async function _provision(session) {
  const uid = session.user.id
  let out = null
  try {
    const r = await fetch(`${API}/api/demo/provision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    })
    if (!r.ok) throw new Error(`provision ${r.status}`)
    out = await r.json()
  } catch (e) {
    console.warn('[demo] provisioning skipped:', e?.message)
    return null
  }
  try { sessionStorage.setItem(KEY, JSON.stringify({ uid, out: { ...out, role_changed: false } })) } catch { /* ignore: sessionStorage unavailable */ }
  _syncRole(session, out)
  return out
}
