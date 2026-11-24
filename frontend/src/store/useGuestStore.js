// store/useGuestStore.js — the one question a guest is asked: "create an account to do this?"
// `ask(what)` opens it from wherever the guest reached for something that needs an account (components/guest/GuestAsk).
import { create } from 'zustand'
import { isGuest } from '../lib/guest'

export const useGuestStore = create(set => ({
  asked: null,                                  // 'book' | 'excel' | 'other' | null
  ask: (what = 'other') => set({ asked: what }),
  close: () => set({ asked: null }),
}))

// For a handler: true (and the question is up) when the caller is a guest, so the handler stops there.
export function guestStopsHere(what) {
  if (!isGuest()) return false
  useGuestStore.getState().ask(what)
  return true
}
