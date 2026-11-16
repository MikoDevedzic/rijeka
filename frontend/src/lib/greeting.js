// lib/greeting.js — the messenger opens by itself once after a sign-in.
//
// Prometheus and the rooms live behind one small button at the corner of the screen, which a newcomer does not find.
// After a sign-in the messenger is therefore opened once, where the user last left it (it moves by its title bar and
// remembers). Closing it keeps it closed: a reload, or a move to another page, does not open it again; the next
// sign-in does. Not on a phone, where an open messenger is the whole screen, and not while it stands in a window
// of its own: there it is already in front of the user, so that sign-in counts as greeted (closing that window
// later does not open the messenger here unasked). The greeting waits a moment after the page is up, so that a
// window of its own has had time to say it is there.
//
//   greetKey(session)        which sign-in this is: the user and the moment they signed in
//   shouldGreet({ ... })     whether to open it now
//   metElsewhere({ ... })    this sign-in has not been greeted here, and the messenger stands in a window of its own
export const GREETED_KEY = 'rijeka.messenger.greeted'
export const GREET_MIN_WIDTH = 900
export const GREET_WAIT_MS = 500

export function greetKey(session) {
  const u = session?.user
  return u?.id ? `${u.id}|${u.last_sign_in_at || ''}` : null
}

export function shouldGreet({ key, seen, width, hidden = false, poppedOut = false, open = false } = {}) {
  if (!key || key === seen) return false
  if (hidden || poppedOut || open) return false
  return Number.isFinite(width) && width >= GREET_MIN_WIDTH
}

export function metElsewhere({ key, seen, poppedOut = false } = {}) {
  return !!key && key !== seen && !!poppedOut
}
