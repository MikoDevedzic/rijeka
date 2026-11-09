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
    return label && label.length <= 28 && !label.startsWith('DEMO') ? label : 'feed'
  }
  return s
}
