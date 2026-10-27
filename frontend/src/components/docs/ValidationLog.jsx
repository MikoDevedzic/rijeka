// Findings log — every independent validation finding, open and closed, read
// live from the public GitHub issues with the "validation" label. No backend.
import { useEffect, useState } from 'react'

const REPO = 'MikoDevedzic/rijeka'
const NEW  = `https://github.com/${REPO}/issues/new?template=validation_finding.yml`

export default function ValidationLog() {
  const [issues, setIssues] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/issues?labels=validation&state=all&per_page=50&sort=updated`,
          { headers: { Accept: 'application/vnd.github+json' } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`GitHub ${r.status}`)))
      .then(list => setIssues(list.filter(i => !i.pull_request)))
      .catch(e => setErr(e.message))
  }, [])
  const sev = (i) => (/\b(S[1-4])\b/.exec(i.title + ' ' + (i.body || ''))?.[1]) || ''
  const open = issues?.filter(i => i.state === 'open') || [], closed = issues?.filter(i => i.state !== 'open') || []
  return (
    <section className="vl">
      <header>
        <div>
          <h2>INDEPENDENT VALIDATION · FINDINGS LOG</h2>
          <p>Anyone can rebuild a Rijeka number outside Rijeka and file what they find. Every finding is answered in public and closed with the fixing commit or recorded as a known limitation. Confirmed S1 and S2 pricing findings carry a USD 250 bounty. Validators are named on the report; sponsors have no say over validation.</p>
        </div>
        <div className="vl-actions">
          <a className="doc-btn primary" href={NEW} target="_blank" rel="noopener noreferrer">FILE A FINDING ↗</a>
          <a className="doc-btn" href={`https://github.com/${REPO}/blob/main/docs/VALIDATION.md`} target="_blank" rel="noopener noreferrer">THE CHARTER ↗</a>
        </div>
      </header>
      {err && <div className="doc-note">Could not reach GitHub ({err}). The log is at github.com/{REPO}/issues?q=label:validation.</div>}
      {issues && (
        <div className="vl-cols">
          <div>
            <h3>OPEN · {open.length}</h3>
            <ul>{open.map(i => <Row key={i.id} i={i} sev={sev(i)} />)}{!open.length && <li className="vl-empty">Nothing open. Pick a product marked "validator wanted" in the charter and be the first.</li>}</ul>
          </div>
          <div>
            <h3>CLOSED · {closed.length}</h3>
            <ul>{closed.map(i => <Row key={i.id} i={i} sev={sev(i)} />)}{!closed.length && <li className="vl-empty">No findings closed yet.</li>}</ul>
          </div>
        </div>
      )}
    </section>
  )
}

function Row({ i, sev }) {
  const when = new Date(i.updated_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <li>
      <a href={i.html_url} target="_blank" rel="noopener noreferrer">{i.title.replace(/^\[validation\]\s*/i, '')}</a>
      <span className="vl-meta">{sev && <b className={`vl-sev ${sev.toLowerCase()}`}>{sev}</b>}#{i.number} · {i.user?.login} · {when}{i.comments ? ` · ${i.comments} comments` : ''}</span>
    </li>
  )
}
