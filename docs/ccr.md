# Counterparty credit: netting sets, two measures, PFE, CVA, limits

Engine: `backend/ccr/`; page: `RISK › COUNTERPARTY CREDIT`; limits under `Configurations › Market Risk › Limits`.

## Two measures

Pricing and risk management ask different questions of the same model, so the engine runs it twice with two parameter sets and labels every number with its measure.

- **Risk-neutral** (CVA and the other XVAs): the Hull-White mean reversion and volatility calibrated to the swaption surface, spot volatilities from the desk's flat vols, the drift from the curve. These are prices.
- **Real-world** (EE, EPE, PFE, limits): volatilities measured from two years of public history (daily changes of each currency's 3M rate, log returns of each spot), a mean reversion set by policy (0.05; two years of daily data cannot identify it, and the estimate is shown beside it), zero drift by default (the forward slope is a risk-neutral artefact, not a forecast; the historical drift is the firm's alternative), and the correlation matrix of all factor shocks from the same history. These are exposures.

## Joint simulation

One Hull-White factor per currency, one lognormal factor per spot, monthly steps to the netting set's last maturity, Brownian motions correlated by the calibration's matrix (identity in the risk-neutral run). Bond prices are affine in the factor and reproduce today's curve:

    P(t,T) = P(0,T)/P(0,t) · exp(−B(t,T)·x_t − σ²/(4a)·B(t,T)²·(1 − e^{−2at})),   B(t,T) = (1 − e^{−a(T−t)})/a

The real-world run shifts the factor so the short rate's expectation stays at today's level (or follows the historical drift). Spots: S_t = S_0·exp((μ − σ²/2)t + σW_t), μ the rate differential or zero.

## Netting

Every trade of a counterparty is valued on the same paths and summed per path and date, so netting is exact. Swaps: fixed leg Σ N·c·τ·P(t,T_j), OIS float leg N·(P(t,T_s) − P(t,T_N)); forwards: ±N·(S_t·DF_base/DF_quote − K)·DF_quote. Caps and swaptions are listed as not simulated, never valued at zero.

## The CSA

From the counterparty record: NO_CSA → uncollateralised; VM or VM_IM → daily variation margin with the record's threshold and minimum transfer amount, a 10-business-day margin period of risk, initial margin when the type says so (SIMM weight on the netting set's IR01, MPoR-scaled, amortising with maturity). The collateral model is the XVA engine's: variation margin held against the value lagged by the MPoR (Brownian bridge inside a step), residual E⁺ = max(V − C − IM, 0).

## Measures

EE(t) the mean of E⁺; PFE_q(t) its q-quantile over paths at 95, 97.5 and 99 %; EPE the time average of EE over the first year; the peak PFE 95 and its date; the largest PFE 95 inside each tenor bucket; current exposure max(V₀ − C₀, 0). CVA, DVA, FVA, KVA and MVA from the risk-neutral paths through the XVA waterfall with the counterparty's default spread (85bp and 40 % LGD until the record carries its own).

## Limits

The risk manager sets limits on `PFE_PEAK:<counterparty>`, `PFE:<counterparty>:<bucket>`, `EPE:<counterparty>`, `CVA:<counterparty>` and `CE:<counterparty>` with the same utilisation and breach rules as the market risk limits; breaches reach the home inbox after the daily run.

## Running it

A netting set of a few trades simulates in a second or two (analytic valuation on the paths). RUN NOW computes the book in the background and stores the result per counterparty (`ccr_daily`), with progress on the page; the daily cron does the same for every account after end of day; COMPUTE LIVE recomputes on the spot. The engine is per counterparty, so a larger book moves to a worker without changing it.

## Limits, stated

- The margin period of risk is shorter than the monthly step, so the lagged value is a Brownian bridge inside the step; its noise is drawn independently per step, which makes the 99 % tail look jagged from one month to the next while the 95 % profile is smooth. Common random numbers across steps are a small next step.
- Trade flows between grid points are margined by construction (the bridge's share of the jump is restored); settlement risk on a coupon is therefore not in the exposure, which is the usual CSA assumption and should be said when it is not the counterparty's.
- One factor per currency: no curve twist in the exposure. Caps and swaptions are not on the paths yet.
- The default spread for CVA is a desk default until the counterparty record carries its own.

## Roadmap

Historical Monte Carlo (paths bootstrapped from blocks of observed changes, full revaluation) as the second real-world model; caps and swaptions on the paths; a per-counterparty CDS spread and LGD on the record; wrong-way risk; stressed windows for regulatory EEPE; a term structure of PFE limits by tenor set per counterparty.
