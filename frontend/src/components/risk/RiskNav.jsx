// risk/RiskNav.jsx — the switch under RISK: MARKET RISK | COUNTERPARTY CREDIT
import { NavLink } from 'react-router-dom'

const TABS = [
  { label: 'MARKET RISK', path: '/risk', title: 'Ladder, VaR, stress, limits' },
  { label: 'COUNTERPARTY CREDIT', path: '/risk/ccr', title: 'Netting sets, PFE, credit limits' },
]

export default function RiskNav() {
  return (
    <nav className="rk-switch" aria-label="Risk sections">
      {TABS.map(t => <NavLink key={t.path} to={t.path} end title={t.title} className={({ isActive }) => `rk-seg${isActive ? ' on' : ''}`}>{t.label}</NavLink>)}
    </nav>
  )
}
