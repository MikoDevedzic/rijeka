import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  session:     null,
  profile:     null,
  loading:     true,
  isNewSignup: false,

  initAuth: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, loading: false })
      if (session) get().fetchProfile(session.user.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        set({ session, loading: false })
        if (event === 'SIGNED_IN' && session) {
          const isNew = await get().fetchProfile(session.user.id)
          if (isNew) set({ isNewSignup: true })
        }
        if (event === 'SIGNED_OUT') {
          set({ profile: null, isNewSignup: false })
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

  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin + '/confirm' }
    })
    return { data, error }
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  },

  signOut: async () => {
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
