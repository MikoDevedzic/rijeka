// risk/RiskNav.jsx — the switch under RISK: MARKET RISK | COUNTERPARTY CREDIT | CAPITAL | COLLATERAL. A tab shows
// when the modules its page needs are on (store/useModulesStore ROUTE_MODULES, the list the routes are gated by).
import { NavLink } from 'react-router-dom'
import { useModulesStore, ROUTE_MODULES } from '../../store/useModulesStore'

const TABS = [
  { label: 'MARKET RISK', path: '/risk', title: 'Ladder, VaR, stress, limits' },
  { label: 'COUNTERPARTY CREDIT', path: '/risk/ccr', title: 'Netting sets, PFE, credit limits' },
  { label: 'CAPITAL', path: '/risk/capital', title: 'Regulatory stock for the CSA as booked: RWA, CVA capital, EAD, IM, leverage, liquid assets' },
  { label: 'COLLATERAL', path: '/risk/collateral', title: 'Schedules, margin positions, what they are held in, carry; the book under collateral regimes, channel by channel' },
]

export default function RiskNav() {
  const modules = useModulesStore(s => s.modules)
  return (
    <nav className="rk-switch" aria-label="Risk sections">
      {TABS.filter(t => (ROUTE_MODULES[t.path] || []).every(k => modules[k] !== false)).map(t => <NavLink key={t.path} to={t.path} end title={t.title} className={({ isActive }) => `rk-seg${isActive ? ' on' : ''}`}>{t.label}</NavLink>)}
    </nav>
  )
}
