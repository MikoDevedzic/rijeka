export default function StubPage({ label, sprint, note }) {
  return (
    <div style={{
      paddingTop: 'calc(var(--appbar-h) + var(--cfgnav-h) + var(--mdnav-h))',
      height: '100%',
      display: 'flex', alignItems: 'center',
      justifyContent: 'center', flexDirection: 'column', gap: 8,
      color: 'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)",
    }}>
      <div style={{ fontSize: 13, color: 'var(--text)', letterSpacing: '0.06em' }}>{label}</div>
      {sprint && <div style={{ fontSize: 11 }}>Sprint {sprint}</div>}
      {note   && <div style={{ fontSize: 10, opacity: 0.6 }}>{note}</div>}
    </div>
  )
}
