/**
 * Rijeka — useTradeEventsStore
 * Sprint 3: immutable trade event stream.
 *
 * State shape:
 *   eventsByTrade: { [tradeId]: TradeEvent[] }   newest-first
 *   loading:       boolean
 *   error:         string | null
 *
 * Usage:
 *   const { fetchEvents, appendEvent, eventsByTrade } = useTradeEventsStore()
 *   await fetchEvents(tradeId)
 *   await appendEvent({ trade_id, event_type, event_date, effective_date, payload, pre_state, post_state })
 */

import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No session — please log in.')
  return { Authorization: `Bearer ${session.access_token}` }
}

// Valid event types mirrored from DB constraint
export const EVENT_TYPES = [
  'BOOKED',
  'ACTIVATED',
  'AMENDED',
  'BOOK_TRANSFER',
  'STORE_CHANGE',
  'PARTIAL_TERMINATION',
  'NOVATED',
  'TERMINATED',
  'MATURED',
  'CANCELLED',
  'DEFAULTED',
  'COMPRESSION',
  'CREDIT_EVENT',
]

// Human-readable labels for the UI
export const EVENT_TYPE_LABELS = {
  BOOKED:              'Booked',
  ACTIVATED:           'Activated',
  AMENDED:             'Amended',
  BOOK_TRANSFER:       'Book Transfer',
  STORE_CHANGE:        'Store Change',
  PARTIAL_TERMINATION: 'Partial Termination',
  NOVATED:             'Novated',
  TERMINATED:          'Terminated',
  MATURED:             'Matured',
  CANCELLED:           'Cancelled',
  DEFAULTED:           'Defaulted',
  COMPRESSION:         'Compression',
  CREDIT_EVENT:        'Credit Event',
}

// Colour coding for event badges (maps to Rijeka CSS variables)
export const EVENT_TYPE_COLOR = {
  BOOKED:              'var(--accent)',    // green
  ACTIVATED:           'var(--accent)',
  AMENDED:             'var(--amber)',     // amber
  BOOK_TRANSFER:       'var(--blue)',      // blue
  STORE_CHANGE:        'var(--blue)',
  PARTIAL_TERMINATION: 'var(--amber)',
  NOVATED:             'var(--purple)',    // purple
  TERMINATED:          'var(--red)',       // red
  MATURED:             'var(--accent)',
  CANCELLED:           'var(--red)',
  DEFAULTED:           'var(--red)',
  COMPRESSION:         'var(--purple)',
  CREDIT_EVENT:        'var(--red)',
}

const useTradeEventsStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────────
  eventsByTrade: {},   // { [tradeId]: TradeEvent[] }
  loading:       false,
  error:         null,

  // ── Actions ────────────────────────────────────────────────

  /**
   * Fetch all events for a trade and cache by trade_id.
   * Called when a TradeWorkspace mounts or the event tab is opened.
   */
  fetchEvents: async (tradeId) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/trade-events/${tradeId}`, { headers })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const events = await res.json()
      set(state => ({
        eventsByTrade: { ...state.eventsByTrade, [tradeId]: events },
        loading: false,
      }))
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useTradeEventsStore] fetchEvents:', e)
    }
  },

  /**
   * Append an event to the stream.
   * Prepends to local cache optimistically after server confirms.
   *
   * @param {object} body  — TradeEventCreate shape
   * @returns {TradeEvent|null}
   */
  appendEvent: async (body) => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`${API}/api/trade-events/`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const event = await res.json()
      const tradeId = String(event.trade_id)
      set(state => ({
        eventsByTrade: {
          ...state.eventsByTrade,
          [tradeId]: [event, ...(state.eventsByTrade[tradeId] || [])],
        },
        loading: false,
      }))
      return event
    } catch (e) {
      set({ loading: false, error: e.message })
      console.error('[useTradeEventsStore] appendEvent:', e)
      return null
    }
  },

  /**
   * Selector: events for one trade (newest first).
   * Returns [] if not yet fetched.
   */
  eventsForTrade: (tradeId) => {
    return get().eventsByTrade[String(tradeId)] || []
  },

  /**
   * Clear cached events for a trade (e.g. on tab close).
   */
  clearTrade: (tradeId) => {
    set(state => {
      const next = { ...state.eventsByTrade }
      delete next[String(tradeId)]
      return { eventsByTrade: next }
    })
  },

  clearError: () => set({ error: null }),
}))

export default useTradeEventsStore
