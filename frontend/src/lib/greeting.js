// lib/greeting.js — the messenger opens by itself once after a sign-in.
//
// Prometheus and the rooms live behind one small button at the corner of the screen, which a newcomer does not find.
// After a sign-in the messenger is therefore opened once, where the user last left it (it moves by its title bar and
// remembers). Closing it keeps it closed: a reload, or a move to another page, does not open it again; the next
// sign-in does. Not on a phone, where an open messenger is the whole screen, and not while it stands in a window
// of its own.
//
//   greetKey(session)        which sign-in this is: the user and the moment they signed in
//   shouldGreet({ ... })     whether to open it now
export const GREETED_KEY = 'rijeka.messenger.greeted'
export const GREET_MIN_WIDTH = 900

export function greetKey(session) {
  const u = session?.user
  return u?.id ? `${u.id}|${u.last_sign_in_at || ''}` : null
}

export function shouldGreet({ key, seen, width, hidden = false, poppedOut = false, open = false } = {}) {
  if (!key || key === seen) return false
  if (hidden || poppedOut || open) return false
  return Number.isFinite(width) && width >= GREET_MIN_WIDTH
}
