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

## Rendering sequence (never changes)

Every trade window, for every product, renders these nine sections in this
exact vertical order. Sections that don't apply to a given product (e.g.
Option Fee for a vanilla swap) are simply not rendered — they do not move
to a different position.

| #  | Section             | Source                                    |
|----|---------------------|-------------------------------------------|
| 1  | TabBar              | Fixed — TRADE / DETAILS / CASHFLOWS / XVA / CURVE SCENARIO / CONFIRM |
| 2  | InstrumentSelector  | Asset class chips → product chips → structure chips (from descriptor) |
| 3  | CounterpartyBlock   | Universal — own entity, counterparty, trade date, desk, book |
| 4  | PrimaryEconomics    | Universal — notional, CCY, direction, tenor, eff/mat date |
| 5  | ProductTerms        | `descriptor.terms.Component`              |
| 6  | OptionFeeBlock      | Rendered **only** if `descriptor.optionFee !== null` |
| 7  | AnalyticsBlock      | Metrics grid (`descriptor.analytics.metrics`) + collapsible breakdown (`descriptor.analytics.breakdown`) |
| 8  | XVASummary          | Universal — link to XVA tab                |
| 9  | TradeFooter         | Sticky — metric chips + STRUCTURE label + PRICE + BOOK TRADE |

If a new product requires a tenth section, extend the shell contract once
for everyone — do not branch the shell per product.

## State ownership

| Concern                      | Owner             | Accessed via               |
|------------------------------|-------------------|----------------------------|
| Selected product             | TradeWindow shell | `productKey`               |
| Selected structure           | TradeWindow shell | `state.structure`          |
| Direction (PAY/RECEIVE)      | TradeWindow shell | `state.direction`          |
| Common economics             | TradeWindow shell | `state.{notional, ccy, tenor, …}` |
| Product-specific fields      | TradeWindow shell | `state.<productField>` (via `update(patch)`) |
| Pricing flags + result       | TradeWindow shell | `result`, `pricing`, `error` |
| Local UI state (collapsed)   | Section primitive | useState in primitive      |
| Market data (curves, vol)    | External stores   | Existing curve system      |

**Descriptors never hold state.** They are pure data + pure functions. Every
descriptor callback receives `state` (and sometimes `result`) as an argument
and returns the rendering spec — there is no internal mutation.

## Pricing flow

When the user clicks PRICE, the shell runs this sequence:

1. **Build payload** — call `descriptor.pricing.buildPayload(state)`
2. **Get auth session** — Supabase session with 5-second deadline. On
   timeout, falls back to cached session from a previous call (the Sprint
   9.1 resilience pattern — handles tab-backgrounded auth-refresh hangs).
3. **POST** to `descriptor.pricing.endpoint` with `AbortController`
   timeout (`descriptor.pricing.timeoutMs`, default 30s)
4. **Parse response** — call `descriptor.pricing.parseResponse(data)` → normalized result
5. **Render** — Analytics + Footer automatically re-render off the result
6. **Safety net** — a shell useEffect auto-clears a stuck pricing flag
   after 20 seconds, with a console.warn

Error handling:
- Timeouts are silent (AbortError); the Analytics section returns to "price to load"
- Network / validation errors (400/422) display the error detail in a bordered message inside AnalyticsBlock
- Previous result is preserved across failed retries so users don't lose state

## Feature flag during migration

Per-product rollout is controlled by a localStorage flag:

```js
// Enable new unified shell for a specific product:
localStorage.setItem('rijeka.tbw.unified', 'true')
```

The Blotter reads this flag and mounts either `<TradeWindow />` (new) or
`<TradeBookingWindow />` (legacy). Flag lives throughout the Sprint 10
migration phases; it is removed in Phase 5 cutover.

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
