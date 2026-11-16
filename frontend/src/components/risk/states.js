// risk/states.js — what a Risk screen says when it does not know, or has nothing to judge by. Unknown is not zero
// and "no limit" is not "within limits": a figure the page cannot have is a dash with the reason beside it.

// The chip beside a report's title: breaches, then warnings, then WITHIN LIMITS; and where no limit is set at all,
// that, in no colour, because nothing was tested.
export function limitStanding(limits, breaches = 0, warnings = 0) {
  if (breaches) return { text: `${breaches} BREACH${breaches > 1 ? 'ES' : ''}`, tone: 'red' }
  if (warnings) return { text: `${warnings} WARNING${warnings > 1 ? 'S' : ''}`, tone: 'amber' }
  if (!(limits || []).length) return { text: 'NO LIMITS SET', tone: '' }
  return { text: 'WITHIN LIMITS', tone: 'ok' }
}

// The Collateral tab's positions come from the latest stored credit run, counterparty by counterparty. A
// counterparty with a CSA and no stored run has a position the page does not know (not one of zero); one without
// a CSA exchanges no margin, which is known. `known` is false where no position of the book's is known at all:
// the totals are then a dash, not $0. `missing` is how many are not in a total that is shown.
export function positions(rows) {
  const csa = (rows || []).filter(r => !['NO_CSA', 'NONE', ''].includes(String(r.csa_type || 'NO_CSA').toUpperCase()))
  const missing = csa.filter(r => !r.has_run).length
  return { csa: csa.length, missing, known: csa.length === 0 || missing < csa.length }
}
