// market-data/fx-source.js — how a stored curve's source is shown where there is room for a word, not a sentence.
// A snapshot's `source` can be long ("DEMO · Deribit forwards · 2026-11-09 15:25 UTC · listed to 24SEP27, flat
// beyond"); printed whole in a table cell or a list row it wraps and stretches the row.

// One word for a table cell: FEED for anything a feed wrote, otherwise the source as saved (MANUAL, BLOOMBERG, IMPORT).
export function sourceKind(source) {
  const s = String(source || '').trim()
  if (!s) return 'MANUAL'
  return s.toUpperCase().startsWith('DEMO') ? 'FEED' : s.toUpperCase()
}

// A few words for a list row or a pill: the venue and the time of its marks, "feed (pending)" for a pair handed
// back and not yet refreshed, otherwise the source as saved.
export function sourceShort(curve) {
  const s = String(curve?.source || '').trim()
  if (!s) return ''
  if (s.startsWith('DEMO · handed back')) return 'feed (pending)'
  if (s.startsWith('DEMO')) {
    const label = String(curve?.label || '')
    // the API's label for a venue row is "<Venue> <day> <Mon> <HH:MM> UTC"; anything longer is the fallback sentence
    if (label && label.length <= 28 && !label.startsWith('DEMO')) return label
    return /synthetic/i.test(s) ? 'synthetic' : /backfill/i.test(s) ? 'backfill' : 'feed'
  }
  return s
}

// True for a row that carries its own time (a venue's marks): its short form needs no date beside it.
export function isVenue(curve) {
  const s = String(curve?.source || '')
  return s.startsWith('DEMO') && sourceShort(curve) === String(curve?.label || '')
}

// One word for the narrow pair list: the venue's name, "feed", or the source as saved. When the marks were
// taken is in the pill above the table, where there is room for it.
export function sourceWord(curve) {
  const short = sourceShort(curve)
  return isVenue(curve) ? short.split(' ')[0] : short
}

// The pill beside a pair's curve pill that says what its forwards are priced from. The account's forward mode
// (MARKET: spot + quoted points; IMPLIED: parity) is one setting for every pair, but a pair with no stored points
// has none to price on and falls back to parity whatever the mode (currencies.py: `if fc:`). So the pill reads
// the two together and never says "quoted points" beside "no forward curve".
//   crypto  parity for a digital asset is spot carried at its carry rate, not two yield curves
export function pricedFromWords(mode, curve, crypto = false) {
  const parity = crypto ? 'priced from the carry rate' : 'priced from yields'
  if (mode === 'IMPLIED') return curve ? `${parity}; the points are stored, not used` : parity
  return curve ? 'priced off the quoted points' : `no points stored: ${parity}`
}

// The digital asset's rate as the pair's header and chips name it, one name with the ticket's IMPLIED <BASE> RATE:
// where the feed's points are in use the forward carries the rate the points imply; otherwise the saved rate
// (the desk's setting, 0 when none) carries spot to the forward. Never "funding": that is the XVA spread.
export function baseRateWords(p, mode) {
  const base = p?.base || 'asset'
  const pointsInUse = !!p?.forward_curve && p.forward_curve.in_use !== false && mode !== 'IMPLIED'
  if (pointsInUse) return `${base} rate implied by the points`
  const pct = Number(p?.funding_pct)
  return `saved ${base} rate ${Number.isFinite(pct) ? pct : 0} %`
}
