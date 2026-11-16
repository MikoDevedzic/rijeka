# The look: Harbour

Adopted 10 November 2026. Deep bottle-green water, limestone type, brass for the one thing to press and for what
is sealed on chain. The tokens are in `frontend/src/index.css` (`:root`); `frontend/src/theme.js` mirrors them for
code that draws on a canvas, and `theme.test.js` holds the two together.

## What a colour means

| Token | Means | Never |
|---|---|---|
| `--accent` (brass), `--accent-hi` | the action of the view (BOOK TRADE, + NEW TRADE), the selected tab's rule, what is sealed on chain, the saving on chain, the name RIJEKA | a label, a typed value, a positive number |
| `--up`, `--down` | the sign of a number; a side that is chosen (coral for paying or selling, green for receiving or buying, the same in the swap's direction, an option's side, a forward's and a leg's); a state that is good or bad in itself (live, calibrated, a verify that passed; defaulted, a failed check) | a selection, an action |
| `--amber` | a caution, something provisional, the PFE tail, the trade's own mark on a chart of a curve it is priced on (its vol, its strike) | an action |
| `--blue` | the counterpart series on a chart (ENE), a link on paper, the second desk's paths in the logo | a selection; a figure in a table (it takes the colour of its sign) |
| `--text-hi`, `--text`, `--text-dim`, `--text-mute`, `--text-faint` | limestone, in five steps. Contrast on `--bg` / `--panel` / `--panel-2`: `--text-mute` 6.2 / 5.6 / 4.8, `--text-faint` 5.3 / 4.8 / 4.1 | `--text-faint` on `--panel-2` or lighter |
| `--panel`, `--panel-2`, `--panel-3` | a surface one step up; `--panel-3` is the fill of a selected chip | |

A selected chip or segment is a lighter panel and the full text colour, not a colour. A status takes a colour only
when it says something: confirmed is brass, live is green, pending is a hollow dot, anything over is faint.

Brass, the on-chain gold, amber and the coral of a negative number are all warm. `--down` is set toward rose so a
caution and a loss are not mistaken for one another; where two warm colours still mark two categories side by
side (the messenger's own messages against Prometheus's, the limit bar's warning against its breach, EE against
PFE on Risk → Counterparty credit) the page has not been read yet, and that is in the list below.

**This holds on the screens rebuilt so far** (the ticket's TRADE, XVA and CONFIRM tabs, the blotter, the top
bar), and since 0.30.4 on the pages behind CONFIGURATIONS a first user opens: the curve, swaption, cap and floor and
pair pages, the HW1F calibration, counterparties and legal entities. There a figure (in a list, in a table, at the head of the page, or typed into a field) is limestone whatever its
curve's class, a convention's value is a value and not a colour by kind, a row's own label (a tenor, an expiry, a strike) is a label, a state that is good in itself (saved, loaded,
connected, quoted, a close fit) is green, a selected chip is the lighter panel, and brass is left to the page's
actions and the selected rule. Elsewhere brass still colours what the teal accent did: about three hundred and
twenty uses remain, among them the DETAILS tab, P&L and Risk. Two things on those pages are
not decided and were left as they were: the colour a curve's CLASS takes in its badge (OIS brass, basis blue,
cross-currency purple: a category, where the rule gives colour to a meaning), and the messenger's two warm
colours (its own brass against Prometheus's lighter gold).

## Type

Instrument Sans for interface text, DM Mono for numbers, references and codes, Bodoni Moda for the heading of the
confirmation certificate and nothing else. DM Mono is drawn in two weights; a number asked for at 600 or 700 gets
the 500 cut (the faces in `index.css` cover those weights with the same file), never a synthetic bold. All three
come from Google Fonts, the host the app already loaded its type from.

## Corners

`--r-1` 4px (badges, small inputs), `--r-2` 6px (buttons, inputs, chips), `--r-3` 10px (cards), `--r-4` 14px (the
ticket). The certificate's corner is 2px: it is paper.

## The certificate

The signed record on the CONFIRM tab is the one light surface (`.cert` in `trade-window/styles.css`). Inside it
the colour tokens are redefined as the paper's inks, so its rows, links and buttons take them without naming a
colour. Its mark is the logo (`brand/CertMark.jsx`; the owner, 13 November 2026: "that should be that rijeka logo and not
random circle thing"): this trade's river, drawn from the record's hash so that the same hash always draws the
same one, running into the ringed R, in the paper's inks. The ring is the seal, as everywhere the mark is drawn:
closed only for a record that stands on chain; one that is signed and not anchored, or closed, has the ring as a
faint outline and the whole in the paper's grey. The ticket keeps a visited tab mounted and hidden, where a canvas
has no size, so the mark is drawn when it first has one and again whenever it comes back into view.
The heading says "Both sides signed the same terms" only where the record itself says it is
bilateral.

The paper confirmation (`trade-window/PaperConfirmation.jsx`) is the same paper as a sheet: a `.cert`, so the same
inks, the certificate's caps and title, figures in mono, rows ruled like the certificate's. It is the one thing
the app prints: printed, the sheet stands alone on white at the page's own margins. What it says of a record it
says in words on the sheet (a stamp and, for a record Rijeka signed for both sides, a boxed line): never by colour
alone, since paper may be printed in one ink.

## The exposure chart

EE in limestone, ENE in blue, PFE 95 % in amber, the simulated paths as hairs of limestone or blue by where they
end (`trade-window/exposure-chart.js`). Three hues that cannot be mistaken for one another.

## The shape of a ticket

The same on every product. **TRADE** is what the user sets. **DETAILS** is the detail of it: a swap's period
schedule; for a forward or an option, the record as it will be booked beside the market it was priced on.
**CASHFLOWS** is what comes back: the flows as legs with their present values and their net, then the valuation
(each figure with its formula, and what the price was built from). The **footer** carries the headline figures
on every tab. On TRADE the only computed things are the forward (a figure at full strength in a field's solid edge, with no
well: it cannot be typed over), a field that shows its default (a brass rule under it once typed over, a dash
in place of a number that is not there yet), an option's
premium line and the notes that say why there is no price. A stored currency trade opened from the blotter has
no valuation block (it never had).
A new ticket opens on a digital-asset forward; the asset classes read CRYPTO, FX, RATES.

**A ticket can leave the page.** OWN WINDOW on its tab bar, and the green light of its title bar, open it in a
browser window of its own (`/ticket`), which the ticket fills: it can sit on another screen while the blotter stays
where it is. A stored trade moves there and leaves the page; its window is named for the trade, so asking again
brings that window forward as it is. A new ticket opens blank there, and the one being typed stays (what is typed
is not carried). The red light closes the ticket and, there, its window. A light that does nothing is dim: the
yellow one always, the green one in a ticket's own window. On a phone there is one window and neither control.
What a ticket's window books or confirms, the other windows read again.

## The name, the top bar, a rail

The logo (`brand/RijekaLogo.jsx`, `.rj-logo`) is a river of simulated paths running into a ringed R, and that R is
the first letter of the name: after it only IJEKA is set in type. Rijeka means river. The paths start apart, one
desk's in limestone and the other's in blue, turn brass as they meet (brass is what is sealed), and run as one
line into the letter. The ring is left open where the river enters: a letter in a closed circle reads as the
registered-trademark sign. It is the one thing that carries a light of its own.

- **It moves for a reason, and then stops.** In a bar it runs once when it appears and once more each time a
  trade is confirmed, and holds still in between: a mark that restarts in the header of a trading screen would
  pull the eye from the numbers. With "reduce motion" set it is drawn complete and does not move.
- **A confirmation is the logo being drawn** (`brand/ConfirmMark.jsx`, on the ticket's CONFIRM tab). While a trade
  is being signed and anchored the river runs and the letter is only a faint outline. The R is drawn when the
  trade is confirmed; the ring is the seal, and is drawn only when the record is anchored on a chain (where it is
  not, the ring stays an outline and the words under it say CONFIRMED · NOT ANCHORED). A confirmation that fails
  never draws the letter. The picture shows only for a confirmation of that trade made while the ticket is open
  (`brand/confirm-phase.js`): a trade confirmed earlier, or cancelled, or terminated, has none, and its
  certificate and seal say what it is. The words under it are a label: the quiet colour, amber when it failed.
- **Where a new reader might stumble, the name is also spelled out.** A ringed letter followed by IJEKA takes a
  moment the first time. The sign-in pages, the front door since 0.31.0, carry the logo too (`.au-mark` holds it), a heading says it in words, and a
  link preview or a first slide uses the whole word with the river beneath it.
- **Small, and in one colour.** Under about 32 pixels it is one line running into the ringed R (the favicon). Where
  colour cannot be used every stroke is one colour (`mono` in `brand/mark.js`).
- The drawing reads its colours from the tokens (`palette()`), so it holds no literal and follows the theme. The
  letter is built from strokes by code and is to be redrawn by a type designer with the rest of the name.

The pages on the top bar (`.ab-link`) are buttons; the one you are on is the lighter panel over the
brass rule. In a rail of filters (the blotter's left pane) a section's heading is the size of its choices and
reads as their heading by weight, the bright text colour and a rule above it; the choices sit a step in, in the
quieter colour, and the selected one is the lighter panel with the brass rule at its edge.

**A filter offers the words its rows show.** A rail that filters a table by a word (a status, an asset class) lists
the words the table's cells can carry, in an order that means something (a trade's life), and gains a button for a
word it did not list while a row carries it. The blotter's status filter once offered PENDING, LIVE, MATURED and
CANCELLED beside rows that said CONFIRMED.

**A table keeps inside its panel.** Columns share the panel's width, each no narrower than its longest figure, and
the rows keep that least width so the table scrolls inside the panel, never past it. A cell whose words are longer
than its column cuts them with an ellipsis and keeps them whole in its title; it never prints over its neighbour.

**The product is "open", its engine is open source.** Copy calls Rijeka an open derivatives desk; "open source" is
said only of the engine and the standard, which are under Apache-2.0. A sentence that lists asset classes says
which are live and which are next.

## Buttons, fields, rows

Three things a user does to the screen, each with one look everywhere (`index.css`, the block "What can be
pressed, typed into or pointed at"; tokens `--btn-*`, `--fld-*`, `--row-*`).

- **A button is raised.** A lighter face than the panel it stands on, a bright edge, bright text, a darker foot
  under it; it lifts under the pointer and goes down onto the foot when pressed. Brass is still the one action of
  a view and stands on the same foot. A button whose colour says something (BUY or SELL, a selected mode, a
  warning) keeps its colour and gains only the foot and the lift (`rj-press`). An icon or a link with no edge is
  not a button in this sense and has neither.
- **The chip that is selected is told at a glance.** A lighter face, a bright edge and a rule under it; a shade of
  fill alone is not enough beside an unselected chip that is itself raised. A side takes its colour when chosen
  (`tbw-chip-dir-pay` coral, `tbw-chip-dir-rec` green); a type (call or put, a style, a product) is not a side and
  is selected in no colour of a sign.
- **A field is a well.** Lighter than the panel, with the field's own edge; lighter still under the pointer; a
  brass ring and its lightest fill while it is typed in. The fill is set for every input, select and textarea
  wherever it is, so a new field needs nothing to look right. A value that is computed, or a field that cannot
  be changed, has no well: what can be typed and what cannot are told apart at a glance. A dash in place of a number
  means there is none yet; a brass rule under a number means it was typed over the default; amber still means
  "this cannot be read".
- **A row answers the pointer.** The row under it is a band with a limestone rule at its left edge; the cell
  under it a shade lighter; on the blotter its text comes to full strength. The selected row is the brass band
  with the brass rule. This is every `tbody tr`, so a new table needs nothing.

A new button takes a class the rules already name (`btn`, `pnl-btn`, `tbw-btn`, `mr-btn`, `doc-btn`) or
`rj-btn`; it is not styled inline with a see-through background.

## The methodology

A syllabus rail, one reading column of about seventy characters, the evidence for the section beside it
(`docs/Methodology.jsx`, `docs/methodology/`). The text is the document's own, so the page sets it and adds
nothing: formulas in KaTeX's faces on a panel with the quiet rule at its left, numbered as the PDF numbers them;
code names in mono. No brass on this page except the selected item's rule and the registry in the scene: nothing
here books or signs, so nothing here is the action of a view. A button is the lighter panel with a bright edge.
Amber says an outside validator is still wanted, green that a model was compared with an outside source; the same
two colours carry a late and an on-time batch in the health strip.

How the system is built is a scene, not a diagram: a colour for each kind of piece (what people open in
limestone, the API in teal, where things are kept in blue, market data coming in in violet, other services in
rose, how a change ships in green) and brass for the registry alone. A step lights its pieces; only a join that
reaches the registry is brass. A line in use takes the colour of the piece that asks and carries a steady stream
of light along it; nothing in the scene pulses outward or glows in a ring. The app stands in the middle, larger
than the rest, and keeps its plate; every other name stands without a plate and without its second line until its
piece is in use or picked, because there are two dozen of them. How a change ships is green, and within it each
reviewer has a colour of its own, taken from the tokens (never brass), so that nine figures in a row can be told
apart; a reviewer's name is the smallest step of the scale (10px) and in that colour, because nine of them share
a row, and the row has a name of its own over its middle, because a first name says nothing to someone who has
not met its owner (set as a host's name is, a little closer, to fit the row). The tokens have nine families of
hue besides brass and the checks' green, and the page has thirteen figures (the product lead, the project
manager, the release manager and the operations keeper are not gates and stand in the text's own greys and the
change's green; the product lead's grey is the faintest and the project manager's a step lighter, and the branch
stands between the two), so two pairs are near each other by
choice and kept apart by place: the first-time visitor's teal and the browser tester's cyan stand at the two
ends of the row, and the operations keeper's limestone stands after the release, away from the independent
reviewer's white. The six checks are the change's green, each lamp a step lighter, and lit one after the other: a colour a
reviewer has would mean two things in one row. A lit head keeps its colour and does not wash to white, so that no
pale yellow stands beside the registry's brass. A name the step does not use is dimmed but stays readable. The
scene's ground is its own: the grid, the slabs and their edges and the dust in the air are darker and lighter
turns of the page's green, written in the scene and nowhere else. On a narrow stage a step names only the pieces
it uses, and the whole map names the app, the API, the database and the registry. The names are buttons set over the canvas in the interface face, so they stay
sharp at any size and are read by a screen reader. There is no flat view to choose; where a browser cannot draw
the scene the names stand in a row and the steps still say what happens.

On the phone home's four-figure strip a figure stands bare and its currency is said once, in the figure's own
label ("IR01 · USD"), the same way for all four; a negative takes a true minus and the coral; each asset of the
spot deltas has a line of its own, so that nothing breaks in the middle of a number.

## Legs

DETAILS of a currency or digital-asset trade is a table of legs (`trade-window/FxLegs.jsx`, `fx-legs.js`): one row
per leg, the first the ticket itself and read-only here; an option's style terms sit in a row under it, on the
deeper ground, with a sentence saying what they mean; a further leg's fields are typed in place and a typed strike carries the brass
rule, as a field typed over its default does. A leg whose price is not yet of the terms it shows is dimmed. The
PACKAGE row is set as the figures above it and adds them.

With further legs the footer, CASHFLOWS and CURVE SCENARIO are the package's (`fx-package.js`). The word PACKAGE
is in the label of every figure that is a sum, and LEG 1 in the label of every figure that is still the ticket's
own (the forward tile, the scenario fixing, the valuation under the flows): no figure is left for the reader to
guess whose it is. CASHFLOWS opens on the package, with a button for each leg's own flows. When the package
cannot be summed the tab says in amber that it shows leg 1 only, and why. A package's footer of six figures
names them without their units (the TRADE tab's tiles carry each), never without a word that carries meaning
(paid, received, what a package is waiting for); a single trade's footer is as it was.

## The right-click menu

The desk's own menu (`components/common/ContextMenu.jsx`, `.rj-menu`) is put only on things that have actions of
their own: a row of the blotter today (`blotter/row-menu.js`). It opens, copies and arranges; it never changes a
trade. Text fields and links keep the browser's menu. An item that does not apply is greyed, not hidden, so the
menu is the same shape on every row.

## Tabs

The ticket's tabs are one control of joined buttons (`.tbw-tabs`): each has an edge, so it reads as something to
press; the selected one is the lighter panel (as a selected chip is) over the brass rule. A chip is a separate
box and picks a term of the trade; the joined control moves between views of it.

## Notes

What explains a figure (where it is from, what a row means) is not on the page until it is asked for: a small
mark beside the figure (`components/common/Note.jsx`), whose note shows on hover, on keyboard focus and on a
tap. **NOTES**, at the right of the tab bar, writes every note out where it stands and is remembered in the
browser (`lib/notes.js`, `data-notes` on the root). A note's text is always in the page, shown or not. What stays
on the page: a field's one-line tag of where its default is from, a warning, and anything that says why there
is no price. Not yet behind marks: the lines on the TRADE tab, the swap's tabs and the scenario tab.

## Figures

One rule for the whole app, held by Dragan (`.claude/agents/dragan.md`) and by a check (`cd frontend && npm run design`,
`src/design.test.js` in the unit run):

- A number, a date, a rate, a tenor or a code is mono with tabular digits; 12.5px where it is a value in a table or
  a field (`fig` in `index.css`; a field that holds a number or a date takes the face by its type or `inputMode`).
  A field is set like the figure beside it: the points typed on the forwards page and the outright computed from
  them are one face and one size.
- A size is a step of one scale, in px (9, 10, 11, 11.5, 12, 12.5, 13, 14, 16, 20). The root size is fixed at 14px:
  until 11 November 2026 it grew with the window's width, and whatever was sized in rem grew with it while
  whatever was sized in px did not.
- A figure takes the colour of text, or of its sign. Brass is not a figure, a label or a typed value; blue is not a
  figure in a table. A derived figure (what parity implies) is quieter than a quoted one.
- A figure that is not a quote says so. Where a market input can be quoted or implied (a forward at a tenor), the
  quoted one is upright and names its source; the implied one is in italics, dimmed, with a mark (IMPLIED in
  amber, INTERPOLATED quiet) whose words say how it was reached. On a chart the implied part is dashed. On the
  ticket an implied forward beyond the quotes is said under the figure, in amber.
- What is still set by hand is counted and may only go down (11 November 2026: 53 distinct sizes, 623 sizes in rem,
  209 hex colours outside the tokens, 6 fonts named directly, all in canvas drawings; 12 November, after the
  Configurations and messenger pages in 0.30.4: 50 sizes, 412 in rem, 195 hex). A size in rem goes to the nearest
  step of the scale at the fixed root of 14px, a tie upward (0.75rem, 10.5px, is a label's 11; 0.875rem, 12.25px,
  is a value's 12.5; a rail's link is 12). The next pages are P&L and Risk, each with pictures before and after
  (`LOOK_TAG=before npx playwright test -c playwright.perf.config.js look.spec.js`).
- **Unknown is not zero, and zero is not unknown.** A figure the page cannot have is a dash; the reason is said
  once, where the eye starts (the bar), with the way to get it beside it as a way there (a ghost button with an
  arrow), never as a filled button that does nothing here. It is never 0 or $0. A figure that is truly nothing
  (no CSA, no trade) is a zero, not a dash. A total that leaves something out says how much it leaves out. The
  cases are read from what produces the figure, every way it can come back empty, and written as one function
  (`frontend/src/components/risk/states.js`). A chip that reports a test (WITHIN LIMITS) is shown only where a
  test ran: with no limit set it says NO LIMITS SET, with none that could be given a value NO LIMIT TESTED, in
  no colour.
- **A card** is its name, its figure and the line under it, whichever names the component gives them
  (`pnl-kl`/`pnl-big`/`rk-sub` or `pnl-card-l`/`-b`/`-s`): the name and the line in mono at the label's size,
  the figure in mono, bold, 1.35rem; only the three cards of Trading P&L are larger (1.7rem). Neither the name
  nor the figure is brass; a card that must stand out has a brass border. A card does not grow past its column
  and a figure too long for it breaks inside it. A class a component names has a rule in a stylesheet: the
  cards of four pages named three that had none, and were set in the page's plain type.
- **A sum of what stands beside it** (FVA = FCA + FBA) is a row of its own under its parts, named by its formula,
  quiet, with a rule over the columns it adds. It is never a column of the total and is never added twice. On a
  phone, where the strip is turned on its side, it is left out and the note under the strip says it.

## Type on the ticket

One rule on every tab: a label is 11px in capitals; a value is 12.5px, a number, a date or a formula in mono and
words in the interface face; a headline figure is 13 to 16px in mono. A tab does not pick its own sizes.
A sentence that carries figures keeps its words in the interface face and sets each figure, date or code in mono,
unbroken, as the capital, margin and netting lines under the XVA results do and the REGIMES line of SURFACE PROOF
does; a figure is not set in the face of the words around it.

## The XVA results

One table (`xva-shared.jsx` `VaStrip`, `OnChainCompareRow`): the adjustments across, each line of figures a row
named once at the left. Every row of money is set alike; a figure takes the colour of its sign and nothing else;
ALL-IN is the one column that stands out and the saving on chain the one brass figure. Nothing scrolls inside
the tab: the inputs column is as tall as its inputs, and the credit curves and the assumptions sit under the
results they drive.

## The scenario tab

One shape on every product (a currency trade's is `FxTabs.jsx` `ScenarioBody`, a rates ticket's
`RatesScenario.jsx`): at the left the curves the price was built on, each a button with its risk factor's mark and
what has been done to it, then the selected curve's flat shock and its points; at the right the selected curve's
chart, the result as one table (factors across, CROSS, and TOTAL the column that stands out), the scenario's
value, and one ladder for the selected curve. A point that was typed or dragged carries the brass rule, as a
field typed over its default does.

**A volatility surface is one of the curves, and is moved as a rate curve is**: flat, point by point, or by
dragging a point on its term structure. One drawing does both (`ScenarioCurve.jsx`): in a box on the panel's
ground, the market dashed, the scenario in the factor's colour, the points as rings that are dragged up or down,
the trade's own date as a quiet dashed line with its word in the text's colour (never brass: it is a label), and,
on a vol, the vol the trade priced at as an amber dot with its figure on a plate. The axis steps in round
numbers. Under it a legend says what each line and the dot are, in the same words on every product
(`CurveLegend`). Beside a vol's term structure a second chart shows the surface at the trade's own expiry (the
smile; across swap tenors for a swaption) with the trade's own point marked: it moves with the scenario, is not
dragged, and so draws its points as small dots, not rings. A chart's title is a label (`PLOT_TITLE`). A shock
between two points is read on the line between them, on every product.

What a shock is said in: a curve in basis points on both tabs ("+10 bp"); a rates vol in basis points of normal
vol, a currency option's in vol points ("+1 pt"), because that is how each is quoted. A button says its curve's
shock as "+10 bp · 2 points".

A rates ticket's figures are the pricing engine's on the moved market, and its chip says FULL REVALUATION; a
currency forward's and a European option's are the tab's own closed form, and the chip says APPROXIMATION; an
option of any other style (American, digital, barrier, double barrier, touch) is priced by the engine at the
market the tab works out, and the chip says ENGINE PRICED. A chip of the engine's says REPRICING… while an answer
is awaited, and the figures of the last answer stay until it is back; a figure with no answer is a dash, never a
figure from somewhere else. A rates ticket whose terms were changed after its price says so in amber and keeps the
scenario of the terms as priced.

A style is not a reason for another tab: a barrier or a touch option has the same curves, the same shocks, the
same table and the same one ladder as a European. What is its own is said in words, in amber, where it applies: a
scenario whose spot stands at or beyond the level says the option is valued as touched and what that is for this
option, and the ladder then carries a BARRIER row marking the columns it is true of. The settlement cell gives an
amount for the fixing typed; where the fixing alone cannot say (a barrier, a touch), the amount if the level never
trades and, under it and set as the first is, the amount if it does.

A vol that is one number is shown as one number: a Bermudan swaption's is the Hull-White σ its tree is built on,
named so in the list, shocked flat, with one sentence under the title where its chart would be (said once, not again in the list). It is not drawn as a curve of one
point, and the swaption surface is not shown beside it as if it were being moved.

Where the two tabs still differ, and why: the currency tab has a forward and a fixing to show, so its tiles are
FORWARD, NPV, CHANGE and the fixing where the rates tab's are NPV, CHANGE, IR01 and the vol; its shock row is
"SHOCK AT SETTLEMENT" because every one of its curves is read at one date; its smile is still drawn on a canvas
(in the vol's colour, read from the token) with the 25-delta lines and its own legend; a rate is shown to four
decimals on a rates curve (a quote) and three on a currency curve (a zero rate). Not yet in the shape: a currency
option that is not European (its ladder is the engine's; none of its curves is shocked), a package's vol, which
is shocked flat only, and a Bermudan swaption's vol, which is the model's and is not shocked. The result table's
figure is one size on both (`RESULT_FIG`, `xva-shared.js`).

## Risk factors

One colour per risk factor, the same on every product (`frontend/src/lib/risk-factors.js`, tokens `--rf-*`):
interest rates, FX spot, digital-asset spot, forward basis, volatility, time. It marks the factor's **name**, as
a small square before the label (`RiskMark`); the figure keeps the colour of its sign. An asset class takes the
colour of the factor it mainly carries. The purpose is to be read without being told: the IR01 of a swap, an
option and a digital-asset forward is one colour because it is one risk, and it adds across the book.

**One name and one sign.** A spot delta is FX01 on a currency and CRY01 on a digital asset (the value for +1% of
spot); the forward basis of a digital asset is CRYBASIS01 (the value for +1bp a year of basis); a curve's is
IR01. A screen never writes SPOT01, "spot 01" or FUND01, and never prints the key a limit is stored under
(`SPOT01:BTC`): the Risk pages read the names from `frontend/src/components/risk/names.js`, which takes them
from the home's, and a limit is named by `limitName`. Where a row carries more than one figure, each is on a
line of its own with its name after it, in the colour of its sign. A table of such rows is one grid whose rows
take their columns from it (`subgrid`), so a column is as wide as its widest figure and none is printed over
the next; a least width is given in px (the root is fixed at 14px; the px scale is for type, not for widths).
On a phone such a row is one stack: the name and the value on a line, each figure under them. The IPV page takes the same names and signs where it draws them (`ipv-page.js` `sensLabel`, `sensValue`): a
digital asset's funding level is CRYBASIS01 in the desk's sign, never IR01, and since the page's shift is the
funding level's own move, a line over its pillars says that the impact is that shift times it with the sign
turned.

## Figures that move

A figure that arrives or changes rolls to its value and flashes once (`components/common/Roll.jsx`,
`lib/roll.js`): every frame is a figure the app would print, the last frame is the text itself, and with
"reduce motion" set there is no roll. The journeys run with reduced motion, so a figure read at once is the
figure; `ticket-shape.spec.js` turns motion on to watch a roll. Text with more than one number in it is shown,
not rolled, and a frame that rounds to nothing carries no sign.

## Keys

The function keys are one table (`frontend/src/lib/shortcuts.js`) read by the listener
(`components/common/Shortcuts.jsx`), by every keycap a button prints (`Keycap`, the `.kc` class) and by every
`aria-keyshortcuts` (`ariaKey`): F1 Home, F2 Blotter, F3 New trade, F4 Price, F5 XVA and then SIMULATE, F6
Confirm, F8 Methodology, Ctrl/⌘+Enter to book. A keycap is hidden from a button's accessible name. A ticket key
presses the ticket's own button. The chord books only the ticket that holds the focus. A page that is not the
desk carries `data-no-shortcuts` and no key acts there. Under 1420px wide the top bar and the BOOK button do not
print their keycap.

## What is not done yet

Colours and sizes written as literals in components, and a lint rule against new ones; brass where it still
stands for the old accent (above); the smile of a currency option on the scenario tab, still a canvas with its
own palette for everything but the curve; the lineage tree on a figure; the mark of where each field's number came from on the rates ticket (the
currency ticket marks an override with a brass rule); EPE on the XVA tab; the remaining pages read screen by
screen; widths under 1440px, where the blotter scrolls sideways.

`frontend/e2e/perf/look.spec.js` takes a picture of the screens a new user meets (the home, the blotter, the
ticket's tabs, the pages behind the top bar; not yet every state: an anchored or terminated certificate needs a
chain), for a person to read after a
change to the look: `npx playwright test -c playwright.perf.config.js look.spec.js`, then `e2e/.out/look/*.png`.

## The home on a monitor

The trader's home (`components/home/TraderHome.jsx`, `trader-home.js`; since 0.36.0), the first of a home for each
role. A phone keeps its own home (below) and a launch workspace its "start here" page.

- **Three bands, always in the same place**, ruled apart on the page's own ground, with no cards: where you stand
  beside what needs you; the P&L statement, the risk picture and the factors; your trades beside the tabs. A later
  role's home keeps the bands and changes what is in them.
- **Where you stand is words first.** One line at 16px, each part with a dot in the colour of what it says: green
  for inside every limit, amber for close, `--down` for passed, a hollow dot for what is pending; the count of
  limits that are clear is quiet (dim), because it is the good news already said or the remainder of the bad. Under it one
  sentence names the closest limit. (Until 0.40.0 a rail under the words carried a mark for every limit; it said
  again what the words and the gauges beside the factors say, and was removed.)
- **One headline figure**, the day's P&L, at 20px (the largest step of the scale) in the colour of its sign.
- **The risk picture is one stream for each risk factor**, in that factor's colour (`--rf-*`), on a canvas whose
  colours are the tokens (`theme.js`, and the factor tokens read from the page). Above its line is long, below it
  short. **One scale**: a box is the sensitivity itself, each factor to its own scale, so a box's figure is in the
  unit of the figure beside the factor's name and a part of it. (Until 0.40.0 a switch offered the share of a limit and USD on a usual day as well;
  three meanings for one height was two too many. What a usual day moves a box by is in the tip.)
  **Along the picture is a column for each quoted tenor** that some factor carries materially (3% of
  its factor's largest), nearest first, grouped by the four buckets; the tenor is named under its column
  as a label (11px) and the bucket under its group. A bucket is at least two columns
  wide, and takes its short name (5-10Y) where the long one does not fit. **A factor has a box in the column of
  each tenor it carries**: as tall as what it carries there on the lane's scale, in the factor's colour (a quarter
  filled, its edge ruled), every point's box as wide as every other's. A factor with no tenor of its own (a spot
  delta, a flat curve, a report stored before the points were) has one box across the bucket it is placed in; so
  has a bucket whose points are all too small for a column, so that nothing a factor carries is left off.
  The figure (12.5px, limestone) is above the box when long and below it when short, and stays in its own lane:
  it goes past the bucket's limit line where that stands in its way and the lane has room; where it has not,
  the figure stands on the line, which is drawn with a break for it and without the share used (a box close to its
  limit reads so; the tip and the gauge beside the factor have the share); with no
  room past the box at all it is written inside the box. A lane's largest boxes are written first, whole; a figure that would run into one already written, or
  into another box, is shortened (741k), and one that still would is left to the tip. The stream's line runs between the boxes and joins them, never through one;
  it says where the risk is, the boxes say how much.
  The light along a stream's line moves at thirty frames a second and not at all with "reduce motion".
- **A limit is read on two sides** (since 0.37.0), because a position is long or short and a limit is one number
  on its size. On a stream
  a bucket's limit is a ruled line in limestone (`--text-hi`) above the line and below it, hatched on the far
  side, across the bucket's columns; on the side the position is on it ends in the share of the limit used (11px). A
  limit too far off the lane to draw is not written on the picture (the tip and the gauge have it). A limit on a factor's total is a gauge at the start of
  its lane, never a line across the buckets. The share used is written in the colour of its state (quiet, amber
  from the limit's warning level, `--down` past it): on a limit `--down` says "past", and the hatching past a limit
  is quiet so that it is not read as a breach. LONG and SHORT are marked once at the picture's edge. Beside a
  factor the gauge is flat in the middle with the limit a fifth from either end.
  The share of a limit that is used is written in whole percent (83%, 110%), here and on the Limits page: it is
  read at a glance against 80 and 100, not to a basis point. A figure under a hundred keeps one decimal where a column mixes small and large (a fixing 01 of 2.8 beside one of
  453), on the Fixings panel. A limit that is the standard size for its kind says
  so (a dashed, quiet chip on the Limits page; ", the standard" on the home): it is a figure to start from.
- **A segment of two, three or six is the ticket's joined control** (`tbw-tabs`): the tabs that hold what the old
  home showed as cards.
- **Brass on this page is a link to where a thing is dealt with** (OPEN BLOTTER →, THE RISK PAGE →), as on the old
  home. The page has no action of its own, so no brass button.
- A name of a factor or a limit is a label (11px, or 12.5px in mono beside its stream); a figure is 12.5px, also the
  one inside a caption ("≈ 89,981 a day"). A trade's row answers the pointer and the keyboard as every row does.
- The picture's tip follows the pointer and names the column under it (its tenor and bucket) and each factor's
  figure there; it stays inside the picture, reaching back over the lanes' names where it is wide.
- **The Market risk page lists the ladder twice**: by bucket, then at each quoted tenor, a row for each curve and a
  cell for each quote that carries risk (the tenor as a label over its figure).
- The rates strip's snapshot line gives way with an ellipsis before it runs off the page.
- Under 1180px wide the bands stack in the same order; nothing is pushed sideways.

## The phone

A screen up to 640px wide (`frontend/src/lib/phone.js`, `components/layout/Phone.css`; since 0.32.0). The owner's
scope, 11 November 2026: the home, booking a trade through the trade window, chat and news; no P&L, no risk, no
capital. Those pages still open by their address but are not in the phone's navigation.

- **One bar at the foot**: HOME, TRADES, NEW, CHAT, NEWS. NEW is brass: it is the phone's one action. The bar keeps
  clear of the home indicator by the safe-area inset.
- **The home is a few things**: the market line, the book's counts and four figures two by two, the latest trades,
  the state of the chain. The policy path, the calendar, the clocks, the globe, the ladder and the written brief
  are a monitor's; stacked on a phone they made a page four screens long, and the owner called it messy.
- **A trade is a card**: the reference and its state, the instrument and its size, the counterparty and the tenor.
- **Nothing is pushed sideways** (the owner, 12 November 2026: "either fit on one screen or scroll down to see
  it"). What does not fit the width is folded onto more lines or read downwards, never put in a box that scrolls
  across; `e2e/phone.spec.js` fails on any such box. The ways it is done:
  - rows turned on their side (`.ph-flip`, with `--ph-n` cells to a row): the XVA strip, the on-chain comparison,
    the scenario's results and ladder. Each row becomes a column, so an adjustment or a shock is a line;
  - a wide table read downwards (`table[data-stack]`, set by `useStackedTables` in `lib/phone.js` for a table of
    five columns or more): each row a block, each cell under its column's heading;
  - a strip folded: the ticket's tabs two rows of three, the figures at the foot three across.
- **The trade window is the whole screen**: its fields two across and 40px high, its tabs all in view, the XVA
  tab's inputs above its results, PRICE and BOOK sharing the foot, one close button a thumb can
  hit. A grid that folds by itself (`auto-fit`) is left to.
- **An iPhone draws a date field and a dropdown by its own rules** (Safari on iOS; seen in the simulator, 13 November
  2026): a date field takes a width of its own and ran over the field beside it, and a dropdown is drawn shorter
  than a field whatever height it is given. On a phone a date field is held to its cell with its value at the
  left, and the trade window's dropdowns are drawn by the page: the height of every other field, with an arrow of
  the page's own (a filled triangle 10px wide in `--text-dim`, 10px from the field's edge). A chip (BUY, SELL,
  an instrument) is 40px high like the field beside it. A read-only field has no well, on a phone as on a monitor.
  Chromium at a phone's width shows none of this: a change to a field is looked at in the simulator's Safari
  (`frontend/e2e/sim/serve.sh`).
- **A field a person types in on the door is 16px**, and an iPhone is told not to enlarge the page on focus
  (`keepScaleOnFocus`): Safari enlarges for smaller type and stays enlarged.
- **A target for a thumb is about 40px high.** Keys (F4, ⌘↵) are not shown: a phone has none.
- **The app says what it is** (the owner, 13 November 2026: "meant for desktop viewing and not phone viewing"): one
  quiet line on the door ("Built for a monitor."), and a note on the home that closes and stays closed on that
  phone (`layout/DeskNote.jsx`). The size of a sheet's note (12px), the text's quieter colour, a monitor glyph; never
  a banner, never a colour, and nothing on a monitor. A note on a phone closes by a bare ✕ in a 40px target.
- **From the home screen.** The door offers ADD TO HOME SCREEN. An iPhone does not let a page install itself, so
  the button shows the taps that visitor's browser has (Safari has kept Share in three places: `installWay` in
  `lib/phone.js`), numbered, with Safari's glyphs beside the words; Android installs directly. The icon is the mark at rest; opened from it, the
  mark comes alive once (`brand/LaunchMark.jsx`), not at all with "reduce motion" set.
- Checked by `e2e/phone.spec.js` at 390 by 844 on Chromium, Firefox and WebKit; pictures by
  `PHONE_TAG=x npx playwright test -c playwright.perf.config.js phone.spec.js`.
