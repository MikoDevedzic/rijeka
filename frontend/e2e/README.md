# Browser journeys

Quinn's tests (`.claude/agents/quinn.md`): the built app, in a real browser, on the local stack. They exist because
unit tests and the build did not catch what users saw: a page that crashed on an undefined variable, a tab that
crashed on a stored record's shape, results that fell below the fold, a PRICE that ran before the par rate had solved.

```bash
cd frontend
npm run e2e                 # starts the stack, builds the app against it, runs every journey
npm run e2e -- pages        # one file
npm run e2e:chain           # the journeys that need a chain: the same stack with a local test chain beside it (below)
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

| Chain | `127.0.0.1:8546`, only under `npm run e2e:chain` | Foundry's `anvil` with the committed registry deployed to it (`backend/stack/chain.py`), and the API told where it is. Without it the stack has no chain, as a self-hosted instance may not: a record is signed and not anchored |

Sign-in: there is no hosted auth server. `serve.sh` mints a four-hour token per seed user with the stack's key
(`backend/stack/token.py`); `fixtures.js` places it where supabase-js keeps its session, so the app starts signed in.
The auth host and realtime are quiet stubs in `fixtures.js`. The sign-in form itself is not covered yet.

Needs: PostgreSQL 16, PostgREST (`brew install postgrest`; CI downloads the static binary), the backend's virtualenv,
`npx playwright install chromium`; for `npm run e2e:chain`, Foundry's `anvil` (on `PATH` or in `~/.foundry/bin`).

## The journeys

| File | What it proves |
|---|---|
| `pages.spec.js` | every page opens signed in with no uncaught error, no console error, no failed API call, no error boundary |
| `methodology.spec.js` | the system page: the scene is drawn (or the page says it cannot be), every piece is named, a step says what happens and names its routes, a piece says what it does, FOLLOW A TRADE starts and stops, and the strip shows the version the API itself reports; a section: all nineteen in the syllabus, §12 at its own address with formulas set and numbered as the PDF's (20), no LaTeX left in the text, the inventory's three models beside it with its status and its workbooks, the worked table repriced by typing and a dash for nonsense, a reference in the text leading to §13, the parts of §17 in the syllabus, the reference table of §18, the workbooks, the document's own page |
| `controls.spec.js` | from the computed style: the blotter's row under the pointer is a band with a rule at its edge and its search box is a well; on the ticket a choice is a well, + ADD LEG is raised on a foot and lifts under the pointer, a strike is a well that takes its lightest fill and a brass ring in focus, a leg's row is lit under the pointer, BOOK is brass and PRICE an ordinary raised button; a P&L button, a workbook button and the methodology's own are raised |
| `ticket-rates.spec.js` | a new swap priced at once waits for the par rate (never a 0 % coupon); XVA under a bilateral CSA with the on-chain comparison, the saving on one row, one sign per figure, the results fully on a 1440×900 screen, the inputs column not overflowing; the margin in USDC shows a negative ColVA and the same CVA; CAPITAL has seven stock rows and no prices; BOOK; CONFIRM shows the attestation |
| `launch.spec.js` | a launch workspace (the home, the narrow navigation, the simple XVA view); a demo user for whom capital is on request (the Modules page, no CAPITAL tab, no Risk → CAPITAL, KVA still on the XVA tab; the answer is given by the journey because the stack runs with provisioning off, and the API's own answer is `backend/tests/integration/test_modules.py`); an existing firm untouched |
| `ticket-shape.spec.js` | a new ticket opens on a digital-asset forward; TRADE holds no valuation on any product; DETAILS is two panels; a forward's CASHFLOWS has its tiles and a table per leg that add up to the net and to the engine's NPV, with the valuation under them; IR01 is the same colour on a forward and a swap; a figure that changes rolls through well-formed figures to its new value and flashes, and does not with reduced motion |
| `ticket-polish.spec.js` | the tabs have an edge and the selected one is filled; DETAILS is set as TRADE is (words in the interface face, numbers in mono, a field's size); a note is hidden until its mark is hovered or focused, stays inside the browser, and NOTES writes every note out and is remembered; EXPORT XLSX downloads a workbook with the legs, the net and the market; on XVA the inputs column does not scroll inside itself, the results and the assumptions are in view, the run and the on-chain row are set alike, a figure is the colour of its sign, and the unit is said once |
| `ticket-scenario.spec.js` | the forward's answer carries its discounting curve's pillars; the scenario tab lists the curves that price the trade; the discounting curve is shocked flat (the table's IR01 × shock is the ticket's), by a typed point with a sign (an unreadable one changes nothing) and by a drag on its chart; the factors and the cross add up to the total; one ladder whose middle column is the scenario; RESET CURVE takes back one curve and RESET ALL the rest; the inputs column does not scroll inside itself; an FX forward lists both rate curves and moves its quoted points in pips; an option adds its vol surface |
| `blotter-menu.spec.js` | right-click a trade: the menu opens at the pointer inside the window, offers nothing that changes a trade, and Escape puts it away; Copy reference puts the reference on the clipboard; a status chosen from the menu narrows the blotter and the rail's ALL shows every trade again (it used to hide them all); the counterparty filter and "Show every trade again"; the keyboard ticks a trade and opens it |
| `ticket-legs.spec.js` | DETAILS of a forward is one leg, an outright; STRIP × 3 adds two legs a month apart, each priced by the engine near zero at its fair forward; a typed strike moves that leg's value and the package's total is the sum; an unreadable strike goes back; a side flipped makes it CUSTOM; BOOK pressed while a leg is still being priced books nothing and says so; then BOOK books three trades tagged with the package and their place, each further leg named after the first; booked legs are not edited; the blotter finds the three by the package's reference and the row menu offers its legs; NEW TRADE and another pair start with the ticket alone; a package that stops part of the way is finished from the table; on an option ticket a risk reversal, a straddle and a calendar are one press and are named for what they are; a leg made a barrier opens its terms with a level and is priced as one, an unreadable level goes back, a touch has no strike and no size; the booked legs are option trades with their style as structure and the blotter shows it; a forward with a put leg made a digital books a forward and a digital; an FX forward prices a call leg The XVA tab of a strip of three: SIMULATE 3 LEGS posts every leg to `/api/xva/currency-package`, the answer is a package with a row per leg, the netting line shows the set's peak exposure at most the legs' added up; a leg removed clears the run; with no further leg the ticket runs on its own route again Wrong-way risk: a sold forward simulated independent has no wrong-way line; with the counterparty's intensity × 3 when the coin halves the same paths give a larger CVA, the answer's independent figure is the first run's, and the line says WRONG-WAY RISK with both Margin and capital on a digital-asset ticket: no label says SIMM; on chain with the amount blank the answer names the engine's estimate and the tab says not ISDA SIMM; 250k typed is 250,000 held for the life with a negative MVA; Group 2b raises KVA and moves nothing else, and the tab names SCO60.99 A package is booked by one call under one trade ID (TRD-…) with a leg ID each (-1, -2, -3); a refused package books nothing and RETRY BOOK books the three; the CONFIRM tab names the trade ID and every leg, one press confirms the three as one record, no leg is confirmed on its own, the certificate shows the package, its hash and the leg's own hash, VERIFY finds the leg in the package, and the blotter shows three CONFIRMED legs With further legs the footer is the package's (PACKAGE NPV the sum of the legs, the structure as DETAILS names it, every label on one line), CASHFLOWS lists every leg and the dates on which money moves with each leg's own flows behind its button and exports the package's workbook, and CURVE SCENARIO reprices every leg under one scenario (a spot shock moves each leg and the package is their sum; a vol shock moves only the option leg); a leg made a barrier leaves the scenario on leg 1 and says so |
| `shortcuts.spec.js` | the function keys: each does what its button does (pages, a new ticket, price, XVA, simulate, confirm) and each button shows its key; which keys are taken from the browser and which are left to it; the booking chord books only the ticket that holds the focus, once, and nothing from a field outside it; with several tickets open a key means the newest or the one last touched; the keys are off on a legal page; no keycap widens the top bar at 1366 |
| `ticket-fx.spec.js` | a forward and an option, FX and digital asset: priced, XVA with the saving on chain in view, a stablecoin on both sides costs its carry |
| `chain/confirm-anchored.spec.js` (`npm run e2e:chain`) | a confirmation that is really anchored: CONFIRM ON-CHAIN on a booked swap is answered with an anchor on the stack's test chain; the ticket draws the R with its ring and says CONFIRMED ON CHAIN; the certificate names the chain, the transaction and the hash; the node itself, asked without the app, has the transaction succeeded to the registry in that block with the registry's `Confirmed` event for that hash, and `isConfirmed` true for it and false for a hash nobody confirmed; VERIFY agrees; the public register lists the row with two LEIs; the blotter shows the trade confirmed |

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
