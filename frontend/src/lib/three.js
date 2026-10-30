// three.js is bundled by Vite (no runtime CDN script). The swaption scenes were written
// against r128, so the renderer defaults that changed since are restored here: a linear
// colour pipeline (no sRGB conversion of hex colours or output) and pre-r155 light scaling.
let three = null

export async function loadThree() {
  if (!three) {
    const mod = await import('three')
    mod.ColorManagement.enabled = false        // r128 took hex colours as-is
    window.THREE = mod                         // the scenes read the THREE global
    three = mod
  }
  return three
}

// r128 wrote linear values straight to the canvas; r152+ converts to sRGB by default.
export function legacyRenderer(THREE, opts) {
  const renderer = new THREE.WebGLRenderer(opts)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  return renderer
}

// Pre-r155 ("legacy lights") intensities were implicitly scaled by PI.
export const LEGACY_LIGHT = Math.PI
