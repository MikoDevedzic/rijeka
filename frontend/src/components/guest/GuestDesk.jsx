// guest/GuestDesk.jsx — /guest: where a visitor with no account lands (lib/guest.js).
//
// The page opens the app's one ticket, as the blotter's + NEW TRADE does, and stays behind it: what a guest can do
// here, what an account adds, and the way to one. The ticket prices and runs XVA for a guest; BOOK asks for the
// account (store/useGuestStore, GuestAsk).
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import useBookingStore from '../../store/useBookingStore'
import './Guest.css'

export default function GuestDesk() {
  const navigate = useNavigate()
  const open = useBookingStore(s => s.open)
  const windows = useBookingStore(s => s.windows)

  // once, on arriving: the ticket is what the visitor came for
  useEffect(() => {
    if (!useBookingStore.getState().windows.length) useBookingStore.getState().open(null)
  }, [])

  return (
    <div className="gst-page" data-testid="guest-desk">
      <p className="gst-eyebrow">GUEST</p>
      <h1 className="gst-title">Price a trade and see what it costs to hold</h1>
      <p className="gst-lead">
        You are on the guest desk: no account, nothing to install. Fill in a ticket, press PRICE, and read the value, the
        risk and the XVA beside it. The rates here are synthetic; the method is the one in the methodology.
      </p>
      <div className="gst-rows">
        <section className="gst-row">
          <h3>AS A GUEST</h3>
          <ul>
            <li>Price swaps, options and forwards in rates, currencies and digital assets</li>
            <li>Run CVA, DVA, funding, capital and margin on the ticket</li>
            <li className="gst-desk">Read the methodology and the roadmap</li>
          </ul>
        </section>
        <section className="gst-row">
          <h3>WITH AN ACCOUNT (FREE)</h3>
          <ul>
            <li>Book the trade into a blotter of your own</li>
            <li>Confirm it on chain and keep the proof</li>
            <li>Download the Excel that reproduces each number</li>
          </ul>
        </section>
      </div>
      <div className="gst-actions">
        {windows.length === 0 && <button type="button" className="gst-go" data-action="guest-new-trade" onClick={() => open(null)}>+ NEW TRADE</button>}
        <button type="button" className={windows.length === 0 ? 'gst-quiet' : 'gst-go'} data-action="guest-signup" onClick={() => navigate('/signup')}>CREATE AN ACCOUNT</button>
        <button type="button" className="gst-quiet gst-desk" onClick={() => navigate('/methodology')}>READ THE METHODOLOGY</button>
      </div>
      <p className="gst-note">The guest desk is shared and small: a guest&rsquo;s simulation runs up to 2,000 paths, and what you price here is not kept.</p>
    </div>
  )
}
