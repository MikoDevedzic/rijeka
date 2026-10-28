import { createClient, processLock } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars. Check your .env file.')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: {
      getItem:    (key) => sessionStorage.getItem(key),
      setItem:    (key, value) => sessionStorage.setItem(key, value),
      removeItem: (key) => sessionStorage.removeItem(key),
    },
    // The session lives in sessionStorage, which is per tab, so there is nothing
    // to guard across tabs. The default navigator.locks lock is shared by every
    // Rijeka tab and window, and one that stalls while holding it hangs every
    // query (supabase.from() takes it too, via getSession) in all the others.
    lock:               processLock,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
  }
})
