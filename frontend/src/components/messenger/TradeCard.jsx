import { useCallback, useEffect, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { hasWallet, connect, ensureChain, signTypedData, personalSign, sameAddress, shortAddress } from '../../lib/wallet'
import './TradeCard.css'

// A trade shared into a room for confirmation. Everyone in the room sees the
// agreed terms; the counterparty checks them against their own book and
// countersigns with their own wallet. Rijeka never holds that key.

const CHAINS = { 1: 'Ethereum', 11155111: 'Sepolia', 31337: 'local test chain' }
const chainName = (id) => CHAINS[id] || `chain ${id}`

function num(n) {
  const x = Number(n)
  return Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n
}
const freq = (f) => (f || '').toLowerCase().replace('_', '-')

function LegLine({ l }) {
  const verb = l.you === 'PAY' ? 'You pay' : 'You receive'
  const what = l.leg_type === 'FIXED'
    ? `fixed ${l.rate}`
    : `${(l.index || 'float').replace(/_/g, ' ')}${l.spread_bp ? ` ${l.spread_bp > 0 ? '+' : ''}${l.spread_bp}bp` : ''}`
  const conv = [l.day_count, freq(l.frequency), l.reset && l.leg_type !== 'FIXED' ? `${freq(l.reset)} reset` : null].filter(Boolean).join(' · ')
  return <div className="tc-leg"><b>{verb} {what}</b><span> {conv}</span></div>
}

export default function TradeCard({ m }) {
  const { cardState, cardVersion, me } = useChatStore()
  const version = cardVersion[m.card.trade_id] || 0
  const [state, setState] = useState(null)
  const [err, setErr] = useState(null)
  const [signing, setSigning] = useState(false)

  const load = useCallback(() => {
    cardState(m.id).then(s => { setState(s); setErr(null) }).catch(e => setErr(e.message))
  }, [cardState, m.id])
  useEffect(() => { load() }, [load, version])

  const snap = m.card
  // The saved summary is written from the booker's side; anyone else waits for
  // the live state, which phrases the terms from their side.
  const iBooked = me?.firm?.id === snap.booker_firm_id
  const s = state?.summary || (iBooked ? snap.summary : null)
  const status = state?.status || snap.status_at_share

  return (
    <div className="tc">
      <div className="tc-head">
        <span className="tc-kind">TRADE</span>
        <span className="tc-ref">{snap.trade_ref}</span>
        <StatusChip state={state} status={status} snap={snap} />
      </div>
      <div className="tc-body">
        {s ? <>
          <div className="tc-line">
            {s.instrument?.replace('_', ' ')}{s.structure ? ' · ' + s.structure : ''} · <b>{s.ccy} {num(s.notional)}</b>
            {s.them?.name && <span className="tc-sub"> · with {s.them.name}</span>}
          </div>
          {s.legs?.map((l, i) => <LegLine key={i} l={l} />)}
          <div className="tc-dates">Trade {s.trade_date} · Effective {s.effective_date} · Maturity {s.maturity_date}</div>
        </> : !err && <div className="tc-sub">Loading terms…</div>}
        <div className="tc-hash" title="keccak256 of the agreed record — what both parties sign">
          hash {(state?.current_hash || snap.trade_hash).slice(0, 10)}…{(state?.current_hash || snap.trade_hash).slice(-6)}
        </div>
        {!state && snap.booker_firm && <div className="tc-sub">Terms as {snap.booker_firm} booked them.</div>}
        {err && <div className="tc-err">{err}</div>}

        {state?.changed_since_shared && (
          <div className="tc-warn">The booking changed after it was shared. The terms above are the current ones; check them again.</div>
        )}
        {state?.side === 'COUNTERPARTY' && status === 'PENDING' && <MatchBanner match={state.match} />}
        {state?.confirmation && (
          <div className="tc-confirmed">
            ✓ Confirmed by both parties{state.confirmation.anchored ? ` · ${chainName(state.confirmation.chain_id)} block ${num(state.confirmation.block_number)}` : ''}
            {state.confirmation.explorer_tx && <> · <a href={state.confirmation.explorer_tx} target="_blank" rel="noopener noreferrer">transaction ↗</a></>}
          </div>
        )}
        {state?.side === 'COUNTERPARTY' && status === 'PENDING' && state.can_act && (
          signing
            ? <Countersign messageId={m.id} state={state} onDone={() => { setSigning(false); load() }} onCancel={() => setSigning(false)} reload={load} />
            : <button className="tc-btn primary" onClick={() => setSigning(true)}>REVIEW &amp; COUNTERSIGN</button>
        )}
        {state?.side === 'BOOKER' && status === 'PENDING' && (
          <div className="tc-sub">Waiting for {state.cp_firm} to countersign.</div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ state, status, snap }) {
  if (status === 'CONFIRMED') return <span className="tc-chip ok">CONFIRMED</span>
  if (status === 'PENDING') return <span className="tc-chip pending">AWAITING {(state?.cp_firm || snap.cp_firm || '').toUpperCase()}</span>
  return <span className="tc-chip">{status}</span>
}

// Break values come as the record stores them; show rates as %, spreads as bp.
function breakValue(field, v) {
  if (v == null || v === '') return '—'
  const x = Number(v)
  if (Number.isFinite(x) && /fixed_rate/.test(field)) return `${+(x * 100).toFixed(6)}%`
  if (Number.isFinite(x) && /spread/.test(field)) return `${+(x * 10000).toFixed(4)}bp`
  if (Number.isFinite(x) && /notional/.test(field)) return num(x)
  return String(v)
}

function MatchBanner({ match }) {
  if (!match) return null
  if (match.status === 'MATCH') return <div className="tc-match ok">✓ Matches your booking {match.trade_ref}.</div>
  if (match.status === 'NO_BOOKING') return (
    <div className="tc-match none">No booking of this trade in your book. Check each term above before you sign.</div>
  )
  return (
    <div className="tc-match break">
      ✗ Breaks against your booking {match.trade_ref}:
      <table><tbody>
        {match.breaks.map((b, i) => <tr key={i}><td>{b.field}</td><td>shared <b>{breakValue(b.field, b.shared)}</b></td><td>yours <b>{breakValue(b.field, b.yours)}</b></td></tr>)}
      </tbody></table>
      Resolve these with the other side before signing.
    </div>
  )
}

function Countersign({ messageId, state, onDone, onCancel, reload }) {
  const { countersign } = useChatStore()
  const sg = state.signing || {}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [pasted, setPasted] = useState('')
  const [done, setDone] = useState(null)

  const submit = async (address, signature) => {
    setDone(await countersign(messageId, { address, signature, trade_hash: state.current_hash }))
    onDone()
  }
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }

  if (!sg.registered_address) {
    return (
      <div className="tc-sign">
        <div>Your firm hasn't registered a signing wallet for {sg.lei || 'its LEI'} yet.</div>
        {sg.can_register
          ? <WalletRegister onDone={reload} />
          : <div className="tc-sub">Ask your firm's admin to register one (✦ messenger → WALLET).</div>}
        <button className="tc-btn ghost" onClick={onCancel}>CANCEL</button>
      </div>
    )
  }

  const withWallet = () => run(async () => {
    const account = await connect()
    if (!sameAddress(account, sg.registered_address)) {
      throw new Error(`Your wallet is on ${shortAddress(account)}, but your firm signs with ${shortAddress(sg.registered_address)}. Switch account in your wallet.`)
    }
    await ensureChain(sg.chain_id)
    const signature = await signTypedData(account, sg.typed_data)
    await submit(account, signature)
  })

  const withPasted = () => run(async () => {
    let j
    try { j = JSON.parse(pasted) } catch { throw new Error('Paste the JSON the tool printed (it has address and signature).') }
    if (j.trade_hash && j.trade_hash.toLowerCase() !== state.current_hash.toLowerCase()) {
      throw new Error('That signature is for different terms (hash mismatch). Download the request again.')
    }
    await submit(j.address, j.signature)
  })

  const download = () => {
    const blob = new Blob([JSON.stringify(sg.request, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${state.trade_ref}-confirmation-request.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (done) return <div className="tc-confirmed">✓ Countersigned and anchored.</div>
  return (
    <div className="tc-sign">
      <div>
        You're signing the terms above as <b>{sg.request?.to?.name}</b> ({sg.lei}) with <b>{shortAddress(sg.registered_address)}</b>,
        on {chainName(sg.chain_id)}. Your signature and {state.booker_firm}'s together confirm the trade on-chain.
      </div>
      <div className="tc-digest">digest {sg.digest}</div>
      {err && <div className="tc-err">{err}</div>}
      <div className="tc-actions">
        <button className="tc-btn primary" disabled={busy || !hasWallet()} onClick={withWallet}
                title={hasWallet() ? '' : 'No browser wallet found'}>{busy ? 'SIGNING…' : 'SIGN WITH WALLET'}</button>
        <button className="tc-btn ghost" disabled={busy} onClick={onCancel}>CANCEL</button>
      </div>
      {!hasWallet() && <div className="tc-sub">No browser wallet found. Sign with your own tool instead:</div>}
      <details className="tc-own" open={!hasWallet()}>
        <summary>Sign with your own tool</summary>
        <ol>
          <li><button className="tc-btn ghost" onClick={download}>DOWNLOAD REQUEST</button></li>
          <li>Run <code>python chain/tools/countersign.py {state.trade_ref}-confirmation-request.json --key-file your.key</code>. It re-checks the hash and signs only if the terms match.</li>
          <li>Paste what it prints:</li>
        </ol>
        <textarea rows={4} value={pasted} onChange={e => setPasted(e.target.value)} placeholder='{"address": "0x…", "signature": "0x…", …}' />
        <button className="tc-btn primary" disabled={busy || !pasted.trim()} onClick={withPasted}>SUBMIT SIGNATURE</button>
      </details>
    </div>
  )
}

// A firm admin proves they control a wallet by signing a challenge with it;
// its address becomes the one Rijeka accepts for the firm's LEIs.
export function WalletRegister({ onDone }) {
  const { signerChallenge, registerSigner } = useChatStore()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(null)
  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const address = await connect()
      const { message } = await signerChallenge(address)
      const signature = await personalSign(address, message)
      const r = await registerSigner({ address, message, signature })
      setOk(r.address)
      onDone?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  if (ok) return <div className="tc-confirmed">✓ Registered {shortAddress(ok)} as your firm's signing wallet.</div>
  return (
    <div className="tc-register">
      <button className="tc-btn primary" disabled={busy || !hasWallet()} onClick={go}>{busy ? 'WAITING FOR WALLET…' : 'CONNECT WALLET & REGISTER'}</button>
      <span className="tc-sub">{hasWallet()
        ? 'Your wallet asks you to sign a short message. No funds move and it costs nothing.'
        : 'Needs a browser wallet such as MetaMask.'}</span>
      {err && <div className="tc-err">{err}</div>}
    </div>
  )
}

// Your firm's LEIs and the wallet each signs with.
export function WalletPanel() {
  const { signer } = useChatStore()
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => { signer().then(setInfo).catch(e => setErr(e.message)) }, [signer])
  useEffect(() => { load() }, [load])
  return (
    <div className="tc-wallet">
      <p>When a trade is shared with your firm, it is countersigned with the wallet registered here. Rijeka keeps only the
        wallet's public address; the key stays with you.</p>
      {err && <div className="tc-err">{err}</div>}
      {info?.leis.map(l => (
        <div key={l.lei} className="tc-wallet-row">
          <span className="tc-ref">{l.lei}</span>
          <span>{l.signing_address ? <b>{l.signing_address}</b> : <span className="tc-sub">no signing wallet</span>}</span>
        </div>
      ))}
      {info?.can_register
        ? <WalletRegister onDone={load} />
        : info && <div className="tc-sub">Only your firm's admin can register or change it.</div>}
    </div>
  )
}

// Pick one of your trades with the other firm in this room, and share it.
export function TradePicker({ roomId, onClose }) {
  const { shareableTrades, shareTrade } = useChatStore()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { shareableTrades(roomId).then(setData).catch(e => setErr(e.message)) }, [roomId, shareableTrades])
  const share = async (id) => {
    setBusy(true); setErr(null)
    try {
      const r = await shareTrade(roomId, id)
      if (r.already_shared) setErr('Already shared in this room: its card is above, with its live status.')
      else onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="tc-picker">
      <div className="tc-picker-head">
        <span>SHARE A TRADE{data ? ` WITH ${data.counterparty}` : ''}</span>
        <button className="ms-icon" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="tc-sub">They see the agreed terms only — not your book, desk or strategy.</div>
      {err && <div className="tc-err">{err}</div>}
      {!data && !err && <div className="tc-sub">Loading your trades…</div>}
      <div className="tc-picker-list">
        {data?.trades.map(t => (
          <button key={t.id} className="tc-pick" disabled={busy} onClick={() => share(t.id)}>
            <span className="tc-ref">{t.trade_ref}</span>
            <span>{(t.instrument || '').replace('_', ' ')} · {t.ccy} {num(t.notional)} · {t.maturity_date}</span>
            <span className={`tc-chip ${t.status === 'CONFIRMED' ? 'ok' : t.status === 'PENDING' ? 'pending' : ''}`}>{t.status}</span>
          </button>
        ))}
        {data && !data.trades.length && <div className="tc-sub">You have no trades with {data.counterparty}.</div>}
      </div>
    </div>
  )
}
