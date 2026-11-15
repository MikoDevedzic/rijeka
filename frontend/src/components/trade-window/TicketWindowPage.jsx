// trade-window/TicketWindowPage.jsx
//
// /ticket: a ticket in a browser window of its own, so it can sit on another screen while the blotter stays where
// it is (lib/windows.js popOutTicket). `?trade=<id>` shows that stored trade; without it the window is a new ticket.
// The ticket itself is the app's one TradeWindow, opened through the booking store as the blotter opens it; while
// this page is up, <html> carries `solo-ticket` and the ticket fills the window (styles.css). Closing the ticket
// closes the window.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useBookingStore from '../../store/useBookingStore'
import { useTradesStore } from '../../store/useTradesStore'
import { SOLO_TICKET_CLASS } from '../../lib/windows'
import { supabase } from '../../lib/supabase'

export default function TicketWindowPage() {
  const [params] = useSearchParams()
  const tradeId = params.get('trade')
  const [state, setState] = useState(tradeId ? 'loading' : 'open')        // loading | open | missing | closed

  useEffect(() => {
    document.documentElement.classList.add(SOLO_TICKET_CLASS)
    const was = document.title
    document.title = tradeId ? 'Rijeka · trade' : 'Rijeka · new trade'
    return () => { document.documentElement.classList.remove(SOLO_TICKET_CLASS); document.title = was }
  }, [tradeId])

  useEffect(() => {
    const { open, closeAll } = useBookingStore.getState()
    closeAll()                                           // this window holds one ticket
    let seen = false, dead = false
    // the ticket was closed: so is its window (a window the visitor opened by hand cannot be closed by the page)
    const unsub = useBookingStore.subscribe(s => {
      if (s.windows.length > 0) { seen = true; return }
      if (seen && !dead) { setState('closed'); window.close() }
    })
    const find = async () => {
      await useTradesStore.getState().fetchTrades({ quiet: true })
      return useTradesStore.getState().trades.find(t => String(t.id) === String(tradeId))
    }
    const load = async () => {
      // a new window has the sign-in of the window that opened it, but the client reads it a moment after the page
      // starts: a query sent before that is answered as if nobody were signed in, with no rows and no error
      await supabase.auth.getSession()
      let trade = await find()
      if (!trade && !dead) { await new Promise(r => setTimeout(r, 700)); trade = await find() }      // a trade booked this second
      if (dead) return
      if (!trade) { setState('missing'); return }
      open(trade)
      setState('open')
    }
    if (!tradeId) open(null)
    else load().catch(() => { if (!dead) setState('missing') })
    return () => { dead = true; unsub() }
  }, [tradeId])

  const say = state === 'loading' ? 'Opening the ticket…'
    : state === 'missing' ? 'This trade is not in your book.'
    : state === 'closed' ? 'The ticket is closed. You can close this window.' : null
  return <div className="tbw-solo-back" data-testid="ticket-window" data-state={state}>{say && <p>{say}</p>}</div>
}
