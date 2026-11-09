// pnl/PnlNav.jsx — the switch under P&L: TRADING P&L | XVA RESERVES | IPV. A tab shows when the modules its page
// needs are on (store/useModulesStore ROUTE_MODULES, the list the routes are gated by).
import { NavLink } from 'react-router-dom'
import { useModulesStore, ROUTE_MODULES } from '../../store/useModulesStore'

const TABS = [
  { label: 'TRADING P&L', path: '/pnl', title: 'Attribution, the roll-up, the sign-off' },
  { label: 'XVA RESERVES', path: '/pnl/xva', title: 'The reserve book: levels per counterparty and component, day on day' },
  { label: 'IPV', path: '/pnl/ipv', title: 'Independent price verification: the market data the book is priced on, verified where the risk sits; flash → official' },
]

export default function PnlNav() {
  const modules = useModulesStore(s => s.modules)
  return (
    <nav className="rk-switch" aria-label="P&L sections">
      {TABS.filter(t => (ROUTE_MODULES[t.path] || []).every(k => modules[k] !== false)).map(t => <NavLink key={t.path} to={t.path} end title={t.title} className={({ isActive }) => `rk-seg${isActive ? ' on' : ''}`}>{t.label}</NavLink>)}
    </nav>
  )
}
