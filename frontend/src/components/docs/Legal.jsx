// Public legal pages (/terms, /privacy). Content lives in src/legal/*.js and is
// also rendered to the landing site by scripts/build_legal.mjs.
import { Link } from 'react-router-dom'
import { TERMS, TERMS_META } from '../../legal/terms'
import { PRIVACY, PRIVACY_META } from '../../legal/privacy'
import './Docs.css'

function Page({ meta, sections, other }) {
  return (
    <div className="legal">
      <header className="legal-head">
        <Link to="/login" className="legal-brand">RIJEKA</Link>
        <nav><Link to="/terms">TERMS</Link><Link to="/privacy">PRIVACY</Link><a href="https://rijeka.app">RIJEKA.APP</a></nav>
      </header>
      <main className="doc legal-body">
        <h1>{meta.title.toUpperCase()}</h1>
        <p className="legal-meta">Rijeka LLC · version {meta.version} · last updated {meta.updated}</p>
        {sections.map(s => (
          <section key={s.h}><h2>{s.h}</h2>{s.p.map((t, i) => <p key={i}>{t}</p>)}</section>
        ))}
        <footer className="doc-foot">See also the <Link to={other.path}>{other.label}</Link>. Questions: miko@rijeka.app</footer>
      </main>
    </div>
  )
}

export function Terms()   { return <Page meta={TERMS_META}   sections={TERMS}   other={{ path: '/privacy', label: 'Privacy Notice' }} /> }
export function Privacy() { return <Page meta={PRIVACY_META} sections={PRIVACY} other={{ path: '/terms',   label: 'Terms of Service' }} /> }
