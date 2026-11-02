# Launch audit (2 November 2026)

Three independent read-only reviews (backend, frontend, documentation and repository surface) run on
commit `0a6b0db`, every S1 finding re-verified by hand in the source. The question asked: what to clean
up to take the hosted demo from about 80/100 to 90+ for outside users (banks, asset managers,
universities, open-source reviewers). Baseline that day: 696 tests passing, 424 QuantLib comparison
rows in CI, 16 Foundry tests, main protected with three required checks, methodology v1.2 published,
the XVA rates workbook live.

| Area | Score | What holds it down |
|---|---|---|
| Backend | 78 | one cross-tenant write, a create path that skips the lifecycle, raw driver errors reaching clients, a dozen expensive endpoints with no rate limit, scheduler recomputing every account on every deploy, no logging configuration |
| Frontend | 79 | a global error handler that can erase the running desk after a redeploy, a confirm dead end for cap/floor/collar/swaption bookings, vocabulary drift (DV01, half-replaced underscores, "SPRINT 6" badges), ~1,900 lines of dead code and an orphaned pricer page |
| Docs and repo | 72 | the README's top half and two linked docs describe the March product, the landing page is git-ignored and inconsistent about what is live, self-hosting does not work from schema.sql alone, licence coverage of risk/ccr/pnl undefined, no architecture page, env reference, changelog or model inventory |

The substance underneath (pricing, risk, methodology, validation, security model, tenancy on every row,
CI) would score 90+ on its own in all three reviews. The gap is a thin layer of hygiene at the edges an
outside user meets first. None of it is architectural.

## Found and fixed during the audit

- The app served a methodology PDF three days older than the repository's (a hand-copied file under
  `frontend/public`). The frontend build now copies it from `docs/methodology` (prebuild step).
- The release-sync workflow exited early whenever `release` already sat at the API's live commit, before
  its frontend-and-docs-only branch could run, so a push Render does not build never reached
  app.rijeka.app through it. Fixed the same day; the in-process mover already had the order right.

## S1: fix before anyone outside is pointed at it

1. **Cross-tenant write.** `POST /api/cashflows/bulk` deletes every PROJECTED cashflow for a `trade_id`
   with no `user_id` filter and never checks the trade is the caller's (`backend/api/routes/cashflows.py`,
   the delete after the override snapshot). No frontend caller today; still an open hole on a public API.
   Fix: load the trade scoped to the caller (404 otherwise), add `Cashflow.user_id` to the delete.
2. **Lifecycle bypass on create.** `POST /api/trades/` writes a caller-supplied `status` verbatim
   (`TradeCreate.status`, default PENDING) and writes no BOOKED event, so a CONFIRMED trade can exist with
   no signatures, which `PUT` explicitly refuses. Fix: force PENDING on create and route through
   `booking.book_trade` so an event always exists.
3. **Global error handler erases the live desk.** `frontend/src/main.jsx` registers `error` and
   `unhandledrejection` handlers that call `showFatal`, which replaces the root with "COULD NOT START"
   with no has-mounted guard. Four `loadThree()` chains (ScenarioTab, TradeBookingWindow) have no `.catch`,
   so an open tab after a Netlify deploy (404 on the old three chunk) loses the whole desk. Fix: disarm
   `showFatal` once React has mounted (keep the 8 s watchdog), `.catch` the four chains.
4. **Confirm dead end on the legacy window.** The CONFIRM tab renders only when `viewTrade` is PENDING;
   `viewTrade` is never set on a successful booking, so a freshly booked cap, floor, collar or swaption
   shows "Book the trade first" until the user closes and reopens it from the blotter. Fix:
   `setViewTrade(bookedTrade)` on success, or route those products through the unified window.
5. **README describes the March product.** Bloomberg/Refinitiv market data, seven instruments, three
   roles, phantom validation reports v0.5.0/v0.6.0/v0.4.3, Bermudans "roadmap", VaR/CCR/P&L "Phase 4",
   contradicting the same file's later sections. Fix: rewrite the top half as a one-screen overview of
   what is live, validation = the reference suite plus `docs/VALIDATION.md`, roadmap = a pointer to
   the in-app one.
6. **Landing page (rijeka.app) inconsistent and stale.** "Next: FX options" beside "FORWARDS AND OPTIONS
   LIVE"; counterparty credit listed as NEXT; meta description claims credit, equities and commodities;
   it links the 28 October methodology PDF. Source is `netlify_drop/`, git-ignored, deployed by hand.
   Fix: one alignment pass against the in-app roadmap, link the app's PDF, redeploy.

## S2: before launch

### Backend
- Raw error text to clients: `detail=f"Integrity error: {msg}"` in booking (psycopg includes the
  statement), `str(e)` in pnl, chain RPC text in four places, 28 `detail=f"...{e}"` sites in all. Route
  non-validation exceptions through `_errors.internal`.
- Public health body carries scheduler exception text (200 chars per failed step) on an
  unauthenticated route. Keep only the class name public.
- Rate limiting: `heavy()` guards four handlers; unguarded and equally expensive: XVA currency
  (10,000 paths), XVA calibrate, CCR `live=1`, P&L EOD, risk metrics (recomputes the report every
  call), the Excel replications (the XVA book runs a calibration and a 200-path MC per download),
  Prometheus analyse and book brief (16k max tokens, adaptive thinking, tool rounds, SDK default
  timeout, no per-account budget). Also `risk/report?date=` with no stored row computes without `heavy()`.
- Chain confirm holds a request thread up to 180 s under a per-process lock; a handful of concurrent
  confirmations queue everyone on a 40-thread pool. Submit, return pending, reconcile in the scheduler
  (the reconcile path exists).
- `DELETE /api/trades/{id}` 500s on any booked trade (events are ON DELETE RESTRICT plus a trigger).
  Refuse with 409 or make delete a CANCELLED event.
- Raw `uuid.UUID(...)` / `date.fromisoformat(...)` on path and body strings become 500s (trades, org,
  booking counterparty_id). Type the parameters.
- The two create paths validate differently: `TradeCreate` derives option structure from the style,
  `BookingRequest` validates IR_SWAP only, so an option booked via `/api/book/trade` relies on the DB
  CHECK. Share one validator.
- `FX_SWAP` is bookable (`NO_LEG_INSTRUMENTS`) but has no pricer and is unknown to P&L, risk, CCR and
  the canonical record. Drop it from the allowlist.
- Scheduler reruns every daily batch for every account on each restart and every two hours
  (`due()` true on the first cycle; no "already stored today" skip). Skip accounts with today's row.
- No logging configuration anywhere: under uvicorn every `log.info` is dropped on Render. One
  `basicConfig` at startup.
- Cross-tenant tests never run in CI (dummy DATABASE_URL, the RLS suite skips) and test reads only.
  Add a negative write test per route with the mocked DB.
- `GET /api/ops/usage` and the CSP report listing return platform-wide analytics to any signed-in
  user. Gate on admin.

### Frontend
- Product labels: `.replace('_', ' ')` replaces the first underscore only (TradeCard, PnlPage, RiskPage);
  the blotter shows the raw key. One `productLabel()`.
- DV01 in user copy (swaption "CURVE DV01", XVATab "bp = VA / DV01") although the pricer bans it. IR01
  everywhere, one SENSITIVITY_LABELS constant.
- Sprint jargon on screen: "SPRINT 6" on the CCR config section, sprint badges on eight items, "Sprint 8"
  in two tooltips. "On the roadmap" wording.
- FundingDetail shows a hard-coded "Last updated: 2025-01-15".
- `/pricer` is routed but unlinked, with `alert()` stubs for BOOK and 5–8 px inline font sizes. Remove
  the route, the 700-line page and its CSS.
- Methodology tab fetch has no `r.ok` check: a 401/502 body becomes `products` and `.map` throws.
- Dead code (verified no importer): `trade-window/products/fx.js` (non-compiling skeleton), two unused
  terms bodies, three stores (`useTradeLegsStore`, `useTradeEventsStore`, `useCashflowsStore`),
  `CurveInputPanel`, `IrSwapStructures`, `NewTradeWorkspace.css`, `TradePanel` in BlotterShell.
- Migration file paths shown to end users in Users, RiskSettings and PnlPage copy.
- No `React.lazy`: the 1.6 MB main chunk carries the 4,136-line legacy window, SwaptionVolDetail,
  ScenarioTab, XVATab, every config page and the docs. Lazy-load config, market data, docs and the legacy
  window.
- Accessibility basics: 7 aria-labels across 179 inputs, close controls as `<span onClick>`, decorative
  dots with `cursor:pointer` that do nothing, table rows with no keyboard path.

### Docs and repo
- LICENSE lists `backend/pricing/` as Apache but the risk, ccr, pnl and market_data engines fall under
  the "everything else" BSL clause with no stub; README calls them "engine". List every backend
  directory with its licence.
- SELF-HOSTING says `docs/schema.sql` is the whole schema; it lacks eight tables (risk_limits,
  risk_settings, eod_marks, pnl_daily, pnl_signoffs, ccr_daily, chain_attempts, usage_hits) and the
  role CHECK is the old three roles. Re-export from a migrated database, or say "then run
  docs/migrations in date order"; fix the role instruction (profiles.role, not auth metadata).
- `docs/DEPLOY_CHECKLIST.md` is a March artefact (old repo name, `git add .`, a JWT shared secret the
  security model no longer has, api.rijeka.app which does not resolve). Delete; `docs/ops/deploy.md`
  is the reference.
- `docs/EXOTIC_OPTIONS_ROADMAP.md` is headed "Private and Confidential, do not commit", lists products
  that exist only as leg-type strings, and puts live touch options under "to add". Archive it.
- Missing pages a reviewer expects: `docs/architecture.md` (Netlify → Render → Supabase, relayer and
  registry, Anthropic, public data, the release-branch deploy chain, one diagram), an environment
  variable reference (about 30 `RIJEKA_*` variables, half explained only in render.yaml comments),
  `CHANGELOG.md` with one version constant (API says 0.4.0, tags stop in April, methodology 1.2), a
  model inventory (product · module · methodology section · reference rows · validation · open findings).
- `model_validation/` holds only the April v0.4.2 report; README cites three others. A README in the
  folder saying the current evidence is the reference suite.
- `docs/pnl_attribution.md` says swaption vols have no step in two places and that they do in a third;
  the code agrees with the third. Issue #31 to be re-scoped to cap vol.
- `BTC01` survives in README and three backend comments; everything else says `CRY01`. A one-table
  glossary of the sensitivity names.
- Privacy notice v1.0 predates the usage beacons, CSP reports and client error reports. Add the
  paragraph; a three-line "what the hosted demo stores and who sees it" box in README.
- Tracked duplicates of the landing and static tools (`landing/`, `frontend/landing/`,
  `frontend/public/landing.html` served live, diverged irs/xva copies) and two dead netlify redirects.
- Dependabot PRs #1–#3 (actions majors, green), #4 (npm, green), #14 (pip: FastAPI 0.141→0.162,
  SQLAlchemy 2.0→2.1, anthropic 0.121→2.3, dateutil 3.0; backend tests fail) open since 30 October
  while SECURITY.md says dependencies are audited. Merge the four green ones; split #14.

## S3: what an open-source reviewer will comment on

Backend: four copies of `_secret_ok` (two non-constant-time), role checks inlined about forty times,
three identical in-memory rate limiters, root-level routes (`/price`, `/nodes`, a shadowed `/health`),
`print()` in the pricer hot path, unbounded `SimulateRequest`, dead `pricing/pnl.py` and
`cap_vol_strip.py`, sprint scripts at the repo root, deprecated `on_event` and `declarative_base`,
five unpinned requirements, no linter in CI, 37 of 179 HTTP operations covered by route tests.
Frontend: 40 copies of the API base constant, about 40 local number formatters, two global
`.tbw-window` rules that disagree, 170 hard-coded hex colours, `alert()`/`confirm()` in onboarding,
nine `console.log` timing lines in the cap handler, no Escape on floating windows, mixed store export
conventions. Docs: CONTRIBUTING says ~400 tests and omits the dev requirements, no PR template or DCO
check, the validation issue template lacks the FX, crypto, risk and credit products, `security@` vs
`miko@`, migration numbers cited that do not exist as files, `.gitignore` rules that fight the docs
tree, the Swagger page live but unlinked, `frontend/README.md` is Vite boilerplate.

## Status

- **Batch A shipped 2 November 2026** (PR 50): every S1, the backend S2 hygiene, the frontend quick
  fixes, the README top half, the two stale docs.
- **Batch B shipped 2 November 2026**: `docs/architecture.md`, `docs/ops/environment.md` and a complete
  `.env.example`, `CHANGELOG.md` with one version constant (0.6.0, tagged), `docs/model_inventory.md`,
  `docs/glossary.md`, LICENSE with every directory named and stubs, privacy v1.1, the self-hosting
  guide corrected (migrations, roles), `model_validation/README.md`, lazy routes and vendor chunks
  (first screen 450 → 286 kB gzip), ruff at zero findings in CI, the duplicate landing copies and dead
  redirects removed, the validation issue template extended.
- **Batch C shipped 2 November 2026**: the unified trade window books swaptions, caps, floors and collars
  through the atomic route (`booking.js` builders with 11 unit tests; the bodies validated through the
  backend's `BookingRequest`, `complete_booking` and the exposure engine's term reader) and opens every
  existing trade (view mode: read-only ticket, legs fetched, priced on open, CONFIRM with the UTI, the
  counterparty's ref, proof link and live follow); the gate and the 4,156-line legacy window, its CSS and
  the curve designer are deleted; vitest added with a CI step. View mode was verified by reading and by
  the contract test, not in a browser.
- **After C, same evening**: XVA on every ticket from the credit engine (incremental charge, with and
  without the trade on the same paths; options included), the stand-alone forward XVA on the pair's own
  surface, Excel replications of the FX and digital-asset forward XVA (50 checks each, all PASS); a
  new-version bar so an open tab learns of a deploy.

## The plan to 90+

Three batches, in order. Each is a PR with tests, merged through the usual chain.

**Batch A (one day, worth about ten points): the S1 list and the backend S2 hygiene.** Cashflow scope,
create lifecycle, `_errors.internal` everywhere, health body, `heavy()` on every expensive handler plus
a Prometheus budget and client timeout, delete → 409, typed parameters, shared booking validator, drop
FX_SWAP, scheduler skip-if-stored, logging config, admin gate on usage and CSP, negative write tests;
frontend `showFatal` guard and the four `.catch`, `setViewTrade` on booking, `productLabel()`,
IR01 labels, sprint wording, FundingDetail date, remove `/pricer`, Methodology `r.ok`, delete the dead
files, migration paths out of user copy. README top half, DEPLOY_CHECKLIST deleted, exotic roadmap
archived, `BTC01` → `CRY01`, pnl_attribution VOL rows, #31 re-scoped.

**Batch B (one day): the pages a reviewer expects.** `docs/architecture.md`, `docs/ops/environment.md`
and a complete `.env.example`, `CHANGELOG.md` and one version constant with a tagged release, the model
inventory, schema re-export or the migration note in SELF-HOSTING, LICENSE directory table and stubs,
privacy v1.1, model_validation README, glossary, lazy routes and `manualChunks`, the duplicate landing
copies removed, ruff in CI.

**Batch C (two to three days): retire the legacy booking window.** Extend `booking.js::executeBooking`
so cap, floor, collar and swaption book through the unified window, then delete the 4,136-line
`TradeBookingWindow` and its tabs. This is the single change that moves the frontend past 90.

**Decisions that are Miko's**, not code: merge the four green Dependabot PRs and split #14; whether
the risk/ccr/pnl engines are Apache (the README implies yes); track `netlify_drop/` in the repository
or state where its source lives; one security contact address; whether the Swagger page stays public;
api.rijeka.app DNS (dead) and `RIJEKA_GITHUB_TOKEN` on Render (the release move still runs by hand);
enforce CSP after the quiet week; the landing page redeploy with the v1.2 PDF.
