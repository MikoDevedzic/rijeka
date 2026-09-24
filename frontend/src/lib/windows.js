// Multi-window support. Traders spread Rijeka across screens: the blotter
// on one, the messenger on another. A page can't be dragged to another
// monitor, but a window can, so every module can open in its own window and
// the messenger can pop out of the page.
//
// Same-origin windows talk over one BroadcastChannel. Windows in one browser
// can be signed in as DIFFERENT users (e.g. a demo with two accounts), so
// every message carries the sender's user id and is ignored by any window
// signed in as someone else. Private data must never cross that line.

import { useAuthStore } from '../store/useAuthStore'

const CHANNEL = 'rijeka-windows'
const currentUser = () => useAuthStore.getState().session?.user?.id || null
let bc = null

export function channel() {
  if (bc === null) {
    try { bc = new BroadcastChannel(CHANNEL) } catch { bc = undefined }  // unsupported: single-window
  }
  return bc
}

export function broadcast(msg) {
  const uid = currentUser()
  if (!uid) return
  try { channel()?.postMessage({ ...msg, uid }) } catch { /* another window may be closing */ }
}

export function onBroadcast(handler) {
  const c = channel()
  if (!c) return () => {}
  const fn = (e) => {
    const msg = e.data || {}
    const uid = currentUser()
    if (!uid || msg.uid !== uid) return   // another user's window
    handler(msg)
  }
  c.addEventListener('message', fn)
  return () => c.removeEventListener('message', fn)
}

// Open (or bring forward) a named app window. Reusing the name means a second
// click focuses the same window instead of stacking copies.
export function openAppWindow(path, name, { w, h } = {}) {
  const sw = window.screen?.availWidth || 1600, sh = window.screen?.availHeight || 1000
  const width = Math.round(w || sw * 0.8), height = Math.round(h || sh * 0.85)
  const left = Math.round((window.screenX || 0) + 40), top = Math.round((window.screenY || 0) + 40)
  const win = window.open(path, name, `popup,width=${width},height=${height},left=${left},top=${top}`)
  win?.focus()
  return win
}

// The messenger window, if one is open. window.open('', name) returns the
// existing window without reloading it.
export const MESSENGER_WINDOW = 'rijeka-messenger'
export const MESSENGER_PATH = '/messenger'

export function focusMessengerWindow() {
  const win = window.open('', MESSENGER_WINDOW)
  if (!win) return false
  if (win.location.href === 'about:blank') { win.close(); return false }   // it wasn't open
  win.focus()
  return true
}

export function popOutMessenger() {
  return openAppWindow(MESSENGER_PATH, MESSENGER_WINDOW, { w: 560, h: Math.min(820, (window.screen?.availHeight || 900) - 80) })
}
