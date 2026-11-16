// configurations/problems-view.js — the words of the Problems panel (GET /api/ops/problems), tested by themselves.

const KIND = { browser: 'in the browser', api: 'the API answered an error', slow: 'a slow answer' }

/** Who a problem hit: the accounts by name, those it cannot name by count, and visitors who were not signed in. */
export function whoLine(p) {
  const named = p.emails || []
  const rest = (p.accounts || 0) - named.length
  const parts = [...named]
  if (rest > 0) parts.push(`${rest} more account${rest === 1 ? '' : 's'}`)
  if (p.anonymous) parts.push(p.anonymous === 1 ? 'a visitor not signed in' : `${p.anonymous} not signed in`)
  return parts.join(', ') || '—'
}

/** The line under a problem: what kind it is, where the report came from, the build, and whether it rang. */
export function kindLine(p) {
  const parts = [KIND[p.kind] || String(p.kind || '')]
  if (p.kind === 'browser' && p.source) parts.push(p.source)
  if (p.release && p.release !== 'dev') parts.push(String(p.release).slice(0, 7))
  if (p.rings === false) parts.push('kept, does not ring')
  return parts.join(' · ')
}

/** What the header says: the count, or why there is none to give. */
export function headline(b) {
  if (!b) return ''
  if (!b.recording) return 'not kept: the health table is not applied, and nobody is alerted'
  if (b.unread) return 'not read just now: reload to ask again'
  const n = b.problems.length
  return n ? `${n} problem${n === 1 ? '' : 's'} · ${b.occurrences} occurrence${b.occurrences === 1 ? '' : 's'}${b.truncated ? ' · the newest only' : ''}` : 'none'
}

/** Whom the alarm reaches. `silent` when it reaches nobody, which the panel must not let pass for quiet. */
export function toldLine(b) {
  if (!b || !b.recording) return { silent: false, text: '' }
  const rooms = b.rooms || 0
  if (!rooms && !b.mail) return { silent: true, text: 'NOBODY IS TOLD: no admin account has a support room yet (open the messenger once, signed in as an admin) and mail is not set up.' }
  const ways = []
  if (rooms) ways.push(rooms === 1 ? "a message in the admin's support room" : `a message in ${rooms} admins' support rooms`)
  if (b.mail) ways.push('a mail')
  return { silent: false, text: `The operator is told by ${ways.join(' and ')}.` }
}

/** A moment, as the page's other panels write one: the viewer's own day and time. */
export function when(iso, locale) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
