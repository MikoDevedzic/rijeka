// trade-window/fx-settlement.js — which settlement price source a digital-asset ticket books, and at what time.
//
// The pairs answer lists a pair's sources as `fixing_sources` ([{source, time, auto}]); `fixing_default` is the
// one a ticket books when nobody chooses (the venue's delivery price where the feed runs, the licensed benchmark
// elsewhere), and `fixing_default_time` is its time. The booked valuation time is always the time of the booked
// source, on the forward and on the option alike, whether the source was picked or left at the default.
//
// Only an older API answer, one without `fixing_sources`, keeps what the ticket wrote before the choice existed:
// the default source with the product's hard-coded time (the forward 16:00 London, the option 08:00 UTC).

export const LEGACY_VALUATION_TIME = { FORWARD: '16:00 London', OPTION: '08:00 UTC' }

const usable = (s) => !!s && typeof s.source === 'string' && s.source.trim() !== ''

// The select's options: the pair's sources, the default first in the list if the API left it out.
// Empty when the API does not list sources (an older answer): the ticket then shows no choice.
export function settlementOptions(cur) {
  const list = Array.isArray(cur?.fixing_sources) ? cur.fixing_sources.filter(usable) : []
  if (!list.length) return []
  const def = cur?.fixing_default
  if (def && !list.some(s => s.source === def)) return [{ source: def, time: cur?.fixing_default_time || null, auto: false }, ...list]
  return list
}

// What the trade's terms carry: {source, time, auto, isDefault}. `picked` is the select's value ('' = untouched).
export function settlementTerms(cur, picked, product) {
  const legacy = LEGACY_VALUATION_TIME[product] || LEGACY_VALUATION_TIME.FORWARD
  const options = settlementOptions(cur)
  const def = cur?.fixing_default
  if (!options.length) return { source: def, time: legacy, auto: false, isDefault: true }
  const hit = (picked ? options.find(s => s.source === picked) : null) || options.find(s => s.source === def) || options[0]
  const isDefault = hit.source === def
  // the source's own time; a default listed without one takes the API's fixing_default_time; the old constant is the last resort
  const time = hit.time || (isDefault ? cur?.fixing_default_time : null) || legacy
  return { source: hit.source, time, auto: !!hit.auto, isDefault }
}

// "CME CF BRR · 16:00 London": one option of the select.
export function settlementLabel(s) {
  return s?.time ? `${s.source} · ${s.time}` : String(s?.source || '')
}

// The muted line under the select: who supplies this source's fixing.
export function settlementNote(s) {
  if (!s) return ''
  return s.auto ? `fixed automatically each day${s.time ? ` at ${s.time}` : ''}` : 'your desk enters this fixing'
}
