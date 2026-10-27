// METHODOLOGY — every product, the formula behind it, and an Excel workbook that
// rebuilds the default trade from the user's own market data next to Rijeka's number.
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import './Docs.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

async function authed(path, opts = {}) {
  const s = await getSessionMaybe()
  return fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, ...(opts.headers || {}) } })
}

export default function Methodology() {
  const [products, setProducts] = useState(null)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { authed('/api/methodology/products').then(r => r.json()).then(setProducts).catch(e => setErr(e.message)) }, [])

  const download = async (p) => {
    setBusy(p.id); setErr(null)
    try {
      const r = await authed(`/api/methodology/${p.id}/replication.xlsx`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || `HTTP ${r.status}`)
      const blob = await r.blob()
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `rijeka_${p.id}_replication.xlsx`
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name })
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const groups = products ? [...new Set(products.map(p => p.group))] : []
  return (
    <div className="doc">
      <header className="doc-head">
        <h1>METHODOLOGY</h1>
        <p>No black boxes. For each product: the model, the default trade, and an Excel workbook that rebuilds that trade with live
           formulas from <b>your</b> latest market data, beside the value Rijeka's engine produced. Change a yellow cell and it reprices.
           The curve's discount factors come from Rijeka's bootstrap as values; everything after that is a formula you can read.</p>
      </header>
      {err && <div className="doc-err">{err}</div>}
      {!products && !err && <div className="doc-note">Loading…</div>}
      {groups.map(g => (
        <section key={g} className="doc-group">
          <h2>{g.toUpperCase()}</h2>
          <div className="doc-cards">
            {products.filter(p => p.group === g).map(p => (
              <article key={p.id} className="doc-card">
                <h3>{p.name}</h3>
                <div className="doc-row"><span>DEFAULT TRADE</span><p>{p.default}</p></div>
                <div className="doc-row"><span>FORMULA</span><p className="doc-formula">{p.formula}</p></div>
                <div className="doc-actions">
                  {p.replication === 'xlsx' && <button className="doc-btn" disabled={busy === p.id} onClick={() => download(p)}>{busy === p.id ? 'BUILDING…' : '⬇ EXPORT EXCEL REPLICATION'}</button>}
                  {p.replication === 'xlsx-static' && <a className="doc-btn" href={p.doc} target="_blank" rel="noopener noreferrer">⬇ TRACE WORKBOOK</a>}
                  {p.replication === 'doc' && <a className="doc-btn" href={`https://github.com/MikoDevedzic/rijeka/blob/main${p.doc}`} target="_blank" rel="noopener noreferrer">VALIDATION REPORT ↗</a>}
                  {p.replication === 'verifier' && <a className="doc-btn" href={p.doc} target="_blank" rel="noopener noreferrer">OPEN THE VERIFIER ↗</a>}
                  <a className="doc-link" href="https://github.com/MikoDevedzic/rijeka/tree/main/backend/pricing" target="_blank" rel="noopener noreferrer">SOURCE ↗</a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      <footer className="doc-foot">Model validation reports live in <code>model_validation/</code> and <code>docs/</code> in the repository. Apache-2.0.</footer>
    </div>
  )
}
