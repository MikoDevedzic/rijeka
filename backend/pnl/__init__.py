"""
P&L and attribution.

  market.py     the market as of a date: every saved snapshot (curves, spots, funding)
                at or before that date, with overrides for step-wise revaluation
  valuation.py  one trade valued on one market on one date, through the production pricers
  explain.py    day-on-day P&L of a trade by sequential full revaluation: carry, each
                curve by tenor bucket, spot, then whatever is left; and trading activity
  report.py     the book for a date: trade rows, roll-up by desk and book in a reporting
                currency, MTD / YTD from stored daily rows, sign-off state, persistence
"""
