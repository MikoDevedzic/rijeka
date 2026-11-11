# The look: Harbour

Adopted 10 November 2026. Deep bottle-green water, limestone type, brass for the one thing to press and for what
is sealed on chain. The tokens are in `frontend/src/index.css` (`:root`); `frontend/src/theme.js` mirrors them for
code that draws on a canvas, and `theme.test.js` holds the two together.

## What a colour means

| Token | Means | Never |
|---|---|---|
| `--accent` (brass), `--accent-hi` | the action of the view (BOOK TRADE, + NEW TRADE), the selected tab's rule, what is sealed on chain, the saving on chain, the name RIJEKA | a label, a typed value, a positive number |
| `--up`, `--down` | the sign of a number; a side that is chosen (coral for paying or selling, green for receiving or buying, the same in the swap's direction, an option's side, a forward's and a leg's); a state that is good or bad in itself (live, calibrated, a verify that passed; defaulted, a failed check) | a selection, an action |
| `--amber` | a caution, something provisional, the PFE tail | an action |
| `--blue` | the counterpart series on a chart (ENE), a link on paper | a selection; a figure in a table (it takes the colour of its sign) |
| `--text-hi`, `--text`, `--text-dim`, `--text-mute`, `--text-faint` | limestone, in five steps. Contrast on `--bg` / `--panel` / `--panel-2`: `--text-mute` 6.2 / 5.6 / 4.8, `--text-faint` 5.3 / 4.8 / 4.1 | `--text-faint` on `--panel-2` or lighter |
| `--panel`, `--panel-2`, `--panel-3` | a surface one step up; `--panel-3` is the fill of a selected chip | |

A selected chip or segment is a lighter panel and the full text colour, not a colour. A status takes a colour only
when it says something: confirmed is brass, live is green, pending is a hollow dot, anything over is faint.

Brass, the on-chain gold, amber and the coral of a negative number are all warm. `--down` is set toward rose so a
caution and a loss are not mistaken for one another; where two warm colours still mark two categories side by
side (the messenger's own messages against Prometheus's, the limit bar's warning against its breach, EE against
PFE on Risk → Counterparty credit) the page has not been read yet, and that is in the list below.

**This holds on the screens rebuilt so far** (the ticket's TRADE, XVA and CONFIRM tabs, the blotter, the top
bar). Elsewhere brass still colours what the teal accent did: about four hundred uses remain, among them the
CURVE SCENARIO and DETAILS tabs, the market-data pages and the configuration pages.

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
colour. The seal (`trade-window/Seal.jsx`, `seal-rings.js`) is drawn from the trade's hash: the same hash always
draws the same seal. Only a record that stands on chain has the stamp's blue and red and the centre point: one
that is signed and not anchored, or closed, has a grey seal without it. The ticket keeps a visited tab mounted
and hidden, where a canvas has no size, so the seal is drawn when it first has one and again whenever it comes
back into view. The heading says "Both sides signed the same terms" only where the record itself says it is
bilateral.

## The exposure chart

EE in limestone, ENE in blue, PFE 95 % in amber, the simulated paths as hairs of limestone or blue by where they
end (`trade-window/exposure-chart.js`). Three hues that cannot be mistaken for one another.

## The shape of a ticket

The same on every product. **TRADE** is what the user sets. **DETAILS** is the detail of it: a swap's period
schedule; for a forward or an option, the record as it will be booked beside the market it was priced on.
**CASHFLOWS** is what comes back: the flows as legs with their present values and their net, then the valuation
(each figure with its formula, and what the price was built from). The **footer** carries the headline figures
on every tab. On TRADE the only computed things are a field that shows its default (dashed), an option's
premium line and the notes that say why there is no price. A stored currency trade opened from the blotter has
no valuation block (it never had).
A new ticket opens on a digital-asset forward; the asset classes read CRYPTO, FX, RATES.

## The name, the top bar, a rail

The name RIJEKA (`.rj-wordmark`) is brass and the one thing that glows: nothing else on a page carries a light
of its own. The pages on the top bar (`.ab-link`) are buttons; the one you are on is the lighter panel over the
brass rule. In a rail of filters (the blotter's left pane) a section's heading is the size of its choices and
reads as their heading by weight, the bright text colour and a rule above it; the choices sit a step in, in the
quieter colour, and the selected one is the lighter panel with the brass rule at its edge.

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
  be changed, has no well: what can be typed and what cannot are told apart at a glance. Dashes still mean "this
  is the default: type over it"; amber still means "this cannot be read".
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
rose) and brass for the registry alone. A step lights its pieces and its joins in limestone; only a join that
reaches the registry is brass. The names are buttons set over the canvas in the interface face, so they stay
sharp at any size and are read by a screen reader. There is no flat view to choose; where a browser cannot draw
the scene the names stand in a row and the steps still say what happens.

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

## Type on the ticket

One rule on every tab: a label is 11px in capitals; a value is 12.5px, a number, a date or a formula in mono and
words in the interface face; a headline figure is 13 to 16px in mono. A tab does not pick its own sizes.

## The XVA results

One table (`xva-shared.jsx` `VaStrip`, `OnChainCompareRow`): the adjustments across, each line of figures a row
named once at the left. Every row of money is set alike; a figure takes the colour of its sign and nothing else;
ALL-IN is the one column that stands out and the saving on chain the one brass figure. Nothing scrolls inside
the tab: the inputs column is as tall as its inputs, and the credit curves and the assumptions sit under the
results they drive.

## The scenario tab

The XVA tab's shape (`FxTabs.jsx` `ScenarioBody`, `FxRateCurve.jsx`): at the left the curves the price was
built on, each a button with its risk factor's mark and what has been done to it, then the selected curve's
flat shock and its points; at the right the selected curve's chart, the result as one table (factors across,
TOTAL the column that stands out), the scenario's forward, value and fixing, and one ladder for the selected
curve. A point that was typed or dragged carries the brass rule, as a field typed over its default does.

## Risk factors

One colour per risk factor, the same on every product (`frontend/src/lib/risk-factors.js`, tokens `--rf-*`):
interest rates, FX spot, digital-asset spot, forward basis, volatility, time. It marks the factor's **name**, as
a small square before the label (`RiskMark`); the figure keeps the colour of its sign. An asset class takes the
colour of the factor it mainly carries. The purpose is to be read without being told: the IR01 of a swap, an
option and a digital-asset forward is one colour because it is one risk, and it adds across the book.

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
stands for the old accent (above); the three-dimensional vol surface on the scenario tab, still in its own
colours; the lineage tree on a figure; the mark of where each field's number came from on the rates ticket (the
currency ticket marks an override with a brass rule); EPE on the XVA tab; the remaining pages read screen by
screen; widths under 1440px, where the blotter scrolls sideways.

`frontend/e2e/perf/look.spec.js` takes a picture of the screens a new user meets (the home, the blotter, the
ticket's tabs, the pages behind the top bar; not yet every state: an anchored or terminated certificate needs a
chain), for a person to read after a
change to the look: `npx playwright test -c playwright.perf.config.js look.spec.js`, then `e2e/.out/look/*.png`.
