// components/common/Loading.jsx
// The one line shown while a lazily loaded page or tab's code is fetched (App.jsx,
// the trade window's XVA and scenario tabs). Terse and quiet, like the desk's other
// loading states; never a blank area.
export default function Loading({ label = 'LOADING...', style }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: '1.25rem 1.5rem', color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: '0.7rem', letterSpacing: '0.15em', ...style }}>
      {label}
    </div>
  )
}
