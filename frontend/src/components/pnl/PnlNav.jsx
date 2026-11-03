// pnl/PnlNav.jsx — the switch under P&L: TRADING P&L | XVA RESERVES | IPV, each following its module switch.
import { NavLink } from 'react-router-dom'
import { useModulesStore } from '../../store/useModulesStore'

const TABS = [
  { label: 'TRADING P&L', path: '/pnl', title: 'Attribution, the roll-up, the sign-off', module: 'PNL' },
  { label: 'XVA RESERVES', path: '/pnl/xva', title: 'The reserve book: levels per counterparty and component, day on day', module: 'XVA_RESERVES' },
  { label: 'IPV', path: '/pnl/ipv', title: 'Independent price verification: the market data the book is priced on, verified where the risk sits; flash → official', module: 'IPV' },
]

export default function PnlNav() {
  const modules = useModulesStore(s => s.modules)
  return (
    <nav className="rk-switch" aria-label="P&L sections">
      {TABS.filter(t => modules[t.module] !== false).map(t => <NavLink key={t.path} to={t.path} end title={t.title} className={({ isActive }) => `rk-seg${isActive ? ' on' : ''}`}>{t.label}</NavLink>)}
    </nav>
  )
}
