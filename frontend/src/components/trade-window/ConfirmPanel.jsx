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
}) {
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

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

        <div className="tbw-mut" style={{
          fontSize: 11, lineHeight: 1.5, maxWidth: 520,
        }}>
          Confirming marks the trade as agreed with the counterparty and
          advances it to CONFIRMED. It will activate automatically on the
          effective date. Cancelling closes the trade without settlement —
          this is terminal and cannot be undone.
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="tbw-btn tbw-btn-book"
            disabled={confirming || cancelling}
            onClick={onConfirm}
          >
            {confirming
              ? '⏳ CONFIRMING...'
              : confirmErr
                ? '▶ RETRY CONFIRM'
                : '▶ CONFIRM TRADE'}
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
