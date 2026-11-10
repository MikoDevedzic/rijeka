// The smoothness profile (e2e/perf): the same stack the journeys use, built unminified so a slow frame names its
// function, and run on the full Chromium build so the page is drawn by the machine's graphics chip (the default
// headless shell rasterises in software). Local only: it is a measurement, not a gate.
import base from './playwright.config.js'
export default {
  ...base,
  testDir: './e2e/perf',
  testIgnore: [],
  use: { ...base.use, channel: 'chromium' },
  webServer: { ...base.webServer, command: 'RIJEKA_E2E_BUILD_FLAGS="--minify false" bash e2e/serve.sh' },
}
