// components/ErrorBoundary.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// One render error must never blank the desk. React only catches render-phase
// errors in a class component, so this is the single class in the app.
//
//   <ErrorBoundary scope="window" onReset={closeWindow}>   — a trade window
//   <ErrorBoundary scope="page"   resetKey={pathname}>     — a routed page
//   <ErrorBoundary scope="widget">                         — the messenger
//   <ErrorBoundary scope="tab">                            — a tab of a trade window whose code is fetched when it is
//                                                            first opened: the window and what is typed in it stay
//
// `resetKey` clears the error when it changes (navigating away heals a page).
// `onReset` is offered as the primary action when given (close the window).
//
// A file of code that did not arrive (lib/stale-build.js) is not an error of the page. The host is asked which build
// it serves. Another build than this tab's: the desk was updated while the window was open; with no trade window
// open and no message being typed the tab reloads by itself, once, and otherwise it says so and asks, since a reload
// throws those away. The same build, or no answer: the connection dropped or the file is missing; that is said as
// what it is, reported to the operator, and nothing reloads by itself.
// ────────────────────────────────────────────────────────────────────────────────────
import { Component } from 'react'
import Loading from './common/Loading'
import { report } from '../lib/errors'
import { RELOADED_KEY, buildMoved, isStaleBuild, loadWords, shouldReload, typedFields } from '../lib/stale-build'
import useBookingStore from '../store/useBookingStore'

const COPY = {
  window: { title: 'This window hit an error',  action: 'CLOSE WINDOW' },
  page:   { title: 'This page hit an error',    action: 'RELOAD' },
  widget: { title: 'The messenger hit an error', action: 'RELOAD' },
  tab:    { title: 'This tab hit an error',     action: 'RELOAD DESK' },
}
const SAFE = 'Nothing was booked or changed by this.'

function held() {
  let windows = 0
  try { windows = useBookingStore.getState().windows.length } catch { /* the store is not there: nothing is open */ }
  return { windows, typed: typedFields() }
}

export default class ErrorBoundary extends Component {
  state = { error: null, copied: false, build: null, holds: false }

  static getDerivedStateFromError(error) {
    return { error, copied: false, build: null, holds: false }
  }

  componentDidCatch(error, info) {
    if (isStaleBuild(error)) { this.ask(error, info); return }
    // The stack stays in the console for the user's bug report, and the message and
    // stack (never a token) go to the operator's error log (lib/errors.js).
    console.error('[rijeka] render error in', this.props.scope || 'app', error, info?.componentStack)
    report(error, 'boundary', { stack: `${error?.stack || ''}\n${info?.componentStack || ''}` })
  }

  // A file of code did not arrive: a release, or something else? The host says.
  ask = async (error, info) => {
    const moved = await buildMoved()
    if (this.state.error !== error) return                              // healed, or another error, while the host was asked
    const { windows, typed } = held()                                   // read after the answer: a window opened meanwhile counts
    const holds = windows > 0 || typed > 0
    if (moved !== true) {
      // not a release: the operator hears of it (a file missing from a deploy must not go unseen), nothing reloads
      console.error('[rijeka] a file did not arrive in', this.props.scope || 'app', error)
      report(error, 'boundary-load', { stack: `${error?.stack || ''}\n${info?.componentStack || ''}` })
      this.setState({ build: 'unreachable', holds })
      return
    }
    let last = NaN
    try { last = Number(window.sessionStorage.getItem(RELOADED_KEY)) || NaN } catch { /* no storage: reload once, then ask */ }
    if (shouldReload({ now: Date.now(), last, windows, typed })) {
      try { window.sessionStorage.setItem(RELOADED_KEY, String(Date.now())) } catch { /* as above */ }
      window.location.reload()
      return
    }
    this.setState({ build: 'moved', holds })
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, copied: false, build: null, holds: false })
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
    const stale = isStaleBuild(error)
    // while the host is asked what happened the page is, as far as anyone knows, still loading
    if (stale && !this.state.build) return scope === 'page' ? <Loading /> : null
    const moved = stale && this.state.build === 'moved'
    const load  = stale ? loadWords(scope, this.state.build, this.state.holds) : null
    const copy  = stale ? { title: load.title, action: 'RELOAD' } : COPY[scope] || COPY.page
    const msg   = (error?.message || String(error)).slice(0, 240)
    const inWindow = scope === 'window' || scope === 'tab'

    const card = (
      <div className="empty-state" role="alert" style={{ padding: '36px 24px', minHeight: inWindow ? 260 : '60vh' }}>
        <div className="empty-icon" style={{ color: 'var(--amber)' }}>⚠</div>
        <div className="empty-title" data-testid={stale ? (moved ? 'stale-build' : 'not-loaded') : undefined}>{copy.title}</div>
        <div className="empty-sub">
          {stale ? load.text
            : scope === 'tab' ? `${SAFE} The rest of the window works as it did; reloading the desk closes it, so book or note what is in it first.`
            : `${SAFE} Your blotter, market data and confirmations are safe on the server.`}
        </div>
        {!stale && <div style={{
          marginTop: 8, maxWidth: 420, padding: '8px 10px', borderRadius: 3,
          border: '1px solid var(--border-hi)', background: 'var(--panel)',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-dim)', textAlign: 'left',
          wordBreak: 'break-word',
        }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn" onClick={stale ? () => window.location.reload() : this.primary}
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#1b1403', fontWeight: 700, letterSpacing: '0.08em' }}>
            {copy.action}
          </button>
          {this.props.onReset && !stale && (
            <button className="btn" onClick={() => window.location.reload()} style={{ letterSpacing: '0.08em' }}>RELOAD DESK</button>
          )}
          {!moved && <button className="btn" onClick={this.copy} style={{ letterSpacing: '0.08em' }}>
            {this.state.copied ? 'COPIED' : 'COPY DETAILS'}
          </button>}
        </div>
        {!moved && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-mute)' }}>
          Paste the details to <a href="mailto:miko@rijeka.app" style={{ color: 'var(--accent)' }}>miko@rijeka.app</a> or the support room.
        </div>}
      </div>
    )

    // A trade window draws its own chrome, so when it throws there is no frame
    // left to sit in: float the card where the window was.
    if (scope === 'window') {
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(8,23,20,0.55)', backdropFilter: 'blur(2px)' }}>
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
