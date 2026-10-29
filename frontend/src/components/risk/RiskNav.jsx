// risk/RiskNav.jsx — the strip under RISK: MARKET RISK | COUNTERPARTY CREDIT
import { NavLink } from 'react-router-dom'

const TABS = [
  { label: 'MARKET RISK', path: '/risk', sub: 'ladder · VaR · stress · limits' },
  { label: 'COUNTERPARTY CREDIT', path: '/risk/ccr', sub: 'netting sets · PFE · CVA · credit limits' },
]

export default function RiskNav() {
  return (
    <nav className="rk-tabs" aria-label="Risk sections">
      {TABS.map(t => (
        <NavLink key={t.path} to={t.path} end className={({ isActive }) => `rk-tab${isActive ? ' on' : ''}`}>
          <span>{t.label}</span><small>{t.sub}</small>
        </NavLink>
      ))}
    </nav>
  )
}
