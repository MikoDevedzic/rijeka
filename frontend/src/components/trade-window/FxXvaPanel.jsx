// trade-window/FxXvaPanel.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// XVA for an FX or crypto forward: the same waterfall as the rates book
// (CVA / DVA / FVA / FBA / KVA / MVA under the chosen CSA), with the exposure
// profile from a lognormal forward at the pair's surface ATM vol (a desk override here), the simulated
// paths drawn behind the profiles as on the rates tab, and the on-chain comparison on the same paths.
// POST /api/xva/currency (backend/pricing/fx_xva.py).
// ────────────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import ExposureCanvas from './ExposureCanvas'
import IncrementalXva from './IncrementalXva'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const VA = [['NPV', 'npv'], ['CVA', 'cva'], ['DVA', 'dva'], ['FVA', 'fva'], ['FBA', 'fba'], ['KVA', 'kva'], ['MVA', 'mva'], ['ALL-IN', 'all_in']]
const COLOR = { npv: 'var(--text-hi)', cva: 'var(--red)', dva: 'var(--blue)', fva: 'var(--red)', fba: 'var(--blue)', kva: 'var(--red)', mva: 'var(--amber)', all_in: 'var(--accent)' }

const lbl = { fontSize: '0.8rem', letterSpacing: '0.12em', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }
const inp = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-hi)', fontFamily: 'var(--mono)', fontSize: '0.8125rem', padding: '4px 6px', width: '100%', outline: 'none' }
const secHdr = { fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--text)', fontFamily: 'var(--sans)', paddingLeft: 10, borderLeft: '3px solid var(--accent)', lineHeight: 1.2, margin: '14px 0 8px' }

export default function FxXvaPanel({ quote, counterpartyId, counterpartyName, buildTrade, tradeId }) {
  const payload = quote ? { pair: `${quote.base_currency}${quote.quote_currency}`, base_notional: quote.base_notional,
    settlement_date: quote.settlement_date, forward_rate: quote.forward_rate, direction: quote.direction } : null
  const [p, setP] = useState({ vol_pct: '', cp_cds_bp: 85, own_cds_bp: 42, ftp_bp: 55, lgd: 40, hurdle: 12, paths: 2000 })
  const [csa, setCsa] = useState('NO CSA')
  const [im, setIm] = useState(false)
  const [res, setRes] = useState(null)
  const [cmp, setCmp] = useState(null)           // the same run under the ON-CHAIN preset
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setP(s => ({ ...s, [k]: e.target.value }))

  const incremental = (
    <IncrementalXva counterpartyId={counterpartyId} counterpartyName={counterpartyName} buildTrade={buildTrade}
      tradeId={tradeId} priced={!!quote} ccy={quote?.quote_currency || 'USD'} />
  )

  const isOption = quote?.shape === 'OPTION'

  const run = async () => {
    if (!quote || !payload) return
    setBusy(true); setErr(null)
    try {
      const session = await getSessionMaybe()
      const common = {
        vol_pct: p.vol_pct === '' ? null : Number(p.vol_pct), paths: Number(p.paths) || 2000,
        cp_cds_bp: Number(p.cp_cds_bp), own_cds_bp: Number(p.own_cds_bp), ftp_bp: Number(p.ftp_bp),
        lgd: Number(p.lgd) / 100, own_lgd: Number(p.lgd) / 100, hurdle_rate: Number(p.hurdle) / 100,
        csa: csa === 'NO CSA' ? (im ? { preset: 'UNCOLLATERALISED', im_exchanged: true } : null)
          : csa === 'BILATERAL' ? { preset: 'BILATERAL', threshold_cp: 500000, mta: 100000, mpor_days: 10, im_exchanged: im }
          : { preset: 'ON_CHAIN', im_exchanged: im },
      }
      const body = isOption
        ? { trade: buildTrade?.(), ...common }
        : { pair: payload.pair, base_notional: Number(payload.base_notional), settlement_date: payload.settlement_date,
            forward_rate: payload.forward_rate ?? null, direction: payload.direction || 'BUY', ...common }
      if (isOption && !body.trade) throw new Error('Price the option first')
      const post = async (b) => {
        const r = await fetch(`${API}/api/xva/${isOption ? 'currency-option' : 'currency'}`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
        const j = await r.json()
        if (!r.ok) throw new Error(j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : `xva ${r.status}`)
        return j
      }
      setRes(await post(body))
      // the same forward, the same seed, under atomic settlement: the difference is the collateral terms alone
      setCmp(compare && csa !== 'ON-CHAIN' ? await post({ ...body, csa: { preset: 'ON_CHAIN', im_exchanged: im } }) : null)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const ccy = quote?.quote_currency || 'USD'

  return (
    <div className="tbw-no-drag" style={{ padding: '0 16px 16px', fontFamily: 'var(--sans)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        <div>
          <div style={secHdr}>{isOption ? 'OPTION ON THE PATHS' : 'FORWARD MODEL'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><div style={lbl}>VOL % (OVERRIDE)</div><input style={inp} value={p.vol_pct} placeholder={res?.params?.vol_pct != null ? String(res.params.vol_pct) : 'surface'} onChange={set('vol_pct')} /></div>
            <div><div style={lbl}>PATHS</div><input style={inp} value={p.paths} onChange={set('paths')} /></div>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-mute)', marginTop: 6, lineHeight: 1.4 }}>
            {isOption
              ? <>Lognormal spot at the option's vol; on every path the {quote?.style ? quote.style.replace(/_/g, ' ').toLowerCase() : 'option'} is valued with its closed form, the credit engine's model: before expiry the holder's value with the time left (barriers and touches carry which paths have knocked, monitored at the grid points; an American as its European, a lower bound), after it the payoff fixed and discounted to settlement. Bought: one-sided exposure after the premium. Vol from the pair's surface at the option's expiry and strike; type a number to override.</>
              : <>Lognormal forward, exposure ±N·(F<sub>t</sub> − K)·DF. Vol is the pair's surface at the forward's tenor (ATM); type a number to override. A pair without a surface uses the demo default, and the run says so.</>}
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: '0.78rem', color: 'var(--text-dim)' }} title="A second run on the same paths under the ON-CHAIN preset (continuous VM, 5bd MPoR); the difference is the collateral terms alone">
            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> Compare on-chain
          </label>
          <button onClick={run} disabled={busy || !quote} style={{ marginTop: 14, width: '100%', padding: '8px 0', fontFamily: 'var(--mono)', fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer',
            background: 'rgba(13,212,168,0.1)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 3 }}>
            {busy ? 'SIMULATING…' : !quote ? 'PRICE THE TICKET FIRST' : '▶ SIMULATE'}
          </button>
          {err && <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--red)' }}>{err}</div>}
        </div>
        <div>
          <div style={secHdr}>EXPOSURE · {ccy}</div>
          <ExposureCanvas result={res} height={230} />
          {res && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-mute)', fontFamily: 'var(--mono)', marginTop: 6 }}>
              {res.params.style ? res.params.style.replace(/_/g, ' ') + ' · ' : ''}vol {Number(res.params.vol_pct).toFixed(2)}% ({res.params.vol_source}) · {res.n_paths} paths · {res.steps} monthly steps · {res.sample_paths?.length || 0} paths drawn ({res.csa?.collateralised ? 'residual after collateral' : 'gross MtM'}) · IM weight {res.params.im_rw_per_pct} per 1% ({res.params.im_basis}) · CSA {res.csa?.preset}
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
      {cmp?.xva && res?.xva && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderTop: 0 }}>
          {VA.map(([, key]) => (
            <div key={key} style={{ background: 'var(--bg)', padding: '6px 10px' }}>
              <div style={{ ...lbl, color: 'var(--accent)' }}>{key === 'npv' ? 'ON-CHAIN' : ''}&nbsp;</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.875rem', fontWeight: 700, color: COLOR[key] }}>{fmt(cmp.xva[key])}</div>
              <div style={{ fontSize: '0.7rem', fontFamily: 'var(--mono)', color: 'var(--text-mute)' }}>{key === 'npv' ? '' : (cmp.xva[key] - res.xva[key] >= 0 ? '+' : '') + fmt(cmp.xva[key] - res.xva[key])}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: '0.7rem', color: 'var(--text-mute)', fontFamily: 'var(--mono)', marginTop: 6 }}>
        ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA · same waterfall and CSA model as the rates book · {ccy}
        {cmp && <> · ON-CHAIN row: the same {cmp.n_paths} paths under continuous VM and a {cmp.csa?.mpor_days}bd margin period; the difference is the collateral terms alone</>}
      </div>
      <div style={{ margin: '12px -16px 0', borderTop: '1px solid var(--border)' }}>{incremental}</div>
    </div>
  )
}
