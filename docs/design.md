# The look: Harbour

Adopted 10 November 2026. Deep bottle-green water, limestone type, brass for the one thing to press and for what
is sealed on chain. The tokens are in `frontend/src/index.css` (`:root`); `frontend/src/theme.js` mirrors them for
code that draws on a canvas, and `theme.test.js` holds the two together.

## What a colour means

| Token | Means | Never |
|---|---|---|
| `--accent` (brass), `--accent-hi` | the action of the view (BOOK TRADE, + NEW TRADE), the selected tab's rule, what is sealed on chain, the saving on chain | a label, a typed value, a positive number |
| `--up`, `--down` | the sign of a number; the paying or selling side; a state that is good or bad in itself (live, calibrated, a verify that passed; defaulted, a failed check) | a selection, an action |
| `--amber` | a caution, something provisional, the PFE tail | an action |
| `--blue` | the counterpart series: ENE, DVA and FBA, a benefit, a link on paper | a selection |
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
