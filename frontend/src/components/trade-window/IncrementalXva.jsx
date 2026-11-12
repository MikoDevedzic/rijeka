// trade-window/IncrementalXva.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The charge the desk quotes pre-trade: the counterparty's netting set valued with
// the new trade and without it by the credit engine that produces the book's
// reserves, same paths for both runs. Sits under the stand-alone number on the
// XVA tab of both the rates panel (xva-panel.jsx) and the FX / crypto panel
// (FxXvaPanel.jsx). POST /api/xva/incremental.
//
// New trade:    { counterparty_id, trade: <the booking body>, trade_id: null }
// Stored trade: { counterparty_id, trade_id }  → the marginal effect of removing it
//
// Signs as on the P&L page: costs negative, benefits positive
// (CVA −, DVA +, FVA −, FBA +, KVA −, MVA −).
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { fmtSigned, buildRows, disabledReason, buildRequest, errorMessage, eePoints, mockResponse } from './incremental-xva'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
// true: a plausible response after 600 ms and no server call (UI work without the route)
const MOCK = false

// ── component ─────────────────────────────────────────────────────────────────────
const mono = { fontFamily: 'var(--mono)' }
const th = { ...mono, fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', fontWeight: 600, textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid var(--border)' }
const td = { ...mono, fontSize: '0.8125rem', color: 'var(--text-hi)', textAlign: 'right', padding: '4px 8px', whiteSpace: 'nowrap' }
const foot = { ...mono, fontSize: '0.7rem', color: 'var(--text-mute)', marginTop: 6, lineHeight: 1.5 }

export default function IncrementalXva({ counterpartyId, counterpartyName, buildTrade, tradeId, priced, ccy = 'USD', buildTrades = null, legs = 0, legsKey = '' }) {
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  // A result belongs to one netting set: a new counterparty starts clean.
  useEffect(() => { setRes(null); setErr(null) }, [counterpartyId, tradeId, legsKey])

  const view = !!tradeId
  const reason = busy ? null : disabledReason({ counterpartyId, priced, buildTrade, tradeId })
  const cpLabel = (counterpartyName || res?.counterparty || 'COUNTERPARTY').toUpperCase()

  const run = async () => {
    if (busy || reason) return
    setBusy(true); setErr(null)
    try {
      const body = buildRequest({ counterpartyId, tradeId, buildTrade, buildTrades })
      let j
      if (MOCK) {
        await new Promise(r => setTimeout(r, 600))
        j = mockResponse({ counterpartyId, counterpartyName, tradeId })
      } else {
        const session = await getSessionMaybe()
        const r = await fetch(`${API}/api/xva/incremental`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(errorMessage(r.status, j))
      }
      if (live.current) setRes(j)
    } catch (e) {
      if (live.current) setErr(e.message || String(e))
    } finally {
      if (live.current) setBusy(false)
    }
  }

  const rows = buildRows(res)
  const ee = res?.ee
  const eeAll = ee ? [...(ee.without || []), ...(ee.with || [])].map(Number).filter(v => !isNaN(v)) : []
  const eeLo = eeAll.length ? Math.min(0, ...eeAll) : 0
  const eeHi = eeAll.length ? Math.max(...eeAll) : 1
  const peak = (xs) => xs?.length ? Math.max(...xs.map(Number)) : null

  return (
    <div className="tbw-sec tbw-no-drag" style={{ borderBottom: 'none' }}>
      {/* the heading and the button share a row, the sentence under them: closed, the block is short enough to sit
          under the results on a laptop without scrolling the window */}
      <div className="tbw-sec-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 0 }}>
        <div className="tbw-lbl" style={{ cursor: 'default', marginBottom: 0 }}>
          {view ? 'MARGINAL XVA · REMOVING THIS TRADE' : `INCREMENTAL XVA · ${cpLabel}'S NETTING SET`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="rj-press" onClick={run} disabled={busy || !!reason} title={reason || undefined}
            style={{ padding: '7px 14px', ...mono, fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.1em', cursor: busy || reason ? 'default' : 'pointer',
              background: 'rgba(217,178,92,0.1)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 3, opacity: reason ? 0.45 : 1 }}>
            {busy ? 'RUNNING…' : res ? 'RECOMPUTE' : legs > 1 && !view ? 'CHARGE THIS PACKAGE' : 'CHARGE THIS TRADE'}
          </button>
          {reason && <span style={{ ...mono, fontSize: '0.75rem', color: 'var(--text-mute)', letterSpacing: '0.04em' }}>— {reason}</span>}
          {busy && <span style={{ ...mono, fontSize: '0.75rem', color: 'var(--text-mute)' }}>credit engine valuing the netting set twice…</span>}
        </div>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-mute)', lineHeight: 1.45, marginTop: 6 }}>
        {legs > 1 && !view
          ? <>The credit engine's risk-neutral run with this package of {legs} legs and without it, same paths. This is the charge the desk would quote; the number above is the package on its own.</>
          : <>The credit engine's risk-neutral run with this trade and without it, same paths. This is the charge the desk would quote; the number above is the trade on its own.</>}
      </div>
      {err && <div className="tc-err" style={{ ...mono, color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}

      {res && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, alignItems: 'start' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>{ccy}</th>
                  <th style={th}>WITHOUT</th>
                  <th style={th}>WITH</th>
                  <th style={th}>INCREMENTAL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} style={r.total ? { borderTop: '1px solid var(--border)' } : undefined}>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.12em', fontWeight: r.total ? 700 : 600 }}>{r.label}</td>
                    <td style={{ ...td, fontWeight: r.total ? 700 : 400 }}>{fmtSigned(r.without, ccy)}</td>
                    <td style={{ ...td, fontWeight: r.total ? 700 : 400 }}>{fmtSigned(r.with, ccy)}</td>
                    <td style={{ ...td, fontWeight: 700, color: r.total ? 'var(--accent)' : 'var(--text-hi)', fontSize: r.total ? '0.9375rem' : '0.8125rem' }}>{fmtSigned(r.incremental, ccy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div>
              <div style={{ ...th, textAlign: 'left', padding: '4px 0', borderBottom: 'none' }}>EXPECTED EXPOSURE · {ccy}</div>
              <svg width="100%" height={70} viewBox="0 0 1000 100" preserveAspectRatio="none"
                style={{ display: 'block', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 2 }}>
                <polyline points={eePoints(ee?.without, eeLo, eeHi)} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
                <polyline points={eePoints(ee?.with, eeLo, eeHi)} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, ...foot, marginTop: 4 }}>
                <span>{ee?.grid?.[0] || ''}</span>
                <span>
                  <span style={{ color: 'var(--text-dim)' }}>– – WITHOUT</span> peak {fmtSigned(peak(ee?.without), ccy)}
                  {' · '}
                  <span style={{ color: 'var(--accent)' }}>— WITH</span> peak {fmtSigned(peak(ee?.with), ccy)}
                </span>
                <span>{ee?.grid?.[ee.grid.length - 1] || ''}</span>
              </div>
            </div>
          </div>

          <div style={foot}>
            {res.measure || 'RISK_NEUTRAL'} · {res.n_paths?.toLocaleString?.() ?? res.n_paths} paths · {res.months} months
            {' · '}CSA {res.csa?.preset || '—'}{res.csa?.mpor_days != null ? ` · MPoR ${res.csa.mpor_days}d` : ''}{res.csa?.im_exchanged ? ' · IM exchanged' : ''}
            {' · '}{res.other_trades ?? 0} other trade{res.other_trades === 1 ? '' : 's'} in the set
            {res.asof ? ` · as of ${res.asof}` : ''}{res.seconds != null ? ` · ${Number(res.seconds).toFixed(1)}s` : ''}
            {res.notes?.length ? <div>{res.notes.join(' · ')}</div> : null}
          </div>
        </div>
      )}
    </div>
  )
}
