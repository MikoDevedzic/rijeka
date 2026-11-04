// store/useModulesStore.js — which modules the firm runs (GET /api/modules). Every module is on until the
// answer arrives and whenever the firm has not chosen, so a deploy ahead of the migration changes nothing.
import { create } from 'zustand'
import { getSessionMaybe } from '../lib/session'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
export const MODULE_KEYS = ['CHAIN_CONFIRM', 'PNL', 'XVA', 'MARKET_RISK', 'COUNTERPARTY_CREDIT', 'CAPITAL', 'PROMETHEUS', 'NEWS', 'COLLATERAL', 'XVA_RESERVES', 'IPV']
const ALL_ON = Object.fromEntries(MODULE_KEYS.map(k => [k, true]))

export const useModulesStore = create((set, get) => ({
  modules: ALL_ON,
  preset: null,
  source: 'default',
  catalogue: null,
  loaded: false,
  isOn: (key) => get().modules[key] !== false,
  load: async () => {
    try {
      const s = await getSessionMaybe()
      if (!s?.access_token) return
      const r = await fetch(`${API}/api/modules`, { headers: { Authorization: `Bearer ${s.access_token}` } })
      if (!r.ok) return
      const j = await r.json()
      set({ modules: { ...ALL_ON, ...(j.modules || {}) }, preset: j.preset || null, source: j.source || 'default', catalogue: j, loaded: true })
    } catch { /* every module stays on */ }
  },
  apply: (j) => set({ modules: { ...ALL_ON, ...(j.modules || {}) }, preset: j.preset || null, source: j.source || 'default', catalogue: j, loaded: true }),
}))

// The modules a route needs; a page whose module is off sends the visitor home.
export const ROUTE_MODULES = {
  '/pnl': ['PNL'],
  '/pnl/xva': ['PNL', 'XVA_RESERVES'],
  '/pnl/ipv': ['PNL', 'IPV'],
  '/risk': ['MARKET_RISK'],
  '/risk/ccr': ['COUNTERPARTY_CREDIT'],
  '/risk/capital': ['CAPITAL'],
  '/risk/collateral': ['COLLATERAL'],
}
