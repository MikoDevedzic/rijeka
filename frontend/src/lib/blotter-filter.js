// lib/blotter-filter.js — whether a trade passes the blotter's filters. A filter that is 'ALL' or empty lets every
// trade through (the rail's ALL button writes an empty value: read as "not ALL", it hid every trade). The search
// box matches the reference, the UTI, the counterparty's own reference and name, the desk, the strategy (a package's
// reference is in it), the instrument and the structure, in any case.
const on = (v) => !!v && v !== 'ALL'

export function passesFilters(t, filters = {}, theirRef = null) {
  if (on(filters.status) && t.status !== filters.status) return false
  if (on(filters.assetClass) && t.asset_class !== filters.assetClass) return false
  if (on(filters.store) && t.store !== filters.store) return false
  if (filters.search) {
    const q = String(filters.search).toLowerCase()
    const has = (s) => String(s || '').toLowerCase().includes(q)
    if (!(has(t.trade_ref) || has(t.uti) || has(theirRef) || has(t.counterparty?.name) || has(t.desk) || has(t.strategy) || has(t.instrument_type)
        || String(t.structure || '').toLowerCase().replace(/_/g, ' ').includes(q))) return false
  }
  return true
}
