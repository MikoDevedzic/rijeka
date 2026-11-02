// Product shape per FX / digital-asset instrument type. Shared by FxCryptoPanel and TradeWindow.
export const SHAPE_OF = { FX_SPOT: 'SPOT', FX_FORWARD: 'FORWARD', NDF: 'NDF', CRYPTO_FORWARD: 'NDF', FX_OPTION: 'OPTION', CRYPTO_OPTION: 'OPTION' }
// The desk's name for the spot delta: FX01 on a currency pair, CRY01 on a digital asset (PV for +1% spot).
export const DELTA_LABEL = (crypto) => (crypto ? 'CRY01' : 'FX01')
