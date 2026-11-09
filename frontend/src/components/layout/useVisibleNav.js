// layout/useVisibleNav.js — the top-level navigation a firm sees, following its module switches. One list for
// the top bar (AppBar) and the home page (CommandCenter). An item that fronts gated pages (P&L, RISK) is shown
// when at least one of them is on, and opens the first one that is: store/useModulesStore ROUTE_MODULES is the
// only place that says which module a page needs, and its order is the order the pages are tried in.
import { useMemo } from 'react'
import { useModulesStore, ROUTE_MODULES } from '../../store/useModulesStore'

const NAV = [
  { label: 'HOME',           path: '/command-center', exact: true  },
  { label: 'BLOTTER',        path: '/blotter',        exact: false },
  { label: 'P&L',            path: '/pnl',            exact: true  },
  { label: 'RISK',           path: '/risk',           exact: false },
  { label: 'CONFIGURATIONS', path: '/configurations', exact: false },
  { label: 'METHODOLOGY',    path: '/methodology',    exact: true  },
  { label: 'ROADMAP',        path: '/roadmap',        exact: true  },
]

// Each visible item with `to`, the page its button opens. Pure: `modules` is the store's key → bool map.
export function visibleNav(modules, routes = ROUTE_MODULES) {
  const on = route => routes[route].every(k => modules[k] !== false)
  return NAV.flatMap(item => {
    const pages = Object.keys(routes).filter(r => r === item.path || r.startsWith(item.path + '/'))
    if (!pages.length) return [{ ...item, to: item.path }]
    const first = pages.find(on)
    return first ? [{ ...item, to: first }] : []
  })
}

export function useVisibleNav() {
  const modules = useModulesStore(s => s.modules)
  return useMemo(() => visibleNav(modules), [modules])
}
