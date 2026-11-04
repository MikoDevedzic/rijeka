// The rates calibration arrives in two shapes: POST /api/xva/calibrate returns the per-instrument fit as a
// list under fit_details with converged / iterations alongside; a calibration read back from the server
// (or an old copy in sessionStorage) may carry the stored object {basket, converged, iterations, ...}
// instead. The tab only ever renders the normalised form, where fit_details is always an array.
export function normaliseCalibration(d) {
  if (!d || typeof d !== 'object') return null
  const fd = d.fit_details
  if (Array.isArray(fd)) return d
  if (fd && typeof fd === 'object') {
    const { basket, ...rest } = fd
    return { ...rest, ...d, fit_details: Array.isArray(basket) ? basket : [] }
  }
  return { ...d, fit_details: [] }
}
