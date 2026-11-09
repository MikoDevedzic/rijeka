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
