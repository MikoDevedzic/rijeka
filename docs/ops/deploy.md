# Deploy order: API first, then the app

Two hosts deploy from this repository:

- **rijeka-api** on Render builds `main` after the commit's CI checks pass (Render's
  "wait for CI"), about ten minutes after a push.
- **app.rijeka.app** on Netlify builds the **`release`** branch, not `main`.

`.github/workflows/release-sync.yml` runs every five minutes, reads the commit the live
API is serving from `GET /health` (`commit`, from Render's `RENDER_GIT_COMMIT`) and moves
`release` to it. The frontend therefore lands a few minutes after the API that serves
it, never before; a failed API deploy leaves the frontend where it was; a Render rollback
rolls the frontend back too (the push is forced, `release` is a pointer, not history).

Why not a job in `ci.yml`: Render waits for all of the commit's checks, so a check that
waited for Render would never finish.

To deploy the frontend by hand without waiting: `gh workflow run release-sync`.
The landing site rijeka.app is separate (root `netlify_drop/`, deployed with the CLI).
