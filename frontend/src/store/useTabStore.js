import { create } from 'zustand'

const BOOK_TAB = { id: 'book', type: 'book', label: 'BOOK', closeable: false, dirty: false }

export const useTabStore = create((set, get) => ({
  tabs: [BOOK_TAB],
  activeId: 'book',

  setActive: (id) => set({ activeId: id }),

  openTrade: (trade) => {
    const tabId = `trade-${trade.id}`
    const existing = get().tabs.find(t => t.id === tabId)
    if (existing) { set({ activeId: tabId }); return }
    const tab = { id: tabId, type: 'trade', label: trade.trade_ref, tradeId: trade.id, trade, closeable: true, dirty: false, panel: 'overview' }
    set(s => ({ tabs: [...s.tabs, tab], activeId: tabId }))
  },

  openNewTrade: (prefill = null) => {
    const id = `new-${Date.now()}`
    const tab = { id, type: 'new', label: '+ NEW TRADE', closeable: true, dirty: false, prefill }
    set(s => ({ tabs: [...s.tabs, tab], activeId: id }))
  },

  closeTab: (id) => {
    const { tabs, activeId } = get()
    if (id === 'book') return
    const idx = tabs.findIndex(t => t.id === id)
    const next = tabs.filter(t => t.id !== id)
    const newActive = activeId === id ? (next[Math.max(0, idx - 1)]?.id || 'book') : activeId
    set({ tabs: next, activeId: newActive })
  },

  setDirty: (id, dirty) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, dirty } : t) })),
  setPanel: (id, panel) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, panel } : t) })),

  promoteTrade: (newId, trade) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === newId
        ? { ...t, id: `trade-${trade.id}`, type: 'trade', label: trade.trade_ref, tradeId: trade.id, trade, dirty: false }
        : t),
      activeId: `trade-${trade.id}`,
    }))
  },

  refreshTrade: (tradeId, trade) =>
    set(s => ({ tabs: s.tabs.map(t => t.tradeId === tradeId ? { ...t, trade } : t) })),

  openComparison: (trades) => {
    const id = `compare-${Date.now()}`
    const label = `CMP (${trades.length})`
    const tab = { id, type: 'compare', label, trades, closeable: true, dirty: false }
    set(s => ({ tabs: [...s.tabs, tab], activeId: id }))
  },
}))
