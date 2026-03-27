/**
 * Rijeka — useCashflowsStore
 * Sprint 3C: generated cashflow schedule.
 *
 * State:
 *   cashflowsByTrade: { [tradeId]: Cashflow[] }  ordered by payment_date
 *   loading:          boolean
 *   error:            string | null
 *
 * Key concept:
 *   amount        = generated value (never mutated)
 *   amount_override = user inline edit (non-destructive)
 *   effectiveAmount(cf) = cf.amount_override ?? cf.amount
 */

import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No session — please log in.')
  return { Authorization: `Bearer ${session.access_token}` }
}

export const CF_STATUS = {
  PROJECTED: 'PROJECTED',
  CONFIRMED: 'CONFIRMED',
  SETTLED:   'SETTLED',
  CANCELLED: 'CANCELLED',
}

export const CF_STATUS_COLOR = {
  PROJECTED: 'var(--blue)',
  CONFIRMED: 'var(--accent)',
  SETTLED:   'var(--accent)',
  CANCELLED: 'var(--red)',
}

/** Effective amount respecting override. */
export function effectiveAmount(cf) {
  return cf.amount_override != null ? cf.amount_override : cf.amount
}

const useCashflowsStore = create((set, get) => ({
  cashflowsByTrade: {},
  loading:          false,
  error:            null,

  // ── Fetch ──────────────────────────────────────────────────

  /**
   * Fetch all cashflows for a trade (ordered by payment_date).
   * Called when TradeWorkspace → Cashflows tab mounts.
   */
  fetchCashflows: async (tradeId) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/cashflows/${tradeId}`, { headers })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const cashflows = await res.json()
      set(state => ({
        cashflowsByTrade: { ...state.cashflowsByTrade, [String(tradeId)]: cashflows },
        loading: false,
      }))
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useCashflowsStore] fetchCashflows:', e)
    }
  },

  // ── Write ──────────────────────────────────────────────────

  /**
   * Write complete cashflow schedule for a trade (wipe PROJECTED + replace).
   * Called by the pricing engine after curve bootstrap.
   *
   * @param {string}       tradeId
   * @param {Cashflow[]}   cashflows  — array of CashflowIn objects
   */
  writeSchedule: async (tradeId, cashflows) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/cashflows/bulk`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ trade_id: tradeId, cashflows }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const created = await res.json()
      // Merge with any CONFIRMED/SETTLED cashflows already in cache
      set(state => {
        const existing = state.cashflowsByTrade[String(tradeId)] || []
        const preserved = existing.filter(
          cf => cf.status === 'CONFIRMED' || cf.status === 'SETTLED'
        )
        const merged = [...preserved, ...created]
        merged.sort((a, b) => a.payment_date.localeCompare(b.payment_date))
        return {
          cashflowsByTrade: { ...state.cashflowsByTrade, [String(tradeId)]: merged },
          loading: false,
        }
      })
      return created
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useCashflowsStore] writeSchedule:', e)
      return null
    }
  },

  /**
   * Override a single cashflow amount (non-destructive inline edit).
   * Mirrors the existing cashflow_overrides mechanic in trades.terms.
   */
  overrideCashflow: async (cashflowId, tradeId, amountOverride) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/cashflows/${cashflowId}/override`, {
        method:  'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount_override: amountOverride }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const updated = await res.json()
      const tid = String(tradeId)
      set(state => ({
        cashflowsByTrade: {
          ...state.cashflowsByTrade,
          [tid]: (state.cashflowsByTrade[tid] || []).map(cf =>
            cf.id === cashflowId ? updated : cf
          ),
        },
        loading: false,
      }))
      return updated
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useCashflowsStore] overrideCashflow:', e)
      return null
    }
  },

  /**
   * Update cashflow status (PROJECTED → CONFIRMED → SETTLED | CANCELLED).
   */
  updateStatus: async (cashflowId, tradeId, status) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/cashflows/${cashflowId}/status`, {
        method:  'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const updated = await res.json()
      const tid = String(tradeId)
      set(state => ({
        cashflowsByTrade: {
          ...state.cashflowsByTrade,
          [tid]: (state.cashflowsByTrade[tid] || []).map(cf =>
            cf.id === cashflowId ? updated : cf
          ),
        },
        loading: false,
      }))
      return updated
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useCashflowsStore] updateStatus:', e)
      return null
    }
  },

  // ── Selectors ──────────────────────────────────────────────

  cashflowsForTrade: (tradeId) =>
    get().cashflowsByTrade[String(tradeId)] || [],

  cashflowsForLeg: (tradeId, legId) =>
    (get().cashflowsByTrade[String(tradeId)] || [])
      .filter(cf => cf.leg_id === legId),

  /** Net cashflow per payment date across all legs. */
  netByDate: (tradeId) => {
    const cfs = get().cashflowsByTrade[String(tradeId)] || []
    const map = {}
    for (const cf of cfs) {
      if (cf.status === 'CANCELLED') continue
      const key = `${cf.payment_date}|${cf.currency}`
      map[key] = (map[key] || 0) + Number(effectiveAmount(cf))
    }
    return Object.entries(map).map(([key, net]) => {
      const [payment_date, currency] = key.split('|')
      return { payment_date, currency, net }
    }).sort((a, b) => a.payment_date.localeCompare(b.payment_date))
  },

  clearTrade: (tradeId) => {
    set(state => {
      const next = { ...state.cashflowsByTrade }
      delete next[String(tradeId)]
      return { cashflowsByTrade: next }
    })
  },

  clearError: () => set({ error: null }),
}))

export default useCashflowsStore
