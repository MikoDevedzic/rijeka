// trade-window/useSendStatus.js
// Where a pending trade can go for countersignature, and sending it there (see
// SendForConfirmation.jsx). Follows the confirmation live: when the counterparty
// signs, the room gets a trade_event message, the chat store bumps that trade's
// cardVersion, and the status is fetched again.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { reconcileAnchor } from './booking'

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

// An anchor in flight: the confirm sent a transaction the block had not taken when the request
// returned (202). One check when the trade opens (a reload mid-anchoring picks it up) and one
// each time a confirm attempt ends; then every ANCHOR_POLL_MS while pending, for at most
// ANCHOR_MAX_MS. Returns null, { pending, tx_hash, explorer_tx, note }, { failed, reason } or
// { timedOut, tx_hash, explorer_tx }. onConfirmed fires once the CONFIRMED event is written.
export const ANCHOR_POLL_MS = 10_000
export const ANCHOR_MAX_MS = 10 * 60_000

export function useAnchoring(tradeId, confirming, onConfirmed) {
  const [anchor, setAnchor] = useState(null)
  const cb = useRef(onConfirmed); cb.current = onConfirmed
  const since = useRef(0)

  useEffect(() => {
    if (!tradeId || confirming) return
    let cancelled = false
    let timer = null
    const check = async () => {
      let r
      try { r = await reconcileAnchor(tradeId) }
      catch (e) { if (!cancelled) setAnchor(a => (a?.pending ? { ...a, note: e.message } : a)); return }
      if (cancelled) return
      if (r.applied || r.status === 'CONFIRMED') { clearInterval(timer); timer = null; since.current = 0; setAnchor(null); cb.current?.(); return }
      if (r.pending) {
        if (!since.current) since.current = Date.now()
        if (Date.now() - since.current > ANCHOR_MAX_MS) { clearInterval(timer); timer = null; setAnchor({ timedOut: true, tx_hash: r.tx_hash, explorer_tx: r.explorer_tx }); return }
        setAnchor({ pending: true, tx_hash: r.tx_hash, explorer_tx: r.explorer_tx, note: r.note })
        if (!timer) timer = setInterval(check, ANCHOR_POLL_MS)
        return
      }
      clearInterval(timer); timer = null; since.current = 0
      setAnchor(r.failed ? { failed: true, reason: r.reason } : null)
    }
    check()
    return () => { cancelled = true; clearInterval(timer) }
  }, [tradeId, confirming])

  return anchor
}

