# Browser journeys

Quinn's tests (`.claude/agents/quinn.md`): the built app, in a real browser, on the local stack. They exist because
unit tests and the build did not catch what users saw: a page that crashed on an undefined variable, a tab that
crashed on a stored record's shape, results that fell below the fold, a PRICE that ran before the par rate had solved.

```bash
cd frontend
npm run e2e                 # starts the stack, builds the app against it, runs every journey
npm run e2e -- pages        # one file
npm run e2e:serve           # the stack alone, to click through by hand at http://127.0.0.1:4174 (signed out: see below)
```

Nothing here touches production. `serve.sh` refuses a hosted database.

## What runs

| Piece | Where | What |
|---|---|---|
| Database | `postgresql:///rijeka_test` (or `RIJEKA_STACK_DATABASE_URL`) | `backend/stack/up.sh`: schema, every migration, the seed (two users, one firm, market data of 2 November 2026) |
| REST | `127.0.0.1:3010` | PostgREST on that database, for the reads the app makes through supabase-js (profiles, trades, counterparties, legal entities, org nodes); row-level security applies as on Supabase (`backend/stack/rest.sql`) |
| API | `127.0.0.1:8010` | `uvicorn main:app` with the stack's environment; rate limits off (`RIJEKA_RATE_LIMITS=0`, honoured only on the stack) |
| Web | `127.0.0.1:4174` | `vite build` against the two above, served by `vite preview` |

Sign-in: there is no hosted auth server. `serve.sh` mints a four-hour token per seed user with the stack's key
(`backend/stack/token.py`); `fixtures.js` places it where supabase-js keeps its session, so the app starts signed in.
The auth host and realtime are quiet stubs in `fixtures.js`. The sign-in form itself is not covered yet.

Needs: PostgreSQL 16, PostgREST (`brew install postgrest`; CI downloads the static binary), the backend's virtualenv,
`npx playwright install chromium`.

## The journeys

| File | What it proves |
|---|---|
| `pages.spec.js` | every page opens signed in with no uncaught error, no console error, no failed API call, no error boundary |
| `ticket-rates.spec.js` | a new swap priced at once waits for the par rate (never a 0 % coupon); XVA under a bilateral CSA with the on-chain comparison, the saving on one row, one sign per figure, the results fully on a 1440×900 screen, the inputs column not overflowing; the margin in USDC shows a negative ColVA and the same CVA; CAPITAL has seven stock rows and no prices; BOOK; CONFIRM shows the attestation |
| `launch.spec.js` | a launch workspace (the home, the narrow navigation, the simple XVA view); a demo user for whom capital is on request (the Modules page, no CAPITAL tab, no Risk → CAPITAL, KVA still on the XVA tab; the answer is given by the journey because the stack runs with provisioning off, and the API's own answer is `backend/tests/integration/test_modules.py`); an existing firm untouched |
| `ticket-shape.spec.js` | a new ticket opens on a digital-asset forward; TRADE holds no valuation on any product; DETAILS is two panels; a forward's CASHFLOWS has its tiles and a table per leg that add up to the net and to the engine's NPV, with the valuation under them; IR01 is the same colour on a forward and a swap; a figure that changes rolls through well-formed figures to its new value and flashes, and does not with reduced motion |
| `ticket-polish.spec.js` | the tabs have an edge and the selected one is filled; DETAILS is set as TRADE is (words in the interface face, numbers in mono, a field's size); a note is hidden until its mark is hovered or focused, stays inside the browser, and NOTES writes every note out and is remembered; EXPORT XLSX downloads a workbook with the legs, the net and the market; on XVA the inputs column does not scroll inside itself, the results and the assumptions are in view, the run and the on-chain row are set alike, a figure is the colour of its sign, and the unit is said once |
| `ticket-scenario.spec.js` | the forward's answer carries its discounting curve's pillars; the scenario tab lists the curves that price the trade; the discounting curve is shocked flat (the table's IR01 × shock is the ticket's), by a typed point with a sign (an unreadable one changes nothing) and by a drag on its chart; the factors and the cross add up to the total; one ladder whose middle column is the scenario; RESET CURVE takes back one curve and RESET ALL the rest; the inputs column does not scroll inside itself; an FX forward lists both rate curves and moves its quoted points in pips; an option adds its vol surface |
| `blotter-menu.spec.js` | right-click a trade: the menu opens at the pointer inside the window, offers nothing that changes a trade, and Escape puts it away; Copy reference puts the reference on the clipboard; a status chosen from the menu narrows the blotter and the rail's ALL shows every trade again (it used to hide them all); the counterparty filter and "Show every trade again"; the keyboard ticks a trade and opens it |
| `ticket-legs.spec.js` | DETAILS of a forward is one leg, an outright; STRIP × 3 adds two legs a month apart, each priced by the engine near zero at its fair forward; a typed strike moves that leg's value and the package's total is the sum; an unreadable strike goes back; a side flipped makes it CUSTOM; BOOK pressed while a leg is still being priced books nothing and says so; then BOOK books three trades tagged with the package and their place, each further leg named after the first; booked legs are not edited; the blotter finds the three by the package's reference and the row menu offers its legs |
| `shortcuts.spec.js` | the function keys: each does what its button does (pages, a new ticket, price, XVA, simulate, confirm) and each button shows its key; which keys are taken from the browser and which are left to it; the booking chord books only the ticket that holds the focus, once, and nothing from a field outside it; with several tickets open a key means the newest or the one last touched; the keys are off on a legal page; no keycap widens the top bar at 1366 |
| `ticket-fx.spec.js` | a forward and an option, FX and digital asset: priced, XVA with the saving on chain in view, a stablecoin on both sides costs its carry |

A journey fails on anything the browser reports while it runs (`fixtures.js` `problems`): an uncaught exception, a
console error, any 4xx or 5xx from the API or the REST layer except a 404 on a read the page treats as "nothing
stored yet".

## Adding to them

A new page goes in `pages.spec.js`. A new tab, button or panel a user will press gets a step in a ticket journey,
with the layout checks from `fixtures.js` (`expectFullyInView`, `expectNoHorizontalOverflow`, `expectNoInnerScroll`).
Containers whose layout is asserted carry a `data-testid`. Assert what the user sees and what the request carried,
not that a button exists.

On failure: `e2e/.out/results/<test>/` has the screenshot and a trace (`npx playwright show-trace …/trace.zip`);
`e2e/.out/api.log` and `postgrest.log` have the servers' side.
