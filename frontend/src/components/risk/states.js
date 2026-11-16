// risk/states.js — what a Risk screen says when it does not know, or has nothing to judge by. Unknown is not zero
// and "no limit" is not "within limits": a figure the page cannot have is a dash with the reason beside it.

// The chip beside a report's title: breaches, then warnings, then WITHIN LIMITS; and where nothing was tested, that,
// in no colour. A limit is tested where it was given a value (its status is not NA: a limit on a counterparty with
// no run, or on a desk for a figure that exists only for the book, has none).
export function limitStanding(limits, breaches = 0, warnings = 0) {
  if (breaches) return { text: `${breaches} BREACH${breaches > 1 ? 'ES' : ''}`, tone: 'red' }
  if (warnings) return { text: `${warnings} WARNING${warnings > 1 ? 'S' : ''}`, tone: 'amber' }
  const set = limits || []
  if (!set.length) return { text: 'NO LIMITS SET', tone: '' }
  if (!set.some(l => String(l.status || '').toUpperCase() !== 'NA')) return { text: 'NO LIMIT TESTED', tone: '' }
  return { text: 'WITHIN LIMITS', tone: 'ok' }
}

const hasCsa = (r) => !['NO_CSA', 'NONE', ''].includes(String(r?.csa_type || 'NO_CSA').toUpperCase())
// What the Collateral tab knows of one counterparty's margin. Its positions are the latest stored credit run's, and
// a run holds the counterparties that had live trades when it ran:
//   'none'    no CSA: no margin is exchanged, and that is known
//   'run'     in the stored run, simulated: the position is the run's
//   'flat'    a run is stored and the counterparty is not in it: it had no live trade then, so nothing is margined
//   'failed'  in the stored run, but the run could not simulate it (no spot, an error): not known
//   'unrun'   no run is stored at all: not known
export function positionOf(row, stored) {
  if (!hasCsa(row)) return 'none'
  if (row.has_run) return 'run'
  if (!stored) return 'unrun'
  return row.trades == null ? 'flat' : 'failed'
}
export const positionKnown = (row, stored) => !['failed', 'unrun'].includes(positionOf(row, stored))

// The book's totals: `known` is false where no position of the book's is known at all (the totals are then a dash,
// not $0); `missing` is how many counterparties with a CSA are not in a total that is shown; `why` says it once.
export function positions(rows, stored) {
  const csa = (rows || []).filter(hasCsa)
  const missing = csa.filter(r => !positionKnown(r, stored)).length
  const known = csa.length === 0 || missing < csa.length
  const why = !missing ? null
    : !stored ? 'no credit run is stored: positions not known'
    : `${missing} of ${csa.length} with a CSA could not be simulated in the stored run${known ? ': not in the totals' : ''}`
  return { csa: csa.length, missing, known, why }
}
