// risk/RiskNav.jsx — the switch under RISK: MARKET RISK | COUNTERPARTY CREDIT | CAPITAL
import { NavLink } from 'react-router-dom'
import { useModulesStore } from '../../store/useModulesStore'

const TABS = [
  { label: 'MARKET RISK', path: '/risk', title: 'Ladder, VaR, stress, limits', module: 'MARKET_RISK' },
  { label: 'COUNTERPARTY CREDIT', path: '/risk/ccr', title: 'Netting sets, PFE, credit limits', module: 'COUNTERPARTY_CREDIT' },
  { label: 'CAPITAL', path: '/risk/capital', title: 'The book under collateral regimes: RWA, CVA capital, KVA, leverage, channel by channel', module: 'CAPITAL' },
]

export default function RiskNav() {
  const modules = useModulesStore(s => s.modules)
  return (
    <nav className="rk-switch" aria-label="Risk sections">
      {TABS.filter(t => modules[t.module] !== false).map(t => <NavLink key={t.path} to={t.path} end title={t.title} className={({ isActive }) => `rk-seg${isActive ? ' on' : ''}`}>{t.label}</NavLink>)}
    </nav>
  )
}
