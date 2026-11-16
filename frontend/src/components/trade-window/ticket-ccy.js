// trade-window/ticket-ccy.js — the currency a rates ticket's figures are in. The pricer answers in the trade's own
// currency; the ticket's formatters wrote "$" whatever it was, so a EUR swap's PV and IR01 stood under a dollar
// sign (a first-time visitor, 16 November 2026). The window says its currency once (TicketCcy) and every figure on
// it is written in that: "€" for EUR, "£", "¥", and the code itself for a currency with no sign of its own.
import { createContext } from 'react'

export const TicketCcy = createContext('USD')

const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
export const ccySign = (ccy) => SYM[ccy] ?? `${ccy} `

// A figure already written with a dollar sign, in the ticket's currency. Text that is not a string, and a dollar
// ticket, are returned as they are.
export const inCcy = (text, ccy) => (typeof text !== 'string' || !ccy || ccy === 'USD' ? text : text.replaceAll('$', ccySign(ccy)))
