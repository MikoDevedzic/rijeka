# Changelog

By date, newest first. The API reports its version and commit on `GET /api/ops/health`; the
methodology document carries its own version (v1.9). Commits on `main` are the detail.

## Legs, step 2: every option style as a leg; collar, risk reversal, straddle, calendar · 10 November 2026 (frontend only)

- **A leg can be a forward, a call, a put or a touch**, on a forward ticket and on an option ticket alike (every
  currency and digital-asset product but spot). A call or a put carries its style: European, American, digital,
  barrier or double barrier; a touch is a type of its own, with no strike. Choosing a style opens its terms in a
  row under the leg (the barrier and whether it knocks in or out, the two levels, the payout), started around the
  forward, with a sentence saying what they mean. They are the fields of the standalone option ticket.
- **Each leg is priced and booked by the code that prices and books it as a ticket of its own.** The ticket's
  builder of the price request and of the trade's record now takes any leg's terms; the ticket's own trade goes
  through the same code, unchanged. A booked option leg is a CRYPTO_OPTION or FX_OPTION trade with its style as
  its structure, as a standalone one is.
- **The two-option structures are one press on an option ticket:** a collar or a risk reversal (the other of call
  and put on the other side, as far from the forward), a straddle (the other at the same strike and side), a
  calendar (the same option a month later, the other side). A strip works for options as for forwards. The
  package is named for what it is (and CUSTOM once it is changed), by the strike the ticket is priced at.
- **The picture:** legs on one date draw what the package pays at expiry, less the options' premium, with each
  strike and barrier marked (a barrier is read at the expiry alone, and the note says so); legs on several dates
  draw the strikes against the fair forwards, as before.
- **The blotter** shows an option leg's style beside its place (TOUCH · CUSTOM 2/2).
- **Not in this step:** the other tabs and the footer over the whole package (they show the first leg); one
  confirmation and one XVA run for the package; a rebate on a barrier, a payout in the base currency and a
  double touch on a leg (the standalone ticket has them); pasting or importing legs from Excel.
## 0.16.4 · 10 November 2026

**Two bookings in one second no longer ask for the same reference.**

- **What broke.** A trade booked without a reference was named `TRD-` and the last eight digits of the clock's
  second. Two bookings by one user inside a second (a package posting its legs, two tickets, two windows, a
  double press) asked for the same name; one user's references are unique (`uq_trades_user_ref`), so the second
  was refused: 500 "The trade could not be saved" from `POST /api/trades/`, 409 from `POST /api/book/trade`.
- **Now.** The reference keeps its shape, `TRD-` and eight digits, and the first booking of a second reads as it
  always did. The trade row is inserted inside a savepoint; when the database says the name is taken, the next
  number is tried (eight in a row, then numbers drawn at random, so a long burst costs a bounded number of
  attempts). The database decides, not a read before the write, so two requests in flight are told apart too.
  One helper, `backend/api/routes/_trade_ref.py`, used by both create routes and so by the booking made from a
  counterparty's card.
- **A reference the client supplies is never changed.** A duplicate is refused with 409 on both routes
  (`POST /api/trades/` answered 500). A generated reference never takes the `-2` form a package gives its own
  further legs.
- **The BOOKED event names the trade as the row does.** `POST /api/book/trade` assembled its event before the
  row had its name, so a generated reference was null in the event while the row carried it (found by the
  database keeper's and the reviewer's reads of this change). New bookings record it; events already written are
  not rewritten.
- No schema change and no migration: the index is the one production already has.

## A forward as a package of legs: strips · 10 November 2026 (frontend only)

- **DETAILS of a currency or digital-asset forward is now a table of legs.** The first leg is the ticket itself
  (set on TRADE). **+ ADD LEG** adds the same forward a month later; **STRIP × 3 / 6 / 12** fills a forward for
  each month. Every further leg has its own side, size, settlement date and strike; a strike left empty is the
  fair forward for its date, worked out by the engine. Each leg is priced by the same route as the ticket, and
  the value, the spot sensitivity and IR01 add in a PACKAGE row. Under the table, the strikes against the fair
  forwards, with the size of each leg.
- **BOOK books the package** (the button says how many legs): each leg is its own trade, of the kind the desk
  already prices, fixes, settles and confirms, tied by a tag in the trade's `strategy` field
  ("STRIP PKG-M3K9Q2 2/6"), which is the booking firm's own and is never shown to the counterparty. No database
  change. A leg that does not hold the price of the terms it shows stops the booking before anything is sent,
  and says which. If a later leg is refused after earlier ones were booked, the table says how many stand and
  why the next did not, and BOOK THE REMAINING LEGS books the rest under the same package without sending the
  booked ones again. NEW TRADE, another pair or another product starts with the ticket alone.
- **The blotter** shows a package leg's place (STRIP 2/6) in the STRUCTURE column, finds a package by its
  reference in the search box, and the row's right-click menu offers "The n legs of this package".
- **Not in this step:** option legs and the presets that need them (collar, risk reversal, straddle, calendar);
  the other tabs (CASHFLOWS, XVA, CURVE SCENARIO, CONFIRM) and the footer still show the first leg; one
  confirmation and one XVA run for the whole package; pasting or importing legs from Excel.
- **Found on the way, not fixed here:** the API names a trade by the clock's second, so two trades booked by one
  firm in the same second collide and the second is refused with a 500. A package names its further legs after
  the first (TRD-94333140-2), which avoids it; two separate tickets booked in the same second still can.

## A right-click menu on the blotter; ALL shows every trade again · 10 November 2026 (frontend only)

- **Right-click a trade in the blotter** for a menu at the pointer: open it (or the ticked trades together), copy
  its reference, its UTI or the counterparty's reference, show only the trades of its counterparty, its asset
  class or its status, show every trade again, tick or untick it. The arrows, Home, End, Enter and Escape work
  it. Nothing on the menu changes a trade: confirming and terminating stay on the ticket, where the terms are in
  front of the person who acts. Text fields and links keep the browser's own menu.
- **Fixed: ALL STATUS, ALL CLASSES and ALL STORES hid every trade.** After choosing a status, a class or a store
  in the rail, pressing its ALL button emptied the blotter ("no trades match filters") until the page was
  loaded again: the button wrote an empty value and the filter read it as a value to match. Found while wiring
  the menu's own filters. The rule is now one function with its own tests (`lib/blotter-filter.js`).

## The shell: the name, the top bar, the blotter's rail · 10 November 2026 (frontend only)

- **The name is the brightest thing on the page.** RIJEKA on the top bar (and on the home page's own bar) is
  brass, a size larger, and carries a soft light that breathes slowly; with "reduce motion" set it is still.
- **The pages on the top bar read as buttons.** The page you are on is a lighter panel over the brass rule, as
  a selected tab on the ticket is; the others light under the pointer.
- **The blotter's rail has a hierarchy.** A section's heading (STATUS, ASSET CLASS, STORE) was smaller and
  fainter than the choices under it. It is now their size, in the bright text colour and a heavier weight, with
  a rule above it, and the choices sit under it a step in. The selected choice is the lighter panel with the
  brass rule at its edge.

## 0.16.3 · 10 November 2026

**CURVE SCENARIO in the XVA tab's shape (forwards and options on a currency pair or a digital asset).**

- **Every curve the price was built on is listed** at the left, each in its risk factor's colour, with what has
  been done to it: the spot, the forward points (a digital asset's forward basis), the discounting curve, the
  second currency's curve on a currency pair, the vol surface on an option.
- **One way to move any of them.** The selected curve takes a flat shock (a slider or a typed number), a shock
  on one point (typed in the table beside it), or a drag on the chart. Before, only the forward curve could be
  dragged and the rate curves were one slider each. A rate curve now draws its own pillars and each can be
  moved; a currency pair's quoted points can be moved together, in pips.
- **The result is one table**, set as the XVA results are: the factors across; the shock at settlement, the
  change in value from each shock alone, what is left over when they act together, and the total; and under it
  sensitivity × shock from the ticket's own risk figures, which adds across factors.
- **One ladder**, laid across, for the selected curve, on top of the scenario (the two ladders side by side are
  gone; the spot ladder used to ignore a dragged spot). Notes are behind their marks, as on the other tabs.
- **What a pillar's shock does.** A forward or an option settles on one date, so of a rate curve its price sees
  the zero rate to that date. A shock on a pillar reaches the price as the engine's own curve would carry it:
  the curve is linear in the log of the discount factor between pillars, so Δ on the pillars a and b moves the
  zero rate at T by [(1 − w)·Δa·ta + w·Δb·tb] / T. A parallel shock is itself; +50 bp on a 2M pillar alone is
  about +16 bp at 3M, not +25. `backend/tests/test_scenario_pillar_shock.py` pins the rule against the engine's
  curve, bumped, and the browser's test carries the same numbers. The tab shows the pillars up to the
  settlement and the two after it: those beyond cannot reach the trade. The repricing is the browser's closed
  form, as the tab already was, and still says APPROXIMATION.
- **API:** `POST /api/currency/forward/price` and `/option/price` answer with `curves`: the discounting curve's
  id and pillars (date, years, zero rate, discount factor) and, where the second currency is carried on a curve,
  that one's (not on quoted points, where the second currency is the one rate the points imply). Display only: no figure in the answer changes. An older web app ignores the field; the new one
  against an older API lists the curve with a flat shock only.
- **Not in this change:** the swap's scenario tab (a separate, older screen); an exotic option keeps the
  engine's own ladder and takes spot and tenor moves only, as before.

## The ticket, easier to read · 10 November 2026 (frontend only; the API stays 0.16.2)

- **Tabs that read as something to press.** The ticket's tabs are one control of joined buttons, each with an
  edge; the selected one is a lighter panel over the brass rule. They were bare words with a rule under one.
- **Notes are behind a mark until they are asked for.** On a forward's or an option's DETAILS and CASHFLOWS, in
  the valuation's breakdown and on the XVA tab, the line that says where a number is from or what a row means
  is now a small mark beside it: hover it, tab to it or tap it and the note shows. **NOTES**, at the right of
  the tab bar, writes every note out where it stands (for learning the screen, for a picture, for a screen
  with no pointer) and is remembered in the browser. The TRADE tab, the swap's own tabs and the scenario tab
  keep their lines for now.
- **One type rule on every tab.** DETAILS set every value in the mono face at a size that moved with the screen;
  TRADE sets a field at 12.5px, numbers in mono and words in the interface face. DETAILS and CASHFLOWS now
  follow TRADE: a number, a date or a formula in mono, words in the interface face, the same sizes.
- **A forward's or an option's CASHFLOWS exports to Excel** (EXPORT XLSX, as the swap's schedule does): what the
  trade is, the legs and their net, and the market it was priced on. A present value is written as amount ×
  discount factor and the net as a sum, each with the figure the tab showed, so the sheet recomputes and can be
  checked against the screen. An option's sheet states the premium and breaks the value into the discounted
  payoff at today's forward and the time value, which add up to it. A figure the quote does not carry is an
  empty cell.
- **XVA: the results are one table.** The adjustments run across; each line of figures is a row named once at
  the left (the run, named for its settlement; its basis points; the same run on chain; the change). The run
  and the on-chain row are set alike: one face, one size, and a figure takes the colour of its sign and nothing
  else (a cost is the colour of a negative, a benefit of a positive, a rounded zero is unsigned and quiet).
  Each adjustment used to carry a colour of its own (a zero in amber, DVA in blue), in ten sizes, and "bp of
  notional" was printed nine times. ALL-IN is the one column that stands out, and the saving on chain the one
  brass figure. Press a column for its definition, as before. No figure is ever cut short: the money steps down
  a size, in every row together, when one figure is long, and on a narrow window the results scroll sideways.
  On a swap the two rates in the basis-point row say what they are (par, rate).
- **XVA: nothing scrolls inside the tab.** The inputs column was pinned to the chart's height and scrolled inside
  itself, so the settlement and the assumptions were out of view. It is now as tall as its inputs, and the
  credit curves and the assumptions sit under the results they drive, in view on a laptop screen for a forward
  or an option. A swap under a CSA has more settlement inputs than fit a 900px screen: there the window scrolls,
  once, and nothing inside it does. The chart is a quarter shorter to make the room.
- **Not changed:** no figure, formula or request. The change in an adjustment is coloured by its sign (what it
  does to the all-in), where it used to be coloured by whether the adjustment shrank.

## Digital assets first; one shape for every ticket; a colour per risk factor · 10 November 2026 (frontend only; the API stays 0.16.2)

- **A new ticket opens on a digital-asset forward.** CRYPTO is the first asset class on the ticket and in the
  blotter's rail, then FX, then RATES. A stored trade still opens on its own asset class.
- **TRADE is what you set; what comes back is elsewhere.** The valuation block (the figures, each with its
  formula, and what the price was built from) and the pointer to the XVA tab have left the TRADE tab on every
  product. The footer carries the headline figures on every tab, as before. A digital-asset or FX ticket's TRADE
  tab now fits the window without scrolling inside it. A swap's price that fails is still said under its terms.
- **CASHFLOWS is the flows, then the valuation, on every new ticket.** A forward is shown the way a swap is: four
  summary tiles (NET NPV, each leg's PV, when and how it settles), a table per leg (what is received, what is
  paid) and the net of the two. The amounts are the ones the tab already showed: N·F against N·K, whose
  difference is (F − K)·N; a cash-settled forward had only the net line, and its two legs say they are not
  exchanged. The valuation block follows the flows, on the swap as well. A stored currency trade opened from the
  blotter has the flows and, as before, no valuation block.
- **DETAILS is the record beside the market it was priced on**, as two panels of rows (what it is, its value,
  where the value is from) in place of a grid of tiles.
- **One colour per risk factor, the same on every product.** A small square before a sensitivity's name: interest
  rates, FX spot, digital-asset spot, forward basis, volatility, time. The IR01 on a swap, on an option and on a
  digital-asset forward is the same blue because it is the same risk, and its tooltip says it adds across the
  book. An asset class takes the colour of the factor it mainly carries (a dot on the ticket's chips, the
  blotter's badges and rail). The figure keeps the colour of its sign.
- **A figure rolls to its new value and flashes once.** In the footer, the valuation tiles, the XVA strip and the
  saving on chain: from zero for a first price, from the figure that was there after that, in a third of a
  second, then a flash in the colour of the way it moved. With "reduce motion" set the new figure is simply shown.
- **Fixed on the way:** the swap's cashflow summary printed a signed zero ("−$0") and coloured the fixed leg red
  and the float leg brass whichever way they ran; a rounded zero is now unsigned and uncoloured, and each card
  and row takes the colour of its figure's sign.

## Function keys · 10 November 2026 (frontend only; the API stays 0.16.2)

- **The desk's keys.** F1 Home, F2 Blotter, F3 New trade (from any page), F4 Price, F5 XVA and, pressed again on
  that tab, SIMULATE, F6 Confirm, F8 Methodology. Ctrl+Enter (⌘+Enter on a Mac) books: a chord, because booking
  writes a trade, and Enter alone books nothing. Each button shows its key; on a screen narrower than 1420px the
  top bar and the BOOK button leave the keycap out (there is no room for it) and name the key in their tooltip.
- **A key does what its button does.** A ticket key presses the ticket's own button, so nothing happens when the
  button is missing (a module switched off) or disabled (a price in flight). With a ticket open F4, F5 and F6 are
  always taken from the browser, so F5 never reloads the page from under a ticket; with none open they are the
  browser's (F5 reloads, as anywhere). A function key held with Ctrl, ⌘, Alt or Shift is left to the browser.
- **Which ticket.** With several open, a key means the ticket that holds the focus; else the one last clicked or
  focused, unless a ticket has been opened since, which is the one in front; else the newest. F3 takes the focus
  out of the ticket it is about to cover.
- **Booking is narrower than the rest.** The chord books only the ticket that holds the focus. Typed in a field
  outside a ticket (the messenger's box, a search field, a form under Configurations) it books nothing and still
  means what it meant to that field.
- **Where the keys are off.** The messenger's own window, the terms and privacy pages, the sign-in page and the
  boot screen.
- **Left as it is:** F7 is kept for the inspector on a figure, not built yet. On a Mac laptop the function keys
  need fn unless the keyboard is set to standard function keys. On Windows F4 on a focused list no longer opens
  it while a ticket is open (it prices). Tickets are still not raised when clicked: a key follows the click, the
  drawing order does not.

## The look: Harbour · 10 November 2026 (frontend only; the API stays 0.16.2)

One colour system, one pair of typefaces, and the first screens a new user meets rebuilt on them (`docs/design.md`).

- **Colour means something, on the screens rebuilt here** (the ticket's TRADE, XVA and CONFIRM tabs, the blotter,
  the top bar). Deep green surfaces, limestone type. Brass is the action of the view, the selected tab's rule and
  what is sealed on chain. A number takes the colour of its sign (green, rose); a selected chip is a lighter
  panel; a status has a colour only when it says something. The teal accent brass replaces was also the colour of
  labels, typed values, selected chips and positive numbers, and on the pages not yet read (the CURVE SCENARIO and
  DETAILS tabs, market data, configurations) brass still stands where teal did: about four hundred uses.
- **Type.** Instrument Sans for the interface and DM Mono for numbers replace Space Grotesk and JetBrains Mono;
  a number is never heavier than the 500 cut.
- **The ticket.** The open tab is the full text colour with a brass rule under it and the others are muted;
  softer corners; PRICE is a quiet button and BOOK TRADE the one brass button, its label now dark on brass (it
  was pale on the accent, under 2:1: a reset rule outranked every class colour in the ticket, and no longer
  does). The paying or selling side is tinted rose; the other is the neutral selected chip.
- **The blotter.** Denser rows and columns sized for what they hold: at 1440 wide every column is shown whole; narrower than that the table
  scrolls sideways instead of cutting every column short. Neutral class badges; CONFIRMED is brass, LIVE green, PENDING a hollow dot, in the rows and in the rail.
- **The XVA tab.** The exposure chart draws EE in limestone, ENE in blue and PFE 95 % in amber over the simulated
  paths; the saving on chain is the tab's brass figure; model inputs are limestone. No figure is added or
  changed.
- **The confirmation.** The signed record is a certificate on paper with a serif heading and a seal drawn from the
  trade's hash: the same hash always draws the same seal, in the stamp's blue and red with its centre point only
  for a record that stands on chain, grey without it for one that is not anchored or is closed. It is drawn when
  the tab is looked at, so a confirmation that lands while another tab is open is not left blank. The heading says
  "Both sides signed the same terms" only where the record says it is bilateral. The rows, the three actions and
  what VERIFY answers are as they were.
- **The home page** keeps its layout and its news; it takes the palette and the type.
- **Not in this change:** the lineage tree on a figure, the mark of where each number came from on the rates
  ticket, EPE on the XVA tab (it needs its reference check first), the three-dimensional vol surface, and the
  pages not listed here beyond the palette. Where two warm colours mark two categories side by side (the
  messenger, the limit bar, EE against PFE on Risk → Counterparty credit) they are closer than they were. On a
  laptop-height screen the policy path's axis labels still run into the line under them, as before.

## 0.16.2 · 9 November 2026

Capital is not part of the hosted demo.

- **No CAPITAL tab beside XVA and no Risk → CAPITAL, for anyone but the admin role.** Where every sign-in gets its
  own sandbox workspace (`RIJEKA_DEMO_PROVISION` on, which is also what an unset variable means),
  `GET /api/modules` answers every user without the admin role with capital off, whatever the firm's row says: a
  workspace made before the launch preset, a preset that includes capital (Dealer, Classroom) and a firm whose
  admin switched it on are all answered the same way. The admin role keeps every module and every switch.
- **Who is not affected.** An instance with `RIJEKA_DEMO_PROVISION=0` holds nothing back. An instance that keeps
  sandboxes (a classroom) sets the new `RIJEKA_HELD_MODULES=NONE`; the same setting can name other modules to hold,
  and a mistyped name in it holds capital as well.
- **Someone it is held from can never switch it on.** A save of the switches keeps what the row said about capital.
  A preset that has it off (Launch, Corporate, Fund) switches the row off; a preset that has it on leaves the row.
  Nothing asked for is refused: a page opened before the deploy still saves its other switches, and ticking
  Capital there changes nothing in the row's switches (it is recorded as a save, with no change). One save is turned away: when the firm's row cannot be read, a save by such a user
  answers 503 and writes nothing, because a failed read would otherwise pass for on (a save whose write fails
  answers 503 too, where it was an unhandled error). The list of changes such a
  user is shown leaves capital out; the audit rows are whole.
- **Configurations → Modules says how to see it.** Capital is listed as off and on request, with the address to
  write to, and has no switch. A workspace that has chosen nothing reads DEFAULT · NOTHING CHOSEN instead of
  EVERYTHING ON; every preset says "(capital on request)"; and since Dealer, Fund and Classroom are then the same
  switches, the preset the firm chose is the one lit. The launch home's link reads "Switch on P&L, risk and more";
  the two roadmap lines that describe the CAPITAL tab and Risk → CAPITAL say they are available on request and
  give the address; the
  note under a counterparty's terms names only the pages the reader has (it named the credit report and the
  CAPITAL tab to a launch workspace that has neither).
- **KVA stays.** It is an XVA charge: the XVA tab, its capital-model input and the saving on chain are unchanged.
- **The switches are asked for again when the API could not answer.** After a 5xx, no answer at all or a body that
  is not JSON, three more times (3, 10 and 30 seconds later). Until the first answer every module is on, as
  before; a read that fails later keeps the last answer. A ticket open on a tab whose module then goes off returns
  to TRADE.
- **The public pulse reads the demo setting like everything else.** `GET /api/public/pulse` said `demo: true` for
  any non-empty `RIJEKA_DEMO_PROVISION`, `0` included, and `false` when it was unset; it now answers what
  `demo.enabled()` answers. On the hosted demo the value is unchanged.
- **What it is not.** Like every module switch it hides pages and tabs and is not an entitlement: `/api/capital`
  stays callable; Risk → Collateral, when a demo user switches it on, still shows the book under collateral
  regimes with its RWA and capital lines; the counterparty form still has its capital attributes. Until
  `GET /api/modules` first answers the app treats every module as on: a ticket opened in that moment has the tab,
  a reload on Risk → CAPITAL draws the page before it is sent home, and if that first read fails the Risk section
  is there until a read succeeds. An account that was given the admin role earlier keeps capital. There is no way yet to show capital to one firm on the hosted demo:
  the admin role is not that (it opens the Users page and platform usage too).

## 0.16.1 · 9 November 2026

Every tab of the currency and digital-asset ticket read as a first-time user reads it, and the ticket under a moving
pointer.

- **The scenario tab moves the forward over the right time.** A rate shock moved the forward over the whole time to
  settlement; the engine carries it from the spot date, so a +1 bp shock on a 3M EURUSD disagreed with the ticket's
  own IR01 by the days of spot lag. The price answers (forward and option) now carry `t_spot`, and the scenario
  reprices with F' = F·(1+s)·exp((Δq − Δb)·(T − t_spot)); a digital asset's lag is zero. The scenario vectors the
  browser and the engine both read (`backend/tests/vectors/fx_scenario.json`) cover it; methodology v1.9 writes it down.
- **AS BOOKED means the quote that was booked.** The term sheet was headed AS BOOKED whenever a trade had been booked
  in the window, also after a term changed, after NEW TRADE, or when a newer price landed while the booking was on
  its way. It now says so only while the quote on screen is the one that was sent.
- **Captions that are the engine's expression.** Each sensitivity's caption carries its sign (± for BUY and SELL) and
  the engine's own formula (CRYBASIS01 and a digital asset's IR01 were captioned with a different one); discount
  factors that run from today say so beside a forward that is carried from the spot date.
- **One number format on a tab.** The term sheet, cashflows and scenario tabs followed the browser's language while
  the fields and the footer were en-US: a German browser showed 10.000.000 beside 10,000,000. A figure that rounds to
  zero is +$0 and takes no colour, never −$0 in red. The footer strip is plain; the tiles carry the sign and colour.
- **A ticket that follows the pointer.** Dragging the ticket re-rendered it for every pixel of travel (1,700 attribute
  writes in a three-second drag). It now moves as one transform a frame and is rendered once, on release; a press
  that does not travel changes nothing. The blotter's row highlight no longer fades behind a moving pointer. The
  footer sits on the bottom edge when a tab is shorter than the window, and the schedule headers stay on one line.
- **The desk's clock is New York from the first line.** `main.py` set `TZ` and nothing else. The C library on Linux
  reads `TZ` once, when Python imports `time`, so the API stayed on the host's zone (UTC on Render) until the first
  timestamp was parsed, and today's date changed under it: between 19:00 and midnight New York the same process
  could store a mark under one date and look for it under another. `main.py` and the worker now call
  `time.tzset()`, and the worker sets the zone outright as the API does. Found by CI, which ran this branch at
  00:24 UTC; `backend/tests/test_desk_clock.py` holds both processes. That it happened on Render is read from how
  CPython and glibc work, not observed there.
- **Tests that change a role drop the API's copy of it.** The auth layer keeps a user's role for 30 seconds. Two
  integration tests set a role in the table directly and left the cache to the clock, so whether a later
  trader-only call was refused depended on how fast the machine ran the suite: it passed on the Mac and on two
  slower CI runs and failed on one in between. `tests/integration/conftest.py::set_role` does both, and a test in
  `test_roles.py` fails if it stops. Known and not changed here: the admin's Users screen writes a role straight to
  the table, so the API honours that change up to 30 seconds late.
- Journeys: a drag of the rates and the crypto ticket rewrites nothing inside it; a price landing while a booking is
  out; the term sheet and captions in a browser that writes decimals with a comma. The smoothness profile
  (`frontend/e2e/perf`, its own config) is a local measurement, not a gate.

## 0.16.0 · 9 November 2026

What a desk head sees on the ticket: the findings of a first-time-user pass, and three names the owner decided.

- **Dates by market convention.** A tenor's value date was today plus N months with no calendar: a 3M EURUSD
  forward got a value date three months from the trade date instead of the spot date, and a 6M BTC forward
  settled USD on a Sunday. The API now gives each pair its calendar (the joint holidays of both currencies for
  three years), its spot date and the dates of every tenor: FX from the spot date, modified following; a digital
  asset from the trade date, on a New York business day; an option's expiry the latest date whose spot date is
  its delivery. A typed date rolls the same way and says so. Found on the way and fixed: five of the seven holiday
  calendars lacked their regional days (a USDCHF spot date could fall on Good Friday); USDCAD spot is one day; a
  digital asset's spot date is now T+0 everywhere. All seven calendars match QuantLib over three years.
- **CRYBASIS01, forward points, the implied BTC rate.** The digital-asset forward's sensitivities are CRY01 (1 %
  spot), IR01 (USD discounting) and CRYBASIS01 (+1 bp a year on the forward basis, a long forward positive; the API
  reports it beside FUND01, its negative). The field once called BTC funding is the implied BTC rate behind the
  forward points, and the forward shows its points FX-style. "Funding" now means only the desk's spread on the XVA
  tab. Every sensitivity on the ticket says its unit; an FX forward shows the two currencies' IR01 apart.
- **A strike booked as displayed.** A default strike is rounded to the pair's decimals by the API (`strike_dp`),
  so the premium shown, the strike booked and a settlement amount agree to the cent. At the fair forward the NPV
  is then the rounding, said so under the strike: cents on BTC (two decimals), up to about 50 USD on a 10m EURUSD
  forward (five decimals), where it was exactly zero before. A typed strike is never rounded.
- **What a touch or a digital pays**, in a sentence (`we receive 100,000 USD if BTC touches 144,000 before
  2027-02-09`), with the call/put and notional controls hidden where they mean nothing; the premium of an option
  shown as a premium (amount, % of notional, per unit); a barrier says how it is observed; BOOK is disabled until a
  counterparty is chosen; one date format on the tabs; colour only for the sign of a number; wording throughout
  (fixing source, settlement date, value date, spot date).
- Methodology v1.8.

## 0.15.0 · 9 November 2026

- **The currency and digital-asset ticket prices itself.** A new ticket opens priced, and reprices 400 ms after
  the last change to a term, the latest answer only. While it reprices the last figures stay on screen, dimmed.
  The automatic price never sends terms the API would refuse; a failure is said beside the value, not in the
  window's title or on BOOK. PRICE remains a forced reprice.
- **BOOK books what was shown.** A quote travels with the terms it was priced for. Pressed between a change and
  its price, BOOK reprices, shows the new figures and asks to be pressed again; it never books figures that were
  not on screen, and never forces a price for terms the ticket has already refused. While a price is awaited the
  footer and the other tabs mark their figures as belonging to the terms before the change, and XVA cannot be
  simulated on them.
- **The forward rate is on the ticket**: the fair forward of the latest quote, its distance from spot and what
  that is a year.
- **A field on its default shows the number.** Spot, strike, vol and funding showed a grey hint that vanished on a
  click and read as an empty field. Each now shows the number the price used, with a few words under it saying
  where it comes from; typing over it is an override, marked, with a control that puts the default back. An
  override is disclosed: the booked trade is revalued on the stored market, so its value in the blotter will differ.
- **Numbers are read one way, whatever the browser's language.** Fields are written with a point for decimals; a
  comma is read only as a thousands separator in the en-US position (`108,250.5`). Text that cannot be read that
  way (`1,08345`, `1.2.3`) is kept, marked, and never priced or booked: before this a browser set to German or
  Croatian wrote `1,08345` into a field and an edit of it was read as 108345.
- **The tenor tells the truth about the date.** A typed settlement or expiry date left the tenor on its old value.
  The tenor now shows the standard tenor the date falls on, or CUSTOM with its length. A digital-asset date stops
  at two years, where the forward points and the vol surface end (a five-year forward was priced at spot plus the
  two-year points); a currency pair is not limited. The option has a tenor too.
- **A vol surface on the CURVE SCENARIO tab of an option**: the term structure (ATM and the two 25-delta lines)
  with the expiry marked, and the smile at the expiry with the strike marked, both moved by the VOL slider. What the
  browser reads off the surface is pinned to the engine's reading by 148 shared test cases, and the tab says so
  if the two ever disagree.
- Option levels are seeded from the option's own vol and expiry, so every style opens as a live trade; a touch no
  longer sends a strike left over from another style. The option ticket's rows are aligned, its labels are one
  line each, and the spot snap is an action of the spot field.
- The scenario tab's heavier requests (the repricing ladder of a non-European option) run only while the tab is
  showing and the quote is current.
- **The exotic pricer at its limits.** An American option whose strike is some 170 standard deviations from the
  forward, and a barrier or touch at a very low vol, raised an arithmetic error and the API answered 500. The tree
  now returns its limit there (the best of exercising along the drift: now, at expiry, or at the interior time
  where the discounted exercise value peaks; within 0.2bp of QuantLib either side of that point). Any arithmetic
  error that still escapes a pricer is answered as terms it cannot value.
- **A payment at the hit was undervalued at a low vol** (found by Emmy while validating the above; older than this
  change). The value of one unit paid at the first hit of a barrier, used by a one-touch paid at the hit and by a
  knock-out's rebate, lost a term where |b|√T/σ is above about 3.7: up to 4.7 % of the payout at a vol of one or
  two percent, exact at the vols of the pairs quoted here (EURUSD at 7 %, BTC at 55 %). It is now evaluated in
  logarithms, and checked against a quadrature of the hitting density, also under negative rates. The pinned
  sample book and the reference table are unchanged.
- Market data → Volatility shows every tenor a stored surface has (a venue's surface has ten; two were hidden).
- 0.14.2 read back from production: approved 4, applied 4, problems 0.

## 0.14.2 · 9 November 2026

- `public.is_admin()` resolves its table in the public schema whatever the caller's session has set
  (`docs/migrations/2026-11-09_is_admin_search_path.sql`, on the approved list; found and reviewed by Edgar on a
  scratch database: the function's body, owner and grants are unchanged, the Users page works as before).
- 0.14.1 read back from production: approved 3, applied 3, problems 0.

## 0.14.1 · 9 November 2026

- The profiles policies of 31 October (`docs/migrations/2026-10-31_profiles_policies.sql`: a user updates their
  own profile row but not their role; an admin updates any row) are on the approved list, so the runner applies
  them wherever they were not. Reviewed by Edgar on a scratch database: role changes through the Supabase client
  are refused for a non-admin, the Users page still works for an admin, the file is safe to run again.
- 0.14.0 read back from production: both approved migrations applied by the runner on its first start
  (approved 2, applied 2, problems 0), the fixings table present.
- This change's lessons are in the role definitions (Vera, Magnus, Quinn, Nikola).

## 0.14.0 · 9 November 2026

- **Fixings for digital assets.** A cash-settled trade's record has always named a settlement price source; nothing
  stored a fixing, so an expired trade was valued on the stored spot of the day and then read zero.
  - **The store** (`backend/settlement/`, table `fixings`, `docs/migrations/2026-11-10_fixings.sql`): the venue's
    daily delivery price for BTC, ETH and SOL (Deribit, 08:00 UTC), read once a day, shared by every account and
    never overwritten by the feed; a desk's own entry for a benchmark, its own only, a later entry superseding the
    earlier one. `GET /api/currency/fixings/{pair}`, `POST /api/currency/fixings`, a cron-gated tick, a scheduler
    step and a health check `crypto_fixings`. Until the migration is applied nothing is stored and everything
    behaves as before.
  - **What the feed's price has to pass.** A date the venue can have published; a value within 15 % of the template
    account's stored spot for that date (the day beside it where there is none), else it is not stored. A re-read
    that differs from a stored fixing stores nothing and marks the date disputed. The tick fills holes among the
    last ten dates; health is red on a hole in the last week or a disputed date. An administrator fills or
    corrects a date with a reason (`POST /api/currency/fixings/correct`; `override_band` with a longer reason
    stores a genuine fixing outside the band); the old row is kept. A desk cannot store a fixing under the
    venue's name or one that reads like it. The venue's source is offered on a ticket only where the feed is
    delivering that pair.
  - **Settlement** (`settlement/rule.py`, one rule for the booked valuation and the ticket): from its fixing date a
    trade is valued on the fixing of exactly the source it names, a forward at sign × N × (fixing − K) discounted to
    the settlement date, an option at its payoff on the fixing; another source's price is never used. With no
    fixing stored the value is today's (the stored spot), marked provisional. A barrier or touch option whose
    knock state is not recorded, and which the fixing does not decide, is provisional too: the amount shown is the
    one that holds if the barrier was never touched. The answer for a booked trade names its `state` (`LIVE`,
    `FIXED`, `SETTLED`); a booked digital-asset trade opened on or after its fixing date shows the fixing used,
    the amount and both dates instead of an error or a scenario. Not in this change: the trade's status does not
    change and no settlement event is written.
  - **On the ticket:** SETTLES ON, a choice between the venue's price (fixed automatically) and the benchmark (the
    desk enters it). The default is the automatic source wherever the feed is delivering that pair's fixing, which
    is the hosted demo once the table is there, and the benchmark elsewhere (`settlement_default` in the pairs
    answer; `fixing_default` is unchanged for older web clients). The fixing time on the record always follows the
    source, and booking checks it. Trades already booked keep the source they name.
  - **FIXING DATE** on the forward: the settlement date for the venue's morning price, one day earlier for a
    benchmark, editable from tomorrow, and no earlier than seven days before settlement, to the settlement date;
    the record's valuation date, checked at booking. Before its fixing date a forward is priced to the settlement
    date (1.4bp of notional per day of gap at a 5 % basis), which is why the gap is limited. An option fixes at
    its expiry, and the ticket says so.
  - **Market data → FX · Crypto → Fixings:** the last thirty days per source, and the entry form.
- **The CURVE SCENARIO tab of currency and digital-asset tickets, redrawn.** A chart of the pair: recent fixings to
  the left of today, the forward curve to the right, the strike and the settlement date marked. The curve is
  dragged by tenor (with a ripple to its neighbours) or as a whole, and the forward, the value and the ladders
  follow, repriced in the browser with the pricer's closed form and the backend's interpolation of forward points.
  FIXING AT EXPIRY takes a scenario fixing and shows the settlement amount. The sliders and ladders remain below.
- Fixed on the way: the tabs of a priced currency ticket could be handed the terms of the moment before the quote
  arrived (none), which the new tab showed as "no settlement price source".
- **Migrations reach production through the API.** The deployed API applies, when it starts, the migrations on
  an approved list (`backend/db/migrations_approved.txt`, copies in `backend/db/approved/`): each line carries the
  file's sha256 and the owner's approval in his own words. One transaction per file with its ledger row, a guard
  against destructive statements, off everywhere but the deployed API (`RIJEKA_MIGRATE`; a hosted database is
  refused outside it); `GET /api/ops/health` → `migrations` counts what was applied and what is pending, and
  `GET /api/ops/migrations` names them for the admin role. A ninth role, Edgar the database keeper, reviews every
  entry (`.claude/agents/edgar.md`).
- `backend/stack/apply.py` and the seed no longer follow the shell's `DATABASE_URL` to a hosted database: one is
  accepted only when named with `--database-url`, never for `--reset` or the seed, and its password is not
  printed.
- PRICE on a booked currency or digital-asset trade revalues it as booked; the button did nothing there before.
- **Security, found by Edgar and Magnus on this change and older than it.** An account with no profile row (the
  sign-up function swallows its own errors, so a failed insert leaves none) was given the role its token claimed,
  and the client writes that claim. The role of a request is now read from the profile only: no row, or a row that
  cannot be read just then, is a viewer. With `docs/migrations/2026-11-09_signup_role.sql`, applied in production
  by the runner in this release, a new account cannot ask to be an admin by either route.
- Methodology v1.7; the map (`docs/architecture.md`) gains "Fixings and settlement", "Migrations in production"
  and the new writers.

## 0.13.0 · 9 November 2026

- *Same day, frontend only:* on Market data → FX · Crypto the source of a pair's forward points is one word in
  the table (FEED, MANUAL, BLOOMBERG; the whole label on hover) and a few words in the list. Printed whole, a
  feed's label wrapped to four lines and stretched every row of the table; the list rows had grown the same way
  earlier in the day. The table no longer spreads across a wide screen.

- **The launch view.** Two people shown the app found it overwhelming. A workspace provisioned for a new sign-in
  now starts on the `LAUNCH` set of modules: book, value, the XVA charge and its saving on chain, confirm.
  - **What a launch workspace shows.** A home page of four next steps and one button; a top bar of five items; a
    ticket without the CAPITAL tab; no P&L or RISK pages; Configurations without the items of switched-off modules
    or the roadmap placeholders. Nothing is removed from the product: the owner switches modules on under
    Configurations → Modules. Switching single modules on keeps the launch view; choosing a full preset such as
    Dealer brings back the dashboard home and the full XVA tab (`GET /api/modules` → `view`).
  - **Existing firms are not touched.** The preset is written only where a firm is created. A firm with nothing
    chosen keeps every module on and the dashboard home; its XVA tab is as it was, plus the one toggle. (A sign-in
    that never had a firm gets one, on the launch set, as any new sign-in does.)
  - **Simple XVA view.** On a launch workspace the XVA tab opens with the counterparty, settlement and collateral,
    SIMULATE, one line saying what the run assumes, and the results. The model inputs are behind SHOW MODEL INPUTS;
    the choice is remembered in the browser. The request sent is the same in both views (a browser journey compares
    them on a rates ticket at default inputs). The line says so when there is no stored calibration or no vol
    surface, instead of naming one.
  - **Who switches modules.** A profile admin anywhere; and, where every sign-in gets its own sandbox firm, the
    owner of a firm of one. Before this only a profile admin could, which on the hosted demo meant nobody a
    visitor could ask. A switch hides and skips; it is not an entitlement, and a module's API routes still answer
    when it is off. A launch workspace's P&L, risk and credit batches are off from its first day.
  - `RIJEKA_SIGNUP_PRESET` (default `LAUNCH`; `NONE` for every module on, as before).
  - Also: the RISK item in the top bar counts Collateral and opens the first risk page that is on; the home page,
    the top bar and the Risk and P&L sub-navigation read one list of which page needs which module.
- **Security, found by Magnus on this change and older than it.**
  - The sign-up trigger took a new account's role from the metadata the client sends, and the role check admits
    `admin`: a sign-up made straight against the auth API could ask to be an admin. Fixed by
    `docs/migrations/2026-11-09_signup_role.sql` (a new account is a viewer; provisioning raises it to trader),
    **which takes effect only once it is applied to the hosted database**.
  - Provisioning looked a new account's firm up by a name built from its email and joined it as the firm's admin
    if one existed. It now always creates a new firm of one.
  - Module switching by a firm's own admin is limited to a firm of one, the note on a switch is bounded, and the
    two new write routes are rate limited.
- **Back to the venue's forwards.** In production the template account held its own saved BTC, ETH and SOL forward
  curves, so the feed, which never replaces an account's own entry, stored vols and no forwards. Market data →
  FX · Crypto → a digital-asset pair now offers USE THE FEED'S FORWARDS, in two steps, to an account pricing on its
  own saved points. Nothing is deleted: today's row is written with the same points under a feed label, the next
  marks run replaces it with the venue's, and the saved rows of earlier dates stay, so a past day re-runs as it
  did. For the template, the demo accounts still on a copy of its curve are handed back with it. It is refused
  where the feed does not write to the account or has no forwards for the pair yet.
- **Emmy's first two runs, on the venue surface** (the model validator, added today). No figure was wrong against
  the documented formula; the supports and several claims were.
  - The stale-mark filter went through three versions in a day: comparing a mark with the line between its
    neighbours also removed the neighbours; taking the worst first fixed one stale mark and failed on two side by
    side and on one at the end of a short chain. It now compares a mark with the median of the five around it.
    Three stale marks side by side are still not seen by it and are left to the bounds.
  - Stated with measured sizes in the methodology (v1.6) and the model inventory, which gains a row for the surface:
    a three-point smile is an extrapolation outside the 25-delta strikes (2 to 3 vol points low at 10 delta and 5 to
    9 at 5 delta on the skew side of test smiles); a listed expiry between tenors can be up to 1.3 points off, not
    "a few tenths"; ATM is the 50-delta-forward vol, 0.1 to 0.8 points from the vol at the forward strike at these
    levels; FUND01 under quoted points is exact to two years and a third low at three; the built vol history never
    scales its one-week row. None of the new calculations has a QuantLib row or a workbook yet; the inventory says so.
  - A digital-asset option on a quoted forward no longer says "the funding rate as the carry".
- Two more roles since 0.12.0: Nikola (architect, consulted before this build as well as after) and Emmy (model
  validator); what each role missed on the Deribit feed is written into its definition. Reviewed by Vera (no
  blocking finding, five to fix), Magnus (two high, both older than this change; one medium), Nikola (the map
  against the code) and Emmy; all fixed here or stated above.

## 0.12.0 · 9 November 2026

- **Live digital-asset market data.** BTC, ETH and SOL option vols and forwards come from Deribit's public option
  marks (`market_data/deribit.py`), refreshed every ten minutes together with the spot, in place of the parametric
  surface and the flat funding rate. On 9 November the old BTC surface stood some fourteen vol points above the
  market with the risk reversal on the wrong side.
  - **The reading.** Per listed expiry the marks are read at 25 and 50 forward delta, the convention of the pricer's
    smile; across expiries ATM is linear in total variance, onto ten tenors (the FX grid plus 2W and 3W, where the
    listed term structure is steepest). The pricer is linear in vol between tenors, so it returns the venue's mark at
    a tenor and close to it between tenors from two weeks out; inside one week it holds the one-week level, which a
    steep front end can miss by points. The forward of each expiry over the index is stored as forward points; on
    the market forward mode the ticket's forward is spot plus those points. Three unauthenticated requests per run.
  - **On the ticket.** The vol and the forward name the venue and the time of the marks. A funding rate typed on a
    digital-asset ticket still wins on that price: the forward is then the carry at that rate and the response says
    so. (As before, a typed rate is not stored with the trade: the booked trade and the XVA tab value on the market.)
  - **Safeguards.** The venue's response is treated as someone else's data: a size cap and a deadline on the read,
    finite numbers and well-formed expiry codes only, marks dated within thirty minutes, a forward within bounds of
    the index, the index within 5 % of the spot fetched in the same run. Within an expiry a mark that stands off its
    neighbours is left out; an expiry inside two days, with fewer than six usable marks, with no open interest, or
    that does not reach the 25-delta points is left out; a surface needs two expiries. When the venue does not
    answer nothing is written: the last good surface stands with its own time and the daily rebuild carries it. The
    health check `crypto_marks` reads the time the marks carried (not when a row was written), for the template
    account, and turns red two hours after the oldest of the three assets; it is absent where the feed is off.
  - **Accounts.** The marks are written for the template account and pushed to every demo account in one statement.
    An account's own entry for a digital-asset vol or forward curve, the template owner's included, stays in force
    until that account replaces it: the marks tick copies and replaces only rows a feed wrote, and the daily copy
    does not lay a venue's row over an own entry. (The older writers keep their rules for the curves they build;
    `docs/architecture.md` lists each writer and what it replaces.) Saving a desk spot on a pair whose points come
    from the feed saves the spot alone.
  - **Risk.** FUND01 on the ladder is unchanged in meaning: on quoted points +1bp of funding moves the points it
    implies. A built history row never replaces a venue row, and the vol history before the venue's first surface is
    rebuilt from it so the series has no step; that takes effect when the history backfill is next run, and until
    then a VaR window containing 9 November samples the change of source as one day's fall in vol
    (`docs/market_risk.md`). Not yet a risk factor: the forward points themselves, so the basis has no VaR; the
    counterparty-credit paths still drift a digital asset at the stored flat funding rate.
  - **What moves on the first day.** A booked digital-asset forward or option revalues on the venue's forward and
    vol. The vol part is attributed to the vol step of the P&L explain; the forward part has no previous day's points
    to difference against and lands in "Cross & unattributed" that once. The pinned sample book is unchanged (the
    local stack has no venue).
  - **Switch.** `RIJEKA_DERIBIT=0` stops the requests; the process that runs the batches then removes the venue's
    rows from the template and demo accounts at the next daily rebuild (a developer's shell on the shared database
    cannot). Run the history backfill afterwards to rebuild the vol series. `RIJEKA_SCHEDULER_MARKS_MINUTES` sets the period.
  - Methodology v1.5; `docs/architecture.md` gains a market-data table, source by source, and the venue in the diagram.
  - Reviewed by Vera (one blocking finding: the desk-spot save; ten others), Magnus (two medium, six low) and
    Nikola, the architect, a seventh role added with this change (the map claimed more than the code did in a dozen
    places, most of them older than this change); all fixed or answered here. Tests: the builder against chains generated from a known smile (no venue data
    in the repository), hostile and malformed responses, the routes, the scheduler group, the health check, the
    history guard and anchor, FUND01 on quoted points, an integration test on the local stack, and a browser journey
    for the ticket's captions (33 journeys).

## 0.11.1 · 8 November 2026

- **Guardrails.** Six named roles with one job each (`CLAUDE.md`, `.claude/agents/`, `docs/ops/release.md`): Quinn the
  browser tester, Ada the numbers guardian, Vera the independent reviewer, Magnus the security reviewer, Jarvis the
  release manager, Petra the project manager.
  - **Browser journeys** (`frontend/e2e`, CI job `browser journeys`): the built app in a real browser on the local
    stack, signed in with a stack-minted token, PostgREST serving the supabase-js reads. Every page opens clean; the
    rates, FX and digital-asset tickets go from pricing through XVA, capital, booking and confirmation; the results
    must be on a laptop screen.
  - **The pinned sample book** (`tests/integration/test_golden_book.py`): 66 figures on a fixed market, date and
    seeds; a figure moves only with a dated explanation.
  - `GET /api/ops/health` reports under `schema` which optional migrations are applied and what each gates.
- **Found by the first runs and fixed:**
  - PRICE pressed before the par rate had solved priced the swap's fixed leg at 0 % (a "par" swap worth $1.6m) and
    the XVA then ran with no IR01. The window now holds the click until the coupon arrives, or says why it cannot.
  - Twenty-eight calls on the market-data configuration pages used a relative `/api/…` path. On the hosted app that
    reaches the static host, which answers with the HTML shell, so stored skew, SABR and cap-vol data silently did not
    load. They go through one helper (`lib/api.js`); a lint rule forbids a relative API path.
  - The XVA results fell below the fold whenever the inputs column was tall (a bilateral CSA with the collateral
    block). The chart and the results now set the panel's height and the inputs scroll on their own.
  - A non-admin's System page asked for the admin usage figures (a 403 on every visit); a rounded-zero bp figure
    printed "+-0.0bp"; the on-chain NPV cell clipped its value.
  - The local stack's seed lacked the platform firm, so the messenger's rooms call failed on every page there.

## 0.11.0 · 4 November 2026

- Collateral in the book, phase C3 of `docs/archive/PLAN_collateral_2026-11-04.md`:
  - **Risk → COLLATERAL:** per counterparty the schedule in force, today's variation-margin position and initial
    margin from the latest stored credit run, what each side is held in by instrument at its haircut, the carry per
    year over OIS, the rail; totals by instrument and by class, the on-chain share; the book under regimes (the
    report that was Risk → CAPITAL) below it. `GET /api/collateral/book`.
  - **Risk → CAPITAL** is regulatory stock only for the CSA as booked (RWA, K CCR, K CVA, EAD, IM, leverage
    exposure, HQLA of IM), per counterparty and in total.
  - **ColVA in the book:** the credit engine's components, the P&L's XVA reserves, the incremental charge and the
    regimes report's metrics carry it; a regime's cost is −(CVA + FVA + KVA + MVA + ColVA).
  - The COLLATERAL module switch is real (it was listed as planned): Risk → COLLATERAL and the ticket's collateral
    block.
  - Stated as not done: collateral yields as IPV inputs and a realised carry line in P&L (`docs/collateral.md` §6).

## 0.10.0 · 4 November 2026

- Collateral on the ticket, phase C2 of `docs/archive/PLAN_collateral_2026-11-04.md`:
  - **ColVA**, the carry of the variation margin against cash at OIS, in the waterfall (`docs/xva.md` §7b): posted
    margin in an asset earning more than OIS earns the excess, held margin in an asset earning less than the OIS
    rebate costs the shortfall; cash on both sides is zero, so every figure that predates instruments is unchanged
    (tests on the closed form). Every instrument enters as its carry over OIS; the IM pickup in MVA comes from the
    posted side's eligible part instead of a typed number (the field stays as an override).
  - **SETTLEMENT & COLLATERAL** on the rates, FX and digital-asset XVA panels: what the margin is posted and received
    in, from the firm's instruments with their carries; the counterparty's schedule is the default when one is
    recorded; the ColVA cell in the strip; the on-chain comparison on by default with the **saving on chain** in money
    and in bp of notional, upfront and running.
  - The three XVA routes take `collateral: {posted, received, im_posted?, rail?}`; the book's credit engine uses the
    schedule's economic CSA for a counterparty (MPoR, pickup, carries).
  - Both Excel replications carry the two carries as inputs and ColVA as a column; methodology v1.4 (ColVA, the
    instruments and schedules subsection).

## 0.9.0 · 4 November 2026

- Collateral as a first-class object, phase C1 of `docs/archive/PLAN_collateral_2026-11-04.md` (`docs/collateral.md`):
  - **Instruments.** A public seed (USD/EUR/GBP cash, Treasury bills and notes, Bunds, Gilts, USDC, USDT, PYUSD, a
    generic tokenised money-market fund share, a generic tokenised Treasury-bill claim, BTC, ETH, SOL), each with its
    regulatory class, rail (bilateral or on chain with token address) and yield source (a curve's short rate plus a
    spread, a fixed rate, or none), resolved from the account's market every time it is read. A firm adds its own rows
    under Configurations → Collateral Instruments; a firm row with a seed's code replaces that entry for the firm.
  - **Schedules.** The CSA's eligible-collateral annex per counterparty, versioned by effective date: admitted
    instruments (for VM, for IM, a negotiated haircut, a concentration limit), what is posted and received by instrument,
    the rail. Edited on the counterparty page beside the CSA terms; a new counterparty starts from cash and government
    paper of its CSA currency. The record's class-level fields follow the schedule.
  - **The regime is derived.** The counterparty's regime (the first column of the ticket's CAPITAL tab, the BASELINE of
    Risk → CAPITAL) comes from its schedule: classes from the instruments, the on-chain rail setting the on-chain MPoR
    state, each class's yield the weighted yield of the instruments posted in it. A cash schedule on the bilateral rail
    reproduces the previous regime field for field.
  - **CAPITAL tab is stock only:** IM, EAD, RWA, K CCR, K CVA, leverage exposure, HQLA of IM. KVA, MVA, CVA, FVA and the
    quote line leave the grid; they are prices and move to the XVA tab in C2.
  - Migration `docs/migrations/2026-11-05_collateral.sql` (two tables); a deploy ahead of it serves the seed and no
    schedules. Routes under `/api/collateral`. Tests: unit (`tests/test_collateral_instruments.py`) and integration
    (`tests/integration/test_collateral.py`).

## 0.8.4 · 4 November 2026

- CAPITAL tab on the ticket: the regime and counterparty-type chips are whole blocks that wrap as a row (they broke
  mid-label and ran off the column, which also drew a horizontal scrollbar); the paths field is a plain number
  field clamped to the route's 200–5,000; a footer figure that rounds to zero reads "$0" on every product (rates, FX,
  crypto) instead of "−$0" or "-0".

## 0.8.3 · 4 November 2026

- Hotfix: the rates XVA tab crashed with "fit_details.map is not a function" whenever it loaded a stored calibration
  instead of a fresh one (a new sign-in, or a cleared session). The calibration row stores the fit table inside an
  object (with converged, iterations and the surface errors) while the calibrate response carries it as a list; the
  latest-calibration endpoint now returns the response shape, and the tab normalises whichever shape it is given.
  Tests on both ends.

## 0.8.2 · 3 November 2026

- The "is the migration applied" checks for the counterparty capital attributes, the module switches and IPV no
  longer cache a negative answer for the life of the process, so a migration applied while the API runs is seen at
  the next request. The five pending migrations were applied in production on 3 November (role check, counterparty
  capital, margin terms, firm modules, IPV); `2026-11-03_jobs.sql` waits for the Render Blueprint sync.

## 0.8.1 · 3 November 2026

- Hotfix: 0.7.3 shipped two undefined variables that the build does not catch (the app shell's route guard read the
  module store without importing it, so P&L and RISK crashed with "Can't find variable: modules"; the home page read
  the switches in the wrong component). Fixed; the linter (`npm run lint --quiet`) is now a CI step, so an
  undefined variable fails the build.

## 0.8.0 · 3 November 2026

- Independent price verification (P&L → IPV, `backend/ipv`, `/api/ipv/*`): the inputs the book is priced on are
  derived from the trades in scope (every curve, funding level, vol surface and spot they read), each laddered per
  pillar through the production pricers (one quote bumped, the dependent trades repriced); a curve verifies by
  pillar, a swaption surface by expiry × tenor point, an FX surface by tenor and quote type, a spot as one cell;
  an independent mark (a controller's upload, or a self-host's second feed; `ipv_independent_marks`) gives each
  pillar a gap and a status against the firm's tolerance rules (`ipv_tolerances`, most specific wins, defaults
  otherwise); an override is a market-data event with author and reason (`ipv_overrides`) and carries its
  first-order impact (sensitivity × shift); APPLY reprices the book on the overrides and shows the residual as
  second order; inputs are VERIFIED, OVERRIDDEN, APPROVED, WAIVED (automatically when immaterial at tolerance,
  or by decision with a reason) or PENDING; the gate (no pending input, no unvalued trade) then the controller's
  sign-off writes the official P&L (`ipv_runs`, a `pnl_signoffs` row with role IPV), shown as FLASH / OFFICIAL on
  the trading P&L. Scope GLOBAL / DESK / BOOK. The run goes to the worker (`ipv_run`) or a thread; `live=1` for
  small books. Migration `docs/migrations/2026-11-05_ipv.sql`.
- P&L gains its navigation: TRADING P&L | XVA RESERVES (the reserve book: levels per counterparty and component,
  the day's change, netted against memo per the firm's policy) | IPV; Configurations → P&L & CONTROL → IPV
  TOLERANCES. The module switches IPV and XVA RESERVES are live.

## 0.7.3 · 3 November 2026

- Module switches per firm (Configurations → Operations → MODULES, admins; `GET/PUT /api/modules`,
  `backend/modules.py`): on-chain confirmation, P&L, XVA on the ticket, market risk, counterparty credit, capital,
  Prometheus, news, with collateral, XVA reserves and IPV listed as planned. A switch hides the module's pages and
  tabs (the app bar, the risk tabs, the ticket's XVA, CAPITAL and CONFIRM tabs, the home page's P&L tile), sends a
  direct visit to its route home, and skips its nightly batch for the firm's accounts; it never deletes anything.
  Presets DEALER, CORPORATE, FUND, CLASSROOM. Every change is a `module_events` row with who, when, before and
  after; `docs/migrations/2026-11-04_firm_modules.sql`, until which every module is on.

## 0.7.2 · 3 November 2026

- Configurations → Counterparties: EDIT TERMS on every row (ISDA, CSA type, currency, threshold, MTA, discount curve,
  IM model, type, rating, CVA sector, eligible collateral, enforceability, UMR scope, margin frequency, disputes)
  through `PUT /api/counterparties/{id}`, which now accepts the CSA terms and validates them; the row shows the
  terms the credit report and Risk → CAPITAL read. Risk → CAPITAL: shorter column headers that fit, a reduction
  in green and an increase in red throughout.

## 0.7.1 · 3 November 2026

- Risk → CAPITAL: the book under collateral regimes (`GET/POST /api/capital/portfolio`, `ccr/capital_report.py`, the
  `capital_run` job on the worker). Every netting set is simulated once and re-collateralised step by step from the
  CSA as booked to an on-chain CSA under today's rules (zero threshold and MTA, daily margining, no dispute doubling,
  recognised collateral, eligible IM at its yield), then to the forward-looking states (the cleared-floor margin
  period of risk, a tokenised sovereign claim as IM, Level 1 liquidity); each step's difference is its channel's
  attribution and the steps add up to the columns exactly; per counterparty and for the book, every capital
  metric, the change against the baseline and the quote in bp; the invariants (SIMM IM, market-risk capital) stated
  on the page. The counterparty record gains margin frequency and dispute state
  (`docs/migrations/2026-11-04_counterparty_margin_terms.sql`); the credit report's MPoR follows them.

## 0.7.0 · 3 November 2026

- Capital on the ticket (CAPITAL tab, `POST /api/capital/trade`): the trade's SIMM IM, SA-CCR EAD, RWA, CCR and
  CVA capital, KVA, MVA, CVA, FVA, leverage exposure and the HQLA value of the margin posted under every collateral
  regime and counterparty type, as the counterparty's netting set with the trade, without it (common random
  numbers) and the trade alone; a derivation drawer per cell with the formula, the regime's two CSAs, the inputs
  and the SA-CCR snapshot per trade and hedging set; the regime's cost against the first column in bp.
- Collateral classes and regimes (`pricing/collateral.py`): cash, government securities, a tokenised sovereign
  claim, tokenised fund shares, payment stablecoins and cryptoassets with their recognition (CRE22, SCO60.94),
  haircuts (CRE22.49), margin eligibility (CFTC §23.156), liquidity level (LCR30) and SCO60 group; a regime derives a
  regulatory CSA and an economic CSA; four presets.
- SA-CCR by asset class (`pricing/sa_ccr.py`, CRE52): interest rates with maturity buckets, FX, the cryptoasset
  class (SCO60.98), credit, equity and commodity; supervisory deltas for options; the Basel Committee's five worked
  examples reproduced unrounded as the reference suite. The waterfall's KVA leg now uses it along the path for
  every product (before: the interest-rate factor for all) and gains the CVA-capital leg (MAR50.14–50.16) with the
  counterparty's CRE20 risk weight; defaults reproduce 0.6.0 exactly.
- Counterparty record: type, rating bucket, risk-weight override, CVA sector, UMR scope, eligible collateral,
  compositions, enforceability (`docs/migrations/2026-11-04_counterparty_capital.sql`; read and written only once
  applied). Methodology v1.3 (§16); `docs/capital.md`.

## 0.6.0 · 2 November 2026 (launch candidate)

- Staging layer: a Docker-free local stack (`backend/stack`: the Supabase pieces stubbed on a plain PostgreSQL 16,
  the schema and the dated migrations applied statement by statement with a ledger, a seed with two users, a firm and
  fixed market data of 2026-11-02, a local ES256 key set the API reads through `RIJEKA_JWKS_FILE`); 59 API-level
  integration tests (every product booked with the app's own bodies and priced, tenancy, XVA for every style, the
  three reports, the methodology workbooks, confirmation with the `NullBackend`, 401/403) on a `postgres:16` service
  in CI; `docker-compose.yml` with GoTrue for sign-in as the one-command self-host (unexecuted by its author; CI
  smoke-tests `db` + `migrate`).
- Worker tier and asynchronous confirm: a `jobs` table and a `python -m worker` Render service take the counterparty-credit RUN NOW and the risk backfill off the API (routes fall back to in-process threads without the table or the worker); `POST /api/chain/confirm` waits 25 s for the receipt, then answers 202 with the transaction and `chain/pending.py` applies the CONFIRMED transition once the registry has it (`chain_reconcile` every scheduler cycle, `POST /api/chain/reconcile/{trade_id}` polled by the trade window); migration `docs/migrations/2026-11-03_jobs.sql`.
- Vol along the exposure paths: the surface's ATM term structure drives the simulated spots and an option is valued at
  each date at the forward vol for its remaining life and the smile at its moneyness (sticky-delta), in the ticket's
  XVA and in the credit engine alike; the credit engine's risk-neutral spot vol comes from the pair's surface instead
  of a desk default. RE-ROLL, seed and engine time on every XVA tab.
- XVA on every ticket: an incremental charge from the credit engine (the counterparty's netting set with
  the trade and without it, same paths) for rates, FX and digital-asset products, options included; the
  stand-alone forward XVA reads the pair's own vol surface; a stand-alone option XVA for every FX and
  digital-asset style (the option valued along simulated paths with the credit engine's model), with the
  simulated paths drawn behind the profiles and the on-chain comparison on the FX and crypto tickets as on
  the rates tab; Excel replications of the FX and digital-asset forward XVA with the engine's draws.
- Licence: the market-risk, counterparty-credit and P&L engines (`backend/risk`, `backend/ccr`, `backend/pnl`)
  move from the platform (BSL 1.1) to the engine side (Apache-2.0), alongside pricing and chain.
- Launch audit: three independent reviews, the S1 list fixed the same day (tenant scope on the
  cashflow bulk write, a BOOKED event for every trade however created, no driver or RPC text to
  clients, rate limits on every expensive handler, a Prometheus daily allowance, admin gate on
  platform analytics, logging configured; the app's global error handler no longer erases a mounted
  desk; confirm works on a fresh cap/floor/collar/swaption booking). Architecture page, environment
  reference, model inventory, glossary, this changelog, one version constant.
- XVA replication for rates: the Hull-White Monte Carlo rebuilt in Excel from the engine's own draws,
  the swaption calibration with an RMSE grid, the CSA bridge and the waterfall; a live mode.
- Methodology v1.2: market-risk and counterparty-credit chapters; the app serves the current PDF.
- Digital-asset options (BTC, ETH, SOL) in every style on the FX option engine; CRY01, IR01 as
  discounting, FUND01; vol surfaces as VaR factors; VOL stress scenarios.
- FX options: European, American, digital, barrier, double barrier, touch, each against QuantLib;
  FX vol surfaces; the VOL step in P&L; Excel replications for every style but American.
- Open-box replications: cover, ticket rebuilt in cells, derivation ledger, scenario chart, Checks
  sheet; SHOW MATH on the ticket; legacy spreadsheet functions only.
- Blotter follows the trades table live; the counterparty's booking of a product trade needs no legs.
- Deploy chain: Render deploys every commit on main; `release` follows main on frontend-only and
  docs-only pushes.

## 1 November 2026

- QuantLib reference suite: every product repriced independently on every commit (424 comparisons);
  the pricing fixes it found; methodology v1.1 with the Independent reference section.

## 30–31 October 2026

- Counterparty credit: netting sets on shared paths, two measures, historical block sampling, PFE
  and credit limits, caps, floors and swaptions on the exposure paths; XVA on the P&L page.
- Market risk: full-revaluation historical VaR, stress, limits, backtesting; stored daily runs.
- P&L: an AMEND step; sign-off policy per firm.
- Security pass: roles from the database, tenant-scoped legs, no token in errors, relayer budget,
  report-only content security policy, no runtime CDN scripts, PyJWT and Vite updates.
- Batches and the release move run inside the API; browser errors reported to a System page; usage
  beacons without cookies; auth email through Resend.

## 28–29 October 2026

- FX spot, forwards and NDFs on the G10 pairs and digital-asset NDFs on one interest-rate-parity
  model; one risk taxonomy across rates, FX and crypto; quoted forward curves and the basis.
- P&L attribution by sequential full revaluation with end of day and sign-off; market risk (ladder,
  VaR, stress, limits); Prometheus book brief with audited numbers; news summaries.
- Demo market data rebuilt daily from public sources; the policy path; the desk globe; the week
  ahead.

## Before 27 October 2026

Rates desk: OIS bootstrap, IRS / OIS / basis, European swaptions and SABR, caps and floors,
Bermudans, XVA under CSA, SIMM, on-chain confirmation on Sepolia, the messenger, the hosted demo.
Released under MIT until 27 October 2026 (tags up to `v0.5.4`), under Apache-2.0 / BSL 1.1 since.
