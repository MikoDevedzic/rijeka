// market-data/fixings.js — the pure part of the Fixings tab (FixingsPanel.jsx): the order of the table, the one
// word that says where a fixing came from, the split of a pair's sources into the feed's and the desk's, and the
// check of the entry form before it is posted. GET /api/currency/fixings/{pair} answers ascending by date; the
// table reads newest first.

const ORIGINS = ['FEED', 'MANUAL', 'SPOT']
const ORIGIN_PILL = { FEED: 'p-green', MANUAL: 'p-dim', SPOT: 'p-amber' }      // the classes SourceBadge uses on this page
export const MAX_SOURCE_LENGTH = 80                                           // the API's limit on a source name

// One word for the ORIGIN cell: FEED (the feed stored it), MANUAL (a desk entered it), SPOT (a stored spot, no fixing).
export function originWord(row) {
  const o = String(row?.origin || '').trim().toUpperCase()
  if (ORIGINS.includes(o)) return o
  return /^stored spot/i.test(String(row?.source || '')) ? 'SPOT' : 'MANUAL'
}

export const originPill = (word) => ORIGIN_PILL[word] || 'p-dim'

// Newest first; on one date the sources in name order, so the table does not shuffle between reloads.
export function sortFixings(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && typeof r.date === 'string')
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(a.source || '').localeCompare(String(b.source || ''))))
}

const named = (s) => !!s && typeof s.source === 'string' && s.source.trim() !== ''
// The sources a desk enters itself (the entry form's select) and the ones the feed stores each day.
export const deskSources = (sources) => (Array.isArray(sources) ? sources : []).filter(s => named(s) && !s.auto)
export const feedSources = (sources) => (Array.isArray(sources) ? sources : []).filter(s => named(s) && !!s.auto)

// The form's value as typed ("74,012.5") to a number, or null when it is not a positive finite number.
export function parseValue(text) {
  const t = String(text ?? '').replace(/,/g, '').trim()
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

// The entry form before it is posted: {ok: true, body} for POST /api/currency/fixings, or {ok: false, error}.
// `today` is an ISO date; a fixing cannot be entered for a later day.
export function checkFixing({ pair, source, date, value }, today) {
  const src = String(source || '').trim()
  if (!src) return { ok: false, error: 'Choose the source of the fixing' }
  if (src.length > MAX_SOURCE_LENGTH) return { ok: false, error: `A source name is at most ${MAX_SOURCE_LENGTH} characters` }
  const d = String(date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(`${d}T00:00:00Z`))) return { ok: false, error: 'Enter the date of the fixing' }
  if (today && d > today) return { ok: false, error: 'A fixing cannot be dated in the future' }
  const v = parseValue(value)
  if (v == null) return { ok: false, error: 'Enter the fixing as a positive number' }
  return { ok: true, body: { pair, fixing_date: d, source: src, value: v } }
}

// What to say when the save fails. A 409 is the instance, not the entry: its database has no fixings store yet.
export function saveErrorText(err) {
  if (err?.status === 409) return 'This instance cannot store fixings yet: its database has no fixings table. Nothing was saved.'
  return err?.message || 'The fixing was not saved'
}
