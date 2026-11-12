import { create } from 'zustand'

let _nextId = 1

const useBookingStore = create((set) => ({
  windows: [], // [{id, x, y, trade, opts}]  trade=null means NEW TRADE

  // `opts`, for a ticket opened again on a trade that has just changed (a partial termination): { tab, notice }.
  // The ticket opens on that tab and shows that notice (TradeWindow initialTab, initialNotice).
  open: (trade = null, opts = null) => set((state) => {
    const id  = _nextId++
    const idx = state.windows.length
    const x   = 60 + idx * 30
    const y   = 20 + idx * 30
    return { windows: [...state.windows, { id, x, y, trade, opts }] }
  }),

  close: (id) => set((state) => ({
    windows: state.windows.filter(w => w.id !== id)
  })),

  closeAll: () => set({ windows: [] }),
}))

export default useBookingStore
