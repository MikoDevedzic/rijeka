// trade-window/ConfirmPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Sprint 12 item 3: CONFIRM tab content (PENDING -> CONFIRMED | CANCELLED).
//
// Renders under the "◆ CONFIRM" tab in the unified trade shell. States:
//   1) No booked trade yet         -> empty-state hint
//   2) bookedTrade.status === 'PENDING'  -> two action buttons
//        * CONFIRM TRADE  (direct) -> calls onConfirm()
//        * CANCEL TRADE   (2-click with optional reason) -> calls onCancelTrade(reason|null)
//      2b) ANCHORING · tx … -> the confirm sent a transaction the block had not taken within the
//          API's wait (202); useAnchoring polls POST /api/chain/reconcile every 10 s (10 min at
//          most) and onRemoteConfirmed refreshes the window when the CONFIRMED event lands.
//   3) Terminal status (CONFIRMED/CANCELLED/LIVE/etc.) -> read-only badge
//
// All backend calls live in the parent (trade-window/booking.js confirmTrade
// and cancelTrade). This component is pure presentation + local dialog state.
//
// Design (Harbour): the signed record is a certificate, the one light surface in the app, because it is the part
// that leaves it (the proof pack, the picture someone posts): paper, a serif heading, and a seal drawn from the
// trade's hash (Seal.jsx). Inside `.cert` the colour tokens are the paper's inks (styles.css), so every row and
// button below takes them without naming a colour. Uses the same tbw-btn classes as the footer.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { SendForConfirmation } from './SendForConfirmation'
import { useSendStatus, useAnchoring } from './useSendStatus'
import { chainName } from '../../lib/wallet'
import Seal from './Seal'
import PartialTermination from './PartialTermination'
import KnockRecord from './KnockRecord'
import ConfirmMark from '../brand/ConfirmMark'
import { seedOf } from '../brand/mark'
import { confirmCaption, confirmPhase } from '../brand/confirm-phase'

const STATUS_COLORS = {
  PENDING:    'var(--text-hi)',     // waiting: no colour of its own
  CONFIRMED:  'var(--accent)',      // sealed
  CANCELLED:  'var(--text-dim)',
  LIVE:       'var(--up)',
  TERMINATED: 'var(--text-dim)',
  MATURED:    'var(--text-dim)',
  DEFAULTED:  'var(--down)',
  NOVATED:    'var(--purple)',
}

const MONO = 'var(--mono)'

const short = (h) => (h && h.length > 18) ? h.slice(0, 10) + '…' + h.slice(-6) : (h || '—')

/** Attestation block: what was signed, by whom, and where it is anchored. */
function AttestationView({ attestation, onVerify, verifying, verifyResult, onDownloadProof, onCopyProofLink, onTerminate, terminating, confirmErr }) {
  const [showTerminate, setShowTerminate] = useState(false)
  const [reason, setReason] = useState('')
  if (!attestation) return null
  const att = attestation.attestation
  const onChain = attestation.on_chain
  if (!att) return null
  const anchored = !!att.anchor?.anchored
  const terminated = !!att.terminated
  const tAnchor = att.termination?.anchor || {}
  const own = att.parties?.own || {}
  const cp  = att.parties?.counterparty || {}
  const row = (k, v, color) => (
    <div className="cert-row" style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, fontSize: 12, lineHeight: 1.7 }}>
      <span className="tbw-mut" style={{ letterSpacing: '0.06em' }}>{k}</span>
      <span style={{ fontFamily: MONO, color: color || 'var(--text-hi)', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
  const vr = verifyResult
  const vOk = vr && !vr.error && vr.hash_matches && vr.signatures_valid_for_current_state !== false && (!anchored || vr.on_chain_confirmed)
  // "Both sides" only where the record says so in as many words: a record without the field is read as not bilateral,
  // as the API reads it. A signed record with no anchor may never have one (no chain configured), so not "yet".
  const title = terminated ? 'The record is closed on chain'
    : anchored ? (att.bilateral === true ? 'Both sides signed the same terms' : 'The terms are signed and anchored')
    : 'The terms are signed, not anchored'
  return (
    <div className="cert" data-testid="confirm-certificate" style={{ marginTop: 18 }}>
      {/* the paper's stamp blue and red (styles.css .cert) for a record that stands on chain; grey, and without its centre point, for one that is not anchored or is closed */}
      <Seal hash={att.trade_hash} complete={anchored && !terminated} ink={anchored && !terminated ? '#2a3b98' : '#646b88'} ink2={anchored && !terminated ? '#bf261d' : '#646b88'} />
      <div className="cert-body">
      <p className="cert-caps">Certificate of confirmation</p>
      <h5 className="cert-title">{title}</h5>
      <div className="tbw-lbl" style={{ color: terminated ? 'var(--text-dim)' : anchored ? 'var(--accent)' : 'var(--text-dim)', marginBottom: 10 }}>
        {terminated ? `◆ TERMINATED ON ${chainName(att.anchor.chain_id).toUpperCase()}`
          : anchored ? `◆ CONFIRMED ON ${chainName(att.anchor.chain_id).toUpperCase()}` : '◇ SIGNED — NOT ANCHORED'}
        {att.bilateral === false && <span className="tbw-mut" style={{ marginLeft: 10, fontWeight: 400, letterSpacing: 0, color: 'var(--amber)' }}>both signatures produced here — demo, not bilateral</span>}
        <span className="tbw-mut" style={{ marginLeft: 10, fontWeight: 400, letterSpacing: 0 }}>
          canonical schema v{att.schema_version} · EIP-712 · {att.eip712?.name} v{att.eip712?.version}
        </span>
      </div>
      {att.package && row('PACKAGE', <span data-testid="cert-package">{att.package.trade_id} · leg {att.package.leg} of {att.package.of} · {anchored ? 'one record on chain for the package' : 'one signed record for the package'}</span>, 'var(--accent-hi)')}
      {att.package && row('PACKAGE HASH', <span data-testid="cert-package-hash">{att.package.hash}</span>)}
      {row(att.package ? 'THIS LEG\'S HASH' : 'TRADE HASH', att.trade_hash)}
      {att.prev_hash && row('SUPERSEDES', att.prev_hash + '  (amended — earlier signed record)', 'var(--amber)')}
      {row('BOOKED BY', `${own.lei || '—'} · ${short(own.address)} · sig ${short(own.signature)} (${own.key_source})`)}
      {row(att.bilateral === false ? 'COUNTERPARTY' : 'COUNTERSIGNED BY', `${cp.lei || '—'} · ${short(cp.address)} · sig ${short(cp.signature)} (${cp.key_source})`)}
      {anchored ? (<>
        {row('CHAIN', `${chainName(att.anchor.chain_id)} (chainId ${att.anchor.chain_id}) · registry ${short(att.anchor.registry)}`)}
        {row('TRANSACTION', att.anchor.explorer_tx
          ? <a href={att.anchor.explorer_tx} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{att.anchor.tx_hash}</a>
          : att.anchor.tx_hash)}
        {row('BLOCK', `${att.anchor.block_number} · ${att.anchor.confirmed_at ? new Date(att.anchor.confirmed_at * 1000).toISOString() : ''}`)}
        {onChain && row('ON-CHAIN STATUS', onChain.status, onChain.status === 'Confirmed' ? 'var(--accent)' : 'var(--amber)')}
        {terminated && tAnchor.tx_hash && row('TERMINATION TX', tAnchor.explorer_tx
          ? <a href={tAnchor.explorer_tx} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{tAnchor.tx_hash}</a>
          : tAnchor.tx_hash)}
        {terminated && tAnchor.block_number && row('TERMINATED AT', `block ${tAnchor.block_number}` + (att.termination?.reason ? ` · ${att.termination.reason}` : ''))}
      </>) : (
        row('ANCHOR', att.anchor?.note || 'No chain configured', 'var(--text-dim)')
      )}

      <div className="cert-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button className="tbw-btn cert-go" onClick={onVerify} disabled={verifying} style={{ flexShrink: 0, whiteSpace: 'nowrap', minWidth: 116 }}>
          {verifying ? '⏳ VERIFYING…' : '⟳ VERIFY'}
        </button>
        <button className="tbw-btn" onClick={onDownloadProof} style={{ flexShrink: 0, whiteSpace: 'nowrap', minWidth: 116, borderColor: 'var(--border-hi)' }}>
          ↓ PROOF PACK
        </button>
        {onCopyProofLink && (
          <button className="tbw-btn" onClick={onCopyProofLink} style={{ flexShrink: 0, whiteSpace: 'nowrap', minWidth: 116, borderColor: 'var(--border-hi)' }}>
            ⛓ COPY PROOF LINK
          </button>
        )}
        <span className="tbw-mut" style={{ fontSize: 12.5 }}>
          VERIFY recomputes the hash from the trade as stored now. PROOF PACK downloads
          everything a counterparty or auditor needs to check it themselves, without Rijeka.
        </span>
      </div>
      {vr && vr.info && <div className="tbw-mut" style={{ marginTop: 8, color: 'var(--accent)' }}>{vr.info}</div>}
      {anchored && !terminated && onTerminate && (
        <div style={{ marginTop: 12 }}>
          {!showTerminate ? (
            <button className="tbw-btn" onClick={() => setShowTerminate(true)} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
              ◆ TERMINATE ON-CHAIN
            </button>
          ) : (
            <div style={{ padding: 12, background: 'var(--bg)', border: '1px solid var(--red)', borderRadius: 'var(--r-2)', maxWidth: 520 }}>
              <div className="tbw-lbl" style={{ color: 'var(--red)' }}>TERMINATE — BOTH PARTIES SIGN, REGISTRY MARKS THE RECORD CLOSED</div>
              <div className="tbw-mut" style={{ fontSize: 12, lineHeight: 1.5, margin: '6px 0 10px' }}>
                Closes the signed record on-chain with a TradeTermination signature from each party. When the
                counterparty signs for themselves this needs their signature via the termination request; Rijeka
                signs both only if it holds their key.
              </div>
              <input type="text" placeholder="Reason (optional, stored in the event)" value={reason} onChange={e => setReason(e.target.value)} disabled={terminating}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-hi)', fontFamily: MONO, fontSize: 12, borderRadius: 2, outline: 'none', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="tbw-btn" onClick={() => { setShowTerminate(false); setReason('') }} disabled={terminating}>Dismiss</button>
                <button className="tbw-btn tbw-btn-cancel" onClick={() => onTerminate(reason.trim() || null)} disabled={terminating}>
                  {terminating ? '⏳ SIGNING & ANCHORING…' : '✓ TERMINATE'}
                </button>
              </div>
            </div>
          )}
          {confirmErr && <div className="tbw-error" style={{ maxWidth: 520, marginTop: 8 }}>{confirmErr}</div>}
        </div>
      )}
      {vr && !vr.info && (
        <div data-testid="confirm-verify-result" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 'var(--r-1)', fontSize: 12, fontFamily: MONO,
          background: 'var(--bg)', border: '1px solid ' + (vr.error ? 'var(--red)' : vOk ? 'var(--green)' : 'var(--amber)'),
          color: vr.error ? 'var(--red)' : vOk ? 'var(--green)' : 'var(--amber)', lineHeight: 1.7 }}>
          {vr.error ? ('Verify failed: ' + vr.error) : (<>
            <div>{vr.hash_matches ? '✔' : '✘'} hash of current terms {vr.hash_matches ? 'matches' : 'DOES NOT MATCH'} the signed hash</div>
            <div>{vr.signatures_valid_for_current_state ? '✔' : '✘'} both signatures {vr.signatures_valid_for_current_state ? 'valid' : 'INVALID'} for the current terms</div>
            {anchored && <div>{vr.on_chain_confirmed ? '✔' : '✘'} registry status: {vr.on_chain?.status || 'not found'}{vr.chain_error ? ' · ' + vr.chain_error : ''}</div>}
            <div className="tbw-mut" style={{ marginTop: 4 }}>recomputed {short(vr.recomputed_hash)} · stored {short(vr.stored_hash)}</div>
          </>)}
        </div>
      )}
      </div>
    </div>
  )
}

const TERMINAL_COPY = {
  CONFIRMED: 'Trade is confirmed. It will activate automatically on the effective date.',
  TERMINATED: 'Trade is terminated. Both parties signed the termination; the registry record is closed.',
  CANCELLED: 'Trade has been cancelled. This is terminal.',
  LIVE:      'Trade is live. Terminate or amend via their respective actions.',
}

function ConfirmBody({
  onAnchor = () => {},     // tells the panel whether a transaction is in flight or has failed (for the logo above)
  bookedTrade = null,
  confirming  = false,
  cancelling  = false,
  confirmErr  = null,
  cancelErr   = null,
  onConfirm   = () => {},
  onCopyProofLink = null,
  onCancelTrade = () => {},
  attestation = null,
  onVerify    = () => {},
  onDownloadProof = () => {},
  verifying   = false,
  verifyResult = null,
  onRemoteConfirmed = () => {},
  onTerminate = null,
  terminating = false,
  onPartial = null,       // (body) => Promise<boolean>: reduce the trade's notional (PartialTermination.jsx)
  partialBusy = false,
  partialErr = '',
  partialDone = null,
  onKnock = null,         // (body) => Promise<boolean>: record a barrier touched, never touched, or neither (KnockRecord.jsx)
  knockBusy = false,
  knockErr = '',
  pkg = null,             // the package this trade is a leg of: { tradeId, structure, n, legs: [trade, ...] } (fx-legs.js packageOf)
  pkgPending = false,     // every leg still PENDING: CONFIRM confirms the package as one record
}) {
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  // Counterparty on Rijeka: sending it to them for countersignature is the main action,
  // and the status follows their signature live (onRemoteConfirmed refreshes the window).
  const pendingId = bookedTrade?.status === 'PENDING' ? bookedTrade.id : null
  const send = useSendStatus(pendingId, onRemoteConfirmed)
  const cpOnNetwork = !!send.status?.counterparty?.on_network
  // A transaction in flight for this trade (a 202 from CONFIRM ON-CHAIN, or found again after a reload).
  const anchor = useAnchoring(pendingId, confirming, onRemoteConfirmed)
  const anchoring = !!anchor?.pending
  const anchorFailed = !!anchor?.failed || !!anchor?.timedOut      // not taken in time is not in progress either
  useEffect(() => { onAnchor({ pending: anchoring, failed: anchorFailed }) }, [anchoring, anchorFailed, onAnchor])

  // State 1: no booked trade
  if (!bookedTrade || !bookedTrade.id) {
    return (
      <div className="tbw-sec">
        <div className="tbw-lbl">TRADE LIFECYCLE</div>
        <div className="empty-state" style={{ padding: '36px 24px 28px' }}>
          <div className="empty-icon">◆</div>
          <div className="empty-title">Nothing to confirm yet</div>
          <div className="empty-sub">
            Price the ticket and press BOOK TRADE. The booked trade appears here with its canonical
            record, keccak256 hash and EIP-712 signatures, and this tab walks it to the Sepolia registry.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 }}>
            {['BOOK', 'SIGN', 'COUNTERSIGN', 'ANCHOR', 'PROOF LINK'].map((step, i, arr) => (
              <span key={step} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, letterSpacing: '0.12em', fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                <span style={{ padding: '3px 8px', border: '1px solid var(--border-hi)', borderRadius: 2,
                  background: 'var(--panel-2)', color: i === 0 ? 'var(--accent)' : 'var(--text-dim)' }}>{step}</span>
                {i < arr.length - 1 && <span style={{ color: 'var(--text-mute)' }}>›</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const status = bookedTrade.status
  const color  = STATUS_COLORS[status] || 'var(--text-hi)'

  // State 3: terminal — read-only status badge
  if (status !== 'PENDING') {
    return (
      <div className="tbw-sec">
        <div className="tbw-lbl">TRADE LIFECYCLE</div>
        <div style={{ padding: '20px 0' }}>
          <div className="tbw-lbl" style={{ fontSize: 12, marginBottom: 6 }}>
            STATUS
          </div>
          <div style={{
            fontSize: 22,
            fontFamily: 'var(--mono)',
            color,
            fontWeight: 500,
            letterSpacing: '0.05em',
          }}>
            {status}
          </div>

          {bookedTrade.trade_ref && (
            <div className="tbw-mut" style={{ marginTop: 10, fontSize: 12 }}>
              {pkg ? 'Leg ID' : 'Trade ref'}: {bookedTrade.trade_ref}
            </div>
          )}
          {pkg && (
            <div data-testid="confirm-package" data-legs={pkg.n} style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
              <span className="tbw-mut">Trade ID </span><span data-testid="confirm-package-id" style={{ fontFamily: MONO, color: 'var(--accent-hi)' }}>{pkg.tradeId}</span>
              <span className="tbw-mut"> · {pkg.structure.toLowerCase()} of {pkg.n} legs</span>
              <div data-testid="confirm-package-legs" className="tbw-mut" style={{ fontFamily: MONO }}>
                {pkg.legs.map(l => <span key={l.id} style={{ marginRight: 12, color: l.id === bookedTrade.id ? 'var(--text-hi)' : undefined }}>{l.trade_ref} {String(l.status || '').toLowerCase()}</span>)}
              </div>
            </div>
          )}

          <div className="tbw-mut" style={{
            marginTop: 16, fontSize: 12, lineHeight: 1.5, maxWidth: 520,
          }}>
            {TERMINAL_COPY[status] || ('Trade status is ' + status + '. No lifecycle actions available in this tab.')}
          </div>

          {(status === 'CONFIRMED' || status === 'TERMINATED') && (
            <AttestationView attestation={attestation} onVerify={onVerify} verifying={verifying}
              verifyResult={verifyResult} onDownloadProof={onDownloadProof} onCopyProofLink={onCopyProofLink}
              onTerminate={status === 'CONFIRMED' && attestation?.attestation && !attestation.attestation.package ? onTerminate : null} terminating={terminating} confirmErr={confirmErr} />
          )}
          {status === 'CONFIRMED' && (
            <PartialTermination trade={bookedTrade} pkg={pkg || (attestation?.attestation?.package ? {} : null)} terminated={!!attestation?.attestation?.terminated}
              anchored={!!attestation?.attestation?.anchor?.anchored} busy={partialBusy} error={partialErr} done={partialDone} onSubmit={onPartial} />
          )}
          {status === 'CONFIRMED' && <KnockRecord trade={bookedTrade} busy={knockBusy} error={knockErr} onSubmit={onKnock} />}
        </div>
      </div>
    )
  }

  // State 2: PENDING — offer CONFIRM and CANCEL
  return (
    <div className="tbw-sec">
      <div className="tbw-lbl">TRADE LIFECYCLE</div>

      <div style={{
        padding: '16px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}>
        <div>
          <div className="tbw-lbl" style={{ fontSize: 12, marginBottom: 6 }}>
            CURRENT STATUS
          </div>
          <div style={{
            fontSize: 22,
            fontFamily: 'var(--mono)',
            color,
            fontWeight: 500,
            letterSpacing: '0.05em',
          }}>
            PENDING
          </div>
          {bookedTrade.trade_ref && (
            <div className="tbw-mut" style={{ marginTop: 8, fontSize: 12 }}>
              {pkg ? 'Leg ID' : 'Trade ref'}: {bookedTrade.trade_ref}
            </div>
          )}
          {pkg && (
            <div data-testid="confirm-package" data-legs={pkg.n} style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
              <span className="tbw-mut">Trade ID </span><span data-testid="confirm-package-id" style={{ fontFamily: MONO, color: 'var(--accent-hi)' }}>{pkg.tradeId}</span>
              <span className="tbw-mut"> · {pkg.structure.toLowerCase()} of {pkg.n} legs</span>
              <div data-testid="confirm-package-legs" className="tbw-mut" style={{ fontFamily: MONO }}>
                {pkg.legs.map(l => <span key={l.id} style={{ marginRight: 12, color: l.id === bookedTrade.id ? 'var(--text-hi)' : undefined }}>{l.trade_ref} {String(l.status || '').toLowerCase()}</span>)}
              </div>
            </div>
          )}
        </div>

        <SendForConfirmation s={send} />

        <div className="tbw-mut" style={{
          fontSize: 12, lineHeight: 1.5, maxWidth: 520,
        }}>
          {cpOnNetwork
            ? 'Cancelling closes the trade without settlement — terminal and cannot be undone.'
            : pkgPending
              ? `CONFIRM confirms the whole package as one record: each of the ${pkg.n} legs keeps its own canonical record and hash, `
                + 'both legal entities sign (EIP-712) the package record that lists those hashes, and one transaction anchors it in the '
                + 'TradeConfirmationRegistry on Ethereum. Every leg is confirmed together, or none. Only the hash goes on-chain. '
                + 'Cancelling closes this leg without settlement — terminal and cannot be undone.'
              : 'CONFIRM builds the canonical trade record, has both legal entities sign its keccak256 hash (EIP-712), '
                + 'and anchors the pair of signatures in the TradeConfirmationRegistry on Ethereum. From that block both '
                + 'parties hold an identical, immutable record of the terms. Only the hash goes on-chain. Cancelling closes '
                + 'the trade without settlement — terminal and cannot be undone.'}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* Rijeka signing for both sides is only for a counterparty that can't sign for itself here. */}
          {!cpOnNetwork && (
            <button
              className="tbw-btn tbw-btn-book"
              disabled={confirming || cancelling || anchoring}
              onClick={() => onConfirm('chain')}
            >
              {confirming
                ? '⏳ SIGNING & ANCHORING...'
                : anchoring
                  ? `◆ ANCHORING · tx ${short(anchor.tx_hash)}`
                  : (confirmErr || anchor?.failed)
                    ? '▶ RETRY CONFIRM'
                    : pkgPending ? `◆ CONFIRM PACKAGE ON-CHAIN · ${pkg.n} LEGS, ONE RECORD` : '◆ CONFIRM ON-CHAIN'}
            </button>
          )}

          <button
            className="tbw-btn"
            disabled={confirming || cancelling || anchoring}
            onClick={() => onConfirm('offchain')}
            title="Status flip only — no signatures, nothing anchored"
          >
            CONFIRM OFF-CHAIN
          </button>

          <button
            className="tbw-btn tbw-btn-cancel"
            disabled={confirming || cancelling || anchoring}
            onClick={() => setShowCancelDialog(true)}
          >
            ▶ CANCEL TRADE
          </button>
        </div>

        {!anchoring && !confirming && (
          <PartialTermination trade={bookedTrade} pkg={pkg} busy={partialBusy} error={partialErr} done={partialDone} onSubmit={onPartial} />
        )}
        {!anchoring && !confirming && <KnockRecord trade={bookedTrade} busy={knockBusy} error={knockErr} onSubmit={onKnock} />}

        {anchoring && (
          <div style={{ padding: 12, background: 'var(--panel)', border: '1px solid rgba(233,151,90,0.4)', borderRadius: 2, maxWidth: 560 }}>
            <div className="tbw-lbl" style={{ color: 'var(--amber)' }}>◆ ANCHORING · TX {short(anchor.tx_hash)}</div>
            <div className="tbw-mut" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>
              Both signatures are made and the transaction is sent; the block has not taken it yet. This tab asks the
              server every 10 seconds and shows the attestation when it is mined. You can leave the tab or come back
              later: the server keeps following the transaction either way.
              {anchor.note ? ` ${anchor.note}.` : ''}
            </div>
            {anchor.tx_hash && (
              <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 12, wordBreak: 'break-all' }}>
                {anchor.explorer_tx
                  ? <a href={anchor.explorer_tx} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{anchor.tx_hash}</a>
                  : anchor.tx_hash}
              </div>
            )}
          </div>
        )}

        {anchor?.failed && !confirmErr && (
          <div className="tbw-error" style={{ maxWidth: 560 }}>
            Anchoring failed: {anchor.reason}. The trade stays PENDING; CONFIRM ON-CHAIN sends a new transaction.
          </div>
        )}

        {anchor?.timedOut && (
          <div className="tbw-error" style={{ maxWidth: 560 }}>
            Still waiting for the block after 10 minutes. The server keeps following the transaction
            {anchor.explorer_tx ? <> (<a href={anchor.explorer_tx} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{short(anchor.tx_hash)}</a>)</> : ''};
            reopen this tab to check again.
          </div>
        )}

        {confirmErr && (
          <div className="tbw-error" style={{ maxWidth: 520 }}>
            Confirm failed: {confirmErr}
          </div>
        )}

        {showCancelDialog && (
          <div style={{
            marginTop: 4,
            padding: 16,
            background: 'var(--panel)',
            border: '1px solid var(--red)',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxWidth: 520,
          }}>
            <div className="tbw-lbl" style={{ color: 'var(--red)' }}>
              CANCEL TRADE — TERMINAL ACTION
            </div>
            <div className="tbw-mut" style={{ fontSize: 12, lineHeight: 1.5 }}>
              This appends a CANCELLED event to the trade's event stream
              and sets status to CANCELLED permanently. Provide a reason
              below (optional, stored in the audit trail).
            </div>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              disabled={cancelling}
              style={{
                padding: '8px 10px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-hi)',
                fontFamily: 'var(--mono)',
                fontSize: 12,
                borderRadius: 2,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="tbw-btn"
                onClick={() => {
                  setShowCancelDialog(false)
                  setCancelReason('')
                }}
                disabled={cancelling}
              >
                Dismiss
              </button>
              <button
                className="tbw-btn tbw-btn-cancel"
                onClick={() => {
                  const reason = cancelReason.trim()
                  onCancelTrade(reason || null)
                }}
                disabled={cancelling}
              >
                {cancelling ? '⏳ CANCELLING...' : '✓ CONFIRM CANCELLATION'}
              </button>
            </div>
          </div>
        )}

        {cancelErr && (
          <div className="tbw-error" style={{ maxWidth: 520 }}>
            Cancel failed: {cancelErr}
          </div>
        )}
      </div>
    </div>
  )
}

// The logo is the picture of the confirmation (brand/ConfirmMark.jsx): the river runs while the trade is being
// signed and anchored, the R is drawn when the trade is confirmed, and its ring when the record is anchored on a
// chain. It sits above the panel's body and is ONE element across the panel's states, so the river that ran while
// the trade was PENDING is the one that completes. It appears only for a confirmation made on this trade while
// this ticket is open (brand/confirm-phase.js): a trade confirmed earlier shows its certificate and seal as
// before, and the panel starts afresh for each trade (the key), so nothing carries over to the next one booked.
function ConfirmFor(props) {
  const [anchor, setAnchor] = useState({ pending: false, failed: false })
  const [started, setStarted] = useState(false)          // a confirmation was asked for while this ticket was open
  const busy = !!props.confirming || anchor.pending
  if (busy && !started) setStarted(true)                 // remembered from an earlier render (React's own pattern for this)
  const phase = confirmPhase({ busy, started, status: props.bookedTrade?.status, failed: !!props.confirmErr || anchor.failed })
  const sealed = !!props.attestation?.attestation?.anchor?.anchored
  const caption = confirmCaption(phase, sealed)
  return (
    <>
      {phase && (
        <div className="tbw-sec" data-testid="confirm-mark-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <ConfirmMark phase={phase} sealed={sealed} seed={seedOf(String(props.bookedTrade?.id || ''))} />
          <div className="tbw-lbl" data-testid="confirm-mark-caption" aria-live="polite" style={{ color: phase === 'failed' ? 'var(--amber)' : undefined }}>{caption}</div>
        </div>
      )}
      <ConfirmBody {...props} onAnchor={setAnchor} />
    </>
  )
}

export function ConfirmPanel(props) {
  return <ConfirmFor key={props.bookedTrade?.id || 'none'} {...props} />
}
