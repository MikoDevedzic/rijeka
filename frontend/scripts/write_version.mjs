// Writes public/version.json at build time: the release the bundle was built from. The running app
// compares it with its own VITE_COMMIT (lib/version.js) and tells the user when a newer build is live.
import { writeFileSync, mkdirSync } from 'node:fs'
mkdirSync('public', { recursive: true })
writeFileSync('public/version.json', JSON.stringify({ commit: process.env.VITE_COMMIT || 'dev', built: new Date().toISOString() }) + '\n')
