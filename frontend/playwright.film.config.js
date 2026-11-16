// The walkthrough film (e2e/film): the journeys' stack with a local chain, so a confirmation is signed, sent and anchored
// for real, drawn by the full Chromium build (the machine's graphics chip: the logo and the charts move as they do for a
// person) at 1536 by 864 and a pixel ratio of 1.25, which is a 1920 by 1080 frame with everything a quarter larger than
// on a monitor. The browser itself is started at that ratio and at that window size: the screencast films the window's
// own surface, and without both it films 1536 by 864 (the page's ratio alone is not in it) or cuts the foot off. Not a journey and not a gate:  npm run film   (frames to e2e/.out/film, then e2e/film/encode.sh makes rijeka-walkthrough.webm there)
import base from './playwright.config.js'
export default {
  ...base,
  testDir: './e2e/film',
  testIgnore: [],
  retries: 0,
  use: { ...base.use, channel: 'chromium', viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25, launchOptions: { args: ['--force-device-scale-factor=1.25', '--window-size=1536,864'] }, reducedMotion: 'no-preference', video: 'off', trace: 'off', screenshot: 'off' },
  webServer: { ...base.webServer, command: 'RIJEKA_E2E_CHAIN=1 bash e2e/serve.sh' },
}
