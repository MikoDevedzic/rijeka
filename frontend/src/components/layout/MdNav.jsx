import { NavLink, useLocation } from 'react-router-dom'

const MD_ITEMS = [
  { label: 'Curves',    path: '/configurations/market-data/curves'    },
  { label: 'Surfaces',  path: '/configurations/market-data/surfaces'  },
  { label: 'Fixings',   path: '/configurations/market-data/fixings'   },
  { label: 'Snap',      path: '/configurations/market-data/snap'      },
  { label: 'Snapshots', path: '/configurations/market-data/snapshots' },
]

export default function MdNav() {
  const { pathname } = useLocation()
  return (
    <div style={{
      position: 'fixed',
      top: 'calc(var(--appbar-h) + var(--cfgnav-h))',
      left: 0, right: 0,
      height: 'var(--mdnav-h)', zIndex: 80,
      background: 'var(--panel-2)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: '2px',
    }}>
      {MD_ITEMS.map(item => {
        const active = pathname.startsWith(item.path)
        return (
          <NavLink key={item.path} to={item.path} style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '2px 9px', borderRadius: 2,
            textDecoration: 'none', fontSize: '11px',
            fontFamily:"'IBM Plex Mono',var(--mono)", letterSpacing: '0.04em',
            color: active ? 'var(--text-hi)' : 'var(--text)',
            borderBottom: active ? '1px solid var(--text-hi)' : '1px solid transparent',
          }}>
            {item.label}
          </NavLink>
        )
      })}
    </div>
  )
}
