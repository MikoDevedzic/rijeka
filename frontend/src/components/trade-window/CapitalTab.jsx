// trade-window/CapitalTab.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The CAPITAL tab: the trade's initial margin, exposure at default, RWA, capital, KVA,
// MVA and leverage exposure under every collateral regime and counterparty type, as the
// netting set with and without it (common random numbers) and standalone. Every cell
// opens a derivation: the formula, the regime's two CSAs, the counterparty inputs and the
// SA-CCR snapshot per trade and hedging set. POST /api/capital/trade.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { SectionHeader, ModelBadge, ProofExpander, VaFooter } from './xva-shared.jsx'
import { INP, LBL, LEFT_COL } from './xva-shared.js'
import { PRESETS, REGIME_LABEL, REGIME_DESC, DEFAULT_TYPES, buildGrid, buildRequest, derivation, disabledReason, errorMessage,
         fmtBp, fmtCell, mockResponse, quoteCells, regimeNames, typeKeys, FORMULA } from './capital'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const MOCK = false

const mono = { fontFamily: 'var(--mono)' }
const th = { ...mono, fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', fontWeight: 600, textAlign: 'right', padding: '5px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { ...mono, fontSize: '0.8125rem', color: 'var(--text-hi)', textAlign: 'right', padding: '4px 8px', whiteSpace: 'nowrap', cursor: 'pointer' }
const foot = { ...mono, fontSize: '0.7rem', color: 'var(--text-mute)', lineHeight: 1.5 }
// a chip is one block that never breaks inside its label; the rows wrap whole chips (flex-wrap)
const chip = (on) => ({ ...mono, fontSize: '0.7rem', letterSpacing: '0.06em', padding: '3px 7px', borderRadius: 2, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
  color: on ? 'var(--accent)' : 'var(--text-dim)', background: on ? 'rgba(13,212,168,0.08)' : 'transparent', display: 'inline-block', whiteSpace: 'nowrap', lineHeight: 1.3 })
const chipRow = { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }

export default function CapitalTab({ counterpartyId, counterpartyName, buildTrade, tradeId, priced, ccy = 'USD', hasRecordType = false }) {
  const [regimes, setRegimes] = useState(PRESETS)
  const [types, setTypes] = useState(DEFAULT_TYPES)
  const [typeKey, setTypeKey] = useState(DEFAULT_TYPES[0].key)
  const [view, setView] = useState('INCREMENTAL')
  const [hurdle, setHurdle] = useState('12')
  const [paths, setPaths] = useState(2000)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)            // {regime, key}
  const [open, setOpen] = useState(true)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  useEffect(() => { setRes(null); setErr(null); setSel(null) }, [counterpartyId, tradeId])

  const reason = busy ? null : disabledReason({ counterpartyId, priced, buildTrade, tradeId })
  const cpLabel = (counterpartyName || res?.counterparty || 'COUNTERPARTY').toUpperCase()
  const toggleRegime = (r) => setRegimes(rs => rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r])
  const toggleType = (t) => setTypes(ts => ts.some(x => x.key === t.key) ? ts.filter(x => x.key !== t.key) : [...ts, t])

  const run = async () => {
    if (busy || reason) return
    setBusy(true); setErr(null)
    try {
      // the counterparty's own regime (and its recorded type) always lead when a record exists
      const body = buildRequest({ counterpartyId, tradeId, buildTrade, regimes: counterpartyId ? [{ preset: 'CASH_GOVT', name: 'COUNTERPARTY' }, ...regimes] : regimes,
        types, hurdle, paths })
      if (counterpartyId) body.regimes = null        // the route derives the record's regime first, then the presets; the chips filter the view
      let j
      if (MOCK) { await new Promise(r => setTimeout(r, 500)); j = mockResponse() } else {
        const session = await getSessionMaybe()
        const r = await fetch(`${API}/api/capital/trade`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(errorMessage(r.status, j))
      }
      if (live.current) {
        setRes(j)
        const tk = typeKeys(j)
        if (tk.length && !tk.includes(typeKey)) setTypeKey(tk[0])
      }
    } catch (e) { if (live.current) setErr(e.message || String(e)) } finally { if (live.current) setBusy(false) }
  }

  const names = regimeNames(res).filter(n => n === 'COUNTERPARTY' || regimes.includes(n))
  const grid = buildGrid(res, typeKey, view)
  const quotes = quoteCells(res, typeKey)
  const drawer = sel ? derivation(res, sel.regime, typeKey, sel.key, view) : []
  const isNew = !tradeId

  return (
    <div className="tbw-no-drag" style={{ fontFamily: 'var(--sans)' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg)' }}>

        {/* LEFT PANEL */}
        <div style={{ ...LEFT_COL, overflowX: 'hidden' }}>
          <SectionHeader>COLLATERAL REGIMES</SectionHeader>
          <ModelBadge kind="muted">A regime is what the CSA admits and what each rulebook makes of it. The engine derives a regulatory CSA (recognised collateral at its haircut) and an economic CSA (what is exchanged) and runs both.</ModelBadge>
          <div style={chipRow}>
            {PRESETS.map(r => (
              <span key={r} style={chip(regimes.includes(r))} onClick={() => toggleRegime(r)} title={REGIME_DESC[r]}>{REGIME_LABEL[r]}</span>
            ))}
          </div>

          <SectionHeader>COUNTERPARTY TYPE</SectionHeader>
          <ModelBadge kind="muted">The risk weight (CRE20) and the CVA weight (MAR50.16) by type and grade; the record's own type leads when it is set.</ModelBadge>
          <div style={chipRow}>
            {DEFAULT_TYPES.map(t => (
              <span key={t.key} style={chip(types.some(x => x.key === t.key))} onClick={() => toggleType(t)}>{t.key}</span>
            ))}
          </div>

          <SectionHeader>ASSUMPTIONS</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 4, marginBottom: 6, alignItems: 'center' }}>
            <span style={LBL}>Hurdle %</span>
            <input type="text" inputMode="decimal" value={hurdle} onChange={e => setHurdle(e.target.value)} style={{ ...INP, textAlign: 'right' }} />
            <span style={LBL}>Paths</span>
            <input type="text" inputMode="numeric" value={paths} onChange={e => setPaths(e.target.value.replace(/[^0-9]/g, ''))} title="200 to 5,000 risk-neutral paths" style={{ ...INP, textAlign: 'right' }} />
          </div>
          <ModelBadge kind="muted">CDS, LGD and the funding spread are the credit engine's settings (Risk → Credit); the exposure paths are its risk-neutral paths, seed 7, so the figures tie to the book's reserves.</ModelBadge>

          <button onClick={run} disabled={busy || !!reason} title={reason || undefined}
            style={{ width: '100%', padding: '7px', ...mono, fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.1em', cursor: busy || reason ? 'default' : 'pointer',
              background: 'rgba(13,212,168,0.1)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 3, opacity: reason ? 0.45 : 1, marginBottom: 6 }}>
            {busy ? 'RUNNING…' : res ? 'RECOMPUTE' : '▶ CAPITAL UNDER EVERY REGIME'}
          </button>
          {reason && <div style={{ ...foot }}>— {reason}</div>}
          {busy && <div style={{ ...foot }}>the credit engine values the netting set with the trade, without it and alone, then every regime and type on the same paths…</div>}
          {err && <div style={{ ...mono, color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ flex: 1, padding: '10px 14px', overflow: 'auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ ...mono, fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--text)' }}>
              {isNew ? `INCREMENTAL CAPITAL · ${cpLabel}'S NETTING SET` : 'MARGINAL CAPITAL · REMOVING THIS TRADE'}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {['INCREMENTAL', 'STANDALONE'].map(v => <span key={v} style={chip(view === v)} onClick={() => setView(v)}>{v}</span>)}
            </div>
          </div>
          {res && (
            <div style={{ ...chipRow, marginBottom: 8 }}>
              {typeKeys(res).map(k => <span key={k} style={chip(typeKey === k)} onClick={() => setTypeKey(k)}>{k}</span>)}
            </div>
          )}

          {!res && !busy && (
            <div style={{ ...foot, fontSize: '0.78rem', lineHeight: 1.6, maxWidth: 720 }}>
              Columns are collateral regimes, rows are the regulatory and valuation quantities of this trade in the counterparty's netting set.
              The first column is the CSA as booked on the record; the others re-collateralise the same set. Click a cell for its derivation.
            </div>
          )}

          {res && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left' }}>{ccy}</th>
                      {names.map(n => <th key={n} style={th} title={REGIME_DESC[n]}>{REGIME_LABEL[n] || n}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map(r => (
                      <tr key={r.key} style={r.key === 'cost' ? { borderTop: '1px solid var(--border)' } : undefined}>
                        <td style={{ ...td, textAlign: 'left', color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.12em', fontWeight: r.key === 'cost' ? 700 : 600, cursor: 'help' }} title={FORMULA[r.key]}>{r.label}</td>
                        {names.map(n => {
                          const on = sel && sel.regime === n && sel.key === r.key
                          return (
                            <td key={n} onClick={() => { setSel({ regime: n, key: r.key }); setOpen(true) }}
                              style={{ ...td, fontWeight: r.key === 'cost' ? 700 : 400, color: on ? 'var(--accent)' : r.key === 'cost' ? 'var(--accent)' : 'var(--text-hi)',
                                background: on ? 'rgba(13,212,168,0.08)' : 'transparent' }}>
                              {fmtCell(r.cells[n], r.key, ccy)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...td, textAlign: 'left', color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.12em', fontWeight: 600, cursor: 'help' }} title="the regime's cost against the first column, amortised over the trade's annuity (running) or at the front (upfront), in bp of notional">QUOTE VS FIRST</td>
                      {names.map(n => {
                        const q = quotes[n]
                        return <td key={n} style={{ ...td, cursor: 'default', color: q && q.running_bp > 0 ? 'var(--accent)' : q && q.running_bp < 0 ? 'var(--red)' : 'var(--text-mute)' }}>{q ? `${fmtBp(q.running_bp)} run · ${fmtBp(q.upfront_bp)} up` : '—'}</td>
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12 }}>
                <ProofExpander title={sel ? `DERIVATION · ${REGIME_LABEL[sel.regime] || sel.regime} · ${(grid.find(r => r.key === sel.key) || {}).label || sel.key}` : 'DERIVATION · click a cell'} open={open && !!sel} onToggle={() => setOpen(o => !o)}>
                  {drawer.map((l, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)' }}>{l.h}</span>
                      <span style={{ ...mono, fontSize: '0.75rem', color: 'var(--text-hi)', lineHeight: 1.5 }}>{l.t}</span>
                    </div>
                  ))}
                </ProofExpander>
              </div>

              <div style={foot}>
                {res.measure || 'RISK_NEUTRAL'} · {res.n_paths?.toLocaleString?.() ?? res.n_paths} paths · seed {res.seed ?? 7} · {res.months} months
                {' · '}{res.other_trades ?? 0} other trade{res.other_trades === 1 ? '' : 's'} in the set · CDS {res.cp_cds_bp} bp · LGD {Math.round(100 * (res.lgd ?? 0.4))} % · hurdle {Math.round(100 * (res.hurdle ?? 0.12))} %
                {res.asof ? ` · as of ${res.asof}` : ''}{res.seconds != null ? ` · ${Number(res.seconds).toFixed(1)}s` : ''}
                {res.notes?.length ? <div style={{ marginTop: 4 }}>{res.notes.join(' · ')}</div> : null}
              </div>
            </>
          )}
        </div>
      </div>
      <VaFooter>
        Costs negative, exposures and capital as magnitudes. Every formula names its paragraph: Basel CRE20, CRE22, CRE52, MAR50, SCO60, LCR30; ISDA SIMM; CFTC §23.156. {hasRecordType ? 'The counterparty record sets the first type.' : ''}
      </VaFooter>
    </div>
  )
}
