# The look: Harbour

Adopted 10 November 2026. Deep bottle-green water, limestone type, brass for the one thing to press and for what
is sealed on chain. The tokens are in `frontend/src/index.css` (`:root`); `frontend/src/theme.js` mirrors them for
code that draws on a canvas, and `theme.test.js` holds the two together.

## What a colour means

| Token | Means | Never |
|---|---|---|
| `--accent` (brass), `--accent-hi` | the action of the view (BOOK TRADE, + NEW TRADE), the selected tab's rule, what is sealed on chain, the saving on chain | a label, a typed value, a positive number |
| `--up`, `--down` | the sign of a number; receive and pay | a status |
| `--amber` | a caution, something provisional, the PFE tail | an action |
| `--blue` | the counterpart series: ENE, DVA and FBA, a benefit, a link on paper | a selection |
| `--text-hi`, `--text`, `--text-dim`, `--text-mute`, `--text-faint` | limestone, in five steps; `--text-faint` is for captions only (4.4:1) | |
| `--panel`, `--panel-2`, `--panel-3` | a surface one step up; `--panel-3` is the fill of a selected chip | |

A selected chip or segment is a lighter panel and the full text colour, not a colour. A status takes a colour only
when it says something: confirmed is brass, live is green, pending is a hollow dot, anything over is faint.

## Type

Instrument Sans for interface text, DM Mono for numbers, references and codes, Bodoni Moda for the heading of the
confirmation certificate and nothing else. DM Mono is drawn in two weights; a number asked for at 600 or 700 gets
the 500 cut (the faces in `index.css` cover those weights with the same file), never a synthetic bold. All three
come from Google Fonts, the host the app already loaded its type from.

## Corners

`--r-1` 4px (badges, small inputs), `--r-2` 6px (buttons, inputs, chips), `--r-3` 10px (cards), `--r-4` 14px (the
ticket). The certificate keeps a square corner: it is paper.

## The certificate

The signed record on the CONFIRM tab is the one light surface (`.cert` in `trade-window/styles.css`). Inside it
the colour tokens are redefined as the paper's inks, so its rows, links and buttons take them without naming a
colour. The seal (`trade-window/Seal.jsx`, `seal-rings.js`) is drawn from the trade's hash: the same hash always
draws the same seal. A record that is signed and not anchored has a grey seal with no centre point.

## The exposure chart

EE in limestone, ENE in blue, PFE 95 % in amber, the simulated paths as hairs of limestone or blue by where they
end (`trade-window/exposure-chart.js`). Three hues that cannot be mistaken for one another.

## What is not done yet

Colours and sizes written as literals in components (the count is in the backlog, item 49); a lint rule against new
ones; the lineage tree on a figure; the mark of where each field's number came from on the rates ticket (the
currency ticket marks an override with a brass rule); the remaining pages read screen by screen.

`frontend/e2e/perf/look.spec.js` takes one picture of every screen a new user meets, for a person to read after a
change to the look: `npx playwright test -c playwright.perf.config.js look.spec.js`, then `e2e/.out/look/*.png`.
