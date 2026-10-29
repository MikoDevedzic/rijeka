"""
Market risk.

  history.py        risk-factor history: daily curve quotes and spots, from public sources,
                    stored as the template user's snapshots (the daily rebuild extends it)
  sensitivities.py  the ladder: key-rate IR01 by curve and tenor bucket, spot deltas, totals,
                    by bump-and-reprice through the production pricers
  var.py            historical-simulation VaR and expected shortfall on the ladder
  stress.py         named scenarios by full revaluation
  limits.py         limits on any reported number, with utilisation and breaches
  report.py         the risk report for a book on a date, and its daily storage
"""
