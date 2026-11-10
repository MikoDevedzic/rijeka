// onboarding/collateral-schedule.js — the pure helpers behind the counterparty's collateral schedule editor
// (the CSA's eligible-collateral annex): the form shape, the request body, and the weights.

// The editor's state: one row per eligible instrument, the posted and received percentages typed as text.
export const EMPTY_SCHEDULE = { rows: [], rail: 'bilateral', note: '' }

export function rowFor(code) {
  return { instrument: code, vm: true, im: true, csa_haircut_pct: '', limit_pct: '', posted: '', received: '' }
}

// Server schedule → editor state (percentages as whole numbers).
export function formFromSchedule(s) {
  if (!s) return { ...EMPTY_SCHEDULE }
  const rows = (s.eligible || []).map(e => ({
    instrument: e.instrument, vm: e.vm !== false, im: e.im !== false,
    csa_haircut_pct: e.csa_haircut_pct != null ? String(e.csa_haircut_pct) : '',
    limit_pct: e.limit_pct != null ? String(e.limit_pct) : '',
    posted: s.posted?.[e.instrument] != null ? String(Math.round(s.posted[e.instrument] * 1000) / 10) : '',
    received: s.received?.[e.instrument] != null ? String(Math.round(s.received[e.instrument] * 1000) / 10) : '',
  }))
  return { rows, rail: s.rail || 'bilateral', note: s.note || '' }
}

// A default schedule for a new counterparty: cash in the CSA currency plus that currency's government paper.
export function defaultForm(ccy = 'USD', instruments = []) {
  const codes = instruments.map(i => i.code)
  const cash = `${ccy}_CASH`
  const govt = { USD: 'UST_BILL', EUR: 'BUND', GBP: 'GILT' }[ccy]
  const rows = []
  if (codes.includes(cash)) rows.push({ ...rowFor(cash), posted: '100', received: '100' })
  if (govt && codes.includes(govt)) rows.push(rowFor(govt))
  if (!rows.length && codes.length) rows.push({ ...rowFor(codes[0]), posted: '100', received: '100' })
  return { rows, rail: 'bilateral', note: '' }
}

const num = (s) => { const n = Number(s); return s === '' || s == null || !Number.isFinite(n) ? null : n }

// Editor state → the PUT body. Weights are the typed percentages; the server normalises them to sum to one.
export function bodyFromForm(form) {
  const eligible = form.rows.map(r => ({ instrument: r.instrument, vm: !!r.vm, im: !!r.im,
    csa_haircut_pct: num(r.csa_haircut_pct), limit_pct: num(r.limit_pct) }))
  const posted = {}, received = {}
  for (const r of form.rows) {
    const p = num(r.posted), q = num(r.received)
    if (p != null && p > 0) posted[r.instrument] = p
    if (q != null && q > 0) received[r.instrument] = q
  }
  return { eligible, posted, received, rail: form.rail || 'bilateral', note: form.note || null }
}

// What stops a save: nothing eligible, a weight on an instrument not admitted for VM, a negative number.
export function problems(form) {
  const out = []
  if (!form.rows.length) out.push('admit at least one instrument')
  for (const r of form.rows) {
    const p = num(r.posted), q = num(r.received)
    if ((p != null && p < 0) || (q != null && q < 0)) out.push(`${r.instrument}: weights must be non-negative`)
    if (!r.vm && ((p != null && p > 0) || (q != null && q > 0))) out.push(`${r.instrument}: posted or received but not admitted for VM`)
    const h = num(r.csa_haircut_pct)
    if (h != null && (h < 0 || h > 100)) out.push(`${r.instrument}: haircut must be between 0 and 100`)
  }
  return out
}

// Sum of the typed percentages, for the editor's running total.
export function total(form, key) {
  return form.rows.reduce((s, r) => s + (num(r[key]) || 0), 0)
}

// A one-line summary for the list: "UST_BILL 60 · USDC 40 → on chain".
export function summary(s) {
  if (!s) return null
  const comp = Object.entries(s.posted || {}).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${k} ${Math.round(w * 100)}`).join(' · ')
  return `${comp || '—'}${s.rail === 'on_chain' ? ' → on chain' : ''}`
}

// The note under a counterparty's terms: what they feed, naming only the pages this user has (`modules` is the
// store's key → bool map; a module is on unless it is false). Empty when none of those pages is on.
export function termsFeed(modules = {}) {
  const on = k => modules[k] !== false
  const parts = [on('COUNTERPARTY_CREDIT') && 'the credit report', on('XVA') && "the ticket's XVA tab",
    on('CAPITAL') && "the ticket's CAPITAL tab", on('CAPITAL') && 'Risk → CAPITAL'].filter(Boolean)
  if (!parts.length) return ''
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `the CSA terms and the collateral schedule feed ${list}`
}
