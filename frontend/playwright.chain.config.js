// The journeys that need a chain (e2e/chain): the same stack with Foundry's anvil beside it and the registry deployed
// to it (e2e/serve.sh under RIJEKA_E2E_CHAIN=1), so a confirmation is signed, sent and anchored for real. The other
// journeys run with no chain, where a record is signed and not anchored. `npm run e2e:chain`; CI runs it after them.
import base from './playwright.config.js'
export default {
  ...base,
  testDir: './e2e/chain',
  testIgnore: [],
  webServer: { ...base.webServer, command: 'RIJEKA_E2E_CHAIN=1 bash e2e/serve.sh' },
}
