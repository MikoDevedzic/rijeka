import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const SECTIONS = [
  {
    id: 'market-data',
    label: 'MARKET DATA',
    roles: ['viewer','trader','admin'],
    items: [{ label:'RATES CURVES', path:'/configurations/market-data/curves' }],
  },
  {
    id: 'infrastructure',
    label: 'INFRASTRUCTURE',
    roles: ['viewer','trader','admin'],
    items: [{ label:'ORG HIERARCHY', path:'/configurations/org-hierarchy' }],
  },
  {
    id: 'onboarding',
    label: 'ONBOARDING',
    roles: ['viewer','trader','admin'],
    items: [
      { label:'LEGAL ENTITIES',  path:'/configurations/legal-entities' },
      { label:'COUNTERPARTIES',  path:'/configurations/counterparties' },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    roles: ['admin'],
    items: [{ label:'USERS', path:'/configurations/users' }],
  },
]

export default function CfgNav() {
  const { profile } = useAuthStore()
  const [collapsed, setCollapsed] = useState({})
  const toggle = id => setCollapsed(s => ({ ...s, [id]: !s[id] }))
  const role = profile?.role || 'viewer'

  return (
    <nav style={{ width:'200px', minWidth:'200px', background:'var(--panel)', borderRight:'1px solid var(--border)', overflowY:'auto', padding:'1rem 0' }}>
      {SECTIONS.filter(s => s.roles.includes(role)).map(sec => {
        const isOpen = !collapsed[sec.id]
        return (
          <div key={sec.id} style={{ marginBottom:'0.25rem' }}>
            <button onClick={() => toggle(sec.id)} style={{
              width:'100%', background:'none', border:'none',
              padding:'0.45rem 1rem', display:'flex', alignItems:'center',
              justifyContent:'space-between', cursor:'pointer',
              fontFamily:'var(--mono)', fontSize:'0.58rem', fontWeight:700,
              letterSpacing:'0.14em',
              color: sec.id==='admin' ? 'var(--amber)' : 'var(--text-dim)',
            }}>
              <span>{sec.label}</span>
              <span style={{ fontSize:'0.55rem', opacity:0.6 }}>{isOpen?'▾':'▸'}</span>
            </button>
            {isOpen && sec.items.map(item => (
              <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
                display:'block', padding:'0.35rem 1rem 0.35rem 1.5rem',
                fontFamily:'var(--mono)', fontSize:'0.68rem', letterSpacing:'0.06em',
                color: isActive ? 'var(--accent)' : 'var(--text)',
                textDecoration:'none',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                transition:'all 0.12s',
              })}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
