import { create } from 'zustand'
import { passesFilters } from '../lib/blotter-filter'
import { supabase } from '../lib/supabase'
import { getSessionMaybe } from '../lib/session'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// A UTI is up to 52 characters; its tail is what people quote ("UTI ending C7754E").
export const shortUti = (u) => u ? '…' + u.slice(-10) : '—'

// {trade id: {trade_ref, firm}}: the counterparty's own booking of each trade,
// matched by UTI. Their rows are not readable here, so the backend looks them up.
async function fetchTheirRefs() {
  const session = await getSessionMaybe()
  if (!session?.access_token) return {}
  const r = await fetch(`${API}/api/trades/their-refs`, { headers: { Authorization: `Bearer ${session.access_token}` } })
  return r.ok ? r.json() : {}
}

const INIT_FILTERS = { status: 'ALL', assetClass: 'ALL', store: 'ALL', search: '' }

export const useTradesStore = create((set, get) => ({
  trades:  [],
  theirRefs: {},
  loading: false,
  error:   null,
  filters: { ...INIT_FILTERS },

  setFilter:    (k, v) => set(s => ({ filters: { ...s.filters, [k]: v } })),
  resetFilters: ()     => set({ filters: { ...INIT_FILTERS } }),

  // quiet: a background refresh keeps the table on screen instead of showing the loading state.
  fetchTrades: async ({ quiet = false } = {}) => {
    if (!quiet) set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('trades')
      .select(`*,
        counterparty:counterparties(id, name, csa_type),
        own_entity:legal_entities(id, name, short_name)`)
      .order('trade_date',  { ascending: false })
      .order('created_at', { ascending: false })

    error
      ? set({ error: error.message, loading: false })
      : set({ trades: data || [],   loading: false })
    if (!error) fetchTheirRefs().then(theirRefs => set({ theirRefs })).catch(() => {})
  },

  // Live blotter. The table's own changes arrive over realtime (the trades table is in the
  // supabase_realtime publication; RLS limits the stream to this user's rows), so a confirmation
  // countersigned by the other firm, a booking made from a chat card, or a colleague's amendment
  // shows here without a reload. Behind it, a refetch when the tab comes back into view and a
  // slow poll, for a browser whose realtime socket has dropped.
  _stopLive: null,
  startLive: () => {
    if (get()._stopLive) return get()._stopLive
    let timer = null
    const refresh = async () => {
      if (!(await getSessionMaybe())?.access_token) return
      get().fetchTrades({ quiet: true })
    }
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 300) }
    const channel = supabase
      .channel('trades-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, soon)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const poll = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 60_000)
    const stop = () => {
      clearTimeout(timer); clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      supabase.removeChannel(channel)
      set({ _stopLive: null })
    }
    set({ _stopLive: stop })
    return stop
  },

  // A trade is written only through the API (booking, /api/trade-events, /api/chain), where a change is an event. The
  // three writers that went straight to the table from here (add, set a status, delete) were used by nothing and are gone.

  filteredTrades: () => {
    const { trades, filters } = get()
    return trades.filter(t => passesFilters(t, filters, get().theirRefs[t.id]?.trade_ref))
  },
}))
