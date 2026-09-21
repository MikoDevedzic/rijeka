// lib/session.js
// ─────────────────────────────────────────────────────────────────────
// getSessionSafe — supabase.auth.getSession() with a timeout.
//
// supabase-js v2 serialises getSession() behind a navigator.locks lock.
// If that lock is held (token refresh in flight, another tab mid-refresh,
// a callback that re-entered auth) the promise never settles: no error,
// no timeout, the caller hangs. The XVA tab sat on "SIMULATING..." for
// exactly this reason.
//
// The auth store already tracks the live session via onAuthStateChange,
// so on timeout we use that instead of waiting on the lock.
// ─────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import { useAuthStore } from '../store/useAuthStore'

const TIMEOUT_MS = 4000

export async function getSessionSafe() {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('getSession timeout')), TIMEOUT_MS)
  })
  try {
    const { data: { session } } = await Promise.race([supabase.auth.getSession(), timeout])
    if (session) return session
  } catch (e) {
    console.warn('[session] supabase.auth.getSession() did not settle — using auth store session', e?.message)
  } finally {
    clearTimeout(timer)
  }
  const stored = useAuthStore.getState().session
  if (stored?.access_token) return stored
  throw new Error('Not signed in — no session available. Reload and sign in again.')
}
