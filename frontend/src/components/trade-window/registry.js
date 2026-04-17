// trade-window/registry.js
// ─────────────────────────────────────────────────────────────────────────────
// Product Registry — unified trade window plug-in pattern.
//
// Every product (IR_SWAP, IR_SWAPTION, RATES_CAP, FX_FORWARD, CREDIT_DEFAULT_SWAP...)
// is declared as a descriptor object and registered here. The TradeWindow
// renderer iterates sections in a fixed order and asks each product's
// descriptor how to render that section. Products cannot reach into the
// renderer; the renderer can only call contract methods on the descriptor.
//
// Adding a new product = one new file under products/, one registerProduct call.
// No core changes. No new tabs. No new state paths in TradeWindow.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every product adapter conforms to this shape.
 *
 * @typedef {Object} ProductDescriptor
 *
 * @property {string} key                 Unique identifier, e.g. 'IR_SWAP'.
 *                                        Convention: {ASSETCLASS}_{PRODUCT}.
 * @property {string} label               Display label, e.g. 'IR Swap'.
 * @property {string} assetClass          One of 'RATES'|'FX'|'CREDIT'|'EQUITY'|'COMMODITY'.
 * @property {string} [icon]              Optional icon or glyph.
 * @property {boolean} [live=true]        If false, shown as "SOON" in the chip row.
 *
 * @property {StructureSpec[]} structures Empty array if the product has no
 *                                        sub-structure selector. Otherwise one
 *                                        entry per supported structure.
 * @property {string} [defaultStructure]  Key of the default structure.
 *
 * @property {(state) => DirectionLabels} direction
 *                                        Function returning the two direction
 *                                        labels given current state. Allows
 *                                        structure-dependent labels (e.g. BASIS
 *                                        swap → 'PAY LEG 1' / 'RECEIVE LEG 1').
 *
 * @property {TermsSpec} terms            Product-specific terms section. Rendered
 *                                        between Primary Economics and Option Fee.
 *
 * @property {OptionFeeSpec|null} optionFee
 *                                        null if the product has no option
 *                                        premium concept (e.g. vanilla swap).
 *
 * @property {AnalyticsSpec} analytics    Metrics row + breakdown table contract.
 *
 * @property {FooterSpec} footer          Footer chip row + structure label.
 *
 * @property {PricingSpec} pricing        Endpoint, payload, and response parsing.
 */

/**
 * @typedef {Object} StructureSpec
 * @property {string} key       'VANILLA'|'OIS'|'BASIS'|'EUROPEAN'|...
 * @property {string} label     Display label for the chip.
 */

/**
 * @typedef {Object} DirectionLabels
 * @property {string} pay       Left-hand button label, e.g. 'PAY FIXED'.
 * @property {string} receive   Right-hand button label, e.g. 'RECEIVE FIXED'.
 */

/**
 * @typedef {Object} TermsSpec
 * @property {string} title                       Section header, e.g. 'CAP TERMS'.
 * @property {(state) => {text:string,color:string}} helper
 *                                                Intent-revealing badge.
 * @property {string} [footerText]                Optional convention helper line
 *                                                (e.g. 'Bachelier Normal · OIS disc').
 * @property {(props) => ReactNode} Component     React component rendering the
 *                                                product-specific inputs. Receives
 *                                                { state, update, refs }.
 */

/**
 * @typedef {Object} OptionFeeSpec
 * @property {boolean} premiumInBpOrDollar   Show BP|$ toggle (true) or just $ (false).
 * @property {boolean} multiPaymentAllowed   Whether the DETAILS tab shows a schedule editor.
 */

/**
 * @typedef {Object} AnalyticsSpec
 * @property {(result) => MetricCard[]} metrics           Ordered metric cards.
 * @property {(result) => BreakdownTable|null} breakdown  Collapsible table below metrics.
 */

/**
 * @typedef {Object} MetricCard
 * @property {string} label
 * @property {string|number} value
 * @property {'currency'|'bp'|'pct'|'raw'} [format='raw']
 * @property {'sign'|'accent'|'info'|'warning'|null} [colorBy=null]
 */

/**
 * @typedef {Object} BreakdownTable
 * @property {'legs'|'caplets'|'components'|'custom'} kind
 * @property {string[]} columns
 * @property {Array<Array<string|ReactNode>>} rows
 */

/**
 * @typedef {Object} FooterSpec
 * @property {(result, state) => MetricCard[]} metrics
 *                                              Always 3–5 chips in the sticky footer.
 * @property {(state) => string} structureLabel Text shown next to the word STRUCTURE.
 */

/**
 * @typedef {Object} PricingSpec
 * @property {string|((state) => string)} endpoint  API path, e.g. '/api/price/cap'.
 * @property {(state) => object} buildPayload       Serializes state to request body.
 * @property {(response) => object} parseResponse   Normalizes response for the
 *                                                  Analytics section.
 * @property {number} [timeoutMs=30000]             Handler deadline.
 */

const PRODUCTS = new Map()
const ASSET_CLASSES = new Set()

/**
 * Register a product descriptor. Called once per product file at module load.
 * @param {ProductDescriptor} descriptor
 */
export function registerProduct(descriptor) {
  if (!descriptor.key) throw new Error('Product descriptor missing key')
  if (PRODUCTS.has(descriptor.key)) {
    console.warn(`[registry] overwriting product ${descriptor.key}`)
  }
  validateDescriptor(descriptor)
  PRODUCTS.set(descriptor.key, descriptor)
  ASSET_CLASSES.add(descriptor.assetClass)
}

/** Retrieve a descriptor by key. */
export function getProduct(key) {
  return PRODUCTS.get(key) || null
}

/** All registered products, in registration order. */
export function listProducts() {
  return Array.from(PRODUCTS.values())
}

/** All registered products for a given asset class. */
export function listProductsByAssetClass(assetClass) {
  return Array.from(PRODUCTS.values()).filter(p => p.assetClass === assetClass)
}

/** All registered asset classes (for the top chip row). */
export function listAssetClasses() {
  return Array.from(ASSET_CLASSES)
}

// ── Internal validation ─────────────────────────────────────────────────────

function validateDescriptor(d) {
  const required = ['key', 'label', 'assetClass', 'structures',
                    'direction', 'terms', 'analytics', 'footer', 'pricing']
  for (const r of required) {
    if (!(r in d)) throw new Error(`[registry] ${d.key} missing required field: ${r}`)
  }
  if (typeof d.direction !== 'function') {
    throw new Error(`[registry] ${d.key} direction must be a function of state`)
  }
  if (typeof d.terms.Component !== 'function') {
    throw new Error(`[registry] ${d.key} terms.Component must be a React component`)
  }
  if (typeof d.pricing.buildPayload !== 'function') {
    throw new Error(`[registry] ${d.key} pricing.buildPayload must be a function`)
  }
  if (typeof d.pricing.parseResponse !== 'function') {
    throw new Error(`[registry] ${d.key} pricing.parseResponse must be a function`)
  }
  if (!Array.isArray(d.structures)) {
    throw new Error(`[registry] ${d.key} structures must be an array (empty if N/A)`)
  }
}
