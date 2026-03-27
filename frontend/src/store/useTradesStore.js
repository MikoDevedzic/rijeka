import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const INIT_FILTERS = { status: 'ALL', assetClass: 'ALL', store: 'ALL', search: '' }

export const useTradesStore = create((set, get) => ({
  trades:  [],
  loading: false,
  error:   null,
  filters: { ...INIT_FILTERS },

  setFilter:    (k, v) => set(s => ({ filters: { ...s.filters, [k]: v } })),
  resetFilters: ()     => set({ filters: { ...INIT_FILTERS } }),

  fetchTrades: async () => {
    set({ loading: true, error: null })
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
  },

  addTrade: async (trade) => {
    // Generate UUID client-side — Supabase free tier may not have gen_random_uuid() default
    const id = crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })
    const { data, error } = await supabase
      .from('trades')
      .insert([{ ...trade, id }])
      .select(`*,
        counterparty:counterparties(id, name, csa_type),
        own_entity:legal_entities(id, name, short_name)`)
      .single()
    if (error) return { error }
    set(s => ({ trades: [data, ...s.trades] }))
    return { data }
  },

  updateTradeStatus: async (id, status) => {
    const { error } = await supabase.from('trades').update({ status }).eq('id', id)
    if (error) return { error }
    set(s => ({ trades: s.trades.map(t => t.id === id ? { ...t, status } : t) }))
    return {}
  },

  deleteTrade: async (id) => {
    const t = get().trades.find(x => x.id === id)
    if (!['PENDING','CANCELLED'].includes(t?.status))
      return { error: { message: 'Only PENDING or CANCELLED trades can be deleted' } }
    const { error } = await supabase.from('trades').delete().eq('id', id)
    if (error) return { error }
    set(s => ({ trades: s.trades.filter(x => x.id !== id) }))
    return {}
  },

  filteredTrades: () => {
    const { trades, filters } = get()
    return trades.filter(t => {
      if (filters.status    !== 'ALL' && t.status     !== filters.status)    return false
      if (filters.assetClass !== 'ALL' && t.asset_class !== filters.assetClass) return false
      if (filters.store     !== 'ALL' && t.store      !== filters.store)     return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        if (!( (t.trade_ref || '').toLowerCase().includes(q)
            || (t.counterparty?.name || '').toLowerCase().includes(q)
            || (t.desk || '').toLowerCase().includes(q)
            || (t.instrument_type || '').toLowerCase().includes(q) ))
          return false
      }
      return true
    })
  },
}))
