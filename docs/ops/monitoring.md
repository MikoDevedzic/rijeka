# Monitoring

What tells the owner that production is wrong, and how soon. Nothing here needs a sign-in or a secret: every check
reads a public address.

## What is watched, and by what

| What | By what | How soon it is known |
|---|---|---|
| The API process is up | Render's own health check on `/health` (`render.yaml`: `healthCheckPath`): an instance that stops answering is restarted and a failed deploy is not promoted | minutes, to Render; whether Render then tells the owner is a notification setting in its dashboard (not read from here) |
| Every batch is current (news, spot, digital-asset marks and fixings, market data, P&L, market risk, counterparty credit) | `GET /api/ops/health` (`checks`), filled by the in-process scheduler; the `news-tick` workflow drives the same batches from outside and fails when one is stale | when a workflow next runs (see below), or when anyone opens the app: a stale batch is in every signed-in user's inbox |
| Everything a visitor touches, from outside | the `watch` workflow, `.github/scripts/watch.py` | when the workflow next runs, by hand, and after every deploy |
| Errors in users' browsers | the app reports them to the API; `client_errors.last_24h` on the health answer; the watch fails above 25 in a day | as above |

What "stale" means is decided in one place, the API (`api/routes/ops.py`, `evaluate`); `news-tick` and the watch
both read it from `/api/ops/health`, so there are two readers and one rule. `news-tick` is the second driver of the
batches and fails on a stale one; the watch is the alarm for everything else a visitor touches and repeats the
stale-batch line so one report says all of it.

## The watch

```bash
python3 .github/scripts/watch.py                                  # every check
python3 .github/scripts/watch.py --api-commit <sha> --app-commit <sha>   # after a deploy: both report the commit
gh workflow run watch                                             # the same, on GitHub
```

It prints one line per thing looked at and exits 1 when anything is wrong:

| Line | What must hold |
|---|---|
| API health | the answer is there; every batch is current; the scheduler is on, its loop passed in the last 30 minutes (a process started in the last 25 is given time) and the last run of no step failed; no migration is in trouble; fewer than 26 browser errors in a day; a commit is reported (and is the one named) |
| chain and published market | the API has a chain to anchor to, names a registry on Sepolia or mainnet, and the node answered with a block (anything wrong with the chain is asked once more after a minute before it counts); a curve is published |
| the app and the site may read the API | the API allows `https://app.rijeka.app` and `https://rijeka.app` to read it (CORS): without this the app is a blank screen while health is green |
| public register | every row is the shape the register promises (hashes, the registry, a block, a transaction and the explorer's link to it, or neither and a link to the registry for a record the registry already held, at most two LEIs of twenty characters, plain words); no `<` or `>` anywhere in the answer; the total is not below the rows |
| web app | the page opens and has its root; every script and stylesheet it names is answered as a script or a stylesheet (the host answers a missing file with the page itself, status 200, so the type is read); `version.json` carries a commit; the methodology PDF is a PDF |
| public site | the front page, the verifier and the register page open; the verifier lists the registry the API anchors to; the register page still reads the API |

Its own tests (`.github/scripts/test_watch.py`, run by CI in the `backend tests` job) give each check a good answer
and then the same answer broken one way, so a check that could not fail is caught there.

A run asks about fifteen addresses once each (a 5xx or no answer is asked again, twice, eight seconds apart; after
six minutes it stops asking again so that it ends with its report). The register is asked for the same hundred rows
the public register page asks for, so it reads the answer the API already keeps for a minute and does not push it
out. Redirects are not followed; an answer longer than 20 MB or slower than 90 seconds counts as none; what
production sent is printed as plain characters only, since the log is public.

On a Mac whose Python has no certificate store (python.org's), run it with the backend's virtualenv
(`backend/.venv/bin/python`), which has `certifi`. Certificates are always verified.

## What this does not do

**It is not a minute-by-minute alarm.** GitHub runs schedules when it has room. On this repository a half-hourly
workflow and a five-minute one have each run once every five to eight hours (read off `gh run list` on 11 November
2026). An outage can therefore stand for hours before a scheduled run sees it. The watch is the deep check a few
times a day and the read-back after a deploy.

For the minutes, one of these, each the owner's to set up:

1. **An outside uptime service** (any of the free ones) on `https://rijeka-api.onrender.com/api/ops/health`, every
   minute or five, alerting when the status is not 200 **or** the body contains exactly `"ok":false` (a stale batch or a
   failed step; the answer on 11 November 2026 held none, and a migration not yet applied reads `"applied":false`,
   which is a different text). A second monitor on `https://app.rijeka.app/version.json`. This is the one
   that tells a phone within minutes; it needs an account only the owner can make.
2. **Render's notifications** for the service (failed deploys, an unhealthy instance): a setting in the dashboard,
   to be looked at once.

What no check here covers: signing in (the auth provider), a confirmation actually reaching Sepolia (the node is
read only as "it answers"; a relayer wallet that runs low is shown to signed-in users on their home page, not
here), email delivery, and anything behind a sign-in. The whole path from CONFIRM to a block is tested on a local
test chain by `npm run e2e:chain`, not on the hosted one.
