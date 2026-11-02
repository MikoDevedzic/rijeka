// lib/labels.js
// ────────────────────────────────────────────────────────────────────────────────────
// Names shown to people for the keys the API speaks. A product key such as
// INTEREST_RATE_COLLAR is "COLLAR" on the desk; a key this map does not know
// still reads as words (every underscore becomes a space, not just the first).
// ────────────────────────────────────────────────────────────────────────────────────

export const PRODUCT_LABELS = {
  // rates
  IR_SWAP:              'IR SWAP',
  OIS_SWAP:             'OIS SWAP',
  BASIS_SWAP:           'BASIS SWAP',
  FRA:                  'FRA',
  IR_SWAPTION:          'SWAPTION',
  EUROPEAN_SWAPTION:    'SWAPTION',
  BERMUDAN_SWAPTION:    'BERMUDAN SWAPTION',
  AMERICAN_SWAPTION:    'AMERICAN SWAPTION',
  IR_CAP:               'CAP',
  INTEREST_RATE_CAP:    'CAP',
  IR_FLOOR:             'FLOOR',
  INTEREST_RATE_FLOOR:  'FLOOR',
  IR_COLLAR:            'COLLAR',
  INTEREST_RATE_COLLAR: 'COLLAR',
  // currencies
  FX_SPOT:              'FX SPOT',
  FX_FORWARD:           'FX FORWARD',
  FX_SWAP:              'FX SWAP',
  NDF:                  'NDF',
  FX_NDF:               'NDF',
  FX_OPTION:            'FX OPTION',
  // digital assets
  CRYPTO_FORWARD:       'CRYPTO NDF',
  CRYPTO_OPTION:        'CRYPTO OPTION',
}

/** The desk's name for an instrument_type key; unknown keys read as words. */
export function productLabel(instrumentType) {
  if (!instrumentType) return ''
  const key = String(instrumentType).toUpperCase()
  return PRODUCT_LABELS[key] || key.replace(/_/g, ' ')
}

// Sensitivities as the desk names them (never DV01 / PV01).
export const SENSITIVITY_LABELS = {
  IR01:      'IR01',
  IR01_DISC: 'IR01 DISC',
  FX01:      'FX01',
  CRY01:     'CRY01',
  FUND01:    'FUND01',
  VEGA:      'VEGA',
  THETA:     'THETA',
  GAMMA:     'GAMMA',
}

/** The desk's name for a sensitivity key such as ir01_disc. */
export function sensitivityLabel(key) {
  if (!key) return ''
  const k = String(key).toUpperCase()
  return SENSITIVITY_LABELS[k] || k.replace(/_/g, ' ')
}
