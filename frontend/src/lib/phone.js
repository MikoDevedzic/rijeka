// A phone: a screen too narrow for the desk as it is laid out for a monitor. The phone view (0.32.0) is the home,
// the trades, the trade window, chat and news; everything else stays on a larger screen. One query, used by the
// stylesheet (layout/Phone.css, the same 640px) and by the few components whose structure differs.
import { useEffect, useState } from 'react'

export const PHONE_QUERY = '(max-width: 640px)'
const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null)

export const isPhone = () => !!query()?.matches

export function usePhone() {
  const [phone, setPhone] = useState(isPhone)
  useEffect(() => {
    const q = query()
    if (!q) return undefined
    const on = () => setPhone(q.matches)
    on()
    q.addEventListener?.('change', on)
    return () => q.removeEventListener?.('change', on)
  }, [])
  return phone
}

// Running from its icon on a home screen, with no browser bar (the manifest's "standalone"; Safari's own flag).
export const standalone = () => typeof window !== 'undefined'
  && ((typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || window.navigator?.standalone === true)
