// blotter/row-menu.js — what the right-click menu of a blotter row offers, as plain items for common/ContextMenu.
// Everything here reads or arranges: open the trade, copy one of its identifiers, narrow the blotter to trades
// like it, tick or untick it. Nothing that changes a trade (confirm, terminate) is on the menu: those go through
// the ticket, where the terms are in front of the person who acts.
//
// `does` is what the blotter can do: { open(trades), copy(text), filter(key, value), toggle(id), clear() }.
const short = (s, n = 26) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export function rowMenu(t, { selected = [], theirRef = null, filters = {}, canCopy = true } = {}, does = {}) {
  if (!t) return []
  const ticked = selected.some(x => x.id === t.id)
  const several = ticked && selected.length > 1
  const cp = t.counterparty?.name || null
  const narrowed = (filters.status && filters.status !== 'ALL') || (filters.assetClass && filters.assetClass !== 'ALL') || (filters.store && filters.store !== 'ALL') || !!filters.search
  return [
    { label: 'Open', hint: t.trade_ref, onSelect: () => does.open?.([t]) },
    ...(several ? [{ label: `Open the ${selected.length} ticked trades`, onSelect: () => does.open?.(selected) }] : []),
    { separator: true },
    // where the browser gives no clipboard (a page not served securely) the copies are greyed and say so
    { label: 'Copy reference', hint: canCopy ? t.trade_ref : 'no clipboard here', disabled: !t.trade_ref || !canCopy, onSelect: () => does.copy?.(t.trade_ref) },
    { label: 'Copy UTI', hint: !t.uti ? 'none yet' : canCopy ? short(t.uti, 18) : 'no clipboard here', disabled: !t.uti || !canCopy, onSelect: () => does.copy?.(t.uti) },
    ...(theirRef ? [{ label: 'Copy their reference', hint: canCopy ? theirRef : 'no clipboard here', disabled: !canCopy, onSelect: () => does.copy?.(theirRef) }] : []),
    { separator: true },
    { heading: 'SHOW ONLY' },
    { label: cp ? short(cp) : 'This counterparty', disabled: !cp, onSelect: () => does.filter?.('search', cp) },
    { label: t.asset_class || 'This asset class', hint: 'asset class', disabled: !t.asset_class, onSelect: () => does.filter?.('assetClass', t.asset_class) },
    { label: t.status || 'This status', hint: 'status', disabled: !t.status, onSelect: () => does.filter?.('status', t.status) },
    { label: 'Show every trade again', disabled: !narrowed, onSelect: () => does.clear?.() },
    { separator: true },
    { label: ticked ? 'Untick this trade' : 'Tick this trade', onSelect: () => does.toggle?.(t.id) },
  ]
}
