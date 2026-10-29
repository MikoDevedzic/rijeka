"""
Counterparty credit risk.

  calibration.py  the two parameter sets: risk-neutral (swaption-calibrated HW1F, market
                  vols, forward drift) for pricing; real-world (volatilities, mean reversion,
                  drift and correlations from the public history) for exposure and limits
  simulate.py     joint factor paths per netting set: one Hull-White factor per currency, one
                  lognormal factor per spot, correlated Brownian motions
  valuation.py    every trade of a netting set valued on the shared paths (analytic under
                  HW1F), summed per path and date
  exposure.py     the counterparty's CSA on the netted value; EE, EPE, PFE at 95 / 97.5 / 99,
                  peak and buckets; CVA from the risk-neutral run
  report.py       the book by counterparty, limits, storage, the batch
"""
