// risk/limits-page.js — the Limits page's table of a limit for every curve, worked out from the risk report
// (GET /api/risk/report: `limits`, each evaluated on the book, a curve with no limit of its own carrying the
// standard one for its kind; `standards`, the size of each kind). Nothing is computed here but what to show.
import { spotMeasure } from './names'

const pretty = (id) => String(id).replace(/_/g, ' ')
// The factor a limit is on, where it is on a curve's, an asset's, a surface's or a forward basis's total.
export function factorOf(metric) {
  const [head, a, b] = String(metric || '').toUpperCase().split(':')
  if (!a) return null
  if (head === 'IR01') return { name: pretty(a), measure: 'IR01', unit: 'per bp' }
  if (head === 'SPOT01') return { name: a, measure: spotMeasure(a)[1], unit: 'per 1%' }
  if (head === 'VEGA' && !b) return { name: /_SWVOL/.test(a) ? `${a.split('_')[0]} swaptions` : a.replace(/_VOL$/, ''), measure: 'VEGA', unit: /_SWVOL/.test(a) ? 'per bp of vol' : 'per vol point' }
  if (head === 'CRYBASIS01') return { name: a.replace(/_FUNDING$/, ''), measure: 'CRYBASIS01', unit: 'per bp' }
  return null
}
// One row for each curve the book carries: its position's size, its limit (its own, or the standard one), the share used.
export function curveRows(rep) {
  return (rep?.limits || []).filter(l => String(l.scope || 'ALL').toUpperCase() === 'ALL' && factorOf(l.metric)).map(l => ({
    id: l.id, metric: String(l.metric).toUpperCase(), ...factorOf(l.metric), standard: !!l.standard, limit: l.limit, warn_pct: l.warn_pct,
    value: l.value, used: l.utilisation_pct, status: l.status, set_by: l.set_by || null,
  })).sort((a, b) => a.measure.localeCompare(b.measure) || a.name.localeCompare(b.name))
}
// The firm's other limits: every stored one that is not a curve's total (VaR, a stress loss, a bucket, a desk's or a book's).
export const otherLimits = (rep) => (rep?.limits || []).filter(l => !l.standard && !(String(l.scope || 'ALL').toUpperCase() === 'ALL' && factorOf(l.metric)))
export const KIND_NAME = { IR01: 'A curve · IR01', FX01: 'A currency · FX01', CRY01: 'A digital asset · CRY01', VEGA: 'A volatility surface · VEGA', CRYBASIS01: 'A forward basis · CRYBASIS01' }
export const standardRows = (rep) => Object.keys(KIND_NAME).map(k => rep?.standards?.[k]).filter(Boolean)
// A size as typed ("25,000", "25 000", "2.5e4"): a positive number, or null.
export const parseSize = (s) => { const n = Number(String(s ?? '').replace(/[,\s_]/g, '')); return Number.isFinite(n) && n > 0 ? n : null }
