// home/WorldClock.jsx — the desks that matter, their local time, and whether
// their cash session is open (08:00–17:00 local, Monday to Friday).
import { useEffect, useState } from 'react'

const DESKS = [
  { city: 'SYDNEY',    tz: 'Australia/Sydney' },
  { city: 'TOKYO',     tz: 'Asia/Tokyo' },
  { city: 'FRANKFURT', tz: 'Europe/Berlin' },
  { city: 'LONDON',    tz: 'Europe/London' },
  { city: 'NEW YORK',  tz: 'America/New_York' },
]

function local(tz, now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false }).formatToParts(now)
  const get = t => parts.find(p => p.type === t)?.value || ''
  const h = Number(get('hour')) % 24, m = Number(get('minute'))
  const wd = get('weekday')
  const weekday = !['Sat', 'Sun'].includes(wd)
  const mins = h * 60 + m
  const open = weekday && mins >= 8 * 60 && mins < 17 * 60
  const soon = weekday && !open && mins >= 7 * 60 && mins < 8 * 60
  return { time: `${get('hour')}:${get('minute')}:${get('second')}`, day: wd.toUpperCase(), open, soon }
}

export default function WorldClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  return (
    <div className="dh-clocks" aria-label="Desk sessions">
      {DESKS.map(d => {
        const l = local(d.tz, now)
        return (
          <div key={d.city} className={`dh-clock${l.open ? ' open' : l.soon ? ' soon' : ''}`}>
            <span className="dh-clock-city">{d.city}</span>
            <span className="dh-clock-time">{l.time}</span>
            <span className="dh-clock-state"><i />{l.open ? 'OPEN' : l.soon ? 'PRE-OPEN' : 'CLOSED'} · {l.day}</span>
          </div>
        )
      })}
    </div>
  )
}
