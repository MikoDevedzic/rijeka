// configurations/problems-view.js — the words of the Problems panel (GET /api/ops/problems), tested by themselves.

export function whoLine(p) {
  const named = p.emails || []
  const rest = (p.accounts || 0) - named.length
  const parts = [...named]
  if (rest > 0) parts.push(`${rest} more account${rest === 1 ? '' : 's'}`)
  if (p.anonymous) parts.push(p.anonymous === 1 ? 'a visitor not signed in' : `${p.anonymous} not signed in`)
  return parts.join(', ') || '—'
}

export function headline(b) {
  if (!b) return ''
  if (!b.recording) return 'not kept: the health table is not applied, and nobody is alerted'
  if (b.unread) return 'not read just now: reload to ask again'
  const n = b.problems.length
  const told = b.mail ? 'told in the support room and by mail' : 'told in the support room'
  return n ? `${n} problem${n === 1 ? '' : 's'} · ${b.occurrences} occurrence${b.occurrences === 1 ? '' : 's'} · the operator is ${told}` : `none · the operator is ${told}`
}
