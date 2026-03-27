/**
 * Rijeka — useTradeLegsStore
 * Sprint 3B: first-class leg store.
 *
 * State:
 *   legsByTrade: { [tradeId]: TradeLeg[] }  ordered by leg_seq
 *   loading:     boolean
 *   error:       string | null
 *
 * Usage:
 *   const { fetchLegs, bookLeg, legsForTrade } = useTradeLegsStore()
 *   await fetchLegs(tradeId)
 *   await bookLeg({ id, trade_id, leg_ref, leg_seq, leg_type, direction, ... })
 */

import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No session — please log in.')
  return { Authorization: `Bearer ${session.access_token}` }
}

// Mirrors DB CHECK constraint — kept in sync with trade_legs.py
export const LEG_TYPES = [
  'FIXED', 'FLOAT', 'ZERO_COUPON', 'INFLATION',
  'CMS', 'CDS_FEE', 'CDS_CONTINGENT',
  'TOTAL_RETURN', 'EQUITY_RETURN', 'EQUITY_FWD',
  'VARIANCE', 'DIVIDEND',
  'COMMODITY_FLOAT', 'EMISSIONS_FLOAT',
  'RPA_FEE', 'RPA_CONTINGENT',
]

export const LEG_TYPE_LABELS = {
  FIXED:              'Fixed',
  FLOAT:              'Float',
  ZERO_COUPON:        'Zero Coupon',
  INFLATION:          'Inflation',
  CMS:                'CMS',
  CDS_FEE:            'CDS Fee',
  CDS_CONTINGENT:     'CDS Contingent',
  TOTAL_RETURN:       'Total Return',
  EQUITY_RETURN:      'Equity Return',
  EQUITY_FWD:         'Equity Forward',
  VARIANCE:           'Variance',
  DIVIDEND:           'Dividend',
  COMMODITY_FLOAT:    'Commodity Float',
  EMISSIONS_FLOAT:    'Emissions Float',
  RPA_FEE:            'RPA Fee',
  RPA_CONTINGENT:     'RPA Contingent',
}

// Direction colours → Rijeka CSS variables
export const DIRECTION_COLOR = {
  PAY:     'var(--red)',
  RECEIVE: 'var(--accent)',
}

const useTradeLegsStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────────
  legsByTrade: {},    // { [tradeId]: TradeLeg[] }
  loading:     false,
  error:       null,

  // ── Actions ────────────────────────────────────────────────

  /**
   * Fetch all legs for a trade (ordered by leg_seq).
   * Called when TradeWorkspace → Legs tab mounts.
   */
  fetchLegs: async (tradeId) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/trade-legs/${tradeId}`, { headers })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const legs = await res.json()
      set(state => ({
        legsByTrade: { ...state.legsByTrade, [String(tradeId)]: legs },
        loading: false,
      }))
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useTradeLegsStore] fetchLegs:', e)
    }
  },

  /**
   * Book a single leg (POST).
   * Called once per leg at trade booking time.
   * leg.id must be set client-side via crypto.randomUUID().
   *
   * @param {object} leg — TradeLegCreate shape
   * @returns {TradeLeg|null}
   */
  bookLeg: async (leg) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/trade-legs/`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(leg),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const created = await res.json()
      const tradeId = String(created.trade_id)
      set(state => {
        const existing = state.legsByTrade[tradeId] || []
        const merged = [...existing.filter(l => l.id !== created.id), created]
        merged.sort((a, b) => a.leg_seq - b.leg_seq)
        return {
          legsByTrade: { ...state.legsByTrade, [tradeId]: merged },
          loading: false,
        }
      })
      return created
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useTradeLegsStore] bookLeg:', e)
      return null
    }
  },

  /**
   * Book all legs for a trade in parallel.
   * Pass the legs array from the NewTradeWorkspace after trade row is saved.
   *
   * @param {object[]} legs — array of TradeLegCreate
   * @returns {TradeLeg[]}  — successfully booked legs
   */
  bookAllLegs: async (legs) => {
    const results = await Promise.all(
      legs.map(leg => get().bookLeg(leg))
    )
    return results.filter(Boolean)
  },

  /**
   * Update non-economic fields on a leg (PUT).
   */
  updateLeg: async (legId, tradeId, updates) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/trade-legs/leg/${legId}`, {
        method:  'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(updates),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const updated = await res.json()
      const tid = String(tradeId)
      set(state => {
        const legs = (state.legsByTrade[tid] || []).map(l =>
          l.id === legId ? updated : l
        )
        return {
          legsByTrade: { ...state.legsByTrade, [tid]: legs },
          loading: false,
        }
      })
      return updated
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useTradeLegsStore] updateLeg:', e)
      return null
    }
  },

  /**
   * Selector: legs for one trade, sorted by leg_seq.
   */
  legsForTrade: (tradeId) => {
    return (get().legsByTrade[String(tradeId)] || [])
      .slice()
      .sort((a, b) => a.leg_seq - b.leg_seq)
  },

  clearTrade: (tradeId) => {
    set(state => {
      const next = { ...state.legsByTrade }
      delete next[String(tradeId)]
      return { legsByTrade: next }
    })
  },

  clearError: () => set({ error: null }),
}))

export default useTradeLegsStore
