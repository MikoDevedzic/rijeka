// trade-window/ConfirmPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Sprint 12 item 3: CONFIRM tab content (PENDING -> CONFIRMED | CANCELLED).
//
// Renders under the "◆ CONFIRM" tab in the unified trade shell. States:
//   1) No booked trade yet         -> empty-state hint
//   2) bookedTrade.status === 'PENDING'  -> two action buttons
//        * CONFIRM TRADE  (direct) -> calls onConfirm()
//        * CANCEL TRADE   (2-click with optional reason) -> calls onCancelTrade(reason|null)
//   3) Terminal status (CONFIRMED/CANCELLED/LIVE/etc.) -> read-only badge
//
// All backend calls live in the parent (trade-window/booking.js confirmTrade
// and cancelTrade). This component is pure presentation + local dialog state.
//
// Design: Pure Black theme. Amber for pending, teal for confirmed, red for
// cancelled. Uses the same tbw-btn-book / tbw-btn-cancel classes as the
// footer so the visual language matches.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { SendForConfirmation } from './SendForConfirmation'
import { useSendStatus } from './useSendStatus'

const STATUS_COLORS = {
  PENDING:    '#F5C842',  // amber
  CONFIRMED:  '#00D4A8',  // teal
  CANCELLED:  '#FF6B6B',  // red
  LIVE:       '#4A9EFF',  // blue
  TERMINATED: '#666666',
  MATURED:    '#666666',
  DEFAULTED:  '#FF6B6B',
  NOVATED:    '#9B8BB5',  // purple
}

const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace'

const short = (h) => (h && h.length > 18) ? h.slice(0, 10) + '…' + h.slice(-6) : (h || '—')

/** Attestation block: what was signed, by whom, and where it is anchored. */
function AttestationView({ attestation, onVerify, verifying, verifyResult, onDownloadProof }) {
  if (!attestation) return null
  const att = attestation.attestation
  const onChain = attestation.on_chain
  if (!att) return null
  const anchored = !!att.anchor?.anchored
  const own = att.parties?.own || {}
  const cp  = att.parties?.counterparty || {}
  const row = (k, v, color) => (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, fontSize: 11, lineHeight: 1.7 }}>
      <span className="tbw-mut" style={{ letterSpacing: '0.06em' }}>{k}</span>
      <span style={{ fontFamily: MONO, color: color || '#F0F0F0', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
  const vr = verifyResult
  const vOk = vr && !vr.error && vr.hash_matches && vr.signatures_valid_for_current_state !== false && (!anchored || vr.on_chain_confirmed)
  return (
    <div style={{ marginTop: 18, padding: 14, background: '#0C0C0C', border: '1px solid ' + (anchored ? 'rgba(0,212,168,0.35)' : '#2A2A2A'), borderRadius: 2, maxWidth: 720 }}>
      <div className="tbw-lbl" style={{ color: anchored ? '#00D4A8' : '#888', marginBottom: 8 }}>
        {anchored ? '◆ CONFIRMED ON ETHEREUM' : '◇ SIGNED — NOT ANCHORED'}
        <span className="tbw-mut" style={{ marginLeft: 10, fontWeight: 400, letterSpacing: 0 }}>
          canonical schema v{att.schema_version} · EIP-712 · {att.eip712?.name} v{att.eip712?.version}
        </span>
      </div>
      {row('TRADE HASH', att.trade_hash)}
      {row('OWN ENTITY', `${own.lei || '—'} · ${short(own.address)} · sig ${short(own.signature)} (${own.key_source})`)}
      {row('COUNTERPARTY', `${cp.lei || '—'} · ${short(cp.address)} · sig ${short(cp.signature)} (${cp.key_source})`)}
      {anchored ? (<>
        {row('CHAIN', `chainId ${att.anchor.chain_id} · registry ${short(att.anchor.registry)}`)}
        {row('TRANSACTION', att.anchor.explorer_tx
          ? <a href={att.anchor.explorer_tx} target="_blank" rel="noreferrer" style={{ color: '#4A9EFF' }}>{att.anchor.tx_hash}</a>
          : att.anchor.tx_hash)}
        {row('BLOCK', `${att.anchor.block_number} · ${att.anchor.confirmed_at ? new Date(att.anchor.confirmed_at * 1000).toISOString() : ''}`)}
        {onChain && row('ON-CHAIN STATUS', onChain.status, onChain.status === 'Confirmed' ? '#00D4A8' : '#F5C842')}
      </>) : (
        row('ANCHOR', att.anchor?.note || 'No chain configured', '#888')
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button className="tbw-btn" onClick={onVerify} disabled={verifying} style={{ borderColor: 'rgba(0,212,168,0.4)', color: '#00D4A8' }}>
          {verifying ? '⏳ VERIFYING…' : '⟳ VERIFY'}
        </button>
        <button className="tbw-btn" onClick={onDownloadProof} style={{ borderColor: '#2A2A2A' }}>
          ↓ PROOF PACK
        </button>
        <span className="tbw-mut" style={{ fontSize: 10.5 }}>
          VERIFY recomputes the hash from the trade as stored now. PROOF PACK downloads
          everything a counterparty or auditor needs to check it themselves, without Rijeka.
        </span>
      </div>
      {vr && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 2, fontSize: 11, fontFamily: MONO,
          background: vr.error ? 'rgba(255,107,107,0.06)' : vOk ? 'rgba(0,212,168,0.06)' : 'rgba(245,200,66,0.06)',
          border: '1px solid ' + (vr.error ? 'rgba(255,107,107,0.3)' : vOk ? 'rgba(0,212,168,0.3)' : 'rgba(245,200,66,0.3)'),
          color: vr.error ? '#FF6B6B' : vOk ? '#00D4A8' : '#F5C842', lineHeight: 1.7 }}>
          {vr.error ? ('Verify failed: ' + vr.error) : (<>
            <div>{vr.hash_matches ? '✔' : '✘'} hash of current terms {vr.hash_matches ? 'matches' : 'DOES NOT MATCH'} the signed hash</div>
            <div>{vr.signatures_valid_for_current_state ? '✔' : '✘'} both signatures {vr.signatures_valid_for_current_state ? 'valid' : 'INVALID'} for the current terms</div>
            {anchored && <div>{vr.on_chain_confirmed ? '✔' : '✘'} registry status: {vr.on_chain?.status || 'not found'}{vr.chain_error ? ' · ' + vr.chain_error : ''}</div>}
            <div className="tbw-mut" style={{ marginTop: 4 }}>recomputed {short(vr.recomputed_hash)} · stored {short(vr.stored_hash)}</div>
          </>)}
        </div>
      )}
    </div>
  )
}

const TERMINAL_COPY = {
  CONFIRMED: 'Trade is confirmed. It will activate automatically on the effective date.',
  CANCELLED: 'Trade has been cancelled. This is terminal.',
  LIVE:      'Trade is live. Terminate or amend via their respective actions.',
}

export function ConfirmPanel({
  bookedTrade = null,
  confirming  = false,
  cancelling  = false,
  confirmErr  = null,
  cancelErr   = null,
  onConfirm   = () => {},
  onCancelTrade = () => {},
  attestation = null,
  onVerify    = () => {},
  onDownloadProof = () => {},
  verifying   = false,
  verifyResult = null,
  onRemoteConfirmed = () => {},
}) {
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  // Counterparty on Rijeka: sending it to them for countersignature is the main action,
  // and the status follows their signature live (onRemoteConfirmed refreshes the window).
  const pendingId = bookedTrade?.status === 'PENDING' ? bookedTrade.id : null
  const send = useSendStatus(pendingId, onRemoteConfirmed)
  const cpOnNetwork = !!send.status?.counterparty?.on_network

  // State 1: no booked trade
  if (!bookedTrade || !bookedTrade.id) {
    return (
      <div className="tbw-sec">
        <div className="tbw-lbl">TRADE LIFECYCLE</div>
        <div style={{
          padding: '60px 40px',
          textAlign: 'center',
          color: '#555',
          fontSize: 12,
          fontStyle: 'italic',
          letterSpacing: '0.04em',
        }}>
          — book a trade first to confirm or cancel —
        </div>
      </div>
    )
  }

  const status = bookedTrade.status
  const color  = STATUS_COLORS[status] || '#F0F0F0'

  // State 3: terminal — read-only status badge
  if (status !== 'PENDING') {
    return (
      <div className="tbw-sec">
        <div className="tbw-lbl">TRADE LIFECYCLE</div>
        <div style={{ padding: '20px 0' }}>
          <div className="tbw-lbl" style={{ fontSize: 10, marginBottom: 6 }}>
            STATUS
          </div>
          <div style={{
            fontSize: 22,
            fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
            color,
            fontWeight: 500,
            letterSpacing: '0.05em',
          }}>
            {status}
          </div>

          {bookedTrade.trade_ref && (
            <div className="tbw-mut" style={{ marginTop: 10, fontSize: 11 }}>
              Trade ref: {bookedTrade.trade_ref}
            </div>
          )}

          <div className="tbw-mut" style={{
            marginTop: 16, fontSize: 11, lineHeight: 1.5, maxWidth: 520,
          }}>
            {TERMINAL_COPY[status] || ('Trade status is ' + status + '. No lifecycle actions available in this tab.')}
          </div>

          {status === 'CONFIRMED' && (
            <AttestationView attestation={attestation} onVerify={onVerify} verifying={verifying}
              verifyResult={verifyResult} onDownloadProof={onDownloadProof} />
          )}
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
          <div className="tbw-lbl" style={{ fontSize: 10, marginBottom: 6 }}>
            CURRENT STATUS
          </div>
          <div style={{
            fontSize: 22,
            fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
            color,
            fontWeight: 500,
            letterSpacing: '0.05em',
          }}>
            PENDING
          </div>
          {bookedTrade.trade_ref && (
            <div className="tbw-mut" style={{ marginTop: 8, fontSize: 11 }}>
              Trade ref: {bookedTrade.trade_ref}
            </div>
          )}
        </div>

        <SendForConfirmation s={send} />

        <div className="tbw-mut" style={{
          fontSize: 11, lineHeight: 1.5, maxWidth: 520,
        }}>
          {cpOnNetwork
            ? 'Cancelling closes the trade without settlement — terminal and cannot be undone.'
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
              disabled={confirming || cancelling}
              onClick={() => onConfirm('chain')}
            >
              {confirming
                ? '⏳ SIGNING & ANCHORING...'
                : confirmErr
                  ? '▶ RETRY CONFIRM'
                  : '◆ CONFIRM ON-CHAIN'}
            </button>
          )}

          <button
            className="tbw-btn"
            disabled={confirming || cancelling}
            onClick={() => onConfirm('offchain')}
            title="Status flip only — no signatures, nothing anchored"
          >
            CONFIRM OFF-CHAIN
          </button>

          <button
            className="tbw-btn tbw-btn-cancel"
            disabled={confirming || cancelling}
            onClick={() => setShowCancelDialog(true)}
          >
            ▶ CANCEL TRADE
          </button>
        </div>

        {confirmErr && (
          <div className="tbw-error" style={{ maxWidth: 520 }}>
            Confirm failed: {confirmErr}
          </div>
        )}

        {showCancelDialog && (
          <div style={{
            marginTop: 4,
            padding: 16,
            background: '#0C0C0C',
            border: '1px solid #FF6B6B',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxWidth: 520,
          }}>
            <div className="tbw-lbl" style={{ color: '#FF6B6B' }}>
              CANCEL TRADE — TERMINAL ACTION
            </div>
            <div className="tbw-mut" style={{ fontSize: 11, lineHeight: 1.5 }}>
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
                background: '#000',
                border: '1px solid #1E1E1E',
                color: '#F0F0F0',
                fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
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
