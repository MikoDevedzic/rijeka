import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { isGuest, guestSession, enterAsGuest, leaveGuest, GUEST_PROFILE } from '../lib/guest'

export const useAuthStore = create((set, get) => ({
  session:     null,
  profile:     null,
  loading:     true,
  isNewSignup: false,
  demo:        null,   // result of POST /api/demo/provision (hosted demo), see lib/demo.js

  initAuth: () => {
    if (isGuest()) {
      // a guest's tab (lib/guest.js): no profile to read, no workspace to set up; a sign-in below takes over from it
      set({ session: guestSession(), profile: GUEST_PROFILE, loading: false })
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        set({ session, loading: false })
        if (session) { get().fetchProfile(session.user.id); get().provision(session) }
      })
    }

    // Never await a supabase call inside this callback: signInWithPassword()
    // resolves only after every subscriber returns, and a query in here waits
    // on the auth lock that sign-in still holds. That deadlock is why the
    // login button sat on AUTHENTICATING for 10s+. Defer the work instead.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const wasGuest = isGuest()
        if (!session && wasGuest) return                  // the client has no sign-in of its own while the tab is a guest's
        if (session && wasGuest) leaveGuest()             // an account is signed in: the tab is the account's from here
        set({ session, loading: false })
        // SIGNED_IN, or an account's session found in a tab that was a guest's (the event is then INITIAL_SESSION, and
        // the start above read no profile and set up no workspace because the tab was a guest's): the account's own
        if ((event === 'SIGNED_IN' || wasGuest) && session) {
          if (wasGuest) set({ profile: null })
          setTimeout(async () => {
            const isNew = await get().fetchProfile(session.user.id)
            if (isNew) set({ isNewSignup: true })
          }, 0)
          get().provision(session)
        }
        if (event === 'SIGNED_OUT') {
          try { sessionStorage.removeItem('rijeka.booted') } catch { /* ignore: sessionStorage unavailable */ }   // next sign-in boots again
          set({ profile: null, isNewSignup: false, demo: null })
        }
      }
    )
    return () => subscription.unsubscribe()
  },

  fetchProfile: async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) { console.error('Profile fetch error:', error); return false }
    const isNew = !get().profile
    set({ profile: data })
    return isNew
  },

  // Deferred out of the auth callback: see lib/demo.js for why.
  provision: (session) => {
    setTimeout(async () => {
      try {
        const m   = await import('../lib/demo')
        const out = await m.provisionDemo(session)
        if (out) set({ demo: out })
        // the firm (and the set of modules a new workspace starts on) exists only now: read the switches again
        const { useModulesStore } = await import('./useModulesStore')
        useModulesStore.getState().load()
      } catch (e) { console.warn('[demo] provisioning failed', e?.message) }
    }, 0)
  },

  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      // Every sign-up on the hosted demo is a trader in its own sandbox
      // workspace; the backend only ever upgrades viewer → trader.
      options: { emailRedirectTo: window.location.origin + '/confirm', data: { role: 'trader' } }
    })
    return { data, error }
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  },

  // The way in with no account: a pass from the API, and the app shown as a guest sees it (components/guest).
  enterAsGuest: async () => {
    if (get().session && !get().session.is_guest) throw new Error('You are signed in: sign out first to look around as a guest.')
    const session = await enterAsGuest()
    set({ session, profile: GUEST_PROFILE, loading: false, demo: null, isNewSignup: false })
    return session
  },

  signOut: async () => {
    try { sessionStorage.removeItem('rijeka.booted') } catch { /* ignore: sessionStorage unavailable */ }
    if (isGuest()) {
      leaveGuest()
      set({ session: null, profile: null, isNewSignup: false })
      window.location.href = '/'
      return
    }
    await supabase.auth.signOut()
    set({ session: null, profile: null, isNewSignup: false })
    window.location.href = '/'
  },

  clearNewSignup: () => set({ isNewSignup: false }),
}))

export function previewTraderId(email) {
  if (!email || !email.includes('@')) return ''
  const local = email.split('@')[0]
  return local
    .toUpperCase()
    .replace(/[^A-Z.]/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/, '')
}
