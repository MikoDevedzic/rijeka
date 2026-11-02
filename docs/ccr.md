# Counterparty credit: netting sets, real-world exposure, PFE limits

Engine: `backend/ccr/`; page: `RISK › COUNTERPARTY CREDIT`; limits under `Configurations › Market Risk › Limits`.

## Two measures

Pricing and risk management ask different questions of the same model, so the engine runs it twice with two parameter sets and labels every number with its measure.

- **Risk-neutral** (the XVA reserves: CVA, DVA, FVA, FBA, KVA, MVA): the Hull-White mean reversion and volatility calibrated to the swaption surface, spot volatilities from the desk's flat vols, the drift from the curve. These are prices, and they belong to the P&L: the same engine computes them per netting set and the P&L page shows them and their change (docs/pnl_attribution.md). The credit page does not show them.
- **Real-world** (EE, EPE, PFE, limits): volatilities measured from two years of public history (daily changes of each currency's 3M rate, log returns of each spot), a mean reversion set by policy (0.05; two years of daily data cannot identify it, and the estimate is shown beside it), zero drift by default (the forward slope is a risk-neutral artefact, not a forecast; the historical drift is the firm's alternative), and the correlation matrix of all factor shocks from the same history. These are exposures.

## Joint simulation

One Hull-White factor per currency, one lognormal factor per spot, monthly steps to the netting set's last maturity, Brownian motions correlated by the calibration's matrix (identity in the risk-neutral run). Grid times are each grid date's distance from the as-of date in 365.25-day years, the clock every trade date is read on, so a fixing or an expiry on a grid date is at that grid point; each step uses its own length. The short rate is r(t) = f(0,t) + φ(t) + x(t), with x the driftless Ornstein-Uhlenbeck deviation and φ(t) = σ²/(2a²)·(1 − e^{−at})². Bond prices are affine in x + φ (that is, in r − f(0,t)) and reproduce today's curve:

    P(t,T) = P(0,T)/P(0,t) · exp(−B(t,T)·(x_t + φ(t)) − σ²/(4a)·B(t,T)²·(1 − e^{−2at})),   B(t,T) = (1 − e^{−a(T−t)})/a

Until November 2026 the formula was evaluated on x_t alone, which priced every bond on a path high by exp(B·φ) and put path forwards φ(t) below the curve: 8bp at five years, 27bp at ten for a = 3 %, σ = 85bp, so payer exposure was understated and receiver exposure overstated, more so the longer the horizon. The risk-neutral martingale check in `backend/tests/reference/test_ref_ccr.py` (E[D(t)·P(t,T)] = P(0,T)) pins it, and the same suite checks a swaption and a caplet valued on the paths against QuantLib's exact Hull-White prices.

The real-world run shifts the factor so the short rate's expectation stays at today's level (or follows the historical drift). Spots: S_t = S_0·exp((μ − σ²/2)t + σW_t), μ the rate differential or zero.

### Historical simulation (the default real-world sampling)

Instead of Gaussian shocks, each monthly step is a block of 21 consecutive observed daily changes from the calibration window (the 3M rate's daily changes in decimals, the spots' daily log returns), the block's start drawn uniformly, the same block for every factor. The sum of the block is the step's increment: for a rate factor it enters the Hull-White recursion x_i = x_{i−1}·e^{−aΔt} + Σ Δr in place of σ√Δt·z, for a spot it is the step's log return. The panel is demeaned so the drift is the stated one (zero or historical), not the window's. What this keeps that the Gaussian run cannot: the window's fat tails, its volatility clustering within a block, and the realised co-movement of rates and spots without a correlation matrix. The firm chooses between the two (Configurations › Market Risk › VaR settings); when a factor has no history on common dates the run falls back to Gaussian shocks and says so.

## Netting

Every trade of a counterparty is valued on the same paths and summed per path and date, so netting is exact. Swaps: fixed leg Σ N·c·τ·P(t,T_j), OIS float leg N·(P(t,T_s) − P(t,T_N)); forwards: ±N·(S_t·DF_base/DF_quote − K)·DF_quote. Options are on the paths too (ccr/options.py): a caplet or floorlet embedded in a float leg is Bachelier on the path's forward for the period with today's ATM cap vol (nearest cap tenor) held flat until its fixing, then the realised payoff max(f_fix − K, 0)·τ·N discounted to its payment; a European swaption is Bachelier on the path's forward swap rate with today's ATM normal vol (nearest expiry × tenor on the surface) until expiry, then the underlying swap on the paths where it was in the money at expiry (physical settlement) and nothing elsewhere. The vol does not move along the path: that is the stated simplification. A swaption before expiry is valued at the normal vol the paths' own Hull-White model implies for it (`ccr/options.hw_implied_vol`: the Jamshidian price at t₀ inverted through Bachelier), so the value before expiry and the exercise at expiry are one model and expected exposure does not step at expiry; the report shows the market ATM quote and the vol used on the paths side by side. (Until November 2026 the market vol was used before expiry and exposure stepped at expiry by the ratio of the two vols, 13–25 % in the reference test.) A sold option (terms.side SELL) enters with the opposite sign. An FX option (`ccr/options.value_fx_option`) is valued before expiry with Garman-Kohlhagen on the path's forward to settlement (the path's spot and bonds; the base currency's curve where it is simulated, else the flat rate the forward uses) at the vol it was valued with today, held flat; at and after expiry its payoff is fixed on the spot at the expiry grid point and discounted until the settlement date, when it leaves the exposure. The other styles (`pricing/fx_exotic.py`) are valued on the paths with the same closed forms, vectorised: a barrier or touch option carries which paths have already knocked, monitored at the grid points seen so far (discrete, where the pricer is continuous, so knock probabilities are a little understated); an American option is valued as its European on the paths (the early-exercise premium is not simulated: a lower bound). The credit page's options list names the style, the barrier and the payout. Anything else is listed as not simulated, never valued at zero.

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
