// The operator's pages in a journey. The stack's users are traders, so a journey that reads an admin's page answers
// the profile as an admin's and answers every admin read of Configurations → SYSTEM with a body in the API's shape
// (the two canned bodies' keys are held to the API's by backend/tests/test_activity.py and test_health.py).
import { readFileSync } from 'node:fs'
import { API, REST } from './fixtures.js'

export const ADOPTION = JSON.parse(readFileSync(new URL('./adoption-body.json', import.meta.url), 'utf8'))
export const PROBLEMS = JSON.parse(readFileSync(new URL('./problems-body.json', import.meta.url), 'utf8'))
export const USAGE = { days: 14, from: '2026-11-05', to: '2026-11-18', series: [], totals: { visitors: 0, views: 0, signup_started: 0, signups: 0, trades: 0, confirms: 0, anchors: 0 }, hits_stored_in: 'usage_hits', note: '' }

export async function asAdmin(app, { adoption = ADOPTION, problems = PROBLEMS, usage = USAGE } = {}) {
  await app.route(/\/rest\/v1\/profiles/, async route => {
    const res = await route.fetch({ url: route.request().url().replace(/^https?:\/\/[^/]+\/rest\/v1/, REST) })
    const j = await res.json()
    const admin = (p) => ({ ...p, role: 'admin' })
    await route.fulfill({ response: res, json: Array.isArray(j) ? j.map(admin) : admin(j) })
  })
  await app.route(`${API}/api/ops/adoption`, route => route.fulfill({ json: adoption }))
  await app.route(new RegExp(`^${API}/api/ops/problems`), route => route.fulfill({ json: problems }))
  await app.route(`${API}/api/ops/usage`, route => route.fulfill({ json: usage }))
}
