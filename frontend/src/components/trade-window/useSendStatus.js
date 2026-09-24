// trade-window/useSendStatus.js
// Where a pending trade can go for countersignature, and sending it there (see
// SendForConfirmation.jsx). Follows the confirmation live: when the counterparty
// signs, the room gets a trade_event message, the chat store bumps that trade's
// cardVersion, and the status is fetched again.

import { useCallback, useEffect, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'

export function useSendStatus(tradeId, onConfirmed) {
  const { tradeSendStatus, sendTrade, show } = useChatStore()
  const version = useChatStore(s => (tradeId ? s.cardVersion[tradeId] : 0) || 0)
  const [status, setStatus] = useState(null)
  const [err, setErr] = useState(null)
  const [sending, setSending] = useState(false)

  const reload = useCallback(() => {
    if (!tradeId) return
    tradeSendStatus(tradeId).then(st => { setStatus(st); setErr(null) }).catch(e => setErr(e.message))
  }, [tradeId, tradeSendStatus])
  useEffect(() => { reload() }, [reload, version])
  useEffect(() => { if (status?.status === 'CONFIRMED') onConfirmed?.() }, [status?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setSending(true); setErr(null)
    try { await sendTrade(tradeId); reload() } catch (e) { setErr(e.message) } finally { setSending(false) }
  }
  const openInChat = () => { if (status?.sent?.[0]) show(status.sent[0].room_id) }
  return { status, err, sending, send, openInChat, reload }
}
