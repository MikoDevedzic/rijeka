// lib/seen.js — what this browser remembers a person has done once, for the launch home's steps.
//
// The home's four steps are ticked from the trades where the trades can say (booked, confirmed). That a person has
// looked at the XVA charge is in no record the home can read, so the ticket marks it here when its XVA tab is opened
// and the home reads the mark. It is this browser's memory, per account (the caller says whose), and nothing else
// rests on it: without an account nothing is marked, and where storage is refused the step simply stays unticked.
const key = (what, account) => (account ? `rijeka.seen.${what}.${account}` : null)

export function markSeen(what, account) { try { const k = key(what, account); if (k) localStorage.setItem(k, '1') } catch { /* storage refused: the step stays unticked */ } }
export function hasSeen(what, account) { try { const k = key(what, account); return !!k && localStorage.getItem(k) === '1' } catch { return false } }
