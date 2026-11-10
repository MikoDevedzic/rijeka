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
  canEdit: false,          // this user may switch the firm's modules (GET /api/modules → can_edit)
  onRequest: [],           // modules this user cannot have on in the hosted demo (GET /api/modules → on_request); the answer already has them off
  launch: false,           // the firm is a launch workspace (GET /api/modules → view): the simple home and XVA tab, whatever the preset is called now
  catalogue: null,
  loaded: false,
  isOn: (key) => get().modules[key] !== false,
  load: async () => {
    try {
      const s = await getSessionMaybe()
      if (!s?.access_token) return
      const r = await fetch(`${API}/api/modules`, { headers: { Authorization: `Bearer ${s.access_token}` } })
      if (!r.ok) { set({ loaded: true }); return }       // answered, with nothing chosen: every module stays on, and nobody waits on `loaded` for good
      const j = await r.json()
      set({ modules: { ...ALL_ON, ...(j.modules || {}) }, preset: j.preset || null, source: j.source || 'default', canEdit: !!j.can_edit, onRequest: j.on_request || [], launch: j.view === 'launch', catalogue: j, loaded: true })
    } catch { set({ loaded: true }) /* every module stays on */ }
  },
  apply: (j) => set({ modules: { ...ALL_ON, ...(j.modules || {}) }, preset: j.preset || null, source: j.source || 'default', canEdit: !!j.can_edit, onRequest: j.on_request || [], launch: j.view === 'launch', catalogue: j, loaded: true }),
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
