# Independent price verification: the market data the book is priced on, verified where the risk sits

Modules: `backend/ipv/` (`inputs.py`, `tolerances.py`, `ladder.py`, `run.py`, `store.py`), `api/routes/ipv.py`,
the `ipv_run` worker kind; pages P&L → IPV, Configurations → P&L & CONTROL → IPV TOLERANCES. Migration
`docs/migrations/2026-11-05_ipv.sql` (four tables; before it the pages say so and nothing else changes).

## The idea

A controller does not re-price a thousand trades; they verify the inputs the thousand trades are priced on. The
list of those inputs is derived from the book, never from a catalogue: every curve, funding level, vol surface
and spot that any trade in scope reads (`pnl.valuation.trade_curves`, `spot_curve`). Each input is laddered per
pillar through the production pricers (one quote moved by one unit, the dependent trades repriced, the change
summed in USD), so the controller sees, per pillar, how much P&L a move of the mark carries. An override is a
market-data event, never an edit of the desk's snapshot; the traders' marks stay as the flash.

## The run (`ipv/run.py`)

For an account, a market date and a scope (GLOBAL, DESK:name, BOOK:name):

1. **Inputs**: the dependency union over the trades in scope; per input its kind (RATES, FUNDING, SWAPTION_VOL,
   FX_VOL, SPOT) and unit (bp, bp of normal vol, vol points, % of spot).
2. **Pillars**: a tenor on a curve; an expiry × tenor point on a swaption grid (`1Yx5Y`); a tenor and quote type
   on an FX surface (`1Y|RR25`); the SPOT row of a spot. Per pillar: the desk quote, the independent quote (the
   latest `ipv_independent_marks` row at or before the date), the gap in the input's unit, the sensitivity from
   the pillar ladder, the tolerance and materiality from the firm's rules, the status (OK within tolerance,
   REVIEW beyond it, UNVERIFIED without an independent mark, OVERRIDDEN, APPROVED).
3. **State of the input**: OVERRIDDEN when a pillar is overridden; APPROVED or WAIVED by a controller's decision
   (a waiver needs a reason); VERIFIED when an independent mark exists and every pillar is within tolerance;
   WAIVED automatically when no pillar is material (sensitivity × tolerance below the materiality threshold);
   PENDING otherwise. An input without a snapshot (the trades read a default) is PENDING until decided.
4. **Figures**: flash = the trading P&L's day at the scope (the stored day when there is one); first order =
   Σ sensitivity × shift over the overridden pillars; second order = the full revaluation on the overridden
   market less flash less first order (APPLY; `pnl.report.report(..., overrides=)`); XVA = the netted reserve
   change of the day (book level); official = flash + first order + second order + XVA.
5. **The gate**: no PENDING input, no trade the batch could not value. The controller's sign-off marks the run
   SIGNED and writes a `pnl_signoffs` row with role IPV and the official figure; `GET /api/pnl/report` carries
   it as `official`, and the trading P&L shows FLASH and OFFICIAL.

## Tolerances (`ipv/tolerances.py`)

Rules per firm: a glob on the input (`USD_SOFR`, `*_VOL`, `*`), a glob on the pillar (`10Y`, `1Yx5Y`, `*`), the
tolerance in the input's unit, the materiality threshold in USD. The most specific rule wins (an exact input before
a pattern, an exact pillar before `*`). Defaults without a rule: rates 1 bp, funding 2 bp, swaption vol 1.5 bp, FX
vol 0.25 points, spot 0.10 %; materiality 1,000 USD.

## The independent mark

`POST /api/ipv/independent {curve_id, date, quotes, source}` (controller) stores one; a self-host with a second
feed writes the same table. On the hosted demo there is one market-data source, so an input without an upload
reads "none · model IPV only" and needs APPROVE AS MARKED or a waiver; the QuantLib reference suite and the Excel
replications remain the model verification.

## Routes

`GET /api/ipv/run?date&level&name&live`, `POST /api/ipv/run`, `GET /api/ipv/run/status`, `PUT /api/ipv/override`,
`DELETE /api/ipv/override/{id}`, `POST /api/ipv/inputs/approve|waive`, `POST /api/ipv/apply`,
`POST /api/ipv/signoff`, `GET/POST/DELETE /api/ipv/tolerances`, `POST /api/ipv/independent`. Overrides, decisions,
apply and sign-off need the controller, CFO or admin role or firm admin; tolerances the risk, controller or admin
role.

## Limits, stated

- The sensitivity per pillar is a one-sided bump through the pricers; convexity between pillars is in the second
  order only.
- Cap and floor vol (`cap_vol_surface`) is read by the caplet pricer outside the market object and is not yet an
  input row; CDS spreads are desk defaults until the counterparty record carries its own.
- The day's reserve change enters the official figure at book level only; the sequential explain of the reserve
  change is the next step of the XVA RESERVES tab.
- The monthly IPV report and the independent mark from a second feed are self-host features.
