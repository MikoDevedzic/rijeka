// trade-window/paper-confirmation.js — a signed record as a sheet of paper: what PAPER CONFIRMATION prints.
//
// Everything on the sheet comes from the proof pack (GET /api/chain/proof/{id}): the record both parties signed, its
// hash, the two signatures and where it is anchored. Not from the booking as it stands today, so the paper cannot
// say a term the parties did not sign. A value is printed as the record holds it (a number is grouped in thousands
// and never rounded; a date is written out); a field the record leaves empty is left off. Names are not in the
// record (it holds each party's LEI), so a name is printed only where the caller knows it, beside the LEI.

const TESTNETS = new Set([11155111, 17000, 5, 31337])      // Sepolia, Holesky, Goerli, a local node
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const longDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso ?? '')
}
/** A number as the record holds it, grouped in thousands: no digit added, none dropped. */
export const grouped = (v) => {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(String(v ?? ''))
  return m ? `${m[1] === '-' ? '−' : ''}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] || ''}` : String(v ?? '')
}
/** A rate the record holds as a decimal, as a percentage: the point is moved two places in the text, so no digit is made or lost. */
export const pct = (v) => {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v ?? ''))
  if (!m) return String(v ?? '')
  const frac = (m[3] || '').padEnd(2, '0'), whole = (m[2] + frac.slice(0, 2)).replace(/^0+(?=\d)/, ''), rest = frac.slice(2).replace(/0+$/, '')
  return `${m[1] === '-' ? '−' : ''}${grouped(whole)}${rest ? '.' + rest : ''} %`
}
/** A moment written as the sheet writes its dates: "13 November 2026, 16:35 UTC". */
export const longStamp = (iso, seconds = false) => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/.exec(String(iso || ''))
  return m ? `${longDate(m[1])}, ${m[2]}${seconds && m[3] ? m[3] : ''} UTC` : String(iso ?? '')
}
const words = (k) => { const s = String(k).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }
const plain = (v) => String(v).replace(/_/g, ' ')

const KIND = {
  IR_SWAP: 'Interest rate swap', IR_SWAPTION: 'Interest rate swaption', INTEREST_RATE_CAP: 'Interest rate cap', INTEREST_RATE_FLOOR: 'Interest rate floor',
  INTEREST_RATE_COLLAR: 'Interest rate collar', NDF: 'Non-deliverable forward on a digital asset', NDO: 'Non-deliverable option on a digital asset',
  FX_FORWARD: 'Foreign exchange forward', FX_NDF: 'Non-deliverable foreign exchange forward', FX_SPOT: 'Foreign exchange spot',
  FX_OPTION: 'Foreign exchange option', FX_NDO: 'Non-deliverable foreign exchange option',
}
const LABEL = {
  digital_asset: 'Underlying', currency_pair: 'Currency pair', notional_amount: 'Notional', base_notional: 'Base notional', quote_notional: 'Quote notional',
  forward_price: 'Forward price', forward_rate: 'Forward rate', value_date: 'Value date', valuation_date: 'Valuation date', valuation_time: 'Valuation time',
  settlement_date: 'Settlement date', settlement_currency: 'Settlement currency', settlement_type: 'Settlement', settlement_price_source: 'Settlement price source',
  fixing_source: 'Fixing source', fixing_date: 'Fixing date', disruption_fallback: 'Disruption fallback', price_currency: 'Price currency',
  option_type: 'Option', strike: 'Strike', expiration_date: 'Expiration date', premium: 'Premium', premium_currency: 'Premium currency', premium_date: 'Premium date',
  day_count: 'Day count', payment_frequency: 'Payments', reset_frequency: 'Resets', bdc: 'Business day convention', payment_calendar: 'Payment calendar',
  payment_lag: 'Payment lag (business days)', fixed_rate: 'Fixed rate', spread: 'Spread', index: 'Floating rate', stub_type: 'Stub', leverage: 'Leverage',
  notional_type: 'Notional type', ois_compounding: 'Compounding', effective_date: 'Effective date', maturity_date: 'Termination date', currency: 'Currency',
  fixed_rate_type: 'Fixed rate type', spread_type: 'Spread type', calculation_agent: 'Calculation agent',
  fixed_rate_schedule: 'Fixed rate schedule', spread_schedule: 'Spread schedule', notional_schedule: 'Notional schedule',
}
const DATES = /(_date|^first_period_start|^last_period_end)$/
const RATES = new Set(['fixed_rate', 'spread'])
const NUMBERS = new Set(['notional', 'notional_amount', 'base_notional', 'quote_notional', 'forward_price', 'forward_rate', 'strike', 'premium'])
// a choice from a short list, held in capitals: printed as words. Anything else in capitals is a code and stays as it is.
const CHOICES = new Set(['bdc', 'payment_frequency', 'reset_frequency', 'stub_type', 'notional_type', 'settlement_type', 'option_type', 'fixed_rate_type',
  'spread_type', 'ois_compounding', 'style', 'exercise_style', 'barrier_type'])
const CHOICE = { MOD_FOLLOWING: 'Modified following', MOD_PRECEDING: 'Modified preceding', SEMI_ANNUAL: 'Semi-annual', NON_DELIVERABLE: 'Non-deliverable' }
// said elsewhere on the sheet: who buys and sells and who pays is under Parties and in each leg's heading
const LEFT_OFF = new Set(['product', 'buyer', 'seller', 'payer', 'receiver', 'leg_type'])
// a term at its plain default is left off; any other value of it is printed
const PLAIN = { leverage: '1', notional_type: 'BULLET', fixed_rate_type: 'FLAT', spread_type: 'FLAT' }

/** [text, kind] of one value, or null where the sheet says nothing: kind is 'word' for words, 'fig' for figures and codes. */
function shown(k, v) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null
  if (PLAIN[k] !== undefined && String(v) === PLAIN[k]) return null
  if (typeof v === 'object') return [JSON.stringify(v), 'fig']             // a schedule or an embedded option: as the record holds it
  if (DATES.test(k)) return [longDate(v), 'fig']
  if (RATES.has(k)) return [pct(v), 'fig']
  if (NUMBERS.has(k)) return [grouped(v), 'fig']
  if (CHOICES.has(k) && /^[A-Z][A-Z_]*$/.test(String(v))) return [CHOICE[v] || words(String(v).toLowerCase()), 'word']
  return [plain(v), /\s/.test(String(v)) && !/^[A-Z0-9_ /.:-]+$/.test(String(v)) ? 'word' : 'fig']
}
const rowsOf = (obj, skip = LEFT_OFF) => Object.entries(obj || {}).filter(([k]) => !skip.has(k))
  .map(([k, v]) => { const s = shown(k, v); return s && [LABEL[k] || words(k), s[0], s[1]] }).filter(Boolean)
const legWord = (l) => (l.leg_type === 'FIXED' ? 'fixed' : l.leg_type === 'FLOAT' ? 'floating' : plain(String(l.leg_type || 'leg')).toLowerCase())
const zero = (v) => v !== null && v !== undefined && v !== '' && Number(v) === 0
/** A leg's rows. A zero that is only the absence of the thing (the fixed rate of a floating leg) is left off; a spread of zero on a floating leg is a term and stays. */
const legRows = (l) => rowsOf(l, new Set([...LEFT_OFF, 'effective_date', 'maturity_date', ...(l.leg_type !== 'FIXED' && zero(l.fixed_rate) ? ['fixed_rate'] : []),
  ...(l.leg_type === 'FIXED' && zero(l.spread) ? ['spread'] : [])]))

/** The sheet: {kind, ref, uti, state, demo, parties, trade, blocks, record, signatures, made}. `names` is {LEI: name}. */
export function paperOf(proof, names = {}) {
  const rec = proof?.canonical || {}, att = proof?.attestation || {}, t = rec.trade || {}, prod = rec.product || null
  const legs = (rec.legs || []).filter(l => l && typeof l === 'object')        // a package's record lists its legs by hash: those are not legs to print
  const anchor = att.anchor || {}, closed = !!att.termination, anchored = !!anchor.anchored
  const role = {}
  if (prod) { if (prod.buyer) role[prod.buyer] = 'Buyer'; if (prod.seller) role[prod.seller] = 'Seller' }
  for (const l of legs) if (l.payer && !role[l.payer]) role[l.payer] = `Pays ${legWord(l)}`
  const parties = (rec.parties || []).map((lei, i) => ({ letter: 'AB'[i] || String(i + 1), lei, name: names[lei] || null, role: role[lei] || null }))
  const letterOf = (lei) => { const p = parties.find(x => x.lei === lei); return p ? `Party ${p.letter}` : lei }
  const trade = [['Notional', `${grouped(t.notional)} ${t.notional_ccy || ''}`.trim()], ['Trade date', longDate(t.trade_date)],
    ['Effective date', longDate(t.effective_date)], ['Termination date', longDate(t.maturity_date)]].filter(([, v]) => v).map(([k, v]) => [k, v, 'fig'])
  const blocks = []
  if (prod) blocks.push({ title: 'Terms', rows: rowsOf(prod) })
  legs.forEach((l, i) => blocks.push({ title: `Leg ${i + 1} · ${legWord(l)} · ${letterOf(l.payer)} pays ${letterOf(l.receiver)}`, rows: legRows(l) }))
  const kindKey = prod?.product || t.instrument_type
  const sig = (p, label) => ({ label, letter: parties.find(x => x.lei === p?.lei)?.letter || null, lei: p?.lei || '', name: names[p?.lei] || null, address: p?.address || '', signature: p?.signature || '',
    key: p?.key_source === 'dev' ? 'a demonstration key held by Rijeka' : p?.key_source === 'registered' ? 'the wallet registered for this LEI' : (p?.key_source || '') })
  return {
    kind: KIND[kindKey] || plain(kindKey || 'Trade'), structure: t.structure && t.structure !== 'VANILLA' ? plain(t.structure) : null,
    ref: proof?.trade_ref || '', uti: rec.uti || '',
    state: closed ? 'closed' : anchored ? 'anchored' : 'signed',
    demo: att.bilateral === false,                       // both signatures were produced by Rijeka: said on the sheet in as many words
    parties, trade, blocks,
    record: {
      hash: proof?.trade_hash || att.trade_hash || '', schema: rec.schema_version, form: att.eip712 ? `${att.eip712.name} v${att.eip712.version}` : '',
      chain: anchored ? anchor.chain_id : null, registry: anchored ? anchor.registry : null, block: anchored ? anchor.block_number : null,
      tx: anchored ? anchor.tx_hash : null, explorer: anchored ? anchor.explorer_tx || null : null,
      at: anchored && anchor.confirmed_at ? longStamp(new Date(anchor.confirmed_at * 1000).toISOString(), true) : null,
      testnet: anchored && TESTNETS.has(Number(anchor.chain_id)),
      note: anchored ? null : 'Not anchored: this record is held by Rijeka and is on no registry.',
      closedTx: closed ? att.termination?.anchor?.tx_hash || null : null,
    },
    signatures: [sig(att.parties?.own, 'Booked by'), sig(att.parties?.counterparty, att.bilateral === false ? 'Counterparty' : 'Countersigned by')],
    made: proof?.generated_at ? longStamp(proof.generated_at) : '',
    package: !!proof?.package || rec.schema === 'rijeka-package',      // a leg of a package: its sheet is not made (the signed record is the package's)
  }
}
