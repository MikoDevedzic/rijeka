# Changelog

By date, newest first. The API reports its version and commit on `GET /api/ops/health`; the
methodology document carries its own version (v1.20). Commits on `main` are the detail.

## 0.32.2 · 13 November 2026

**"Add to Home Screen" says the taps the visitor's own browser has.** The owner, on his phone: "i'm having hard
time following instrucitons to add to home screen". The sheet said "Tap Share in Safari's bar", which is where
Share sat until iOS 18. Safari has since moved it twice: behind the three dots beside the address bar (26), then
behind a press and hold on the address bar (27).

- The sheet reads Safari's version and gives that version's first step, with Safari's Share and Add glyphs drawn
  beside the words, the steps numbered, and one line for a Safari laid out with Share in its bar. Another browser
  on an iPhone is sent to its Share menu; a page opened inside another app is told to open in Safari
  (`installWay` in `lib/phone.js`, with tests; a journey reads the sheet under five browsers).
- After the review: an iPad that says it is a Mac is told to look in the bar; more in-app browsers are known,
  and a web view that names Safari but no version; the steps name the address bar, not Safari, since a browser
  that sends Safari's user agent reads the same sheet; the line under the list names the icon it shows; focus
  goes into the sheet and back to the button; the journey measures the sheet's text against the sheet.
- After the design review: each step on one line (a button's name and its glyph are not split, "Tap Add"
  and "Open Rijeka" are two steps), bold in the line under the list set as in the list, that line's glyph
  at its line's size, numbers quieter than the words, the in-app sheet a sentence and two steps.
- Left: an in-app browser on Android is still sent to a menu it may not have.
- Not possible, and so not built: a button that does the steps. An iPhone gives a page no way to add itself to
  the home screen; Android does, and there the button already asks the browser in one tap.
- Not checked: any of it on a real iPhone. Where Share sits in Safari 26 and 27 is taken from published
  descriptions, not from a device.

## 0.32.1 · 12 November 2026

**On a phone nothing is pushed sideways, and signing in no longer leaves the page enlarged.** The owner, the same
day the phone view went out: "i dont love the phone version that you have to scroll headers to see and even scroll
on output left/right... either fit on one screen or scroll down to see it", and "when first log in, it is sort of
zoomed in all the way to the edges".

- **The ticket's tabs are two rows of three**, all in view. They were one strip to scroll.
- **The figures at the foot are three across**, on as many lines as they need. They were one row to scroll.
- **The XVA results are a line to an adjustment** (its value and its basis points), and the on-chain comparison a
  second block under them with the same names down the side. On a monitor they are still one strip across.
- **The scenario's results and its ladder are turned the same way**: a curve or a shock to a line.
- **A wide table is read downwards**: each row a block, each figure under its column's heading (the legs, the
  cashflows of a forward and of a swap, the swap's period schedule, caplets). The schedule's two legs stand one
  under the other. A table of four columns or fewer still fits and stays a table.
- **The home's market line** is the curve's four points and, under them, the day they are of. It was a line of
  some 1,300px to scroll.
- **Signing in on an iPhone.** Safari enlarges the page when a field with type under 16px takes the focus and
  leaves it enlarged, so the desk opened zoomed past the screen's edges. The door's fields are 16px on a phone,
  and on an iPhone the page says it is not to be enlarged on focus (two fingers still zoom). Android does not
  enlarge on focus and is left alone.
- On the home a size too small to be said in millions is written out: ten bitcoin read "BTC 0.0m".
- The journeys now fail if any box on a phone's screen scrolls across, on every tab of a digital-asset forward
  and of a swap. Pictures of five kinds of ticket, tab by tab, were read before this went out.
- After the reviews (Vera, Iris): a figure at the foot is never cut with an ellipsis (a column is as wide as its
  longest figure; a long label folds instead); a cell's heading follows its column when the heading changes in
  place (NOTIONAL EUR to NOTIONAL GBP), and a cell that runs across several columns (a total's name, a leg's own
  terms, a message) takes no heading; the flipped tables' rules run unbroken; the schedule's dates are figures,
  not boxes beside taller fields; the tabs are a thumb high; a long counterparty name ends in an ellipsis.
- Left, and older than this change: in the swap's cashflows DCF and RATE are blue and the pay date amber, where
  the colour rules want limestone; the ladder's negative steps use a hyphen for the minus.
- Not checked: a real iPhone (there is no simulator on the machine this was built on); the enlargement is known
  Safari behaviour and the fix is the standard one, but it has not been watched happening and then not happening.
- Tests only, found on the way out: three integration tests depended on the hour or the day they ran. Two
  measured a date from New York's today while their routes read UTC's (wrong from 19:00 to midnight New York);
  one asserted an option's default delivery is its tenor's forward date, which the documented fallback of a
  holiday week does not give (13 November 2026, the EURUSD 3M). No product code changed for them.

## 0.32.0 · 12 November 2026

**The phone view.** On the owner's word ("build the phone view and deploy it right away"), in the scope he set on
11 November: the home, booking a trade through the trade window, chat and news. At 390px the app was about 1,070px
wide and could not be used; nothing is wider than the screen now.

- **A bar at the foot**: HOME, TRADES, NEW, CHAT, NEWS. P&L, risk, configurations and the methodology are not in
  it: they are laid out for a monitor.
- **The home is a few things.** The market line, the book's counts and four figures, the latest trades, the state
  of the chain. The first build stacked the monitor's home (about 3,700px tall) and the owner called it messy,
  the policy path most of all; it is about 1,400px now, and the policy path, the calendar, the clocks and the
  globe stay on a larger screen.
- **Trades are cards**, and a tap opens the trade.
- **The trade window is the whole screen**: fields two across, tabs that scroll (no CAPITAL), the XVA tab's inputs
  above its results, PRICE and BOOK at the foot, a close button a thumb can hit. A journey prices a digital-asset
  forward, runs its XVA, books it and confirms it at phone size.
- **Chat** fills the screen above the bar; **news** is a page of its own (`/news`).
- **From the home screen.** The door has ADD TO HOME SCREEN: on Android it installs; on an iPhone it shows the two
  taps, since a page cannot install itself there. The app then opens full screen from its icon (the manifest says
  "standalone"), and the icon's mark comes alive once as it opens.
- Journeys at 390 by 844 on Chromium, Firefox and WebKit. Not tried on a real phone.

**After the reviews** (Vera, Iris, Magnus) and a second look at every screen in pictures:

- `/news` typed on a monitor showed an unstyled list: its rules lived only in the phone's block. They hold on any
  screen now, and the page is in the journey that opens every page.
- The DETAILS tab's term sheet stood one letter to a line: the phone's two-across rule caught a grid that already
  folds by itself. Such grids are left alone. The CASHFLOWS tab's legs ran their columns into each other; the legs
  and their net now scroll sideways together. On the XVA tab the spread curves sit over the assumptions, each the
  width of the screen, where six tenors shared half of it and showed one digit each.
- The certificate keeps its hashes and its buttons inside the paper. The mark above it and its caption are centred.
- Fields in the ticket are one height (40px). The tab strip and the row of figures at the foot fade at the edge
  where there is more to scroll to. The NOTES switch and the booked ticket's two shortcuts are a monitor's.
- The home loses its sub-headings and the chain's health tiles; a recent trade is two lines, read whole. A positive
  figure in the book is green, not brass, on every screen (`docs/design.md`: brass is not a figure's colour).
- The bar's five icons sit in one box each; the unread count is limestone, not brass. A trade card's third line is
  quieter. The search field says "Search trades".
- The sheet that explains Add to Home Screen closes on Escape. The status bar on an installed iPhone is solid, so
  the app's bar is not under the clock. A headline's link must begin `http://` or `https://`.
- Left as it is: the XVA results strip scrolls sideways on a phone; a booked ticket's foot still offers PRICE (it
  reprices); the opening animation also plays on an installed desktop app.

## 0.31.1 · 12 November 2026

**The door's way to the site points at /about.** On the owner's word ("deploy everything"). The public site now
serves its landing page at rijeka.app/about, and rijeka.app itself is to open the door; EXPLORE RIJEKA goes to
/about so the two do not send a visitor round in a circle. The line beside it names what is there: how it works,
verify, tools, work with us. The app's page names its own address (app.rijeka.app) as its canonical one, where it
named rijeka.app, which is about to be a redirect to it.

## 0.31.0 · 12 November 2026

**The front door.** On the owner's word after two mocks ("when you type rijeka.app it should bring you to login
screen right away ... or you can click from there to go into site"; "go with recommendation, build it"). The app
side is here; the public site's side is staged and waits for its own word.

- **The sign-in page is the door.** It carries the logo (the river into the ringed R) where the name was set in
  type, the line "Price it. See what it costs. Confirm it on chain.", a button on to the public site (EXPLORE
  RIJEKA), and a switch at the top of the card between SIGN IN and CREATE A DESK. Signing in, signing up, the reset
  and the confirmation are untouched. A visitor who is signed in never sees it: the app's address opens the desk.
- **On a phone it is one screen.** The logo, the line, the way to the site and the form, with nothing to scroll at
  390 by 844 and at 375 by 667 (it was 1,325px tall). The drawing of the desk and the counts stay on a larger screen.
  On a laptop the door is one screen too.
- **The icon for a phone's home screen**: the small form of the logo, the river as one line into the R in its open
  ring, on the app's ground (`frontend/scripts/build-icons.mjs` draws it from the favicon). A home screen's icon is
  a still picture on every phone; the mark moves when the app opens. A manifest names the app and its icons. It
  says "browser", not "standalone": the app opens full screen from its icon only once the desk fits a phone, and
  the button that offers the icon comes with that work.
- Links that sat inside a part of the page hidden from screen readers are reachable now; only the drawing is hidden.
- Journeys: a visitor with no session lands on the door and can move between the two forms; the door does not
  scroll on a laptop or on two phones; a signed-in visitor goes to the desk.
- After the reviews (Magnus: nothing to fix; Iris; Vera): the way to the site sits in the top row beside the logo, so
  the drawing under the headline keeps its height (a shorter box had let it run over the scene's tabs); on a phone
  the card sits under the headline, the EXPLORE button and the two small links under the form are a thumb's height,
  and the narrowest phone (320 by 568) is covered: the logo and the button do not touch and the page still does not
  scroll.
- **Not here:** rijeka.app still opens the landing page. Sending it to the door is a change to the public site
  (the landing moves to /about, the root redirects), staged in two steps and deployed only on the owner's word.
  A look without an account is undecided and not built.

## 0.30.4 · 12 November 2026

**The look on the Configurations pages and the messenger.** Item 2 of the Phase 1 exit list, on the owner's word
("do them all in order and deploy"). No figure changes; nothing moves.

- **Type on the scale.** 210 sizes that were set in rem on the market-data, configuration, onboarding and messenger
  pages are steps of the px scale now (`docs/design.md`): none moves by more than half a pixel. The count of sizes
  in rem fell from 622 to 412, of distinct sizes from 53 to 50.
- **Colour means what the rules say** on the curve, swaption, cap and floor and pair pages, the HW1F calibration,
  counterparties and legal entities: a rate, a vol or a spot is limestone whatever its curve's class; a tenor or a
  strike at the head of a row is a label; saved, loaded, connected, quoted and a close fit are green; a selected
  chip is the lighter panel; brass is left to the page's actions and the selected rule. A typed value is no longer
  brass.
- The messenger's colour literals are tokens (twelve fewer hex colours in the source); a firm's name is limestone.
- After the reviews (Iris, Vera): a selected chip is filled the same way on every page; a figure in the lists at the
  left is mono 12.5 like the tables beside it; a convention's value (a day count, a discounting curve, a ticker) is
  limestone, where its kind coloured it amber or blue; a good state's frame is a quiet edge, where it was a brass
  tint (and one border that no browser could read is a border now).
- **Left as it was, for a decision:** the colour of a curve's class in its badge, and the messenger's two warm
  colours (its own brass against Prometheus's lighter gold). A mock comes before either changes.
- Pictures before and after of nine Configurations pages and the messenger are taken by the picture pass
  (`e2e/perf/look.spec.js`, `LOOK_TAG`).

## 0.30.3 · 12 November 2026

**The closing pass before the announcement.** Item 12 of the Phase 1 exit list, with items 10 and 3, on the owner's
word ("do them all in order and deploy"). Every screen a new user meets was pictured on the local stack and read
(89 pictures); what was found is fixed here or listed below.

- **A strip's legs were all struck at the first leg's forward.** Since 0.26.0 a forward that fixes before it settles
  is priced to its fixing date; a further leg of a package was priced to the TICKET's fixing date, not its own. A
  monthly strip therefore put one strike on every leg, called each worth nothing, and booked legs that were worth
  something: on the local stack's market +540 and +1,053 on the second and third legs of about 1.085m each (5 and
  10 bp: one and two months of carry; the validator's own figure at a flat three-month carry is 6.5 and 13). It
  shows where the settlement source fixes before the settlement date (a benchmark such as CME CF BRR); where the
  venue's own price is the source, the fixing is on the settlement date and the legs were priced right. Each leg is
  now priced to the fixing date it is booked with. Separately, the package's XVA run carried every leg to its
  settlement date (a day or two of carry more, about 20 a leg here) and so started from a value the ticket did
  not show; it now starts from the ticket's. Journeys and an integration test hold both.
- **No screen names ISDA SIMM as the margin's basis.** The counterparty record's old default read "SIMM" in the table
  and the form; it is now MODEL (the engine's estimate or the desk's amount), records made before read the same
  way, and the legal entity's SIMM VERSION field and column are off the screen. The database's own column defaults
  are unchanged (a migration, on the owner's word).
- **The home page's policy path fits its box.** The drawing was 150px tall in a box of 126: its dates sat on the
  caption below, the rate labels were cut by 2px at the left, and the Fed's dots, the path's first figure and the
  longer-run label ran into each other. Each label now has its own place and a journey measures it.
- Smaller: the period schedule on a swap's DETAILS writes 10,000,000 and 3.480003 where it wrote 10000000 and
  3.48000300 (the plain number while typing; a comma typed as a decimal is refused and marked, as on the ticket,
  and a figure pasted with its thousands grouped is kept as the number it is, where it was read as 10); a coin's option delta reads 5.55 BTC, not 6; the forward-curve chart
  groups thousands; a roadmap badge in the Configurations rail no longer touches its label; the strip chart's first
  strike label clears the axis.
- **Safari: the logo was never drawn, and two switches had no box.** Item 10: the journeys now run on Firefox and on
  WebKit, Safari's engine (`npm run e2e:engines`, `frontend/playwright.engines.config.js`; the required check stays
  on Chromium). WebKit failed all hundred at first, on two defects of the app. (1) The logo read its colours from
  the page's tokens before Safari had applied the stylesheet, a gradient refused the empty colour, and the
  exception stopped the drawing loop at its first frame: no logo in the top bar, and an error in the console on
  every page. The mark now falls back to the theme's own colours and its loop survives a frame that throws. (2) The
  two switches put on one row in 0.30.1 (initial margin, compare on-chain) showed their labels and no checkbox:
  Safari shrinks a checkbox with no width of its own to nothing in a flex row. They have a size now, and a journey
  measures it. Firefox failed ten journeys, none on a defect of the app: the journeys knew a cancelled request and a
  clipboard permission only as Chromium words them, and a rate label on the home chart was a pixel wider. All
  hundred pass on each engine. Not tried: real Safari or Firefox on a person's machine, Windows, Linux, a phone.
- **Smoothness, measured again** (`e2e/perf`, local): every screen holds 60 frames a second at normal speed and at a
  quarter of it, no frame over 34 ms (three between 20 and 34: two on a wheel over the blotter, one on the home at
  quarter speed), nothing rewritten under a moving pointer on the blotter or the ticket, a drag writes only the
  window's own position.
- A journey now holds the smoothness (`e2e/smooth.spec.js`): what the page rewrites while the pointer moves, which
  is the same on any machine where a frame time is not. Nothing on the blotter or a ticket; a drag, the window's
  own position.
- After the reviews (Vera, Iris, Emmy): the schedule's cells read typing with the ticket's own parser; the chart's
  longer-run label is back over its line; the account of the strip above names the legs, the figures and the
  settlement sources it shows on; the journeys' word for a cancelled request is exact for each engine.
- Left, recorded in the backlog: P&L and Risk pages (a wrapped counterparty name, FUND01 where CRYBASIS01 is meant, a
  minus zero), the blotter's STRUCTURE column truncating long styles, the ticker cut at the right edge when the
  market data is stale.

## 0.30.2 · 12 November 2026

**The evidence behind the XVA on digital assets.** Item 11(e) of the Phase 1 exit list, on the owner's word ("do
them all in order and deploy"). No figure the engine computes changes; methodology v1.20.

- **The exposure backtest.** `backend/scripts/backtest_exposure.py`, after the Basel Committee's sound practices for
  backtesting counterparty credit risk models (2010), on five years of public daily closes of BTC, ETH and SOL: on
  every day the model is asked for the 1st, 5th, 95th and 99th percentile of the move over the next 5 to 91 days and
  the move that followed is counted. Against the band the model's own simulated histories give, the vol regimes are
  outside in 1 cell of 60 and one vol in 17 (in sample: the regimes were fitted to the same five years). Refitted on
  the first three years and tested on the last two, the regimes are outside in none (nor is one vol: two quiet years
  cannot tell them apart).
- **What it does not show, on the page with it** (`docs/xva.md` §8e, methodology §9.3, the model inventory): the vol
  in the test is the realised vol of the 90 days before, not a ticket's implied vol; BTC's 14-day move went above the
  99th percentile on 2.96 % of days, at the very edge of its band, and SOL's on 2.44 %: the margin the desk calls on a
  position worth more to it when the coin rises was the one exceeded most often; five years cannot certify a 1st
  percentile, and the test cannot reject tails that are too wide; an option's exposure is not backtested.
- After the reviews (Emmy, Vera): the band's own construction and the forecast's blindness to the move it is compared
  with are each held by a test (a 90 % band had passed the first tests); the figures the documents quote from the
  procedure's own check are asserted, not commented; the inventory no longer says the fit has no holdout.
- **One MVA figure derived apart from the engine** by the model validator, from the written method alone: a
  margined three-month BTC forward, −326.78 against the engine's −326.17 on one vol and −356.95 against −356.66 on
  the regimes. Kept in the reference suite (`tests/reference/test_ref_mva_forward.py`). §7 now says what she found
  unsaid: before the first margin period has passed the margin is the percentile of the move since today, and ten
  business days are 14.6 days on a digital asset's clock.
- The backtest's own procedure is tested on histories of known law (`tests/test_backtest_exposure.py`): a model
  given its own histories is outside the band about one cell in twenty; one vol given histories the regimes made is
  caught in most.

## 0.30.1 · 12 November 2026

**The ticket's XVA tab on a laptop.** The rest of item 4 of the Phase 1 exit list, on the owner's word ("do them
all in order and deploy"). No figure changes.

- **The incremental charge is in view.** The counterparty's netting set with and without the trade (CHARGE THIS
  TRADE) sat below the whole tab, under the fold on a laptop. It is now directly under the results, above the
  spread curves and the assumptions, on the swap's tab and on the currency and digital-asset tab alike; its heading
  and its button share one line.
- **A swap under a CSA no longer scrolls.** At 1440 by 900, after a run with the on-chain comparison, the swap's tab
  fits the window: the two switches (initial margin, compare on-chain) share one row, and the exposure chart is a
  little shorter on a laptop (it grows with a taller window as before).
- **Not changed, and said:** on the digital-asset tab the last two rows of the assumptions (below the incremental
  charge) are still under the fold at that size, a short scroll: that tab carries the capital and initial-margin
  notes the swap's does not.
- Journeys hold it: the left column ends above the footer, the tab does not scroll, the charge's button is wholly in
  view on both tabs, the two switches sit on one row.
- After the reviews (Vera, Iris): the incremental heading keeps the tab's section-heading style (the new row had
  dropped it); opened, the two halves of its table stack in a narrow window instead of being cut by the column. A
  journey now presses CHARGE THIS TRADE for the first time and holds the heading, the answer and the table's width.

## 0.30.0 · 12 November 2026

**Barriers: watched between the grid's dates, and a touch the desk can record.** Items 11(c) and 5 of the Phase 1
exit list, on the owner's word ("do them all in order and deploy").

- **Watched between dates.** On a ticket's exposure paths a barrier was watched on the grid's dates alone, so a
  level that went out and came back between two dates was never seen. Against the continuous closed forms on a
  six-month knock-out at 55 % vol (40,000 paths): weekly steps missed 16 % of the touches and the knock-out paid
  63 % more on the paths than its price; monthly steps 29 % and 126 %. Now, where the level stood inside at both
  ends of a step, it is taken to have crossed with the Brownian bridge's probability
  exp(−2 ln(a/B) ln(b/B) / v), v the variance that step accumulated on that path (`pricing/fx_xva.knocked_by`).
  The share of paths that touch is within 0.2 % of the closed form on weekly and on monthly steps, and the
  knock-out's payoff within about 1 % of its price. XVA of barrier and touch options moves: a six-month knock-out
  call's CVA falls about 10 % (−38.6 to −34.5 at 20,000 paths; held in a test between 6 and 15 %). The tests hold
  the touches to 2 % and the payoff to 4 %, which is what one seed's sampling error allows. Emmy's own simulation on
  a fine grid (twenty steps a day) agrees: 0.4112 against the engine's 0.4191 and the closed form's 0.4197 for the
  level above, and for a corridor 0.9463 against 0.9493, so the capped sum of its two sides is not measurably off.
  Plain options, forwards and swaps do not move.
- **A touch recorded.** A booked digital-asset barrier or touch option's CONFIRM tab has BARRIER: the day the
  level traded and, if kept, the level seen; once the option has expired, NEVER TOUCHED; and the record can be
  taken off (`POST /api/currency/knock/{id}`, `settlement/knock.py`). The settlement rule always read
  `terms.knocked` and nothing wrote it, so such an option settled on a provisional amount. With a touch recorded
  it is valued for what it has become before expiry: a knock-in as the plain option, a knock-out or a no-touch as
  nothing outstanding (a fixed view on the ticket), a one-touch as its payout. An XVA run on an option that is
  over says there is nothing left to simulate. The signed record of the confirmation does not cover the knock
  state and still verifies.
- **Not done.** The record is on the trade's terms with who and when, not an event (the events table's allowed
  types would need a migration); a rebate or payout paid at the hit is not booked as cash; currency-pair options
  take no record; a corridor's chance of touching both sides inside one step is left out; the credit page's engine
  still watches on its dates alone; a recorded touch is not checked against any price history; "today" is the UTC
  day, in the browser and on the server; a package with a leg recorded as over is refused by the XVA run as a whole
  (take the leg out); a client that does not read trade states is answered the option as booked, with a sentence
  saying the trade is over. Two older inconsistencies on the paths, found by Emmy and not changed here: a
  knock-out's rebate is paid at the hit by the pricer and at expiry by the paths' payoff, and a double one-touch
  paid at the hit is priced by the closed form and zeroed on the paths (backlog 133).

## 0.29.0 · 12 November 2026

**Partial termination.** Asked by the owner ("do we have partial termination process?" ... "build it, deploy it").
The event type and a route that stored it existed; nothing reduced a trade and the ticket offered nothing.

- **On the ticket.** A booked trade's CONFIRM tab has PARTIALLY TERMINATE: the notional that remains and, if one
  was agreed, the fee for the unwind (pay or receive, amount, date). The trade stays; the blotter, the price and the
  XVA then read the notional that remains, and the fee is among the trade's fees as UNWIND. The ticket is opened
  again on the trade as it now stands, on the same tab, saying what was done: its own fields and figures were the
  trade's as it was.
- **What changes is worked out by the API from the booking** (`chain/partial_termination.py`), never taken from
  the request: the trade's notional, every leg's in the same proportion, and for a currency or digital-asset trade
  the notional its signed record carries (`base_notional` and `quote_notional`, or `notional_amount`).
- **A trade confirmed on a chain** has its record superseded there by the reduced one, with a signature from each
  party, as an amendment is (`POST /api/chain/partial-terminate/{id}`; `/partial-termination-request/{id}` gives a
  counterparty that signs for itself the digest). The relayer's budget is charged when a transaction is about to be
  sent, not for a request refused before. VERIFY then passes on the reduced booking. A journey on a local
  chain asks the node: the registry raised `Amended(prev, new)`, no longer holds the first record as confirmed and
  holds the new one.
- **A trade with no anchored record** (pending, or signed on an instance with no chain) is reduced on the booking
  alone; the event is PARTIAL_TERMINATION and claims no signature. On an instance with no chain a confirmed trade's
  old signed record then no longer matches the booking, and VERIFY says so.
- **Refused, in words:** the whole notional or more (terminate it), a cancelled, terminated or matured trade, one
  leg of a package (confirmed or still pending), an option sized by a payout (a digital, a touch), a leg with a
  notional schedule, a fee dated before today or more than five years out, a number no trade has (what remains is
  rounded to the six decimals the booking keeps), a confirmation still being anchored, another firm's trade (404).
- **After the reviews (Vera, Magnus, Iris).** The trade's row is locked while it is reduced, so two reductions
  cannot both start from the same notional. The request routes that hand out the firm's signature
  (`amend-request`, `terminate-request` and the new one) now need a writing role: a viewer could ask for one
  before. The button that reduces is set as the terminate button is, not in the brass of BOOK. A replay of the
  same `Idempotency-Key` answers the trade without the `partial_termination` block.
- **Not done.** The realised P&L of the part terminated (fees are not yet in P&L or settlement: backlog 124); the
  unwind fee is not part of the signed record (no fee is); an option's premium is left as booked; a partial
  termination of a package, of a payout option or of an amortising leg; an effective date other than today.

## 0.28.0 · 12 November 2026

**XVA on a currency or digital-asset ticket: weekly steps, and the charge on the exposure averaged across each
step.** Item 11(c) of the Phase 1 exit list, on the owner's word ("weekly and average, build it, deploy it").

- **What was wrong.** Every run stepped monthly and charged CVA, DVA, FVA and FBA on the exposure at each step's
  end. A forward's exposure grows like the square root of time, so on two or three steps the charge was overstated.
  BTC forward dealt at fair value, 55 % vol, vol regimes on, 20,000 paths, CVA against the same run on daily steps
  with the averaged charge: +31 % at one month, +23 % at three, +8 % at six, +9 % at a year uncollateralised;
  +23 %, +6 %, +3 %, +2 % under a ten-day margin period. Against continuous time, by a closed form on one vol
  (no random numbers, none of the engine's code): +28 % at one month and +20 % at three.
- **Now.** A ticket of a year or less steps weekly (monthly beyond), and the four exposure charges read the mean
  of each step's two ends, the first step starting from today's exposure (`pricing/fx_xva.exposure_grid`,
  `run_waterfall(average_exposure=True)`). Against daily steps with the same averaged charge: within 4 % at every
  one of those tenors, both ways. Against continuous time: 2.7 % low at one month and 1.7 % at three. The averaged
  rule is a trapezoid, and on a profile that grows like the square root of time a trapezoid reads low: 2.6 % at one
  month, 0.7 % at three, 0.1 % at a year by the rule alone, where the step's end read 28 % high. A step starts from
  the set less what was paid on that date, so a package's settled leg is not charged for one more step.
- **On the ticket.** The XVA tab names its steps from the run ("26 weekly steps"), a long strip of step vols shows
  every fourth, and the chart's axis is each point's own time (it read the point's index as months: a one-year
  forward on weekly steps would have ended at "4.4Y").
- **Size.** The limit on a run counts the steps it takes. Measured: 24 option and barrier legs at 10,000 paths
  took 5.6 s on monthly steps and 23.6 s on a year of weekly ones, so a package that large is told how many paths
  fit (3,200); seven legs still run at 10,000, and one ticket at 10,000 paths takes half a second.
- **What moves.** CVA, DVA, FVA and FBA on every currency and digital-asset ticket and package, down by about the
  figures above. KVA and MVA of a margined ticket move with the finer steps (six-month BTC forward with initial
  margin, 20,000 paths: KVA −124 to −130 against −135 on daily steps, MVA −815 to −802 against −795). No price,
  no sensitivity, nothing on a swap, nothing on the credit page.
- **Checked.** Emmy re-derived CVA against continuous time by closed form (31.25 and 160.75 at one and three
  months; the engine 30.4 to 30.6 and 158.0 to 159.7 at 40,000 paths): now `tests/reference/test_ref_exposure_grid.py`
  at 4 %. The averaged charge by hand on the waterfall; the wrong-way quadrature (no random numbers, none of
  the engine's code) redone for the averaged definition and agreeing at 2 %; the margin the engine calls when the
  margin period spans two weekly steps against a simulation that draws both dates; the two workbooks, with the
  averaged charge in their cells, 51 of 51 under every preset.
- **Not done.** A swap's waterfall and the credit page's engine keep monthly steps and the step's end: not
  measured there, and the incremental charge on a ticket is therefore on another grid than its stand-alone figure.
  The workbooks run monthly steps. A barrier is still watched only at the grid dates (weekly now to a year). A
  margined KVA is still about 4 % below daily steps at six months. Ten test modules whose hand figures were worked
  at monthly dates run on monthly steps (`tests/conftest.py::monthly_steps`); run on the app's grid
  (`RIJEKA_TESTS_ON_THE_APP_GRID=1`) what fails there is those dates, with one exception that is the engine's: on
  weekly steps a knock-out call is marked up to 0.2 % above its vanilla at one date two weeks before expiry (three
  cents on a deep out-of-the-money option; the cause is not established).

## 0.27.1 · 12 November 2026

**The forward on the TRADE tab no longer reads as switched off.** Asked by the owner on 10 November ("the forward
reads as greyed out"); item 4 of the Phase 1 exit list, first part. The forward is a computed figure, and it sat in
a dashed box: the only other dashed edge on the ticket is a chip that cannot be pressed. It now has a field's own
solid edge and no well, as every value that cannot be changed has (`docs/design.md`); the figure was and is at
full strength. Styles only; `docs/design.md` now says what marks a default (a brass rule once typed over, a dash
in place of a number that is not there yet), where it said "dashed". Also: Ada's lesson of the day is in her definition.

## 0.27.0 · 12 November 2026

**KVA and MVA charge the whole life of a trade.** Found while measuring a finer grid for digital assets (item 11(c)
of the Phase 1 exit list).

- **What was wrong.** The waterfall read a trade's remaining life at the end of each grid step. On the last step
  that is zero, so the last step carried no capital and no initial-margin funding. The grid is monthly: a one-month
  currency or digital-asset trade has two steps and was charged for one. Measured on a one-month BTC forward,
  uncollateralised: KVA −37.6 on the monthly grid against −82.9 on daily steps. Three months: −259 against −386.
  A rate swap barely showed it (sixty steps, and its add-on shrinks to nothing at maturity). The workbook stated the
  convention ("the last step lands on settlement itself, where the engine books no capital or IM funding"); nothing
  stated its size.
- **Now.** Capital and margin are held through a step, so the remaining life is read at the middle of it
  (`pricing/xva_engine.run_waterfall`; the add-on profiles in `pricing/fx_xva.py`). The step that ends on the
  settlement is charged like every other. The same trade on monthly, weekly and daily steps now gives the same KVA
  within the noise of the paths (one-month BTC forward: −83.5, −84.2, −82.9). The quoted runs: 10 BTC bought at
  the fair forward of 105,000, 55 % vol, flat 4 %, counterparty weight 100 %, hurdle 12 %, 4,000 to 5,000 paths.
- **Checked.** Emmy, by a closed form of her own on a Group 2b forward dealt at the fair forward (KVA is then the
  add-on's integral): −109.02 against the engine's −108.93, and −54.51, half, under the old convention. That closed
  form is now a test at 1 %. The unmargined maturity factor floors the remaining life at ten business days
  (CRE52.48), which the mid-step reading reaches on a fine grid; no monthly figure moves with it.
- **What moves.** KVA and MVA, and the totals that carry them. Short currency and digital-asset trades most: KVA
  about ×2.2 at one month, +45 % at three months, +9 % at a year, uncollateralised; a margined six-month forward
  KVA +12 %, MVA +16 to 18 %. A five-year swap: KVA +2 to 3 %, MVA +0.4 %. The capital stock shown for a trade
  (EAD, RWA, capital at the first step) rises 1 to 2 % on the swap: the first step is read half a month in, not a
  month in. It is the first step's figure, not the valuation date's, and on a short trade it depends on the grid
  (the workbooks now label it "over the first step"). CVA,
  DVA, FVA, FBA and ColVA do not move; no price or sensitivity moves. The pinned book's lines are in
  `GOLDEN_CHANGES.md`.
- **Workbooks.** The three XVA workbooks read the remaining life the same way and reproduce the engine cell by
  cell under every CSA preset (51, 51 and 87 checks, evaluated outside CI).
- **Still open (backlog 127).** Measured the same day: CVA and FVA are taken at each step's end. On the monthly
  grid an uncollateralised one-month digital-asset forward's CVA reads 9 to 12 % above weekly steps and 28 % above
  daily ones (three months: 12 to 15 % and 19 %); the charge is overstated, not understated. A margined KVA and
  MVA still differ by grid (the margin profile is coarse). A finer grid for digital assets, or the exposure taken
  at the middle of each step, is the fix; it is not in this release.

## 0.26.0 · 12 November 2026

**A forward is priced to its fixing date.** Item 5 of the Phase 1 exit list.

- **What was wrong.** A digital-asset forward fixes on its valuation date and is paid on its settlement date. Until
  now it was priced as if it fixed on the settlement date: the carry between the two dates was counted, about 1.4bp
  of notional per day at a 5 % basis, and the gap was limited to seven days to bound the error.
- **Now.** The forward is read at the fixing date and the amount is discounted from the settlement date:
  V = ±N (F(T_fix) − K) D(T_pay). One rule in `pricing/currency_forward.py` (`payment_date`), used by the ticket
  (`fixing_date` on `POST /api/currency/forward/price`), by a booked trade's price and by the P&L valuation. The
  limit of seven days is gone: any date after the trade date, up to the settlement date. The ticket's line says
  "priced to the fixing date", and a change of fixing date asks for the price again. One day before the fixing,
  theta is the day's carry, not the whole value. Risk (the ladder, VaR, stress), the P&L explain and IPV value a
  booked trade through the same valuation and follow. The answer's `df_quote` is the factor the NPV is discounted
  with (to the settlement date); `df_fixing`, `t` and `t_pay` are beside it.
- **XVA.** A run on such a forward (`fixing_date` on `POST /api/xva/currency`) starts from the ticket's own value
  and is exposed until the payment.
- **What moves.** A booked forward whose fixing date is before its settlement date: by the carry over the gap (the
  benchmark's default is one day: about 1.4bp of notional at a 5 % basis). A forward that fixes on its settlement
  date (the venue's morning price, and every currency pair) does not move, and neither does any option.
- **Checked.** Emmy re-derived the value, the three sensitivities and theta in closed form on a case of her own
  (agreement to 1e-9), including the day before the fixing.
- **Not done.** The XVA run simulates the level on to the settlement date, where the amount is in fact known from
  the fixing date (small over days; not a model of a forward that fixes months before it is paid). A forward leg of
  a package's XVA, the counterparty exposure report and the capital built on it (`ccr/valuation.py`), and the older
  route `POST /api/crypto/forward/price` still carry a forward to its settlement date. The Excel replication of a
  forward has no fixing date. On the fixing date itself the settlement rule takes over, as before.

## 0.25.0 · 12 November 2026

**Fees are entered with the trade.** Asked for by the owner: "the fee can also be multiple dates or have multiple
fees. the user should be able to just enter fee cashflow or maybe even some sort of other event type of fee as part
of the trade", for trade entry, pricing and XVA.

- **What was missing.** A currency or digital-asset option booked the model's own price as its premium, dated
  today, with nowhere to type the premium agreed; a rates option took one amount and one date; nothing else could
  carry a fee at all; and no premium reached the value or the exposure.
- **The FEES block** on the TRADE tab of every ticket (rates, FX, digital assets): any number of rows, each a type
  (PREMIUM, UPFRONT, BROKERAGE, UNWIND, OTHER), PAY or RECEIVE, an amount in the trade's currency and a date. A
  premium in instalments is several rows. On an option one press adds a PREMIUM row at the model's price, to change
  as agreed. A row that is not complete says why, and nothing is booked while one stands.
- **Valued.** Each fee's value today on its currency's curve and the total (`POST /api/price/fees`); the block shows
  the fees today and the trade's value net of them. A fee dated before the valuation date is paid.
- **In the XVA.** The fees still to come are part of the trade's value on every path and of the value a margin period
  earlier, on all four runs (rates, currency forward, option, package): a fee we are owed is exposure until it is
  paid, a premium we still owe lowers ours. A known payment is not a risk, so initial margin does not move. Checked
  exactly: a fee received at settlement gives the same paths, margin and every XVA as the same forward struck lower
  by that amount. A fee dated on the valuation date is paid that day: it is in the ticket's value and not in a run,
  since neither side can still fail to pay it.
- **Booked.** `terms.fees` on the trade, checked and stored in one shape by both booking routes; the confirmation's
  premium (one amount, one currency, one date) is the PREMIUM rows that go the option's way (paid when bought,
  received when sold) less any against it, on the first of their dates, so the on-chain record's shape is unchanged.
  A trade booked before this shows its premium as one row. A rates option's premium is now a fee row: the OPTION FEE
  block it replaces is gone. A fee keeps the currency it was typed in: if the pair changes under it, the row says so
  and nothing is priced, simulated or booked until it is entered again or removed.
- **Not yet.** A fee in a currency other than the trade's; a package's fees sit on its first leg, and each option leg
  keeps the model's price as its own premium; fees in P&L, in the CASHFLOWS tab and in settlement; the
  other fees in the on-chain record (it carries the premium only). The rates run reads a fee paid inside a margin
  period as paid evenly over the step.

## 0.24.0 · 12 November 2026

Released together with 0.23.1 and 0.23.2 below, which were built and reviewed on 11 November and reached production
with this version, not before; and with two changes that carry no version of their own: a browser journey that
confirms a trade on a local test chain and reads the transaction back from the node (`npm run e2e:chain`), and a
watch on production from the outside (`.github/scripts/watch.py`, `docs/ops/monitoring.md`).

**A digital asset's vol is not one level.** Second step of finishing the XVA on digital assets ("has to be full
XVA"). It was planned as jumps; fitted to the data, jumps were the wrong model, and this is what the data support.

- **What the data say.** Five years of public daily closes of BTC, ETH and SOL, fitted by maximum likelihood.
  Merton's jumps put about 230 small jumps a year on BTC: the day-to-day clustering read as jumps. Being independent
  from day to day they average out, and the ten-day tail comes out within a point of a Gaussian's, so the margin
  would not have moved. Two vol regimes twice over fit the days far better and carry the tail to a margin period: a
  fast state (calm or stressed, a stress of two or three days) and a slow one (low or high, about two months). The
  slow chain alone adds 36 to 41 to the log-likelihood for three parameters (a regular chi-squared bar would be about
  4; the true bar is higher, and this clears it by a wide margin; the comparison is in-sample).
- **What it is.** On a digital-asset ticket a day's vol is the ticket's × the fast state × the slow state, each
  chain scaled so the variance expected over any period is the ticket's (`pricing/vol_regimes.py`). Over a grid step
  the level is lognormal given the variance the step accumulated on the path, on the same standard normals as before,
  and the margin-period bridge of 0.23.0 runs on that clock. Today's value of a forward or an option does not
  change. A currency pair keeps one vol and is the same draw for draw.
- **What it does to a ticket** (forwards of about a million of notional, 40,000 paths): uncollateralised, CVA and
  FVA fall by up to 3 % on tickets of a year or less (an at-the-money exposure is lower when the variance is
  uncertain than when it is fixed at the same average) and the total moves by about 1 % or less. Under a bilateral or an on-chain CSA the margin at the first date rises 7 to 13 % (what we call 9 to 13 %, what we
  post 7 to 11 %), MVA 2 to 10 % on BTC and ETH, the small CVA beyond margin 15 to 45 %, and KVA falls 4 to 13 % on BTC
  and ETH, where the larger margin lowers the SA-CCR multiplier (SOL's, a Group 2b asset with no multiplier, does not
  move). The total moves 1.5 to 6 % on BTC and ETH and within about 1 % on SOL. Against the
  history: the 1st percentile of a ten-day BTC move is −22.6 % in the model, −24.1 % in the five years (a figure
  whose own sampling band is −30 to −18) and −19.8 % for a Gaussian.
- **Numbers that moved, in `GOLDEN_CHANGES.md`.** The pinned 6-month BTCUSD forward under a bilateral CSA, 500
  paths: KVA −136.69 → −110.01, MVA −657.45 → −676.86, CVA −3.38 → −4.02, DVA 1.33 → 1.86, total −797.42 →
  −790.30, each with its reason. Nothing else pinned moved: no swap, no EURUSD. No uncollateralised digital-asset figure is pinned; a unit test
  holds the size of that move.
- **How it is checked.** The margin estimate with the regimes on agrees to sampling, at every date, with a
  simulation written apart from the engine that redraws both chains and steps the level every day (BTC, ETH, SOL),
  and with the model validator's own implementation, written from the methodology alone (kept in `tests/reference`).
  The 5-, 10- and 14-day tails the calibration printed are pinned. The calibration's likelihood equals the sum over
  every path of hidden states. The `xva_crypto` workbook carries the engine's step variances and rebuilds every
  path and the bridge in cells: 51 of 51 checks under each CSA preset.
- **Where it shows.** The XVA tab's SURFACE PROOF has a REGIMES line with the run's own figures; the answer carries
  `params.vol_regimes`; `vol_regimes: false` in a request runs one vol, for comparison. The fit is
  `backend/scripts/calibrate_vol_regimes.py`: dated constants, and a refit is a reviewed change.
- **Limits, stated.** Two states a chain is coarse: the worst weeks of the five years are worse than the model
  makes them. Today's state is not inferred. The parameters are held for the life of the trade, and on long tickets
  the regimes understate. An option on the paths is still marked at the surface's vol: at the money that mark is
  about 3.6 % above what the regime paths pay one month from expiry, 1.2 % at six months. Default and the regimes are
  independent. The credit page's
  netting-set simulation and the market-risk history are unchanged. The methodology is v1.15 (§9.3); the model
  inventory has the row.
- **A run has a size limit.** A single ticket's XVA run had none; with a clock that holds a byte for every path and
  day, a settlement decades out could have taken the instance's memory. One run takes paths × monthly steps up to
  four million (ten years at 10,000 paths is 1.2 million) and settlements up to 50 years out; beyond that the answer
  is a 422 that says how many paths fit.
- **Also.** A test that compared two figures rounded to a cent with a tolerance of a millionth failed on the day the
  cents fell the other way; it compares to a cent now.

## 0.23.2 · 11 November 2026

**The hosted demo is the launch set.** Call A of the Phase 1 exit list, asked for by the owner ("we're only going
live with XVA... we're not gonig to publish capital or margin or pnl or risk", "as recommended", then "do the
recommendations": the default in code, so nothing has to be set on the host).

- **What a demo holds back by default** is now everything outside the launch set: P&L, market risk, counterparty
  credit, capital, collateral, the XVA reserves and IPV. Until this release it was capital alone, and a demo
  user could switch the other six on under Configurations → Modules. They are answered as off and on request to
  everyone but an administrator, whatever the firm's row says; a save or a preset that asks for one changes
  nothing; the fullest preset gives a demo user the launch set. Booking, valuation, the XVA tab with every
  charge, the scenario tab, confirmation, the messenger and the news room are as they were.
- **The app does not promise a switch that is not there.** The launch home says "P&L, risk and more are on
  request" where it said "Switch on P&L, risk and more", and the Modules page's note says the modules marked on
  request are not part of the demo.
- **The nightly batches follow the firm's own switch, as before** (`modules.runs_batch`). Holding a module hides
  its pages; it does not stop a batch. The health page's checks for P&L, market risk and counterparty credit read
  the latest stored day across every account, and stopping them for everyone but an administrator would have
  turned them red on the first night no administrator's book ran.
- **What changes for a self-hosted desk.** Nothing where `RIJEKA_DEMO_PROVISION=0`, which is what
  `docker-compose.yml` sets: nothing is held. An instance that keeps sandboxes (provisioning on, such as a
  classroom) now holds the seven: set `RIJEKA_HELD_MODULES=NONE` to hold nothing, or `CAPITAL` for what it had.
- **Stated, unchanged:** the hold is a presentation rule, not an entitlement: a held module's API routes still
  answer a signed-in user for their own firm; and a held page can show in the browser if the modules answer does
  not arrive.
- **Checked:** 1,340 unit and reference tests; 147 integration tests on the local stack (a new workspace on a
  demo with the default; the mechanism with capital alone, set explicitly); 95 browser journeys, one new.

## 0.23.1 · 11 November 2026

**Two migrations are written out, and a table that arrives is seen at once.** Call D of the Phase 1 exit list.
Nothing is applied by this release: neither file is on the approved list, and each goes there only on the owner's
words for it.

- **`2026-11-11_pending_anchors.sql`**: the pending-anchors table on its own. It was a section of the 3 November
  jobs file, bundled with the worker's tables, which are safe to apply only when the worker is alive; so the
  confirm path waited on the worker. Applied, a slow block answers at once and the trade reads ANCHORING until
  the receipt is applied. An empty table, row-level security on, no policy and no grant: only the API reads it.
- **`2026-11-11_sync_role_search_path.sql`**: the function that copies a profile's role into the sign-in record
  runs with its owner's rights and named no search path. It names one, as `is_admin()` has since 0.14.2. Its body
  and what it does are unchanged.
- **Read by the database keeper** on scratch databases: both files run twice without error, with and without
  the jobs file applied and in either order; nothing is readable by a signed-in or anonymous role; the role is
  still copied; the runner's guard accepts both without a flag.
- **A presence check keeps only a yes.** The checks for pending anchors and for the jobs table remembered a "no"
  for five minutes, so a confirm would still have waited in the request for up to five minutes after the table
  was applied. A "no" is now asked again every time.
- **Health** names the new file for pending anchors (`schema` on `GET /api/ops/health`).
- **Checked:** 1,340 unit and reference tests; both files applied twice on a fresh local database.

## 0.23.0 · 11 November 2026

**The margin on a digital-asset ticket is no longer read low.** First step of finishing the XVA on digital assets,
asked for by the owner: "lets not hide the KVA and MVA... has to be full XVA", then "go ahead with 11 and the rest."

- **What was wrong.** Collateral and initial margin read the value a margin period before each date. The engine
  took it from a bridge between the grid VALUES, which is Gaussian. A forward's value is a multiple of a lognormal
  level, and at a digital asset's vol the difference is not small: against a simulation that draws the level at both
  dates (200,000 paths, no grid, no bridge) the margin we would call read 1 % low at 8 % vol, 9 to 11 % low at 55 %,
  13 to 15 % at 80 % and 16 to 18 % at 110 %. The documents said 7 to 15 %.
- **What it is now.** On currency and digital-asset tickets (a forward, an option of any style, a package) the
  pair's forward is bridged between grid dates in logs, where it is a Brownian motion and the bridge is exact, and
  every leg is valued on that level with the time it then has left (`pricing/fx_xva.exact_lag`). A leg that has
  settled stands at what it paid; a margin period of a whole step reads the grid. The estimate now agrees with the
  simulation to its sampling error at every vol from 8 to 110 % (`tests/test_fx_xva_lag.py`, 17 tests; the old
  bridge fails the same test at 55 % and above).
- **Numbers that moved, each in `GOLDEN_CHANGES.md`.** A 6-month BTCUSD forward, 10 BTC, 55 % vol, bilateral CSA:
  KVA −150.7 → −134.8, MVA −615.5 → −622.1, CVA −2.8 → −3.6, total −769.1 → −760.4. Why each: the initial margin
  we call is 9 % larger at the first date and 10 % on average (259,784 → 284,311), so the set is further
  over-collateralised and SA-CCR's multiplier falls from 0.305 to 0.275: the add-on (104,127) and the replacement
  cost (nothing) are unchanged and the exposure at default goes 44,462 → 40,098, which is the fall in KVA. The
  variation margin does not rise. The margin we post is lower at the first date and 3 to 8 % higher later, 2 % on
  average, which is MVA. What is left beyond the margin is the lognormal's tail, fatter than the bridge's: the peak
  expected exposure beyond margin goes 952 → 1,382, which is CVA.
  On chain: KVA −113.6 → −98.7, MVA −448.2 → −463.3, total −563.1 → −564.1. At 80 % vol the total moves −1,003 →
  −1,031 bilateral and −743 → −786 on chain. (These are runs of the engine on stated inputs, 2,000 paths, seed 42;
  the pinned book's BTCUSD forward is on the local stack's own market and reads differently.) The pinned EURUSD
  forward (8 % vol) moves 1.4 %: MVA −845.74 → −832.08. Nothing without margin moves, and no rates figure.
- **A margined digital-asset forward is in the pinned book** from today (`xva.BTCUSD.bilateral`), so the next
  changes to its engine show there.
- **The Excel replications rebuild the new lag in cells:** the forward a margin period earlier, then the trade valued
  on it. 51 checks in each of the currency and digital-asset books pass under every CSA preset, evaluated cell by
  cell (the `formulas` library; the unit tests do not evaluate cells).
- **The methodology is v1.14** (§9.2, §9.3) and `docs/xva.md` and the model inventory say what changed.
- **Limits, unchanged and stated:** the rates ticket and the netting-set engine (the credit page, the reserves, the
  incremental charge) still bridge between values, so a margined digital-asset position is charged a little
  differently there and on its ticket; a margined CVA is still the 1 % tail of the model's own move (no jumps, no
  gap risk: the next step). Found by the validator and stated in `docs/xva.md`: a barrier or a touch that is beyond
  its barrier a margin period earlier but has not knocked on the grid is valued as knocked there, which overstates
  the move near the barrier (about 13 % of the margin called at one date of her case) until the paths monitor
  between grid dates; in the expiry's own step the time left runs to the grid date; the option's lag has no
  workbook and no reference row.
- **Reviewed.** The numbers guardian reproduced every figure above to the decimal from the two engines and found
  the first wording of the KVA reason loose (it is the multiplier, through the initial margin, not the variation
  margin): rewritten as above. The validator's own simulation, sharing no code with the engine: a forward's margin within 1.1 %
  date by date and a European call's within 1.6 % at 80 % vol, through margin periods shorter and longer than a
  step; the old bridge 16 to 21 % low on the call. A cold read found the XVA tab's margin-period note still
  describing the old method and naming SIMM: corrected.

## 0.22.1 · 11 November 2026

**Nothing but an LEI is signed, and the public register gives out nothing but what its fields must be.** From the
security review of sign-up, roles, modules and the register (item 6 of the Phase 1 exit list).

- **What was wrong.** The public register page wrote what the API gave it into the page as markup, and the API
  gave it the two parties' LEIs as typed. A legal entity's LEI was free text, and on a demo instance a signing key is
  held for any LEI that begins DEMO, so an account could name its entity DEMO followed by markup, confirm a trade
  with the demo counterparty and have it anchored and listed: a script on rijeka.app/confirmations for every
  visitor. Found by reading the code; the 21 rows listed on 11 November carried none. The page was corrected and
  deployed the same day (it writes every field as text). This release closes it on the server.
- **A confirmation signs nothing but an LEI.** Twenty capital letters and digits (ISO 17442), checked where every
  confirmation, amendment and termination resolves its parties, before a key is looked up. The Legal Entities page
  writes its rows straight to the database, so the rule is held there and not only in the route. The route
  (`POST` and `PUT /api/legal-entities`) refuses anything else too, stores an LEI in capitals, and stores an entity
  with none as it always was (leaving the field out used to be an internal error).
- **The register answers in shapes.** `GET /api/public/confirmations` gives a hash only when it is a hash, an
  address only when it is an address, an LEI only when it is an LEI, a link only when it is an https address
  without markup, and a product only in letters, digits and a few marks. Anything else is left out of the row,
  and a row whose hash is not a hash is not listed.
- **A counterparty is linked only to its owner's legal entity.** The route refuses another account's entity named
  by its id, and a confirmation or a trade card's countersigning reads such a link (the page can write one) as no
  link.
- **An administrator cannot take another role with the role switch.** `PUT /api/me/role` never grants admin, so
  there was no way back but the database, and a lone administrator could lock the Users page for good. It is
  refused, and an administrator is not offered the switch.
- **Checked:** 1,319 unit and reference tests, 122 integration tests on the local stack; hostile rows through the
  register answer leave no markup in it.
- **Reviewed twice by the security reviewer.** The second read found that `$` in the shape rules let a final
  newline through and that a trade card still read a linked entity without its owner: every rule now matches the
  whole string, and that read is scoped.
- **What changes for a desk, stated:** a trade already confirmed whose party's LEI is not twenty capitals and digits
  can still be read, verified and proved, and can no longer be amended or terminated until the LEI is corrected
  (which changes what a new record hashes to); a party with no LEI at all is as before. The register leaves out an
  explorer link that carries a query string or an underscore in its host. An administrator on the hosted demo no
  longer has the role switch.
- **Not in this release, stated:** the rule is not yet a constraint in the database (a migration, on the owner's
  word), so a row written directly can still hold other text, which is then never signed or listed; the modules
  answer still fails open in the browser (the held pages show if it does not arrive; their routes answer either
  way); a role changed on the Users page is honoured up to 30 seconds late, and the Users page itself can still
  demote the last administrator; a legal entity's name is free text (it is signed and shown to the counterparty,
  not on the public register); `docs/schema.sql` is an older export than the policies production runs.
## The tenancy tests run on the local stack · 11 November 2026 (tests only)

**No test signs in to a hosted service any more.** Item 9 of the Phase 1 exit list.

- **What was wrong.** `tests/test_rls_isolation.py` (25 tests: one account must never read, change or delete what
  belongs to another) ran against a server on localhost:8000 with tokens fetched by signing in to the hosted auth
  service, so on a developer's machine it wrote to whatever database that server was on. It was skipped in CI and
  had to be deselected by hand locally.
- **What it is now.** The same checks are `tests/integration/test_tenancy_isolation.py` (24 tests; the one that only
  tested the hosted sign-in is gone): the stack's own tokens, the stack's database, in CI with every other
  integration test. Market data, vol skew and SABR parameters, the XVA calibration, counterparties, legal
  entities, trades, legs and confirmations are each tried from the other account.
- **They clean up.** A calibration they save is dated 2099; left behind it is the "latest" one and the pinned
  book's swap XVA then runs on it the next time the same database is used (seen on the first local run: CVA −2,090
  → −2,733). The file removes what the harness does not truncate, before and after; the suite passes twice in a
  row on one database. Its trades, legs and events stay until the harness truncates them at the start of the next
  session (an event cannot be deleted by a row).
- **What these tests hold, said plainly:** the routes' own filter on the caller's id. The API connects to the
  stack as the tables' owner, so row-level security is not exercised by them, here or before.
- **Removed:** the fixtures in `tests/conftest.py` that read `.env.test` and signed in; the mentions of them in
  `pytest.ini`, `CONTRIBUTING.md` and the CI file's comment.
- **Checked:** the integration suite on the local stack, twice: 144 passed each time, with `test_migrate.py`'s 22
  deselected (it runs only on the default database name; CI runs it). 1,299 unit and reference tests; ruff. A cold
  read compared every call of the old file with the new one: nothing weaker.

## What Phase 1 is, said one way · 11 November 2026 (frontend only)

**The home page and the roadmap say what the sign-in page says.** Asked for by the owner as the first line of the
Phase 1 exit list ("as recommended, then we'll review").

- **The home page's footer** said RATES ONLY IN PHASE 1 while the sign-in page said rates, FX and crypto forwards
  and options are live. It now reads PHASE 1 · RATES, FX & CRYPTO FORWARDS AND OPTIONS.
- **The roadmap was behind the app.** FX and digital assets are listed as Phase 1 beside rates, with FX options
  (which sat under Phase 2). Wrong-way risk shipped in 0.17.0 on currency and
  digital-asset tickets and the page still listed it only as next: it is now DONE with its limits (the multiple is
  the desk's input, the netting-set charge does not see it). Of the two lines that named it, the Phase 2 one no
  longer does, and the counterparty-credit one stays NEXT for what is not built (the netting set); a new NEXT line
  names calibration. Added
  as DONE: a trade as a package of legs (0.19.0), fixings for digital assets (0.14.0), forward curves to ten years
  (0.22.0), the methodology read in the app (0.20.0). Phase 2 is credit and cross-currency, and is PLANNED.
- **Checked:** lint, 587 unit tests, the design check (no count moved), both screens looked at in pictures at
  1440 wide. **Not changed:** the names FUND01 and CRYBASIS01 on the roadmap's older lines; the sign-in page.

## The logo · 11 November 2026 (frontend only)

**A logo that simulates, and a confirmation you can watch.** Asked for by the owner: "our Rijeka logo needs to be
better... just written down seems bit plain", then, choosing step by step from a mock: simulated paths like a Monte
Carlo run, moving, into an R in a ring that is the name's first letter, and "on confirmation on chain the
animation should be our logo loading... once trade confirmes the image should finish loading".

- **The logo is a river of simulated paths running into the ringed R that begins the name.** Rijeka means river.
  One desk's paths are limestone, the other's blue; they turn brass where they meet and run as one line into the
  letter. Each path is a Brownian bridge whose coefficients turn slowly, so it keeps re-simulating. The ring is
  open where the river enters (a letter in a closed circle reads as the registered-trademark sign).
- **In the top bar it runs once and then holds still**, and runs once more each time a trade is confirmed. With
  "reduce motion" set it is drawn complete and does not move. The sign-in pages keep the plain name.
- **On the ticket's CONFIRM tab the logo is the picture of the confirmation.** The river runs while the trade is
  being signed and anchored. The R is drawn when the trade is confirmed. The ring is the seal: it is drawn only
  when the record is anchored on a chain, and the words under it say which (CONFIRMED ON CHAIN, or CONFIRMED · NOT
  ANCHORED). A confirmation that fails never draws the letter. A trade confirmed earlier shows its certificate
  and seal as before.
- **The browser tab has the small form** (one line into the ringed R) in place of the build tool's default icon.
- Not done: the letter is built from strokes by code and is to be redrawn by a type designer; the motion's cost
  on a laptop has not been measured; no check against other firms' marks.

## 0.22.0 · 11 November 2026

**Forward curves to ten years, with what is implied marked as implied.** Asked for by the owner: "we need to be able
to model all FX to 10y... the derived points on the forward curve has to be differentiated somehow so user knows its
implied and how... in configurations, user should be able to turn on/off tenors on the curve."

- **Beyond the last quoted tenor a forward is parity plus that tenor's basis, held flat as a rate.** Until now the
  last points were held flat, so a five-year forward was the two-year one: wrong past the last quote. On a currency
  pair the basis is the cross-currency basis; on a digital asset it is the futures basis, so the asset's implied
  rate is what is held. Forwards inside the quoted tenors are unchanged, and so is every figure of the pinned book.
  The same rule prices the ticket, a booked trade and the P&L revaluation (`pricing/forward_points.py`).
- **Every forward says what it is.** The price carries `forward_kind` (QUOTED, INTERPOLATED or IMPLIED),
  `forward_method` in words and the basis rate. The ticket marks a forward beyond the quotes "implied, not quoted"
  with the method, in amber. The forwards page has a row for every tenor to 10Y: a quoted row names its source, a
  row that is not a quote is in italics with an IMPLIED or INTERPOLATED mark, and the chart draws the implied part
  dashed.
- **A tenor can be switched off** on the forwards page: its points stay on the row and its date is priced like any
  unquoted one. Two tenors must stay on. No migration: the stored quote already had the flag.
- **The ticket's tenors go to 10Y** (3Y, 4Y, 5Y, 7Y, 10Y added). A digital asset's forward prices to ten years (it
  stopped at two); its option still stops at two, where the vol surface ends.
- A tenor the venue feed fills beyond the venue's last listed expiry is named as implied (it prices as before).
- Checked: 12 rows against QuantLib's parity with the basis done by hand (EURUSD, USDJPY, a digital asset, at 3Y, 5Y
  and 10Y), unit tests of the rule, an API test on a real database, a browser journey. Methodology v1.13, §12.
- A ticket at a quoted tenor is that tenor: a two-year ticket settles two calendar years from spot, a few days past
  the tenor's 730, and is priced a few days of carry from the quote and called quoted, not implied (seven days'
  slack). A row changed on the forwards page and not yet saved says NOT SAVED. Saving over a feed's curve keeps
  what the feed filled named as implied unless the desk types over it. The scenario tab draws a ticket's own carry
  when its date is beyond the quotes.
- Reviewed by the model validator (one figure re-derived by hand to nine decimals), the independent reviewer and
  the design keeper; their findings are in this release.
- Limits: one number read off the last quote stands in for the basis beyond it, with no band of uncertainty, and an
  error in a curve is inside that number; while the points are held a parallel move of a curve leaves a forward
  beyond the quotes where it was; nothing trades that far out on a digital asset, and the screen says so; a
  scenario's shock of the points is still flat beyond the last tenor; the reference rows check the parity against
  QuantLib and restate the rule.

## 0.21.2 · 11 November 2026

**A swap shows each leg again, and an embedded cap or floor shows its value and its vega.** Reported by the owner:
"why did we also lose per leg value. i'm looking at IR swap and we only have Net NPV, also, when i'm adding embeded
optionality it doesnt show me Vega risk or the value of the option value on the swap."

- **Each leg's value is in the footer**, on every tab, beside the net: FIXED PV and FLOAT PV (a basis swap's two legs
  by their own names). They were on the TRADE tab until the valuation moved to CASHFLOWS on 10 November, which left
  the footer with the net alone.
- **An embedded cap or floor: OPTION PV and VEGA/1bp.** The engine has always computed both for the strip; the leg
  added the value in and dropped the rest, so the option was inside FLOAT PV and its vega nowhere. The leg's coupons
  and its options are now shown apart and add up to the net; the vol tier used is in the valuation (amber when it is
  the fallback). The price says `option_pv`, `vega`, `option_vol_tier` on each leg and in total, and null on a swap
  with no option (not zero).
- **An embedded option that could not be priced says so.** It used to add nothing and say nothing; the ticket now
  names it and the reason under the terms, the footer says NOT PRICED on every tab, and its value is null, never
  zero. An entry with a side or a type the engine does not know, or one put on a fixed leg, is named too.
- A cap, floor or collar opened from the blotter (booked as a leg that is only its options) shows OPTION PV and
  VEGA/1bp and no coupon figure.
- No figure changed: the QuantLib reference suite, the engines and replications and the pinned book are as they
  were. The option's value and vega on the leg each have a row against QuantLib's Bachelier formula (three booked
  caps and floors), the vega is also checked against the leg repriced on a surface 1bp higher, and one leg's vega
  was re-derived by hand (2,750.60 against 2,750.6026). The vega is $ per +1bp of normal vol, one-sided, with the
  smile held; the swap's IR01 includes the option's delta.

## Figures are set one way; a design keeper · 11 November 2026 (frontend only)

Reported by the owner: the forwards page of Configurations and the ticket did not look alike; "the points pips look
different size than outright"; and nobody was responsible for consistency.

- **One size of type at every width.** The root size grew with the window (`clamp(14px, 0.75vw, 16px)`), so whatever
  was sized in rem grew on a wide screen and whatever was sized in px did not: a figure and the field beside it
  were two sizes. It is 14px now, the size the app is drawn and tested at.
- **A figure is mono, 12.5px, in the colour of text or of its sign.** The forwards page set its tenors, days, points,
  outrights and parity in the interface face; they are set as the ticket's are. Tenors are no longer brass, what
  parity implies is no longer blue (quieter than a quote), the basis takes the colour of its sign, and a quote typed
  into a table is the colour of text. A date or a number in any field takes the number face.
- **Iris, the design keeper** (`.claude/agents/iris.md`, a gate in `CLAUDE.md`), and a check that counts what is
  still set by hand and fails the unit run when a count rises (`npm run design`, `frontend/design-baseline.json`):
  53 distinct sizes, 623 sizes in rem, 209 hex colours outside the tokens. 173 fonts named by hand now use the
  tokens (the same faces: nothing moves on screen). The sizes in rem are next, page by page with pictures.
- A journey measures it: the points field and the outright are one face and one size; the root size is the same at
  1440 and 2400 wide; a date on the ticket is set like the notional.
## Dependencies · 11 November 2026 (frontend only)

Eight of GitHub's nine open alerts closed; none was reachable in the app as deployed.

- **The test runner** (vitest 3.2.4 to 4.1.12): three alerts marked critical and three medium, all in tools that run
  only on a developer's machine and in CI, and only with the runner's UI or API server listening, which the project
  never starts. 568 unit tests pass on the new version.
- **KaTeX** (0.16.11 to 0.18.11): a medium and a low. KaTeX runs when the methodology's pages are built, on the
  project's own `.tex`, without the `trust` option the flaws need; the app ships its stylesheet. The pages were
  rebuilt and read.
- **Left open: `uuid` under `exceljs`** (medium). The flaw is in `v3`/`v5`/`v6` with a caller's buffer; exceljs calls
  `v4()` only, and its latest release still asks for the old version.
- A journey that read the footer's first roll as the one under test now waits for the first to end.

## 0.21.1 · 11 November 2026

**The app follows `main` when the API has nothing to deploy.**

- The API's host builds from `backend/` and deploys only for a change there. The release move (the API's own at
  startup, and the `release-sync` workflow) listed the folders it knew to be outside the API and took everything
  else for the API. The verifier's page lives under `chain/`: the push that changed it was waited for, never
  deployed, and the app stayed a commit behind `main`. One rule now, in both: a push with nothing under `backend/`
  but Markdown lets the app follow `main`. A file moved out of `backend/` counts as a change there, and a list of
  changes GitHub may have cut short (300 files) is not read as "nothing in the API changed".

**The ticket's sides have their colours.** Reported by the owner: on a new trade BUY and SELL were the same colour, and the same as CALL and PUT.

- **A side has a colour, the same wherever it is chosen.** Selling or paying is coral, buying or receiving is green:
  the forward's and the option's BUY and SELL, the swap's PAY and RECEIVE, a swaption's or a cap's side, a leg's
  side on DETAILS, an embedded option's. Before, only the swap's PAY and a leg's SELL were coloured; the forward's
  and the option's sides had none, and an embedded option's BUY was brass (brass is an action).
- **The chip that is selected stands out.** A lighter face, a bright edge and a rule under it. Since 0.21.0 an
  unselected chip had a clear edge of its own, which left the selected one a shade apart and no more. CALL and PUT,
  a product, a style: selected in no colour of a sign.
- A journey reads the colours from the page (`e2e/controls.spec.js`); pictures before and after by
  `e2e/perf/sides.spec.js`.

## Verifier · 11 November 2026 (rijeka.app/verify, deployed the same day and read back byte for byte)

Found by the security review of the merged verifier, before it was pushed to `main`; the flaw was on the public
page until this deploy.

- **A registry the page does not know never earns a green verdict.** A proof names the registry it was anchored in,
  and a `#hash=` link could name one too; the page read whichever it was given, so a forger with a contract and two
  keys of their own could be shown VERIFIED or ANCHORED under any party names. The page now lists the registries it
  knows by chain; any other is read and reported in amber, with both addresses. A self-hosted copy lists its own.
- **A verdict says only what was checked.** VERIFIED needs the hash, both signatures and the chain; a proof with no
  signatures, or with no node to read, is NOT FULLY VERIFIED (it used to be VERIFIED).
- **A link cannot hang the tab.** A proof link is refused above 512 KB, and stops unpacking at 2 MB (a 64 KB link
  could unpack to 64 MB and more). A hash link that is not a hash is refused; a superseded or terminated record
  reads NOT CURRENT, from a link or from a proof; every outcome ends in a verdict, including an empty box, text that
  is not a proof, and an error inside the check. One check runs at a time.
- The embedded example no longer carries the ids of the chat it was confirmed in (they were never part of the
  signed record). Every verdict is written as text.
- Checked in a browser against a stubbed chain, 27 cases, and the first 19 against the page as it was (the forged
  proof and the unsigned proof both read VERIFIED there). Not a test in CI: the page loads its library from a CDN.
  The same 27 ran against the live page after the deploy. Read twice by the security reviewer and twice by the
  independent reviewer.

## Public site · 11 November 2026

Redeployed (rijeka.app is deployed on its own, not with the app).

- **The verifier checks a leg inside its package.** rijeka.app/verify re-derives a leg's own record, finds its hash
  among the package's legs and re-derives the package's hash. The live page had share links the repository's
  source lacked (`#p=`, `#hash=`); the two were merged, not overwritten, and `chain/verify/index.html` is now the
  same file as the live page.
- **No SIMM on the public site.** The SIMM estimator page and its sample workbook are taken down (404), and every
  mention is gone or reworded: the XVA simulator's margin input is "initial margin" from your own margin model.
  One sentence says why: ISDA SIMM is ISDA's licensed methodology and is not included.
- **Also carried by the deploy**, because a deploy replaces the whole site: the methodology PDF (v1.0 was still
  live; now v1.12), the privacy notice v1.1 of 2 November (the app already showed it), and the home page's headline
  naming options.

## 0.21.0 · 11 November 2026

**What can be pressed, typed into or pointed at looks like it, across the app.**

- **A button is raised**: a lighter face, a bright edge, a darker foot, and it goes down when pressed. Until now an
  ordinary button was see-through with a faint edge and dim text, and read as a label (+ ADD LEG on DETAILS was the
  example). Brass stays for the one action of a view (BOOK, + NEW TRADE).
- **A field is a lighter well**: every box that is typed into or chosen from, on every page. It brightens under
  the pointer and takes a brass ring while it is typed in. What is computed or cannot be changed has no well, so a
  typed value and a computed one no longer look alike. A field that is amber because it cannot be read stays amber.
- **A row answers the pointer**: the trade under it is a band with a rule at its edge and its text at full
  strength, on the blotter and in every table; the cell under the pointer is a shade lighter; the selected trade
  is brass. (The blotter did highlight a row before, by one barely visible step.)
- How: three sets of tokens and one block of rules in `index.css` (`--btn-*`, `--fld-*`, `--row-*`). The families
  of button class the app has take the rules directly; the 92 buttons styled inline carry one of two classes
  (`rj-btn`: the whole look; `rj-press`: the foot and the lift only, for a button whose colour says something: a
  side, a selected state, a warning). Icons and links without an edge are left as they are.
- Not changed: the sign-in pages (their own scene) and the certificate (paper). Tabs and the rail's filters keep
  their look; a chip that is not selected has a clearer edge.
- A button that cannot be pressed is flat: no face and no foot. A colour set on one button (a red TERMINATE)
  stands over the family's look. The rule at a row's edge is drawn on its first cell, where every browser paints it.

## 0.20.0 · 10 November 2026

**The methodology is read in the app.** The Methodology page was a list of download buttons under a link to a PDF.

- **A syllabus at the side.** How the system is built, then the document's nineteen sections under the headings a
  desk looks for them by, then the workbooks, the findings log and the document's own page (versions, references,
  PDF). Each section has its own address (`/methodology/12`); a reference in the text ("§13") goes to the section it
  names; the selected section lists its parts.
- **The text is the document's.** `frontend/scripts/build-methodology.mjs` makes the pages from the one LaTeX source
  (`docs/methodology/rijeka_methodology.tex`): the same words, the formulas set by KaTeX at build time, the displays
  numbered as the PDF numbers them. A test fails when the pages are not what the source now gives, so the page and
  the PDF cannot drift apart unseen. The builder stops at a LaTeX command it does not know; it does not guess.
- **What stands behind a section, beside it.** The model inventory's own rows for that section (reference
  comparisons, Excel replication, independent validation, what is open), read by the same builder, and the
  workbooks that belong to it, built on request as before. A section says in one line whether every model in it
  was compared with an outside source or an outside validator is still wanted; the syllabus carries the same in
  three marks. The inventory named five sections by numbers the document had moved on from; they are corrected, and
  the builder now stops when the two disagree.
- **Two tables are worked on the page**: the digital-asset forward of §12 as the workbook's key cells, and the first
  line of the waterfall of §10 with a flat exposure. Type over an input and the cells below reprice. Each says it
  is sample inputs and one formula, not the engine's run.
- **How the system is built.** The pieces as solids in space (three.js, which the app already loads for its other
  scenes), coloured by kind with brass kept for what is on chain; light travels along each join the way the request
  goes; FOLLOW A TRADE walks the seven steps from sign-in to the batches (every two hours, one row a day); a piece says what it does when
  pressed; the scene turns when dragged. Under it, the API's own answer on `GET /api/ops/health`, read when the page
  opens: version, commit, migrations and each batch, amber when one is late. Where a browser cannot draw the scene
  the page says so and the names and steps remain.
- New dependency: `katex` (MIT), for its stylesheet and fonts; the formulas are set when the pages are built, not in
  the browser.
- The METHODOLOGY tab of the top bar stays lit on a section's page; the crypto option styles workbook is listed
  under §13, where the document treats them.
- Not in this change: notes in plain words beside each formula (the mock had two; they have no place in the source
  yet); a workbook's real cells shown in the page (the worked tables are the document's formulas, not the file);
  the formulas are not read out by a screen reader as mathematics (KaTeX's visual output only, to keep the page
  small).

## 0.19.2 · 10 November 2026

**The methodology document, set properly (v1.12).** No formula changed.

- **Names of quantities are upright.** NPV, CVA, LGD, EAD and the like were set as italic letters side by side, which
  reads as a product of letters; 152 of them, of 53 kinds, are now set as names.
- **Nothing runs past the margin.** Seven displays did (the two option prices with their d, the VaR statistics, the
  bond on the paths, the two readings of collateral, SA-CCR, CVA capital, ColVA beside the waterfall), by up to four
  centimetres, and the reference table's last column by seven millimetres. Each is now set on several lines.
- **Paragraphs are divided.** Thirteen ran to a page or more (digital assets: two pages in one paragraph); they are broken
  at about fifty places where the subject changes, in the order they were written. Three formulas that sat inside a
  sentence are displayed, and no heading is left alone at the foot of a page.
- **Code names are printed as written.** Twenty-one showed a backslash before each underscore or brace.
- **The front.** The title said version 1.9 under a header that said 1.11; the history of versions, which filled the
  first page, follows the contents, and gains the entry for 1.10 and 1.11 it lacked.
- **One correction of substance.** The known limitations of §16 still described initial margin as a delta margin per
  risk class with a cryptoasset weight, the method 0.18.0 removed; they now say what §9 says (the desk's amount or
  the engine's estimate; a digital asset's group the engine's default unless the desk sets it). The same leftover is
  gone from `docs/xva.md` (an amortising margin, a comparison with a SIMM-weighted figure) and `docs/capital.md`
  (a margin weight for digital assets); found by the validator.
- Checked: the build reports no line past the margin; every word of the old and new PDFs compared (the differences are
  the ones above and how a PDF reader orders a table).

## 0.19.1 · 10 November 2026

**The footer, CASHFLOWS and CURVE SCENARIO are the package's.** Until now a ticket with further legs showed the
first leg alone on these three.

- **Footer.** PACKAGE NPV (for a package of options alone, NET PREMIUM, paid or received) and each sensitivity
  summed over the legs; the structure reads as DETAILS names it (STRIP, COLLAR, CUSTOM, ...). While a leg is being
  priced, or one could not be, the figures are a dash and the first label says which: a sum with a leg missing is
  not shown. A package's footer with six figures (one with an option in it) names them without their units, so
  the line holds beside a long structure name; paid or received stays. No other ticket's footer changes.
- **CASHFLOWS.** The package first: every leg in a row (its premium, what it would settle at today's forward,
  its discount factor, the engine's NPV) and the dates on which money moves, earliest first, the legs that share a
  date netted; a deliverable currency leg shows both principals. Each leg's own flows are behind its button, as a
  single trade's. EXPORT XLSX writes the package: the legs, the dates, the market each leg was priced on.
- **CURVE SCENARIO.** One scenario over every leg: the spot shock in full, the forward curve's move read at each
  leg's own days from spot, each rate curve's pillar shocks read at each leg's own time (the engine's
  interpolation), the vol shock on every option leg. The change by factor, the tiles and the ladder are the
  package's; a table shows each leg at the market and under the scenario; the chart marks each further leg's
  settlement. A package's vol is one of its curves even when its first leg is a forward.
- **Limits, stated on the screen:** the scenario is the browser's closed form (forwards and European options).
  A package holding a leg of any other style (American, barrier, digital, touch) is not summed without it: the
  tab says the scenario is of leg 1 only, and which leg stands in the way. The same holds for a leg priced on
  another pair or one that has fixed or settled. CAPITAL still shows the first leg, and DETAILS says so. The settlement amounts on CASHFLOWS
  are today's estimate at the fair forward; a touch has no figure there. A booked leg opened from the blotter
  still shows that leg alone.
- **Fixed on the way:** a leg whose type had just been changed drew its strike as not-a-number on the DETAILS
  chart until its new price arrived (console errors, no wrong figure). The note on DETAILS that said the other
  tabs show the first leg now says what they show.
- **Chat: a rooms answer that could not be read no longer crashes the page.** A 200 whose body was cut off was
  taken as the list of rooms and every page showing the unread count fell to its error boundary ("rooms.reduce is
  not a function"). Found by CI: a journey's page recorded it once and the SYSTEM page's journey, which lists
  browser errors, failed on it. What cut the answer off in that run was not established.
- **Evidence and what is missing:** the package's scenario is held to the single-trade closed form leg by leg,
  and one figure was derived independently of the code (agreement to 1e-10). There is no comparison with the
  engine or an outside reference for a package, no Excel replication of the sum and no methodology section
  (`docs/model_inventory.md`).

## 0.19.0 · 10 November 2026

**A package is one trade: one trade ID, a leg ID for each leg, one confirmation on chain.**

- **Booked whole.** A ticket with legs is booked by one call (`POST /api/book/package`) in one transaction: every
  leg or none. Before this each leg was a request of its own and a refusal part of the way left some booked.
- **One trade ID, a leg ID each.** The package has a trade ID of the usual shape (TRD-12345678) and each leg its
  own ID under it (TRD-12345678-1, -2, ...). DETAILS shows TRADE ID and a LEG ID column; the blotter finds the
  legs by the trade ID. A single trade is never given a name a package's legs stand under.
- **One confirmation.** On the CONFIRM tab a package whose legs are all pending offers CONFIRM PACKAGE ON-CHAIN ·
  n LEGS, ONE RECORD. Each leg keeps its own record and hash; both parties sign the package record that lists
  those hashes; one transaction anchors it (`POST /api/chain/confirm-package`). Every leg is confirmed together.
- **The certificate of a leg** shows the package and its place (leg 2 of 3), the package's hash (what is on
  chain) and the leg's own hash. VERIFY re-derives the leg's record, finds it in the package and re-derives the
  package's hash; the proof pack carries the package record as what was signed, with the leg's record beside it,
  so the public verifier as it is today checks it, and its source now checks the leg inside the package too.
- **A package is what was booked together, and it is confirmed together.** Only the server writes a package's
  tag (the ordinary booking and edit routes refuse one, and a leg's tag is not edited), so trades cannot be
  tagged into a package afterwards. While every leg is pending, one leg is not anchored on its own (the API
  refuses it, and the ticket reads the package from the legs it just booked, so a CONFIRM pressed at once still
  confirms the package). Once a leg has gone its own way the others are confirmed one by one.
- **The public register** lists a package once, by the hash the registry holds.
- **The verifier's source** gives a package record with no leg its own verdict (the record is signed and anchored;
  no trade's terms were checked). The page at rijeka.app/verify is the landing site's copy and changes when that
  site is deployed: until then it proves a package's record and does not check a leg's terms inside it.
- **Limits:** one leg of a package confirmed this way cannot be amended or terminated on its own yet (the API
  says so, and the certificate offers no button that would only fail); a counterparty with its own wallet
  confirms leg by leg; the route waits for the block in the request (no 202), and after a lost answer the same
  press finishes it without a second transaction or charge (`docs/ops/deploy.md`); that the legs listed are all
  the legs of the package is the booking's fact, not one the registry knows; packages booked before this
  release (a PKG- reference, one request per leg) stay a grouping in the blotter and are confirmed leg by leg.
  Not run against a live chain here: the local stack has none.
- **Not in this change:** CASHFLOWS, CURVE SCENARIO and the footer over the whole package.

## 0.18.0 · 10 November 2026

**No SIMM. Initial margin is your amount or the engine's estimate; KVA of a currency or digital-asset ticket
follows the Basel classes.**

- **Rijeka does not compute ISDA SIMM, and no longer says it does.** SIMM is ISDA's licensed methodology. Its
  risk-weight table is out of the code, and nothing on a screen, in an answer of the API or in the methodology
  is named for it, except the sentence that says it is not computed and that a firm with a licence enters its own
  figure.
- **Initial margin is an amount in dollars, or the engine's estimate.** On every XVA tab, "Initial margin USD"
  takes an amount (250000, 250k, 0.25m): it is exchanged each way and held for the life, and MVA is its funding
  cost. Left blank, the engine estimates it from its own simulated paths: at each date the 99th percentile rise
  (what we call) and fall (what we post) of the value over the margin period, the confidence the margin rules
  for non-cleared derivatives name. The tab says which of the two it used and how much.
- **KVA of a currency or digital-asset ticket uses SA-CCR's own class**, read from the Basel text: 4 % for a
  currency pair (CRE52.72); for a Group 2a cryptoasset SA-CCR's cryptoasset class at 32 % with a 120 % option
  volatility (SCO60.98); for a Group 2b cryptoasset 50 % of each trade's notional, with no netting in the add-on
  (SCO60.99). BTC and ETH default to Group 2a and everything else to 2b; the Basel group selector on the tab
  changes it. Before this the engine applied the interest-rate factor to everything, which made a digital asset's
  KVA a rounding. The legs of a package now net in the add-on inside one hedging set.
- **Numbers that moved, each explained in `GOLDEN_CHANGES.md`:** on the pinned 5-year swap the estimate is about
  half the SIMM-weighted margin (it is at current volatility, not a stressed one), so MVA is smaller and, with
  less margin held, margined CVA, FVA and KVA are larger; a margined EURUSD forward's KVA is about a hundred
  times larger (the FX class). Nothing uncollateralised moved, except KVA on currency and digital-asset tickets.
- **The Excel replications rebuild the new margin and add-on in cells:** 87 checks in the rates book and 51 in
  each of the currency and digital-asset books pass under every CSA preset, evaluated cell by cell.
- **The methodology is v1.10:** the initial margin section, the add-on by asset class, wrong-way risk and the
  package run are written down; the SIMM reference is gone.
- **The request field is `im_usd`** on the four XVA routes; `simm_im_m` (millions), the old name of the same
  input, is still read so a page loaded before the release keeps working. `crypto_group` (2a, 2b) is new.
- **Limits, in `docs/xva.md` and the model inventory:** the estimate is not a regulatory margin model (current
  volatility, one confidence, a cross-section of the paths); against an exact simulation it is within about 1 % at
  currency vols and reads 7 to 15 % low at digital-asset vols; a margined CVA is small by construction (what is
  left beyond the margin is the 1 % tail of the model's own move: no gap risk, no jumps); the Basel group of an
  asset is the bank's to show its supervisor, and the answer says when the group is the engine's default; a
  payout style enters the add-on at its payout; the book-level capital report still runs every digital asset as
  Group 2a.
- **A leg of a package that settles is a payment, not a move:** the margin and the collateral no longer jump for
  a month when a leg pays.
- **The margin box is in the ticket's own currency** and says which; an entry that is not an amount is said to be
  that and no run starts on it; another pair starts with neither the amount nor the group of the last.
- **On the first batch after this release the XVA reserves of a margined counterparty step** (MVA down, margined
  CVA and KVA up, as above): it will show in the P&L explain as a reserve move with no market move behind it.
- **Not in this change:** the legal-entity and counterparty records still carry a field for the margin model a
  CSA names (a fact about the agreement, not a calculation); the public site's own pages.

## 0.17.0 · 10 November 2026

**Wrong-way risk is modelled on currency and digital-asset tickets.**

- **A party's default can be tied to the asset.** On the XVA tab, CREDIT AND BTC (or the pair's base) takes, for
  the counterparty and for ourselves, the multiple its default intensity takes when the asset halves against its
  forward. On every simulated path the intensity then moves with the asset, and it is solved date by date so the
  credit curve is repriced exactly (Hull and White, 2012). CVA is the exposure on each path times the default
  probability on that path.
- **The tab shows both figures:** CVA with the link and CVA if default were independent, named WRONG-WAY RISK or
  RIGHT-WAY RISK by which way it went; with our own credit linked, DVA with and without. Sold the coin to a counterparty that worsens as it falls: the charge
  rises. Bought it from the same counterparty: it falls.
- **Independent is the default and changes nothing:** every component is what it was, number for number (the
  reference suite, the Excel replications and the pinned book are unchanged).
- **The multiplier (WWR ×) is gone from currency and digital-asset tickets**, where the link replaces it; a rates
  ticket keeps it. The currency routes refuse a multiplier together with a link: one or the other.
- **Checked** against a quadrature of the same definition that shares no code with the simulation, against the
  definition itself, and by the validator's own simulation of four cases (within 1 %, inside sampling error). It
  is in the manner of Hull and White, not their model: the variable is the asset, not the portfolio's value, so
  the direction is the desk's input. **Limits, in `docs/xva.md` and the model inventory:** the multiple is the desk's
  judgement of the counterparty, not calibrated; one link for the life of the trade; the netting-set charge and
  the funding, capital and margin terms do not see it; no methodology section yet.

## 0.16.5 · 10 November 2026

**Legs, step 3, first part: the XVA of a package is one run.**

- **A ticket with legs is simulated as one netting set.** The XVA tab's button reads SIMULATE n LEGS and sends
  every leg (`POST /api/xva/currency-package`). Every leg is valued on the same simulated paths: each forward of
  the pair is its own forward times one lognormal driver, a forward leg is marked, an option leg is valued in its
  style's closed form, a leg is nothing after it settles, and the sum goes through the same waterfall. A strip,
  a collar or a forward with an option is charged on what is left after its legs offset each other.
- **What netting is worth is on the screen:** the set's peak expected exposure beside the legs' peaks added up.
- **The charge in the counterparty's netting set** (CHARGE THIS PACKAGE) takes every leg too.
- **A package of one leg is that leg's own run, draw for draw**, and the two single-trade routes now read their
  inputs through the functions the package uses, so a leg is read one way. Nothing a single trade shows moved
  (the reference suite, the Excel replications and the pinned book are unchanged).
- **A run on screen is of the legs on screen:** change, add or remove a leg and it is cleared; SIMULATE waits
  while a leg is being priced.
- **Margin follows the legs.** Initial margin is on the net spot sensitivity of the legs still alive, so a
  calendar spread posts little while both legs stand and the far leg's margin once the near one has settled.
- **Limits, in `docs/xva.md` and the model inventory:** one pair per package; one factor, so the shape of the
  forward curve or of the vol term structure moving is not simulated; the capital add-on is the sum of the legs'
  add-ons with no offset between them; a leg that settles between two monthly dates stands to the later one; a
  run takes up to 24 legs, ten years and four million leg-path-steps; no methodology section yet.
- **Still to come in step 3:** CASHFLOWS, CURVE SCENARIO and the footer over the whole package, and one
  confirmation for it.

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
