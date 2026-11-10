// store/useModulesStore.js — which modules this user has (GET /api/modules: the firm's switches, less what the
// instance holds for the admin role). Every module is on until the first answer, so a deploy ahead of the
// migration changes nothing; a read that fails later keeps the last answer. A read the API could not answer (a
// 5xx, no answer, a body that is not JSON) is asked again, RETRY_MS, until an answer or a save ends the chain.
import { create } from 'zustand'
import { getSessionMaybe } from '../lib/session'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
export const MODULE_KEYS = ['CHAIN_CONFIRM', 'PNL', 'XVA', 'MARKET_RISK', 'COUNTERPARTY_CREDIT', 'CAPITAL', 'PROMETHEUS', 'NEWS', 'COLLATERAL', 'XVA_RESERVES', 'IPV']
const ALL_ON = Object.fromEntries(MODULE_KEYS.map(k => [k, true]))
const RETRY_MS = [3000, 10000, 30000]      // after a 5xx or no answer at all: a restart, not a refusal. Three times, then not until something calls load() again
let failures = 0
let chain = 0                              // an answer or a save starts a new one: retries queued before it do nothing

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
      if (!r.ok) {                                       // every module stays on, and nobody waits on `loaded` for good
        set({ loaded: true })
        if (r.status >= 500) get().again()
        return
      }
      const j = await r.json()
      failures = 0; chain++
      set({ modules: { ...ALL_ON, ...(j.modules || {}) }, preset: j.preset || null, source: j.source || 'default', canEdit: !!j.can_edit, onRequest: j.on_request || [], launch: j.view === 'launch', catalogue: j, loaded: true })
    } catch { set({ loaded: true }); get().again() /* every module stays on until the API answers */ }
  },
  again: () => { const mine = chain; if (failures < RETRY_MS.length) setTimeout(() => { if (mine === chain) get().load() }, RETRY_MS[failures++]) },
  apply: (j) => { chain++; set({ modules: { ...ALL_ON, ...(j.modules || {}) }, preset: j.preset || null, source: j.source || 'default', canEdit: !!j.can_edit, onRequest: j.on_request || [], launch: j.view === 'launch', catalogue: j, loaded: true }) },
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
