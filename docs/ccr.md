# Counterparty credit: netting sets, real-world exposure, PFE limits

Engine: `backend/ccr/`; page: `RISK › COUNTERPARTY CREDIT`; limits under `Configurations › Market Risk › Limits`.

## Two measures

Pricing and risk management ask different questions of the same model, so the engine runs it twice with two parameter sets and labels every number with its measure.

- **Risk-neutral** (the XVA reserves: CVA, DVA, FVA, FBA, KVA, MVA): the Hull-White mean reversion and volatility calibrated to the swaption surface, spot volatilities from the desk's flat vols, the drift from the curve. These are prices, and they belong to the P&L: the same engine computes them per netting set and the P&L page shows them and their change (docs/pnl_attribution.md). The credit page does not show them.
- **Real-world** (EE, EPE, PFE, limits): volatilities measured from two years of public history (daily changes of each currency's 3M rate, log returns of each spot), a mean reversion set by policy (0.05; two years of daily data cannot identify it, and the estimate is shown beside it), zero drift by default (the forward slope is a risk-neutral artefact, not a forecast; the historical drift is the firm's alternative), and the correlation matrix of all factor shocks from the same history. These are exposures.

## Joint simulation

One Hull-White factor per currency, one lognormal factor per spot, monthly steps to the netting set's last maturity, Brownian motions correlated by the calibration's matrix (identity in the risk-neutral run). Bond prices are affine in the factor and reproduce today's curve:

    P(t,T) = P(0,T)/P(0,t) · exp(−B(t,T)·x_t − σ²/(4a)·B(t,T)²·(1 − e^{−2at})),   B(t,T) = (1 − e^{−a(T−t)})/a

The real-world run shifts the factor so the short rate's expectation stays at today's level (or follows the historical drift). Spots: S_t = S_0·exp((μ − σ²/2)t + σW_t), μ the rate differential or zero.

### Historical simulation (the default real-world sampling)

Instead of Gaussian shocks, each monthly step is a block of 21 consecutive observed daily changes from the calibration window (the 3M rate's daily changes in decimals, the spots' daily log returns), the block's start drawn uniformly, the same block for every factor. The sum of the block is the step's increment: for a rate factor it enters the Hull-White recursion x_i = x_{i−1}·e^{−aΔt} + Σ Δr in place of σ√Δt·z, for a spot it is the step's log return. The panel is demeaned so the drift is the stated one (zero or historical), not the window's. What this keeps that the Gaussian run cannot: the window's fat tails, its volatility clustering within a block, and the realised co-movement of rates and spots without a correlation matrix. The firm chooses between the two (Configurations › Market Risk › VaR settings); when a factor has no history on common dates the run falls back to Gaussian shocks and says so.

## Netting

Every trade of a counterparty is valued on the same paths and summed per path and date, so netting is exact. Swaps: fixed leg Σ N·c·τ·P(t,T_j), OIS float leg N·(P(t,T_s) − P(t,T_N)); forwards: ±N·(S_t·DF_base/DF_quote − K)·DF_quote. Options are on the paths too (ccr/options.py): a caplet or floorlet embedded in a float leg is Bachelier on the path's forward for the period with today's ATM cap vol (nearest cap tenor) held flat until its fixing, then the realised payoff max(f_fix − K, 0)·τ·N discounted to its payment; a European swaption is Bachelier on the path's forward swap rate with today's ATM normal vol (nearest expiry × tenor on the surface) until expiry, then the underlying swap on the paths where it was in the money at expiry (physical settlement) and nothing elsewhere. The vol does not move along the path: that is the stated simplification. Anything else is listed as not simulated, never valued at zero.

## The CSA

From the counterparty record: NO_CSA → uncollateralised; VM or VM_IM → daily variation margin with the record's threshold and minimum transfer amount, a 10-business-day margin period of risk, initial margin when the type says so (SIMM weight on the netting set's IR01, MPoR-scaled, amortising with maturity). The collateral model is the XVA engine's: variation margin held against the value lagged by the MPoR (Brownian bridge inside a step), residual E⁺ = max(V − C − IM, 0).

## Measures

EE(t) the mean of E⁺; PFE_q(t) its q-quantile over paths at 95, 97.5 and 99 %; EPE the time average of EE over the first year; the peak PFE 95 and its date; the largest PFE 95 inside each tenor bucket; current exposure max(V₀ − C₀, 0). The XVA reserves come from the risk-neutral paths through the XVA waterfall with the counterparty's default spread (85bp and 40 % LGD until the record carries its own) and are reported on the P&L page.

## Limits

Credit limits are to counterparty credit what VaR limits are to market risk. The risk manager sets them on `PFE_PEAK:<counterparty>`, `PFE:<counterparty>:<bucket>`, `EPE:<counterparty>` and `CE:<counterparty>` (and, for a CVA desk, `CVA:<counterparty>` on the reserve) with the same utilisation and breach rules as the market risk limits; breaches reach the home inbox after the daily run.

## Running it

A netting set of a few trades simulates in a second or two (analytic valuation on the paths). RUN NOW computes the book in the background and stores the result per counterparty (`ccr_daily`), with progress on the page; the daily cron does the same for every account after end of day; COMPUTE LIVE recomputes on the spot. The engine is per counterparty, so a larger book moves to a worker without changing it.

## Limits, stated

- The margin period of risk is shorter than the monthly step, so the lagged value is a Brownian bridge inside the step; its noise is drawn independently per step, which makes the 99 % tail look jagged from one month to the next while the 95 % profile is smooth. Common random numbers across steps are a small next step.
- Trade flows between grid points are margined by construction (the bridge's share of the jump is restored); settlement risk on a coupon is therefore not in the exposure, which is the usual CSA assumption and should be said when it is not the counterparty's.
- One factor per currency: no curve twist in the exposure. Option vols are held at today's level along the paths (no vol dynamics).
- The default spread for CVA is a desk default until the counterparty record carries its own.

## Roadmap

A per-counterparty CDS spread and LGD on the record; wrong-way risk; stressed windows for regulatory EEPE; a term structure of PFE limits by tenor set per counterparty.
