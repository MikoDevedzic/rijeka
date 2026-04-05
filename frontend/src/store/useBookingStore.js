import { create } from 'zustand'

let _nextId = 1

const useBookingStore = create((set) => ({
  windows: [], // [{id, x, y, trade}]  trade=null means NEW TRADE

  open: (trade = null) => set((state) => {
    const id  = _nextId++
    const idx = state.windows.length
    const x   = 60 + idx * 30
    const y   = 20 + idx * 30
    return { windows: [...state.windows, { id, x, y, trade }] }
  }),

  close: (id) => set((state) => ({
    windows: state.windows.filter(w => w.id !== id)
  })),

  closeAll: () => set({ windows: [] }),
}))

export default useBookingStore
