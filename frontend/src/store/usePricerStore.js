/**
 * Rijeka — usePricerStore
 * Sprint 3D: pricing engine frontend store.
 *
 * State:
 *   resultsByTrade: { [tradeId]: PriceResponse }
 *   loading:        boolean
 *   error:          string | null
 *
 * Usage:
 *   const { priceTrade, generateCashflows, resultForTrade } = usePricerStore()
 *
 * Curve inputs (Sprint 3D — flat rates):
 *   [{ curve_id: "USD_SOFR", flat_rate: 0.0525 }, ...]
 *
 * Sprint 4: curves will be bootstrapped from market data automatically.
 */

import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No session — please log in.')
  return { Authorization: `Bearer ${session.access_token}` }
}

/**
 * Format a number as a currency string for display.
 * e.g. 1234567.89 → "1,234,567.89 USD"
 */
export function fmtCcy(amount, currency = '', decimals = 2) {
  if (amount == null || isNaN(amount)) return '—'
  const n = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return currency ? `${n} ${currency}` : n
}

/** Format a rate as basis points string. e.g. 0.045 → "450.0 bp" */
export function fmtBps(rate) {
  if (rate == null || isNaN(rate)) return '—'
  return (Number(rate) * 10000).toFixed(1) + ' bp'
}

/** Format a rate as percentage. e.g. 0.045 → "4.500%" */
export function fmtPct(rate, decimals = 3) {
  if (rate == null || isNaN(rate)) return '—'
  return (Number(rate) * 100).toFixed(decimals) + '%'
}

const usePricerStore = create((set, get) => ({
  resultsByTrade: {},
  loading:        false,
  error:          null,

  // ── Price a trade ────────────────────────────────────────

  /**
   * Price a trade. Returns NPV, leg PVs, projected cashflows, Greeks.
   *
   * @param {string}   tradeId
   * @param {object[]} curveInputs  [{ curve_id, flat_rate }, ...]
   * @param {string}   valuationDate  ISO date string, defaults to today
   */
  priceTrade: async (tradeId, curveInputs, valuationDate = null) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const body = {
        trade_id:       tradeId,
        curves:         curveInputs,
        valuation_date: valuationDate || new Date().toISOString().slice(0, 10),
      }
      const res = await fetch(`${API}/api/pricer/price`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const result = await res.json()
      set(state => ({
        resultsByTrade: { ...state.resultsByTrade, [String(tradeId)]: result },
        loading: false,
      }))
      return result
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[usePricerStore] priceTrade:', e)
      return null
    }
  },

  /**
   * Generate and store cashflow schedule for a trade.
   * Wipes existing PROJECTED cashflows and writes fresh ones.
   * Call this after booking a new trade or after amending economics.
   *
   * @param {string}   tradeId
   * @param {object[]} curveInputs
   * @param {string}   valuationDate
   * @returns {{ cashflows_written: number } | null}
   */
  generateCashflows: async (tradeId, curveInputs, valuationDate = null) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const body = {
        trade_id:       tradeId,
        curves:         curveInputs,
        valuation_date: valuationDate || new Date().toISOString().slice(0, 10),
      }
      const res = await fetch(`${API}/api/pricer/cashflows/generate`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const result = await res.json()
      set({ loading: false })
      return result
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[usePricerStore] generateCashflows:', e)
      return null
    }
  },

  // ── Selectors ────────────────────────────────────────────

  resultForTrade: (tradeId) => get().resultsByTrade[String(tradeId)] || null,

  clearTrade: (tradeId) => {
    set(state => {
      const next = { ...state.resultsByTrade }
      delete next[String(tradeId)]
      return { resultsByTrade: next }
    })
  },

  clearError: () => set({ error: null }),
}))

export default usePricerStore
