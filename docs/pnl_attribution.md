# P&L and attribution

How Rijeka marks the book, explains the day, and signs it off. Engine: `backend/pnl/`; page: `P&L` next to the blotter; tile on the desk home.

## Marks

A mark is the production pricer on the **market as of the date**: for every curve, spot and funding row, the latest saved snapshot at or before that date (`market_data_snapshots`, keyed by curve id and valuation date). The same code prices the ticket, the blotter and the P&L, including the desk's forward mode for FX and digital assets (quoted forward points when the mode is MARKET). A P&L page and a ticket therefore agree to the cent; a difference between them is a bug, not a convention.

Market dates are the dates on which the benchmark curve (USD SOFR) was saved. Day-on-day P&L is between consecutive market dates.

## Attribution: sequential full revaluation

Starting from yesterday's mark on yesterday's market, the valuation is moved one thing at a time, in a fixed order, and each step's change is one row. Every step is a full repricing, never a sensitivity times a move, so the rows sum to the total by construction and nothing is "spread".

| Step | Row | What moves |
|---|---|---|
| 1 | CARRY | The valuation date rolls to today on yesterday's market: theta, roll-down, accrual |
| 2 | CASH | Coupons and settlements paid in (yesterday, today], signed from our side |
| 3 | RATES | Each curve the trade is valued on, one tenor bucket at a time: 0-1Y, 1-5Y, 5-10Y, 10Y+. Discount curve first, then forecast, then the base currency's curve. A single-quote curve (flat rate, funding) is one step |
| 4 | FX | The spot rate, then the quoted forward points |
| 5 | RESIDUAL | Today's mark on today's market minus the last step: cross effects and anything not moved explicitly (a vol surface today). Shown, never absorbed |

The order is the convention. Moving rates before spot is a choice; any other order is equally valid and gives slightly different rows. The order is printed on the report so that two people reading the same number agree on what it means.

## Market P&L versus trading P&L

- **Market**: rows 1 to 5 on trades that were on the book at both dates.
- **Trading**: new trades, at their close mark (a trade struck at market shows 0; a trade struck off-market shows its day-one P&L); unwinds and terminations, which remove the prior mark plus any termination fee in the terms.

## Roll-up and the reporting currency

Trade rows roll up book → desk → book total, using the desk and book the trade was booked with (`UNASSIGNED` when it was not). Each trade's currency converts to the reporting currency (USD) at the close of the report date, from the saved spot. A currency without a saved spot is left unconverted and flagged.

Month to date and year to date are sums of the stored daily rows plus the live day, so they are sums of what was signed, not recomputations.

## End of day, sign-off, management

`POST /api/pnl/eod` (and the daily cron, after the market data rebuild, for every account) stores one mark per trade per date (`eod_marks`) and one attributed row per trade per date (`pnl_daily`). A rerun replaces the day.

Sign-off (`pnl_signoffs`): the trader reviews the attribution and signs with a comment; then the P&L controller or desk CFO signs (the `controller`, `cfo`, `admin`, `management` or `risk` role, or a firm admin). Signing stores the day first, so what is signed is what is kept. A day with both signatures is FINAL and appears in the management view (`GET /api/pnl/firm`), every book in the firm with its status and comments.

## Limits, stated

- Vol surfaces are not yet a step; an option's vol P&L lands in RESIDUAL.
- A mirror booking without legs has no mark and is listed as not explained.
- Amendments are explained as market moves on the new terms; the amendment's own effect is not separated yet.
- History accumulates from the day the tables are applied (`docs/migrations/2026-10-30_pnl.sql`).
