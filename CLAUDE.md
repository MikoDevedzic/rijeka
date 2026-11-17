# Working on Rijeka

Rijeka is an open OTC derivatives desk (its engine is open source): a FastAPI backend (`backend/`, Render), a React/Vite frontend
(`frontend/`, Netlify from the `release` branch), one hosted Supabase database (the owner's
own environment points at it; contributors, tests and journeys use the local stack), and an on-chain
confirmation registry. `docs/architecture.md` is the map.

## Nothing ships that harms what already works

Every change goes through the same gates. Each gate has a name and an agent definition in `.claude/agents/`.

| Who | Role | When | What "passed" means |
|---|---|---|---|
| **Tarik** | Browser tester | every frontend or API change | `cd frontend && npm run e2e` green on the local stack; a new screen or button has a journey in the same change |
| **Lauren** | Numbers guardian | any change to pricing, XVA, exposure, capital, collateral, P&L or risk | `tests/reference` green, the engine and replication tests green, the pinned sample book unchanged or its movement explained in `GOLDEN_CHANGES.md` |
| **Mike** | Model validator | any change that adds or changes a formula, a product, a risk measure or the construction of a market input | each calculation has a reference comparison, an Excel replication and a methodology section, or `docs/model_inventory.md` says which is missing; one figure re-derived independently by a fresh agent |
| **Dragan** | Design keeper | any change that adds or alters a screen, a table, a field, a button, a colour or a size | `cd frontend && npm run design` shows no count risen; the changed screen compared in pictures with a screen that shows the same kind of thing; a field and the figure beside it measured alike; `docs/design.md` followed or amended |
| **Christine** | Independent reviewer | anything larger than a one-line hotfix | a fresh agent has read `git diff main...HEAD` cold and its findings are fixed or answered |
| **Machado** | Security reviewer | sign-in, roles, tenancy, keys, payments, public endpoints, user-supplied text | no finding left open |
| **Archie** | Architect | any change that adds or removes a service, an outside dependency or data source, a table, a scheduled job, a setting or a public endpoint | `docs/architecture.md` and `docs/ops/environment.md` match the code, checked by a fresh agent against the diff; the new piece follows the pattern the system already has for its kind |
| **Raja DB** | Database keeper | any change that adds or alters a table, column, function, trigger, policy or grant, writes to the database in a new way, or touches the migration runner or its approved list | migrations are one feature each, safe to re-run, locked down and tolerated when absent; `docs/schema.sql` agrees with them; nothing is on the approved list that the owner did not approve in his own words |
| **Eric** | First-time visitor | a release that changes what someone new meets first (the door, sign-up, the home, a ticket's first screen, a new page); before a launch or a public post | Eric has walked the app cold on the local stack and read a picture of every stop; what would confuse a newcomer is fixed or answered |
| **Greg** | Operations keeper | before a launch or a public post; after a change of hosting plan, host or machine size; after an outage; when a release adds work to a request or a batch | the sizes in `docs/ops/environment.md` are true; the dearest action is measured and the headroom said; the watch says nothing wrong; an outage has its account in `docs/ops/incidents.md` |
| **Jenn** | Release manager | every deploy | `docs/ops/release.md` followed; the commit read back from production |
| **Hermie** | Project manager | every proposal and decision | recorded in `_docs/BACKLOG.md` (local only) with its status |
| **Patrick** | Product lead | the start of a working session, after a release, a weekly walk, before a large piece of work | Patrick has said, ranked and argued, what would most strengthen the mission and what to stop; the owner has decided; nothing is approved because Patrick ranked it first |

The roles took these names on 16 November 2026, and a role is called by its name, not by he or she. A record dated
before then keeps the names of its day (the changelog, `docs/archive`, a review note in a code comment or a test, the
approved migration files): Quinn is Tarik, Ada is Lauren, Emmy is Mike, Iris is Dragan, Vera is Christine, Magnus is
Machado, Nikola is Archie, Edgar is Raja DB (`raja`), Jarvis is Jenn, Petra is Hermie, Marco is Eric, Grace is Greg.

A one-line hotfix asked for by name may skip Christine; it never skips lint, tests and Jenn's checklist.

### Who runs each gate (since 12 November 2026)

The owner's rule of 12 November 2026: "yes make leaner review". In five days the review agents ran 199 times and
reported 53 high findings among 776, two thirds of them low, for about 11.7 million tokens. Every gate above stays;
what changes is who runs it.

- **A fresh agent** (sonnet, one round, a narrow brief):
  - **Christine** on every change larger than a one-line hotfix. The brief: report only what would break production,
    mislead a user, move or misstate money, or open a security hole; and say where a document states something the
    code does not do. Where no specialist below is run, their questions for that change go into that brief.
  - **Dragan** when a screen changes.
  - **Mike** when a formula, a product, a risk measure or the construction of a market input is added or changed.
  - **Machado** when sign-in, roles, tenancy, keys, payments or a public endpoint change. Text a user types that does
    not reach a public page is a question in Christine's brief.
  - **Raja DB** when a migration, the runner or the approved list is in the diff.
  - **Eric** before a launch or a public post, and when what a newcomer meets first changes. Eric is the dearest
    of the agents to run (a picture of every stop is taken and read), so not on every change.
  - **Patrick** when the owner asks what to do next, once a week for a walk of the product against its mission,
    and before a piece of work larger than a few days starts. Patrick ranks and argues and changes nothing, and the
    list is a proposal the project manager records.
  - **Greg** after an outage, before a launch, after a change of plan, host or size, and when a release adds
    work to a request or a batch: for the account and the measurements. The builder sets Greg's account in
    `docs/ops/incidents.md`.
- **The builder, who says so in the report**: **Lauren** (`tests/reference`, the engine and replication tests, the
  pinned book, and a reason in `GOLDEN_CHANGES.md` for every number that moved), **Archie** (the map against the
  diff), **Tarik** (the journeys), **Jenn** (the release checklist), **Hermie** (the backlog), and **Greg**'s reading of the hosts' dashboards,
  which needs the owner signed in. A moved number the
  builder cannot explain goes to Lauren as an agent.
- The owner can ask for any role as an agent on any change.

## Standing rules

- **Production is shared.** There is one hosted database and the owner's local `.env` points at it; development
  and every test run on the local stack (`backend/stack/README.md`), never on it. A script that writes is a
  production write. Production writes happen only when the user asks for that write in their own words; show
  the exact statements first. A migration reaches production through the runner (`backend/db/migrate.py`): the
  deployed API applies what is on `backend/db/migrations_approved.txt`, and a line goes on that list only with
  the user's words quoted beside it. An agent never reads or writes the hosted database from a shell, by any
  route (`backend/scripts/export_schema.sh` is the owner's to run). Tests
  and journeys run on the local stack (`backend/stack/README.md`), never on the hosted database.
- **Secrets.** Never print tokens, keys, connection strings or `.env` contents. Never enter credentials on a
  hosted site.
- **Git.** Work on a branch, stage by explicit path (never `git add -A`; another session shares this checkout),
  never commit `.claude/launch.json`. `main` is protected, and all six CI jobs are green on the exact commit before it moves.
- **Frontend.** `npm run lint -- --quiet` before every commit (the same command CI runs, over `src`, the journeys and the config): the build does not catch an undefined variable.
- **Deploy ahead of migration.** Every new table or column is read through a presence check that tolerates its
  absence and never caches a negative answer; add it to `OPTIONAL_MIGRATIONS` in `backend/api/routes/ops.py`
  so `GET /api/ops/health` reports it under `schema`. One feature per migration file: do not bundle tables that
  are safe to apply at different times.
- **Freeze windows.** Ask about demos or client sessions before a deploy. Within two hours of one, only a fix
  the user asks for by name ships, frontend-only where possible.
- **Sources.** Public standards only (Basel, ISDA, CFTC, published papers). Nothing from any client engagement:
  no names, instruments, numbers, text or code.
- **Say what is verified.** "Live" means the commit was read back from production. "Tested" names the suite.
  What was not checked is stated. A rule written on the map or in the changelog ("X is never overwritten") is
  checked against every writer of that table, not only the one the change added.
- **Lessons.** A role does not remember its last run, so the definitions are how this project learns: it is meant
  to get better at its own work each time it is caught out. The owner's rule of 15 November 2026: a lesson is
  written into its role's definition when it is learned, in the same change that mends what was missed, never
  owed for later; `_docs/team/ledger.json` (local) records the run and the lesson. A lesson that belongs to no
  role is told to the owner as a role that is missing, with what the role would look for and when it would run.
  What the builder (the author of a change) has learned is at the end of this file and is added to the same way.

## What the builder has learned

The author of a change has no definition of its own; these are its lessons, each from a miss that a reviewer, a
journey or the owner caught. One line each; the ledger has the day and the case.

- An action that removes a user's data is first designed so that it removes nothing: hand back, do not delete.
- A fix that describes an unpatched weakness is not pushed to the public repository until production is patched.
- Before building anything that reads a file at run time, check what the deployed service can see: Render serves
  only `backend/`.
- Before a release a new user will see, a fresh first-time visitor's pass over pictures of every screen, with the
  arithmetic checked from the screen. It finds what journeys and readers of code do not.
- A blanket change (a colour map, a rename) is tried on one page and its pictures read before it is run
  everywhere; and a rule about words ("no SIMM on the public site") includes the pictures.
- A picture of a state is drawn for every state the thing can be in: write the state as a pure function of its
  inputs and test each case before drawing it.
- Fit before sizing; and "does not move" is measured component by component, not on the total.
- A new input that feeds two places is checked at the edge they treat differently, and a date in a run comes from
  the run's valuation date, never the server's.
- A field of an answer that screens multiply back into a value keeps its meaning when the formula changes; a new
  meaning gets a new name.
- When a grid changes, grep for every place that turns a step index into a time and every guard sized in the old
  steps, before the reviewer does.
- After an action that changes a booked trade, look at every tab of the ticket, not only the one the action is on.
- A film's frame size is read from the encoded file, and a caption is read against the frame under it.
- When a release adds something to a stored report, add in the same release the rule by which an older stored
  report counts as out of date: the home drew whole buckets for a day after the tenors were live (0.40.0).
- When production fails near a deploy, read when the first error was logged before suspecting the deploy, and
  measure a suspected load before naming it the cause (15 November 2026: neither suspicion survived).
- What is offered to the owner as next is checked against what he has already decided and when: a piece he
  scheduled for after the launch was offered for the same evening.
- When a screen is made to read what another screen reads, it reads it the same way: the same hook, with its
  refresh, not a second fetch of the same address (the phone's strip read the stored report where the trader's
  home asks for the live one after a booking). And a changelog names the screens a change changes after reading
  where the component is rendered, not from memory.
- When a figure is renamed, or its sign turned, the old name is searched for on every screen in the same change,
  and the name is read from one module by all of them: the basis was renamed on the ticket and the home and
  left under its old name and sign on the Risk page.
- A column made wide enough for the figures on the stack is not a fix for a figure printed over its neighbour: the
  content sizes the column (one grid, rows on `subgrid`), and the journey gives a row a figure far larger than the
  stack's and measures that each cell still ends before the next begins.
- A search for a name that must go is made without regard to case, over the modules that build labels as well as
  the screens, and the unit test that forbids the name is written over the same files: the first search for SPOT01
  left "spot01" on the IPV page. And when a page is mended, its neighbours in the picture are read too: the cards
  beside the figure being fixed had never been styled.
- Before a screen says "not known", read the code that produces the figure and list every way it comes back
  empty (not asked for, asked and failed, asked and truly nothing): the first rule for the Collateral tab called a
  counterparty with no trades "not yet run", and a limit that could not be valued "within limits".
- A checkpoint commit is staged by explicit path like any other: `git add -A` was typed for a local commit in a
  worktree and was refused by the guard, rightly.
- A tab rebuilt for one product family is rebuilt from what the other family's tab already is, with the pieces
  shared (one chart for a curve and a vol, one size for a result's figure), and the first run on the stack's own
  data decides what is shown: thirty quoted tenors made a column no one could read.
- A scenario input that a product's pricer does not read is refused by the route and not offered by the screen: a
  Bermudan's vol shift was taken, did nothing, and showed a vega times the shock beside a change of zero.
- A screen that reads market data does not keep a failed or empty answer (the rule for presence checks holds in the
  browser too), and a tab that reprices sends the request the price on screen answered, not the form as it stands.
- Before a design review of two screens that should match, their pictures are put side by side and the differences
  listed by the builder: a brass label, two colours for one surface and a box on one tab only were all in pictures
  already looked at one by one.
- A date written into a document is the day's date where the work is done (`date`), not the server's clock's.
- A fact the server reports (the chain it anchors on) is asked of the server where a screen states it, through one
  function that words it; a name typed into copy is wrong on the next host, and the places that still type it are
  listed in the changelog. A message written for the general case is read once as each special party sees it (the
  demo counterparty was told to sign with a command-line tool), and a sentence about what the server will do
  claims no more than the page can know.
- A screen changed by a change is pictured, every one: the home's diagram was edited unseen, and the picture, when
  taken, showed a label that had been cut off since before the change.
- A block moved inside a long component is followed by a check for names read above the line that defines them
  (`npx eslint --rule '{"no-use-before-define": ["error", {"functions": false}]}' <file>`): the usual lint and the
  unit tests passed, and the ticket crashed on its first run on the stack with "cannot access before
  initialization".
- A cell that computes one product's formula is read for every style the screen can show it for: the scenario's
  settlement cell gave a barrier option the payoff of the option without its barrier, and had since the styles
  were added.
- An answer kept from a request is kept under everything it depends on (the trade's terms and the market it was
  priced at), and a figure is read only by that key: kept under a name alone, one trade's scenario value stood
  beside the next trade's price for a quarter of a second, and the reviewer found it.
- A picture given to the design keeper shows the thing the change adds: the ladder's new row was below the fold in
  every picture sent. And a test that cannot run on a stack is skipped by name, not returned from: it otherwise
  reads as passed.
- After the methodology or the model inventory is rebuilt, the methodology journey is run again, and the whole
  set of journeys is run on the tree that is pushed, not on the tree of an hour before: a new inventory row is a
  new card on a section's page, a journey counts those cards, and the full run that passed had been built before
  the row was added.
- A dated note in a document that lives on (the model inventory, a page of the methodology) names the role, not the
  person who held it that day: a rename then rewrites no record, and the independent reviewer did not have to find
  thirty credits moved to a name that did not exist on their date.
- A field a ticket sends is traced to the function that prices it: the collar ticket sent its frequency for as long
  as the route ignored it, and the two neighbouring routes that read the same field hid that for weeks.
- A number read from a request is finite and in range before it is stored or priced, and a text has a length: JSON
  admits NaN, a numeric column keeps it, and a value shared by a firm then spoils every figure made from it. The
  security reviewer found it in a module written before the roles existed, when its tables were about to be made. The
  check itself is tried with what breaks a check: a whole number four hundred digits long is not a float, and
  turning it into one raised an error the route did not catch.
- A figure shown on two screens is read from one place by both, and a new reader is listed beside the others on
  the map: the brief summed the pricers' own figures for weeks after the home had been moved to the risk report,
  because the home's fix had not asked who else showed the book's value.
- A word that must go from public copy is searched for over the whole repository, the page's head and what a
  search engine reads included, not over the screens alone: "ISDA SIMM" stood in the app page's structured data
  for a week after it had been taken off every screen, and "open-source" in the assistant's own description.
- A class that hides a cell on a narrow page is not used for a cell's colour in a table that keeps all its
  columns: the head stayed, three cells went, and every figure after them stood under the wrong heading.
- A release is read from the seat of someone with the app already open, not only from a fresh load: each deploy of
  a day replaced the pages' files under the owner's open window, and the first page pressed after one showed the
  browser's raw error. The release checklist's read-back loads the app afresh and could not see it.
- The browser's words for an error are not its cause. "Failed to fetch dynamically imported module" was taken for
  a release and the tab reloaded itself; the same words come from a dropped connection and from a file missing
  from a deploy. Before the app acts on a guess about why something failed, it asks whoever knows (here the host's
  build), and what it cannot tell apart it does not act on by itself.
- Before the app does anything by itself (reloads, opens a window), list what the user has on screen that it
  would cover or throw away, from every surface that outlives a page: the trade windows, the messenger and what
  is typed in it. The reload looked only at trade windows; the messenger opened over a ticket's right side.
- A count read off a route counts everything that calls the route. The first activity record took any answered
  request for use: a tab left open was an active account, the home page was the Risk page, and a keystroke was a
  price. Before a figure is given a name, list every caller of what it is read from (pages, timers, debounced
  fields), and record what a person did where only that is known: here, in the browser.
- A figure that will be shown as evidence has each of its words defined beside the code that computes it ("active",
  "came back", "ever"), with the case that would flatter it tested: a visit that crosses midnight, a window of days
  cutting what says "ever", a read that fails and shows none.
- An alarm is judged by how it fails. The first health alerts marked a fault as told whether or not the message
  reached anyone, recorded a failed pass as a good one, could be silenced by anyone able to post a report, and rang
  for what is no fault. Before an alarm ships, walk: who can make it ring, who can make it stay quiet, what it does
  when it reaches nobody, and what it says of itself when it cannot do its work. Each has a test.
- Text a stranger can post is never a label the system acts on. A report's own "source" decided whether its fault
  rang, and the first report of a fault lent its label to all the others: what decides is what a verified account
  said, or what the API saw for itself.
- A function moved or rewritten is read for what it assumed before the move. The all-in rate assumed the desk pays
  fixed; rewriting it carried the assumption into new, tested code until a validator asked about the other side.
- A count is made the way the list beside it is made, duplicates and all, and its test carries the awkward case
  (a package of legs), not only the plain one.
- An effect that acts on a value from the address or the store acts once: the address changes a render later than
  the store does, and the same name opened two tickets.
- A fault found in one count is looked for in every count of the same thing before the change is called done. The
  door's count of anchored confirmations was mended while the register page's header, a second query for the same
  number forty lines below, kept the old one; reading production back against the list found it.
- A screen that changed is looked at before a reviewer is asked, at the whole picture and to its right edge: a
  column taken out of the blotter left its width in the table and the head short of the edge, in a picture already
  on disk. And an edit made by a script is read back where it landed: a comment appended to the middle of a long
  line cut the rest of the line off, and only a unit test said so.
- "To cents" is a measurement, taken at the size a screen shows, before it is written. The scenario tab's closed
  form had said it of a European option for weeks; on 10m it was up to a whole unit off, which nobody saw until the
  engine's own figure stood beside it. And a chip that names who priced a figure is checked in the state where
  that one did not answer.
- The security reviewer reads a change that touches a public route before it is released, not while it is: the
  read of 0.46.5's heavier public count came back with a finding minutes after the release had been pushed.
- A screen that reads a counterparty starts on that counterparty's own terms, not on a preset of its own: the XVA
  tab opened on NO CSA for a counterparty whose record holds margin terms, and its first figures were of a trade
  that record does not describe.
- A figure is written in its trade's currency by the one place that knows it (the ticket), not by each formatter:
  a dollar sign written into a formatter is found on every screen that formatter serves.
- A sentence about two figures ("they differ by a small part") is a claim: it is measured, or it says only what is
  known (that they are not the same figure).
- A sentence in the changelog is checked against the diff by someone who did not write it: "Tab stays inside" was
  written of a ticket with no trap, and "no payment lag" of a model that passes the lag on.
- A text that was cut is mended when a journey measures it whole (`scrollWidth` against `clientWidth`), not when
  its words are put in another order: the IPV row's line was reordered, and the ellipsis took the new first part.
- A rule a screen keeps one way in is checked the other ways in: a ticket opened from the blotter was locked, the
  same ticket in the window it was booked in was not, and DETAILS was locked in neither.
- A step shown as to be done has something that can mark it done: two of the launch home's four steps were written
  `done={false}`.
- A term the booking keeps in two places is changed in both, or the change is refused: a swap's coupon is on its
  leg and, as the ticket reads it back, in the trade's `terms`; a journey that opened the amended trade found the
  old coupon on screen.
- A reader of "the latest event of these kinds" is checked when a new writer of one of those kinds appears: an
  amendment that signs nothing would have hidden the signed record behind it.
- Before a screen is designed for a request, the request is read against what is already built: asked for the
  trader's home, a new home was drawn where the one that exists was meant.
- A change of a size is checked against everything sized on it: an increase of a notional was offered on a cap, whose
  options and premium would not have moved, and an option's strike was amended with nothing said of its premium.
- A bound checked in Python is the column's bound: a notional that passed the check and would not fit `numeric(24,6)`
  was a server error where a refusal in words was meant.
- A lifecycle action is run on a chain before it is reviewed: the first amendment journeys ran only where no record
  is anchored, and the branch that signs and supersedes had no test.
- A test that takes its dates from today states its premise in the dates it picks: the NDF fixing test assumed a
  settlement date that is the spot date of its fixing date, and failed the day that date fell after a holiday.
- A line in the model inventory that says what a run reads is checked against the request the screen sends: the
  inventory had a EUR swap's XVA on its own curve with dollar volatility, and the ticket's tab sent the dollar curve.
- A statement a person must see is put where it is seen: a note set inside a heading's info mark is in the page and
  not on the screen, and a journey that reads the page's text passes on it.
- Two figures netted in a formula are read by one convention: the funding benefit took the tenor's own spread from
  a DVA that charges the step's forward spread, and the two together stood 10 to 18 % above the funding spread. When
  a curve is read a new way, look at what the reading does between its tenors and beyond the last one.
- A sentence that says what a run used is checked against every fallback of that run: the answer named the curve a
  swap ran on while a missing curve was silently replaced by a flat rate.
- A figure in the documents is one that was measured, and says how: a test's tolerance was written as the agreement
  (2e-5 where 1e-7 was measured), arithmetic read back from a result was written as its derivation, and a by-hand
  test that writes the engine's expression again was called a check. A claim about an identity under a branch
  ("holds only on average") is computed before it is written: it stood 66 % out.
- When a figure starts to depend on a second input, read every label that compares it with a reference: a tied
  party's "if independent" figure took out both parties' links once CVA carried the desk's survival, and the
  screen's wrong-way label was computed from the difference.
- Put one trade of each product through every run that prices it and lay the answers side by side, before a
  launch and after a change to any of them: three errors stood behind runs that each passed its own tests (a swap
  between coupon dates in the credit engine, a swaption's XVA that was a swap's, a capital add-on blind to the asset
  class). A request field the server's model does not declare is dropped without a word: read the answer for what
  was asked.
- An outside engine's figure is a benchmark only after its own run with no volatility returns today's value at every
  date, on the curve the comparison uses: ORE's example set-up discounted on another curve and filled its overnight
  fixings 4 bp high, and the first "difference" found was that. And an expectation of a product is not the product of
  the expectations: where an adjustment is defined on a discounted amount, discount on the path.
- A figure from a simulation is quoted as its range over several seeds, with the path count, never as one seed's
  value; and a test of a simulated difference compares the two on the same paths, where the sampling error cancels,
  not each against a threshold (0.53.0: "0.37 %" was one seed of four between −0.41 and +0.04, and the test that the
  old figure was outside the tolerance passed only at the pinned seed).
