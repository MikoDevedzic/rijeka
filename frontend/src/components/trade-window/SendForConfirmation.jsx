// trade-window/SendForConfirmation.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Send a pending trade to its counterparty for countersignature, from the
// trade window. When the counterparty's firm is on Rijeka this is the real
// confirmation path: the card goes into your room with that firm (opened if
// needed), they countersign with their own wallet, and the trade confirms.
// Used by the unified window's CONFIRM tab and the legacy window's.
//
// The state comes from useSendStatus(tradeId) (useSendStatus.js), which also
// follows the confirmation live.
// ─────────────────────────────────────────────────────────────────────────────


const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace'

// The send block: the button before sending, the state after.
export function SendForConfirmation({ s, compact = false }) {
  const { status, err, sending, send, openInChat } = s
  if (!status) return err ? <div className="tbw-error">{err}</div> : null
  const cp = status.counterparty?.name || 'the counterparty'
  const sent = status.sent?.length > 0

  if (status.status === 'CONFIRMED') return null   // the parent shows the attestation
  if (!status.counterparty?.on_network) return compact ? null : (
    <div className="tbw-mut" style={{ fontSize: 11, lineHeight: 1.5, maxWidth: 520 }}>
      {status.reason} Their countersignature has to come from their own system: confirm below, or send them the
      confirmation request to sign with the command-line tool.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
      {sent ? (
        <>
          <div style={{ fontFamily: MONO, fontSize: 12, color: '#F5C842', letterSpacing: '0.04em' }}>
            ◆ SENT TO {cp.toUpperCase()} · AWAITING COUNTERSIGNATURE
          </div>
          <div className="tbw-mut" style={{ fontSize: 11, lineHeight: 1.5 }}>
            In <b style={{ color: '#F0F0F0' }}>{status.sent[0].room_title}</b>. They review the terms from their side, check them
            against their own booking, and sign with their firm's wallet. This tab updates when they do.
            {!status.counterparty.has_signer && ` ${cp} hasn't registered a signing wallet yet; they'll be asked to when they open the card.`}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="tbw-btn" onClick={openInChat} style={{ borderColor: 'rgba(0,212,168,0.4)', color: '#00D4A8' }}>OPEN IN CHAT →</button>
          </div>
        </>
      ) : (
        <>
          <button className="tbw-btn tbw-btn-book" disabled={sending || !status.can_send} onClick={send} style={{ alignSelf: 'flex-start' }}>
            {sending ? '⏳ SENDING…' : `◆ SEND TO ${cp.toUpperCase()} FOR COUNTERSIGNATURE`}
          </button>
          <div className="tbw-mut" style={{ fontSize: 11, lineHeight: 1.5 }}>
            {cp} is on Rijeka, so they sign for themselves: the trade goes to your chat with them as a card with the agreed terms
            (not your book or desk), they countersign with their own wallet, and it is anchored on-chain.
          </div>
        </>
      )}
      {err && <div className="tbw-error">{err}</div>}
    </div>
  )
}
