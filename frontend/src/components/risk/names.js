// risk/names.js — one sensitivity, one name and one sign on every screen.
//   a spot delta    FX01 on a currency, CRY01 on a digital asset (PV for +1% spot); never SPOT01, which is only the
//                   key a limit is stored under (SPOT01:<asset>)
//   a forward basis CRYBASIS01, the value for +1bp a year on a digital asset's forward basis; FUND01 was its first
//                   name and has the other sign (+1bp on the carry rate), so a report stored before the rename is
//                   read through `basis` and never printed as it was
// The home (home/trader-home.js) and the ticket (trade-window) name them so; the Risk pages read the names here.
import { spotMeasure, limitLabel } from '../home/trader-home'

export { spotMeasure, limitLabel }
// The basis figure of a report's row (`_total`) or of its ladder (`_usd`), as CRYBASIS01.
export const basis = (x, key = '_total') => {
  const now = x?.[`crybasis01${key}`], was = x?.[`fund01${key}`]
  return now != null ? Number(now) : was != null ? 0 - Number(was) : 0
}
// A limit's name without its scope (the row writes the scope beneath).
export const limitName = (metric, scenarios = []) => limitLabel({ metric }, scenarios)
