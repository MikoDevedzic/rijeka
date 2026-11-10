// Quinn's browser journeys (e2e/). They run the built app on the local stack: see e2e/README.md.
import { defineConfig } from '@playwright/test'

export const WEB = 'http://127.0.0.1:4174'
export const API = 'http://127.0.0.1:8010'
export const REST = 'http://127.0.0.1:3010'

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'perf/**',                 // the smoothness profile is a measurement with its own config, not a journey
  outputDir: './e2e/.out/results',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'e2e/.out/report', open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB,
    viewport: { width: 1440, height: 900 },      // a laptop: what fits here fits everywhere
    reducedMotion: 'reduce',                     // a figure read at once is the figure, not a frame of its roll (ticket-shape.spec.js turns motion on to watch a roll)
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bash e2e/serve.sh',
    url: WEB,
    timeout: 240_000,
    reuseExistingServer: false,          // always this build on a fresh stack: a reused server would test old code
    stdout: 'pipe',
  },
})
