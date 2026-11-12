// The journeys on the two other engines a visitor brings: Firefox, and WebKit (the engine of Safari). The same
// journeys, the same local stack, one after the other: `npm run e2e:engines` (or `-- --project=webkit`). The
// everyday run and CI's required check stay on Chromium (playwright.config.js); this run is the check before an
// announcement and after a change to layout, keyboard handling or anything a browser may do its own way.
// Install the engines once: `npx playwright install firefox webkit`.
import { devices } from '@playwright/test'
import base from './playwright.config.js'

const laptop = { viewport: { width: 1440, height: 900 } }

export default {
  ...base,
  outputDir: './e2e/.out/results-engines',
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'], ...laptop } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...laptop } },
  ],
}
