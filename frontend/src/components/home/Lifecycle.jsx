// home/Lifecycle.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The LIFECYCLE card on the desk home: the globe (sessions, book, registry),
// chain health, what needs the trader's action, and the latest anchors with
// their proof links. Everything comes from GET /api/desk/lifecycle, refreshed
// every minute and on focus. With no anchors yet, the confirmation diagram
// explains what the ring will fill with.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import DeskGlobe from './DeskGlobe'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const REFRESH_MS = 60_000
const KIND = {
  COUNTERSIGN: ['SIGN', 'amber'], AWAITING: ['WAIT', ''], MATURITY: ['DUE', 'blue'],
  OFF_CHAIN: ['OFF-CHAIN', 'red'], WALLET: ['WALLET', 'amber'], NODE: ['NODE', 'red'],
}
const ago = (iso) => { if (!iso) return ''; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d` }
const short = (h) => h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—'
const eth = (v) => v == null ? '—' : `${Number(v).toFixed(v < 0.1 ? 4 : 3)} ETH`

export default function Lifecycle({ demo, empty, reducedMotion }) {
  const navigate = useNavigate()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const session = await getSessionMaybe()
        const r = await fetch(`${API}/api/desk/lifecycle`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
        if (!r.ok) throw new Error(`lifecycle ${r.status}`)
        const j = await r.json(); if (alive) { setD(j); setErr(null) }
      } catch (e) { if (alive) setErr(e.message) }
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', onFocus) }
  }, [])

  const chain = d?.chain, actions = d?.actions || [], anchors = d?.anchors || []
  const explorer = chain?.explorer || 'https://sepolia.etherscan.io'
  const go = (a) => { if (!a.href) return; a.href.startsWith('http') ? window.open(a.href, '_blank', 'noopener') : navigate(a.href) }

  return (
    <section className="dh-card dh-life">
      <header>
        <span>LIFECYCLE</span>
        <span className="dh-sub">
          {chain?.anchored ? <><i className={`lf-beat${chain.reachable === false ? ' bad' : ''}`} />{chain.network}</> : d ? 'OFF-CHAIN' : ''}
          <a className="dh-link" href="https://rijeka.app/verify" target="_blank" rel="noopener noreferrer">VERIFIER ↗</a>
        </span>
      </header>

      <DeskGlobe arcs={d?.arcs || []} home={d?.home} anchors={anchors} chain={chain} reducedMotion={reducedMotion} />

      <div className="lf-health">
        <div><span className="dh-kpi-l">BLOCK</span><b className={chain?.reachable === false ? 'bad' : ''}>{chain?.latest_block ? `#${Number(chain.latest_block).toLocaleString()}` : chain?.anchored ? 'NO NODE' : '—'}</b></div>
        <div><span className="dh-kpi-l">RELAYER</span><b className={chain?.relayer?.low ? 'warn' : ''} title={chain?.relayer?.address || ''}>{chain?.relayer ? eth(chain.relayer.balance_eth) : '—'}</b></div>
        <div><span className="dh-kpi-l">ANCHORED</span><b className={d?.counts?.anchored ? 'ok' : ''}>{d ? d.counts.anchored : '—'}</b></div>
        <div><span className="dh-kpi-l">REGISTRY</span><b>{chain?.registry ? <a href={`${explorer}/address/${chain.registry}`} target="_blank" rel="noopener noreferrer">{short(chain.registry)} ↗</a> : '—'}</b></div>
      </div>

      <div className="lf-block">
        <div className="lf-h"><span>NEEDS YOUR ACTION</span><span className={`lf-n${actions.length ? ' on' : ''}`}>{d ? actions.length : '…'}</span></div>
        {err && <div className="lf-empty">Could not load the desk feed ({err}).</div>}
        {d && !actions.length && <div className="lf-empty ok">Nothing waiting on you. Every booked trade is confirmed and anchored.</div>}
        <ul className="lf-list">
          {actions.slice(0, 5).map((a, i) => {
            const [chip, tone] = KIND[a.kind] || [a.kind, '']
            return (
              <li key={i} className={a.href ? 'go' : ''} onClick={() => go(a)}>
                <span className={`lf-chip ${tone}`}>{chip}</span>
                <span className="lf-t"><b>{a.title}</b><small>{a.detail}</small></span>
                <span className="lf-when">{a.since ? ago(a.since) : a.due ? '' : ''}</span>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="lf-block">
        <div className="lf-h"><span>RECENT ANCHORS</span>{anchors.length > 0 && <a className="dh-link" href="https://rijeka.app/verify" target="_blank" rel="noopener noreferrer">REGISTER ↗</a>}</div>
        {d && !anchors.length && <>
          {empty}
          <div className="dh-text">
            Both parties sign the canonical record; the registry keeps the hash and both addresses. Anyone can recompute and recover them without asking Rijeka. Your first confirmation launches onto the ring above.
            {demo?.enabled && <> Demo: Rijeka holds {demo.counterparty?.name || 'the demo bank'}'s key, so solo confirmations are marked <em>not bilateral</em>.</>}
          </div>
        </>}
        <ul className="lf-list anchors">
          {anchors.slice(0, 4).map((a, i) => (
            <li key={a.tx_hash || i}>
              <span className={`lf-chip ${a.anchored ? (a.bilateral ? 'ok' : '') : 'red'}`}>{a.anchored ? (a.bilateral ? 'BILATERAL' : 'ANCHORED') : 'OFF-CHAIN'}</span>
              <span className="lf-t"><b>{a.trade_ref}</b><small>{[a.product, a.counterparty].filter(Boolean).join(' · ')}{a.block_number ? ` · block ${Number(a.block_number).toLocaleString()}` : ''}</small></span>
              <span className="lf-when">{a.explorer_tx || a.tx_hash ? <a href={a.explorer_tx || `${explorer}/tx/${a.tx_hash}`} target="_blank" rel="noopener noreferrer">PROOF ↗</a> : ago(a.confirmed_at)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
