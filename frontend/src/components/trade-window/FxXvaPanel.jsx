// trade-window/FxXvaPanel.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// XVA for an FX or crypto forward: the same waterfall as the rates book
// (CVA / DVA / FVA / FBA / KVA / MVA under the chosen CSA), with the exposure
// profile from a lognormal forward at a flat vol the desk sets.
// POST /api/xva/currency (backend/pricing/fx_xva.py).
// ────────────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import RateCurveCanvas from '../market-data/RateCurveCanvas'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const VA = [['NPV', 'npv'], ['CVA', 'cva'], ['DVA', 'dva'], ['FVA', 'fva'], ['FBA', 'fba'], ['KVA', 'kva'], ['MVA', 'mva'], ['ALL-IN', 'all_in']]
const COLOR = { npv: 'var(--text-hi)', cva: 'var(--red)', dva: 'var(--blue)', fva: 'var(--red)', fba: 'var(--blue)', kva: 'var(--red)', mva: 'var(--amber)', all_in: 'var(--accent)' }

const lbl = { fontSize: '0.8rem', letterSpacing: '0.12em', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }
const inp = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-hi)', fontFamily: 'var(--mono)', fontSize: '0.8125rem', padding: '4px 6px', width: '100%', outline: 'none' }
const secHdr = { fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--text)', fontFamily: 'var(--sans)', paddingLeft: 10, borderLeft: '3px solid var(--accent)', lineHeight: 1.2, margin: '14px 0 8px' }

export default function FxXvaPanel({ quote }) {
  const payload = quote ? { pair: `${quote.base_currency}${quote.quote_currency}`, base_notional: quote.base_notional,
    settlement_date: quote.settlement_date, forward_rate: quote.forward_rate, direction: quote.direction } : null
  const [p, setP] = useState({ vol_pct: '', cp_cds_bp: 85, own_cds_bp: 42, ftp_bp: 55, lgd: 40, hurdle: 12, paths: 2000 })
  const [csa, setCsa] = useState('NO CSA')
  const [im, setIm] = useState(false)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setP(s => ({ ...s, [k]: e.target.value }))

  const run = async () => {
    if (!quote || !payload) return
    setBusy(true); setErr(null)
    try {
      const session = await getSessionMaybe()
      const body = {
        pair: payload.pair, base_notional: Number(payload.base_notional), settlement_date: payload.settlement_date,
        forward_rate: payload.forward_rate ?? null, direction: payload.direction || 'BUY',
        vol_pct: p.vol_pct === '' ? null : Number(p.vol_pct), paths: Number(p.paths) || 2000,
        cp_cds_bp: Number(p.cp_cds_bp), own_cds_bp: Number(p.own_cds_bp), ftp_bp: Number(p.ftp_bp),
        lgd: Number(p.lgd) / 100, own_lgd: Number(p.lgd) / 100, hurdle_rate: Number(p.hurdle) / 100,
        csa: csa === 'NO CSA' ? (im ? { preset: 'UNCOLLATERALISED', im_exchanged: true } : null)
          : csa === 'BILATERAL' ? { preset: 'BILATERAL', threshold_cp: 500000, mta: 100000, mpor_days: 10, im_exchanged: im }
          : { preset: 'ON_CHAIN', im_exchanged: im },
      }
      const r = await fetch(`${API}/api/xva/currency`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : `xva ${r.status}`)
      setRes(j)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const dt = res?.dt || 1 / 12
  const series = res ? [
    { label: 'EE', color: '#0dd4a8', points: res.ee.map((v, i) => ({ t: (i + 1) * dt, v })) },
    { label: 'ENE', color: '#4a9ad4', dash: [5, 3], points: res.ene.map((v, i) => ({ t: (i + 1) * dt, v })) },
    { label: 'PFE 95%', color: '#f0a020', dash: [3, 2], points: res.pfe.map((v, i) => ({ t: (i + 1) * dt, v })) },
  ] : []
  const ccy = quote?.quote_currency || 'USD'

  return (
    <div className="tbw-no-drag" style={{ padding: '0 16px 16px', fontFamily: 'var(--sans)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        <div>
          <div style={secHdr}>FORWARD MODEL</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><div style={lbl}>VOL % (FLAT)</div><input style={inp} value={p.vol_pct} placeholder={res?.params?.vol_pct != null ? String(res.params.vol_pct) : 'default'} onChange={set('vol_pct')} /></div>
            <div><div style={lbl}>PATHS</div><input style={inp} value={p.paths} onChange={set('paths')} /></div>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-mute)', marginTop: 6, lineHeight: 1.4 }}>
            Lognormal forward, flat vol, exposure ±N·(F<sub>t</sub> − K)·DF. Leave blank for the demo default; there is no public vol surface for FX or digital assets.
          </div>
          <div style={secHdr}>SPREADS (BP) · LGD · HURDLE</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div><div style={lbl}>CP CDS</div><input style={inp} value={p.cp_cds_bp} onChange={set('cp_cds_bp')} /></div>
            <div><div style={lbl}>OWN CDS</div><input style={inp} value={p.own_cds_bp} onChange={set('own_cds_bp')} /></div>
            <div><div style={lbl}>FTP</div><input style={inp} value={p.ftp_bp} onChange={set('ftp_bp')} /></div>
            <div><div style={lbl}>LGD %</div><input style={inp} value={p.lgd} onChange={set('lgd')} /></div>
            <div><div style={lbl}>HURDLE %</div><input style={inp} value={p.hurdle} onChange={set('hurdle')} /></div>
          </div>
          <div style={secHdr}>SETTLEMENT</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['NO CSA', 'BILATERAL', 'ON-CHAIN'].map(k => (
              <button key={k} onClick={() => setCsa(k)} style={{ flex: 1, padding: '5px 0', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'var(--mono)', cursor: 'pointer', background: 'transparent', borderRadius: 2,
                border: csa === k ? '1px solid var(--accent)' : '1px solid var(--border)', color: csa === k ? 'var(--accent)' : 'var(--text-dim)' }}>{k}</button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            <input type="checkbox" checked={im} onChange={e => setIm(e.target.checked)} /> SIMM IM exchanged
          </label>
          <button onClick={run} disabled={busy || !quote} style={{ marginTop: 14, width: '100%', padding: '8px 0', fontFamily: 'var(--mono)', fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer',
            background: 'rgba(13,212,168,0.1)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 3 }}>
            {busy ? 'SIMULATING…' : !quote ? 'PRICE THE TICKET FIRST' : '▶ SIMULATE'}
          </button>
          {err && <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--red)' }}>{err}</div>}
        </div>
        <div>
          <div style={secHdr}>EXPOSURE · {ccy}</div>
          {res ? <RateCurveCanvas series={series} unit="" decimals={0} height={230} /> :
            <div style={{ height: 230, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--panel)', color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: '0.8125rem', letterSpacing: '0.08em' }}>
              EE / ENE / PFE — press SIMULATE
            </div>}
          {res && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-mute)', fontFamily: 'var(--mono)', marginTop: 6 }}>
              vol {res.params.vol_pct}% ({res.params.vol_source}) · {res.n_paths} paths · {res.steps} monthly steps · IM weight {res.params.im_rw_per_pct} per 1% ({res.params.im_basis}) · CSA {res.csa?.preset}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1, background: 'var(--border)', marginTop: 16, border: '1px solid var(--border)' }}>
        {VA.map(([k, key]) => (
          <div key={key} style={{ background: 'var(--bg)', padding: '8px 10px' }}>
            <div style={lbl}>{k}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.9375rem', fontWeight: 700, color: res ? COLOR[key] : 'var(--text-mute)' }}>{res ? fmt(res.xva[key]) : '—'}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-mute)', fontFamily: 'var(--mono)', marginTop: 6 }}>
        ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA · same waterfall and CSA model as the rates book · {ccy}
      </div>
    </div>
  )
}
