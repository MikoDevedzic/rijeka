// components/ErrorBoundary.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// One render error must never blank the desk. React only catches render-phase
// errors in a class component, so this is the single class in the app.
//
//   <ErrorBoundary scope="window" onReset={closeWindow}>   — a trade window
//   <ErrorBoundary scope="page"   resetKey={pathname}>     — a routed page
//   <ErrorBoundary scope="widget">                         — the messenger
//
// `resetKey` clears the error when it changes (navigating away heals a page).
// `onReset` is offered as the primary action when given (close the window).
// ────────────────────────────────────────────────────────────────────────────────────
import { Component } from 'react'
import { report } from '../lib/errors'

const COPY = {
  window: { title: 'This window hit an error',  action: 'CLOSE WINDOW' },
  page:   { title: 'This page hit an error',    action: 'RELOAD' },
  widget: { title: 'The messenger hit an error', action: 'RELOAD' },
}

export default class ErrorBoundary extends Component {
  state = { error: null, copied: false }

  static getDerivedStateFromError(error) {
    return { error, copied: false }
  }

  componentDidCatch(error, info) {
    // The stack stays in the console for the user's bug report, and the message and
    // stack (never a token) go to the operator's error log (lib/errors.js).
    console.error('[rijeka] render error in', this.props.scope || 'app', error, info?.componentStack)
    report(error, 'boundary', { stack: `${error?.stack || ''}\n${info?.componentStack || ''}` })
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, copied: false })
    }
  }

  details() {
    const e = this.state.error
    return [
      `Rijeka ${this.props.scope || 'app'} error`,
      `when: ${new Date().toISOString()}`,
      `where: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      `message: ${e?.message || String(e)}`,
      '',
      e?.stack || '',
    ].join('\n')
  }

  copy = async () => {
    try {
      await navigator.clipboard.writeText(this.details())
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 1800)
    } catch { /* clipboard blocked: the console has the same text */ }
  }

  primary = () => {
    if (this.props.onReset) this.props.onReset()
    else window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const scope = this.props.scope || 'page'
    const copy  = COPY[scope] || COPY.page
    const msg   = (error?.message || String(error)).slice(0, 240)

    const card = (
      <div className="empty-state" role="alert" style={{ padding: '36px 24px', minHeight: scope === 'window' ? 260 : '60vh' }}>
        <div className="empty-icon" style={{ color: 'var(--amber)' }}>⚠</div>
        <div className="empty-title">{copy.title}</div>
        <div className="empty-sub">
          Nothing was booked or changed by this. Your blotter, market data and confirmations are safe on the server.
        </div>
        <div style={{
          marginTop: 8, maxWidth: 420, padding: '8px 10px', borderRadius: 3,
          border: '1px solid var(--border-hi)', background: 'var(--panel)',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-dim)', textAlign: 'left',
          wordBreak: 'break-word',
        }}>{msg}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn" onClick={this.primary}
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#04120E', fontWeight: 700, letterSpacing: '0.08em' }}>
            {copy.action}
          </button>
          {this.props.onReset && (
            <button className="btn" onClick={() => window.location.reload()} style={{ letterSpacing: '0.08em' }}>RELOAD DESK</button>
          )}
          <button className="btn" onClick={this.copy} style={{ letterSpacing: '0.08em' }}>
            {this.state.copied ? 'COPIED' : 'COPY DETAILS'}
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-mute)' }}>
          Paste the details to <a href="mailto:miko@rijeka.app" style={{ color: 'var(--accent)' }}>miko@rijeka.app</a> or the support room.
        </div>
      </div>
    )

    // A trade window draws its own chrome, so when it throws there is no frame
    // left to sit in: float the card where the window was.
    if (scope === 'window') {
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(4,6,10,0.55)', backdropFilter: 'blur(2px)' }}>
          <div style={{ width: 560, maxWidth: 'calc(100vw - 32px)', border: '1px solid var(--border-hi)', borderRadius: 8,
            background: 'linear-gradient(180deg, var(--panel-2), var(--panel))', boxShadow: 'var(--shadow-panel)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)',
              fontSize: 12, letterSpacing: '0.18em', fontWeight: 700, color: 'var(--text)' }}>
              <span style={{ color: 'var(--amber)' }}>⚠</span> TRADE WINDOW
              <button className="btn" onClick={this.primary} style={{ marginLeft: 'auto', padding: '3px 8px' }}>✕</button>
            </div>
            {card}
          </div>
        </div>
      )
    }
    return card
  }
}
