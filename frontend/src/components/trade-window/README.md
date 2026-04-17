# Trade Window — Unified Trade Booking Template

This module provides a single trade booking shell used by every product across
every asset class. Products register themselves as descriptors; the shell
iterates sections in a fixed order and delegates rendering to the descriptor.

## Why this exists

Before this refactor, each product (IR Swap, IR Swaption, Rates Cap/Floor/Collar)
had its own JSX fragment inside `TradeBookingWindow.jsx`, accumulating layout
drift over months of sprints. Tab counts, direction labels, analytics placement,
and even leg-label logic varied per product. The fix is to collapse all shared
structure into the shell and push product-specific logic into adapters.

Adding a new product (e.g. FX Forward, Credit Default Swap, Commodity Future)
is a single file under `products/`. No core changes. No new tabs. No new
state paths in the shell.

## File layout

```
trade-window/
├── registry.js              Plug-in pattern. Exports registerProduct().
├── TradeWindow.jsx          Unified renderer shell.
├── sections.jsx             Section primitives (TabBar, Instrument, Terms, Analytics, ...)
├── product-terms.jsx        Product-specific TERMS bodies (SwapTermsBody, CapTermsBody, ...)
├── styles.css               Pure Black theme, all tbw-* classes
└── products/
    ├── rates.js             IR_SWAP, IR_SWAPTION, RATES_CAP, RATES_FLOOR, RATES_COLLAR
    ├── fx.js                FX_FORWARD (live), FX_OPTION (skeleton)
    ├── credit.js            Sprint 12+
    ├── equity.js            Sprint 13+
    └── commodity.js         Sprint 14+
```

## Adding a new product — 4 steps

**1. Create the terms body** in `product-terms.jsx`:

```jsx
export function MyProductTermsBody({ state, update }) {
  return (
    <Row cols={6}>
      <Field label="STRIKE"><input value={state.strike ?? ''} onChange={e => update({ strike: e.target.value })} /></Field>
      {/* … product-specific fields … */}
    </Row>
  )
}
```

**2. Write the descriptor** in `products/<assetclass>.js`:

```js
import { registerProduct } from '../registry'
import { MyProductTermsBody } from '../product-terms'

registerProduct({
  key: 'FX_NDF',
  label: 'Non-Deliverable Forward',
  assetClass: 'FX',
  structures: [],
  direction: () => ({ pay: 'BUY USD', receive: 'SELL USD' }),
  terms: {
    title: 'NDF TERMS',
    helper: state => ({ text: '→ cash-settled FX forward', color: '#4A9EFF' }),
    footerText: 'Fixing date + value date · USD or settlement CCY',
    Component: MyProductTermsBody,
  },
  optionFee: null,
  analytics: {
    metrics: r => [ /* metric cards */ ],
    breakdown: r => ({ kind: 'legs', columns: [...], rows: [...] }),
  },
  footer: {
    metrics: r => [ /* footer chips */ ],
    structureLabel: () => 'NDF',
  },
  pricing: {
    endpoint: '/api/price/fx-ndf',
    buildPayload: state => ({ /* payload */ }),
    parseResponse: r => r,
    timeoutMs: 30000,
  },
})
```

**3. Import the product file** in `TradeWindow.jsx`:

```js
import './products/fx'  // one line
```

**4. Implement the backend endpoint** at `/api/price/fx-ndf`.

Done. The new product appears in the chip row, gets its own TERMS section,
feeds its metrics into the analytics grid, and shows its footer chips. Nothing
else in the app needs to change.

## Descriptor contract

Every descriptor must implement these nine fields — the registry validates on
`registerProduct` and throws on missing keys.

| Field           | Type                              | Required |
|-----------------|-----------------------------------|----------|
| `key`           | string, unique                    | ✅       |
| `label`         | string, display label             | ✅       |
| `assetClass`    | 'RATES'\|'FX'\|'CREDIT'\|'EQUITY'\|'COMMODITY' | ✅ |
| `structures`    | array (empty if single-structure) | ✅       |
| `direction`     | `(state) => {pay, receive}`       | ✅       |
| `terms`         | `{title, helper, Component}`      | ✅       |
| `optionFee`     | spec or `null`                    | ✅       |
| `analytics`     | `{metrics, breakdown}`            | ✅       |
| `footer`        | `{metrics, structureLabel}`       | ✅       |
| `pricing`       | `{endpoint, buildPayload, parseResponse}` | ✅ |

See `registry.js` JSDoc for full type specs.

## Design principles

1. **Sections are fixed, content is dynamic.** The shell never branches on
   product key. All product-specific logic lives in the descriptor.

2. **Registry at module load, not runtime.** Descriptors register in their own
   file at import time. No dynamic registration, no product service.

3. **State is flat.** Shell owns economics + product-specific state in a
   single object. Descriptors read from it but never mutate it directly —
   they call the `update(patch)` callback passed in as a prop.

4. **Adapters are pure data + pure functions.** No side effects in the
   descriptor itself. Side effects (API calls, state mutations) happen in
   the shell.

5. **One source of truth per concept.** Direction labels come from the
   descriptor. Structure chips come from the descriptor. Footer metrics
   come from the descriptor. Don't duplicate these in the shell.

## Migration from old TradeBookingWindow.jsx

The new system coexists with the old one during migration. Strategy:

| Phase | Timing       | Action                                                                 |
|-------|--------------|------------------------------------------------------------------------|
| 1     | Sprint 10.1  | Scaffold (this). Shell + registry + 5 rates adapters running in parallel. |
| 2     | Sprint 10.2  | Wire IR Swap to new shell. Toggle via feature flag `TBW_UNIFIED=true`. |
| 3     | Sprint 10.3  | Wire Swaption, Cap, Floor, Collar one at a time. Validate each.         |
| 4     | Sprint 10.4  | Remove old TradeBookingWindow.jsx. Unflag.                              |
| 5     | Sprint 11+   | Add FX, credit, commodity through the registry — no more shell changes. |

## Contract stability

The descriptor contract is intended to be stable across asset classes. If a
new product needs something the contract can't express cleanly, that's a
signal to extend the contract — not to work around it via shell branching.

Changes to the contract require updating every existing descriptor. Use
this as a forcing function: the contract should only change when a genuine
cross-cutting concern emerges.
