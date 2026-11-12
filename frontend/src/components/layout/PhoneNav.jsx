// The phone's navigation: a bar at the foot of the screen with the five things the phone view offers. Home and the
// trades are pages; NEW opens the trade window; CHAT opens the messenger over whatever is showing; NEWS is the
// headlines. P&L, risk, configurations and the methodology are not offered here: they are laid out for a monitor.
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import useBookingStore from '../../store/useBookingStore'
import { useChatStore, selectUnreadTotal } from '../../store/useChatStore'
import { usePhone } from '../../lib/phone'

const OFF = ['/login', '/signup', '/confirm', '/reset', '/terms', '/privacy', '/messenger']

export default function PhoneNav() {
  const phone = usePhone()
  const session = useAuthStore(s => s.session)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const chatOpen = useChatStore(s => s.open)
  const unread = useChatStore(selectUnreadTotal)
  if (!phone || !session || OFF.includes(pathname)) return null
  const closeChat = () => { if (useChatStore.getState().open) useChatStore.getState().close() }
  const go = (to) => () => { closeChat(); navigate(to) }
  const at = (p) => !chatOpen && pathname === p
  return (
    <nav className="ph-nav" aria-label="Rijeka">
      <button className={at('/command-center') ? 'on' : ''} aria-current={at('/command-center') ? 'page' : undefined} onClick={go('/command-center')}><i aria-hidden="true">⌂</i>HOME</button>
      <button className={at('/blotter') ? 'on' : ''} aria-current={at('/blotter') ? 'page' : undefined} onClick={go('/blotter')}><i aria-hidden="true">≡</i>TRADES</button>
      <button className="new" onClick={() => { closeChat(); useBookingStore.getState().open() }} aria-label="New trade"><i aria-hidden="true">+</i>NEW</button>
      <button className={chatOpen ? 'on' : ''} aria-pressed={chatOpen} onClick={() => useChatStore.getState().toggle()}><i aria-hidden="true">✦</i>CHAT{unread > 0 && <b className="ph-badge">{unread}</b>}</button>
      <button className={at('/news') ? 'on' : ''} aria-current={at('/news') ? 'page' : undefined} onClick={go('/news')}><i aria-hidden="true">◫</i>NEWS</button>
    </nav>
  )
}
