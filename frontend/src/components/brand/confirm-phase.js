// brand/confirm-phase.js — which state the picture of a confirmation is in (brand/ConfirmMark.jsx).
//
//   busy      a confirmation is being signed, or its transaction is in flight
//   started   a confirmation was asked for on THIS trade while this ticket was open
//   status    the trade's status
//   failed    the request failed, the transaction failed, or it was not taken in time
//
// The river runs only while something is in progress. A trade that was confirmed earlier, or by the other side,
// has no picture here (its certificate and seal say it). A trade that left PENDING any other way (cancelled,
// terminated) has none either: the picture never runs over a trade that is not being confirmed.
export function confirmPhase({ busy = false, started = false, status = null, failed = false } = {}) {
  if (busy) return 'running'
  if (!started) return null
  if (status === 'CONFIRMED') return 'done'
  if (status === 'PENDING') return failed ? 'failed' : 'waiting'
  return null
}

/** The words under the picture. A confirmed trade whose record is not on a chain says so. */
export function confirmCaption(phase, sealed) {
  if (phase === 'running') return 'SIGNING AND ANCHORING'
  if (phase === 'failed') return 'NOT CONFIRMED'
  if (phase === 'done') return sealed ? 'CONFIRMED ON CHAIN' : 'CONFIRMED · NOT ANCHORED'
  return ''
}
