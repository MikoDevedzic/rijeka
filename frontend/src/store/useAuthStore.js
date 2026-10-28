import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  session:     null,
  profile:     null,
  loading:     true,
  isNewSignup: false,
  demo:        null,   // result of POST /api/demo/provision (hosted demo), see lib/demo.js

  initAuth: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, loading: false })
      if (session) { get().fetchProfile(session.user.id); get().provision(session) }
    })

    // Never await a supabase call inside this callback: signInWithPassword()
    // resolves only after every subscriber returns, and a query in here waits
    // on the auth lock that sign-in still holds. That deadlock is why the
    // login button sat on AUTHENTICATING for 10s+. Defer the work instead.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        set({ session, loading: false })
        if (event === 'SIGNED_IN' && session) {
          setTimeout(async () => {
            const isNew = await get().fetchProfile(session.user.id)
            if (isNew) set({ isNewSignup: true })
          }, 0)
          get().provision(session)
        }
        if (event === 'SIGNED_OUT') {
          try { sessionStorage.removeItem('rijeka.booted') } catch {}   // next sign-in boots again
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

  signOut: async () => {
    try { sessionStorage.removeItem('rijeka.booted') } catch {}
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
