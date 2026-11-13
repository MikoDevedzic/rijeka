// trade-window/PaperConfirmation.jsx — the sheet PAPER CONFIRMATION opens: the signed record as a page to print or
// save as a PDF (paper-confirmation.js says what is on it). It lies over the app as a dialog and is the only thing
// that prints while it is open (styles.css, @media print). It is a `.cert`, so its inks are the certificate's.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import CertMark from '../brand/CertMark'
import { chainName } from '../../lib/wallet'
import { paperOf } from './paper-confirmation'

// a record both of whose signatures Rijeka produced is not called signed by both parties, here or anywhere on the sheet
const signed = (p) => (p.demo ? 'Signed with demonstration keys' : 'Signed by both parties')
const STAMP = {
  anchored: (p) => [signed(p), `Anchored on ${chainName(p.record.chain)}`],
  signed: (p) => [signed(p), 'Not anchored on a registry'],
  closed: (p) => [signed(p), 'Anchored, since closed on the registry'],
}
const Rows = ({ rows }) => (
  <dl className="paper-rows">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="fig">{v}</dd></div>)}</dl>
)

export default function PaperConfirmation({ proof, names = {}, onClose }) {
  const p = paperOf(proof, names)
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('paper-open')
    const key = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => { root.classList.remove('paper-open'); window.removeEventListener('keydown', key) }
  }, [onClose])
  const r = p.record
  return createPortal(
    <div className="paper-view" role="dialog" aria-modal="true" aria-label={`Paper confirmation of ${p.ref}`} data-testid="paper-view">
      <div className="paper-bar">
        <span className="tbw-lbl">PAPER CONFIRMATION · {p.ref}</span>
        <span className="paper-bar-go">
          <button type="button" className="rj-btn" data-testid="paper-print" autoFocus onClick={() => window.print()}>PRINT OR SAVE AS PDF</button>
          <button type="button" className="rj-btn" data-testid="paper-close" onClick={onClose}>CLOSE</button>
        </span>
      </div>
      <article className="cert paper-sheet" data-testid="paper-confirmation" data-state={p.state}>
        <header className="paper-head">
          <div className="paper-top">
            <div className="paper-title">
              <CertMark hash={r.hash} stands={p.state === 'anchored'} still width={132} height={100} />
              <div>
                <p className="cert-caps">Trade confirmation</p>
                <h2 className="cert-title">{p.kind}</h2>
                {p.structure && <p className="paper-dim">{p.structure}</p>}
              </div>
            </div>
            <p className={`paper-stamp${p.state === 'anchored' ? '' : ' is-quiet'}`}>{STAMP[p.state](p).map(line => <span key={line}>{line}</span>)}</p>
          </div>
          <div className="paper-ids">
            <div><p className="cert-caps">Trade reference</p><span className="fig">{p.ref}</span></div>
            <div><p className="cert-caps">UTI</p><span className="fig">{p.uti}</span></div>
          </div>
        </header>
        {p.demo && <p className="paper-demo" data-testid="paper-demo">Both signatures on this record were produced by Rijeka, with keys it holds for the demonstration. It is not a confirmation between two parties.</p>}

        <section className="paper-sec"><p className="cert-caps">Parties</p>
          <div className="paper-two">
            {p.parties.map(x => (
              <div key={x.lei} className="paper-party">
                <p className="cert-caps">Party {x.letter}{x.role ? ` · ${x.role}` : ''}</p>
                {x.name && <b>{x.name}</b>}
                <span>LEI <span className="fig">{x.lei}</span></span>
              </div>
            ))}
          </div>
        </section>

        <section className="paper-sec"><p className="cert-caps">Trade</p><Rows rows={p.trade} /></section>
        {p.blocks.map(b => <section key={b.title} className="paper-sec"><p className="cert-caps">{b.title}</p><Rows rows={b.rows} /></section>)}

        <section className="paper-sec"><p className="cert-caps">The record</p>
          <Rows rows={[
            ['Record hash', r.hash],
            ['Signed as', `${r.form} · record schema v${r.schema}`],
            ...(r.chain != null ? [['Registry', `${r.registry} · ${chainName(r.chain)} (chain ${r.chain})`], ['Block', `${r.block}${r.at ? ` · ${r.at}` : ''}`], ['Transaction', r.tx]] : [['Registry', r.note]]),
            ...(r.closedTx ? [['Closed by', r.closedTx]] : []),
          ]} />
          <p className="paper-dim">Anyone holding this trade's proof pack can check the terms, both signatures and the registry at rijeka.app/verify, without Rijeka.</p>
        </section>

        <section className="paper-sec"><p className="cert-caps">Signatures</p>
          <div className="paper-two">
            {p.signatures.map(s => (
              <div key={s.label} className="paper-sig">
                <span><b>{s.label}</b>{s.name ? ` · ${s.name}` : ''}</span>
                <span>LEI <span className="fig">{s.lei}</span></span>
                <span>Signed with <span className="fig">{s.address}</span>{s.key ? `, ${s.key}` : ''}</span>
                <span className="paper-hex">{s.signature}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="paper-foot">
          <p>This sheet is produced from the record the parties signed, not from the booking as it stands today. It is evidence of the terms of this trade. It is not a master agreement and does not replace one: the agreement between the parties governs.</p>
          <p className="paper-made"><span>Produced by Rijeka{p.made ? ` · ${p.made}` : ''}</span><span>{p.ref}</span></p>
        </footer>
      </article>
    </div>, document.body)
}
