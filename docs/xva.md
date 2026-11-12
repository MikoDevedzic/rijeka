# XVA: every component, as the engine computes it

Engine: `backend/pricing/xva_engine.py` (`run_waterfall`), collateral model `backend/pricing/csa.py`, rates exposure from the HW1F Monte Carlo (`xva.py`), FX and digital-asset exposure from a lognormal forward (`fx_xva.py`), a digital asset's on the clock of its vol regimes (§8b). Signs follow the desk convention: costs negative, benefits positive, and

    ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA.

## 1. Exposure paths

Rates: Monte Carlo MtM paths V(t) of the trade under a Hull-White one-factor model calibrated to the swaption surface, on a monthly grid to maturity; `n_paths` paths. FX and digital assets (weekly steps for a ticket of a year or less, monthly beyond: §8d): V(t) = ±N·(F_t − K)·DF_q(t,T) with F_t driftless under the T-forward measure: for a currency pair lognormal at the pair's vol (the surface's ATM term structure, or a desk input, named on the ticket); for a digital asset lognormal over each grid step given the variance the step accumulated under the asset's vol regimes (§8b), with the same variance on average. Both hand the same shape to the waterfall: paths from our side (positive = the counterparty owes us), V(0), and the discount factors P(0, t_k).

## 2. Collateral: the CSA turns V into a residual exposure

Variation margin held against the lagged MtM, from our side (+ = we hold theirs):

    C(t) = max(V(t−δ) − TH_cp, 0) − max(−V(t−δ) − TH_own, 0),   zeroed when |C| < MTA

δ is the margin period of risk in years (mpor_days / 250); V(t−δ) is taken on the path between grid points: on a currency or digital-asset ticket exactly (the pair's forward bridged in logs, where it is a Brownian motion, and every leg valued on it: `fx_xva.exact_lag`, since 0.23.0); on a rates ticket and in the netting-set engine by a Brownian bridge between the grid values (`xva_engine.lagged_values`). Initial margin is exchanged each way: the desk's own amount, held for the life of the trade, or the engine's estimate from the paths at each date (Initial margin, below). The residuals are

    E⁺(t) = max(V − C − IM, 0)        EE(t)  = mean over paths
    E⁻(t) = min(V − C + IM, 0)        ENE(t) = mean over paths
    PFE(t) = 95th percentile of V − C

Presets: UNCOLLATERALISED (no VM, no IM); BILATERAL (daily VM, 10 business-day MPoR, initial margin, thresholds and MTA from the request); ON_CHAIN (continuous VM, zero threshold and MTA, 5 business-day MPoR, initial margin over that shorter period). The CSA is the single object that distinguishes the three; everything below is a function of E⁺, E⁻ and δ.

## 3. CVA

Credit triangle: hazard = spread / LGD, survival Q(t) = exp(−s·t/LGD) with the counterparty's CDS spread s (flat or a term curve).

    CVA = − LGD · Σ_i EE(t_i) · [Q(t_{i−1}) − Q(t_i)] · P(0,t_i) · WWR

WWR is a wrong-way-risk multiplier (1 by default). Reported negative: a cost.

## 4. DVA

The mirror on our own survival, with our CDS spread and LGD:

    DVA = + LGD_own · Σ_i |ENE(t_i)| · [Q_own(t_{i−1}) − Q_own(t_i)] · P(0,t_i)

Reported positive: a benefit (the controversial one; shown, not netted away).

## 5. FVA and FBA

Funding the uncollateralised positive exposure at the funds-transfer price, and the benefit of funding received on the negative one at a fraction of it:

    FVA = − Σ_i ftp(t_i) · EE(t_i) · Δt · P(0,t_i)
    FBA = + Σ_i ftp(t_i) · fba_ratio · |ENE(t_i)| · Δt · P(0,t_i)

ftp is the desk's funding spread (flat or a term curve); fba_ratio (0.55 by default) is the share of the funding spread credited on benefit.

## 5b. The grid of a currency or digital-asset ticket, and the exposure a charge reads (§8d, 0.28.0)

    steps = max(2, ⌈52·T⌉) for T ≤ 372 days, else max(2, ⌈12·T⌉);   Δ = T / steps        (pricing/fx_xva.exposure_grid)
    CVA, DVA, FVA, FBA at step i read  ½·(EE_{i−1} + EE_i)   (ENE likewise; per path under wrong-way risk)
    EE_0 = max(V_0 − C(V_0) − IM_1, 0),  ENE_0 = min(V_0 − C(V_0) + IM_1, 0)             (run_waterfall(average_exposure=True))

A forward's exposure grows like √t. Read at each step's end on two or three monthly steps it overstated the charge.
BTC forward dealt at fair value, 55 % vol, 20,000 paths, CVA against the same run on daily steps:

| | 1M | 3M | 6M | 1Y |
|---|---|---|---|---|
| until 0.28.0: monthly steps, exposure at the step's end, uncollateralised | +31 % | +23 % | +8 % | +9 % |
| the same under a ten-day margin period | +23 % | +6 % | +3 % | +2 % |
| now: weekly steps, averaged exposure, uncollateralised | −2 % | +1 % | −3 % | 0 % |
| the same under a ten-day margin period | −3 % | 0 % | −2 % | 0 % |

The daily figures above carry the averaged charge and the asset's vol regimes. Against continuous time, by closed
form on one vol (EE(t) of a forward dealt at K is a call's undiscounted value; CVA = LGD ∫ EE(t) e^{−rt} h e^{−ht} dt),
the rule until 0.28.0 read +28 % at one month and +20 % at three, and the engine now reads −2.7 % and −1.7 %
(`tests/reference/test_ref_exposure_grid.py`). The averaged rule is a trapezoid: on a profile that grows like √t it
reads low, 2.6 % at one month, 0.7 % at three, 0.1 % at a year by the rule alone; monthly steps beyond a year read
0.8 % low at 1.03 years and 0.4 % at two. A step starts from the set less what was paid on that date, so a leg of a
package that has settled is not charged for one more step.

The charge was overstated, not understated. The profiles on the chart (EE, ENE, PFE) are still the values at the
grid dates. KVA's replacement cost, MVA's margin and ColVA are read at each step's end. A swap's waterfall and
the credit page's netting-set engine keep monthly steps and the step's end (not measured there), so the
incremental charge on a ticket (`CHARGE THIS TRADE`) and the ticket's stand-alone figure are on different grids.
Still grid-dependent on a margined ticket: KVA about 4 % below daily steps at six months, MVA 1 % above. The
replication workbooks run monthly steps (`grid_per_year` on the input) with the averaged charge in their cells;
that the grids agree is tested on the engine (`tests/test_exposure_grid.py`). The independent quadrature of
wrong-way risk (`tests/test_wrong_way_risk.py`) is of the averaged definition.

## 6. KVA

Capital held over the life, charged at the hurdle rate. Exposure at default by the chosen model:

    SA-CCR:  EAD(t) = α · [RC(t) + multiplier · AddOn(t)],  α = 1.4
             AddOn = SF_IR · N · SD(M−t) · MF,  SD(m) = (1 − e^{−0.05m}) / 0.05
             margined: MF = 1.5·√(MPoR/250), RC = max(V − C, TH + MTA − NICA, 0), NICA = IM received
             unmargined: MF = √(min(m,1)), RC = max(V − C, 0)
             multiplier = min(1, 0.05 + 0.95·exp((V − C − NICA) / (1.9·AddOn)))
    CEM:     EAD(t) = RC(t) + SF_IR · N · MF
    IMM:     EAD(t) = α · EE(t)

    K(t) = 8 % · RW_cp · EAD(t)
    KVA  = − hurdle · Σ_i K_i · Δt · P(0,t_i),   K_i = K with the remaining life M − (t_i − Δt/2)

The remaining life `M − t` in the add-on, the maturity factor and the CVA-capital leg is read at the middle of step
`i` (0.27.0): capital is held through the step, so the step that ends on the maturity is charged like the others.
Until then it was read at the step's end, where it is zero on the last step: a one-month trade on two monthly steps
was charged for one. The replacement cost is read at the step's end, as the exposure is, and so is the discount factor (about r·Δt/2
low: 0.2 % at a monthly step and 4 %). The unmargined maturity factor floors M at ten business days (CRE52.48).
MVA: the margin itself is still the one at each step's end; what changed is that the last step is funded too.
The figures reported as the capital stock (EAD, RWA, capital, add-on) are the first step's, read the same way: not
the valuation date's, and on a short trade they depend on the grid (a one-month BTC forward's first-step EAD is
15 % higher on daily steps than on monthly ones).

## 7. MVA

Initial margin posted is funded at the funding spread less whatever the collateral earns:

    IM_post(t_i) = max( q₀.₉₉( mean(Δ_i) − Δ_i ), 0 ),   IM_recv(t_i) = max( q₀.₉₉( Δ_i − mean(Δ_i) ), 0 ),   Δ_i = V(t_i) − V(t_i − δ)
    MVA = − Σ_i IM_post(t_i) · max(ftp(t_i) − pickup, 0) · Δt · P(0,t_i)

Before the first margin period has passed (t_i < δ) the value a margin period earlier is today's: the margin at the
first date is the percentile of the move since today. δ is 10/250 of a year under the bilateral preset: 14.6 days on
a digital asset's 365-day clock. One MVA figure is held against a derivation written apart from the engine by the
model validator (12 November 2026, `tests/reference/test_ref_mva_forward.py`): long 10 BTC three months forward under
the bilateral preset, −326.78 against the engine's −326.17 on one vol (0.19 %) and −356.95 against −356.66 on the
regimes (0.08 %), the margin at the first date within 0.12 %.

**Initial margin (10 November 2026).** Rijeka does not compute ISDA SIMM: SIMM is ISDA's licensed methodology,
and its risk weights are not in this code. Initial margin is one of two things. An amount the desk sets (`im_usd`
on every XVA route; `simm_im_m`, in millions, is the old name of the same input and is still read): exchanged
each way and held for the life, so MVA is that amount funded at the spread, step by step. A firm with a SIMM
licence enters its own SIMM figure there. Or the engine's own estimate (`pricing/xva_engine.model_im`): at each
grid date the 99th percentile rise (the margin we call, which stands between us and their default) and fall (the
margin we post, which MVA funds) of the set's value over the margin period ending at that date, about its mean,
from the lagged value the variation margin already uses. The confidence is the one the BCBS-IOSCO margin rules
for non-centrally cleared derivatives name (one-tailed, 99 per cent, over the margin horizon). The mean is taken
out because what every path does over the period (a coupon, the passage of time) is not a risk. A shorter margin
period gives a smaller estimate, by about √(5/10) from bilateral to on chain. Limits: the estimate is at the
model's current volatility, not one calibrated to a period of stress, so it reads lower than a stressed
regulatory figure (about half of the weights-based figure this engine carried until 0.18.0, on the pinned 5-year swap); it is a cross-section of the
paths at each date, not a margin recomputed on each path (an option far out of the money carries the same margin
as one in the money); one confidence for every asset class. On currency and digital-asset tickets the value a
margin period earlier is exact (0.23.0): against a simulation that draws the level at both dates, no grid and no
bridge, the estimate agrees to sampling error at 8 to 110 % vol (`tests/test_fx_xva_lag.py`). Until then those
tickets bridged between grid VALUES, which keeps the variance of the move but is Gaussian where the value is
lognormal: the margin we call read within about 1 % at currency vols and 9 to 18 % low at 55 to 110 % (the
validator's own figure on 10 November 2026 was 7 to 15 %). On a digital asset the level also has vol regimes since 0.24.0 (below), and the margin estimate is checked against a simulation day by day (`tests/test_vol_regimes.py`). The rates ticket and the netting-set engine
(`ccr/exposure.py`: the credit page, the reserves, the incremental charge) still bridge between values, so a
margined digital-asset position is charged a little differently there and on its ticket. The validator's own
simulation (11 November 2026, her code, a Garman–Kohlhagen formula of her own) puts the forward's margin within
1.1 % date by date and a European call's within 1.6 %, at 80 % vol and both margin periods. Two approximations in the option's lag are the paths' own: in the step that ends on the expiry's grid date the time left runs to that date, where the paths fix the payoff, not to the expiry (they differ by a currency option's two days to settlement); and a barrier or a touch carries the knock state of the grid dates before t − δ and is then valued by a closed form that monitors continuously, so a path beyond the barrier at t − δ that has not knocked on the grid is valued as knocked, though about a third of those are back inside at the next grid date. Near the barrier that overstates the move (the validator, 11 November 2026: 9 % of paths at the second month of a six-month up-barrier at 115 % of spot and 80 % vol; valued at the barrier instead, the margin called moved 13 % at that date and 2 to 3 % later). It goes when the paths monitor between grid dates.
The option's lag has no Excel replication (the workbooks are a forward) and no row in the reference suite: its
evidence is the simulation in `tests/test_fx_xva_lag.py` (a forward and a European call; a digital, a barrier, a
touch and a surface are held only to the package and one-leg identities). **A margined CVA is small by construction:** exposure beyond the margin is the 1 % tail of the same model's
own move at the same percentile (on a six-month forward CVA falls from −71 uncollateralised to −0.24 bilateral),
so gap risk, jumps, a fatter tail than the model's and a margin call that is not met are not in it; the figure
says the margin covers the model's move, not that the counterparty risk is that small. A leg of a package that
settles is a payment, not a move: the value a margin period earlier is read on the set with the settled cash
still in it (`run_waterfall(settled=)`), so the margin and the collateral do not jump at a settlement. The answer names
which of the two it used (`capital.im_basis`) and carries the note (`capital.im_note`).

**The capital add-on of a currency or digital-asset ticket (10 November 2026)** is SA-CCR's for its asset class
(`pricing/fx_xva.capital_inputs`, `saccr_rows`; `pricing/sa_ccr.py`), read from the Basel text. A currency pair:
the foreign-exchange class, 4 % of the foreign leg's notional in the domestic currency at spot × the maturity
factor, one hedging set per pair (CRE52.35, CRE52.72). A Group 2a cryptoasset: SA-CCR with a cryptoasset class in
the FX class's structure, a hedging set per pair, supervisory factor 32 %, supervisory option volatility 120 %
(SCO60.98). A Group 2b cryptoasset: exposure = α × (RC + PFE) with the PFE 50 % of each transaction's gross
notional, no hedging set, no multiplier (SCO60.99). A forward enters at δ = ±1, an option at the supervisory delta
of its strike (CRE52.40); the legs of a package net inside the hedging set (a bought and a sold forward of the
same terms carry no add-on), except under Group 2b, where each trade's half-notional stands. A cryptoasset is
Group 2b unless the bank has shown its supervisor SCO60.55's hedging recognition criteria; the engine's default
is 2a for BTC and ETH and 2b otherwise, and `crypto_group` on the request (the Basel group selector on the tab)
sets it. Before this the engine applied the interest-rate factor (0.5 % × supervisory duration) to everything,
which made a digital asset's KVA a rounding. The answer says whose choice the group was (`capital.basis`: set by the desk, or the engine's default with the
condition the rule sets). Limits: a style whose size is a payout (a digital, a touch) enters
at its payout, which the rules do not name; a barrier enters at its vanilla delta; an option's maturity is its
settlement, a day or two after the last exercise date CRE52.31 names; the notional is in the quote currency of
the pair, as every figure of the ticket is, not converted to a bank's domestic currency; under Group 2b a leg's
add-on stops at the grid date before its exposure does when it settles between two dates; the counterparty's risk
weight is the ticket's input; the older CEM and internal-model choices are unchanged. **The book-level capital
report (`ccr/saccr_map.py`) has no Group 2b treatment yet:** it runs every digital asset in the cryptoasset class
(Group 2a), so SOL is charged differently there and on its ticket, and the report's notes say so.

## 7b. ColVA: what the variation margin is held in

The CSA says how much margin moves; the collateral schedule says what it is held in (`docs/collateral.md`). The
discounting and the cash rebate assume OIS, so every instrument enters as its *carry over OIS*: cash in the CSA
currency 0, a Treasury bill on the same curve 0, a tokenised money-market fund share about −10 bp, a payment
stablecoin that pays its holder nothing −OIS, a fixed-rate fund share its rate less the OIS one-year zero.

    ColVA = Σ_i ( VM_posted(t_i) · s_post + VM_held(t_i) · s_recv ) · Δt · P(0,t_i)

with VM_posted and VM_held the mean of the two sides of C (§2) at each step and s the carries of the posted and
received compositions. Posted margin in an asset earning more than OIS earns the excess; held margin in an asset
earning less than the OIS we rebate costs the shortfall. Cash on both sides is zero, so a cash ticket reads exactly
as before. The posted side's carry is also the MVA pickup (§7), over the part that is eligible as IM. The ticket's
SETTLEMENT & COLLATERAL block chooses the instruments (the counterparty's schedule by default); the Excel
replications carry the two carries as inputs and ColVA as a column.

## 8. What the on-chain CSA changes, quantified

Same trade, same model, three CSAs: uncollateralised, bilateral (10bd MPoR), on-chain (5bd MPoR, continuous VM, no threshold, no MTA). CVA falls with the residual exposure; MVA falls with √(5/10) on the IM; KVA falls through the smaller RC and MF. The ticket's XVA tab runs the on-chain comparison by default on every panel (rates, FX, digital assets): the same paths and the same collateral under atomic settlement, each adjustment side by side, and the saving in money and in bp of notional, upfront and running over the grid's annuity Σ DF·Δt (returned with the XVA block). The difference is the business case for confirming and margining on chain, in the counterparty's own numbers.

## 8b. Vol regimes of a digital asset (0.24.0)

A digital asset's daily returns are not draws from one bell curve: violent days come together and pass in two or
three days, and under that the whole level is higher for a couple of months and then lower. One vol reads the move
over a margin period too small. On a digital-asset ticket a day's vol is the ticket's × a fast state (calm or
stressed) × a slow state (low or high), two independent two-state Markov chains, each scaled so that its squared
multiplier averages one (`pricing/vol_regimes.py`). The regimes change the clock, not the law given the clock: over
a grid step the level is lognormal given the variance the step accumulated on the path (`U`, mean one), with the
same standard normals a run on one vol draws. So the level is still a martingale, the variance expected to any
date is the ticket's (today's value of a forward or an option does not change; an option on the paths is still
marked at the surface's vol, which for an option at the money is about 3.6 % above what the regime paths pay on average
one month from expiry, 1.2 % at six months and 0.4 % at two years), and an uncollateralised ticket moves little. What changes is the move over days and
weeks: and, less, the spread at one date, since an at-the-money exposure is lower when the variance is uncertain
than when it is fixed at the same average (uncollateralised CVA and FVA fall 1 to 3 % on tickets of a year or less).
The value a margin period earlier is the same bridge on the clock: the share of the step's variance before
the date takes the place of the share of its time.

Fitted by maximum likelihood (Hamilton's filter) to five years of public daily closes, by
`backend/scripts/calibrate_vol_regimes.py`, which prints the constants and the tails they imply against the
history's own and its sampling band. BTC: stressed 2.62 × calm, a stress of 2.0 days; high 1.80 × low, a high spell
of 54 days. Against one vol the fast chain raises the log-likelihood by 164 to 190 on the three assets and the slow
chain by 36 to 41 more for three parameters (in-sample; a regular chi-squared bar would be about 4, and the true bar
is higher because the slow chain is not identified at ratio 1, but not by that much). The 1st percentile of a ten-day log move: BTC −22.6 % (history −24.1 %,
whose band on resampling is −30.0 to −18.2; a Gaussian −19.8 %), ETH −31.1 % (−31.1 %; −26.8 %), SOL −42.4 %
(−44.6 %; −35.7 %).

Tried on the same closes and not kept: Merton's jumps by maximum likelihood (about 230 small jumps a year on BTC,
which average out, leaving the ten-day tail within a point of a Gaussian's), and the fast chain alone (its stress
is over in days; ten-day tail −21.3 % on BTC).

On a ticket (forwards of about a million of notional, 40,000 paths, against the same run on one vol):
uncollateralised, CVA and FVA fall by up to 3 % on tickets of a year or less (less than half a per cent at two
years) and the total moves by about 1 % or less; under a bilateral or an on-chain CSA the margin at the first
date rises 7 to 13 % (called 9 to 13 %, posted 7 to 11 %), MVA 2 to 10 % on BTC and ETH, CVA 15 to 45 % (on small
figures), KVA falls 4 to 13 % on BTC and ETH where the larger margin lowers the SA-CCR multiplier (SOL's, Group 2b
with no multiplier, does not move), and the total moves 1.5 to 6 % on BTC and ETH and within about 1 %
on SOL. `vol_regimes: false` in the request runs one vol, for comparison; the answer's `params.vol_regimes` says
what the regimes were. Limits: `docs/model_inventory.md`.

## 8e. The backtest: did the simulated level cover what the level did? (0.30.2)

`backend/scripts/backtest_exposure.py`, after the Basel Committee's *Sound practices for backtesting counterparty
credit risk models* (December 2010): forecast the distribution at a date, see where the realised move fell in it,
count how often it fell in the tails, over several horizons. On every day of five years of public daily closes
(BTC, ETH, SOL to 11 November 2026; the first 90 days are warm-up) the model is given a vol and asked for the 1st,
5th, 95th and 99th percentile of the log move over the next 5, 10, 14, 30 and 91 days; the move that followed is
counted as beyond each or not. Two models: one vol (a lognormal level), and the vol regimes of §8b, on the clock the
exposure paths use, drawn by the engine's own code. A forward's value is monotone in the level, so the level's
percentile is the trade's: the 14-day rows are the test of initial margin (the 99th percentile over the margin
period, each way) and the 95 % rows of the PFE the ticket draws.

Days overlap and the vol is itself an estimate, so a binomial band would be wrong. The same procedure is run on 500
histories simulated from the model itself (same length, warm-up and overlap); the band is where 95 % of those counts
fall. Run on histories of known law the band behaves as a 95 % band should (a model given its own histories is
outside it in 4 to 6 % of cells), and one vol given five-year histories the regimes made is caught in a tail at ten
days in about 6 histories of 10: five years is a short record for a 1st percentile (`tests/test_backtest_exposure.py`).

Share of days on which the 14-day move went beyond the model's percentile (in brackets the model's own band):

| | model | below 1 % | below 5 % | above 95 % | above 99 % |
|---|---|---|---|---|---|
| BTC | one vol | **2.55** (0.17–2.50) | 5.63 (2.73–8.36) | 6.62 (2.67–7.84) | **3.60** (0.20–2.38) |
| BTC | regimes | 1.10 (0.17–3.02) | 5.63 (3.19–8.91) | 6.67 (2.96–9.00) | 2.96 (0.17–2.96) |
| ETH | one vol | 2.03 (0.17–2.47) | 4.64 (2.73–8.36) | **7.89** (2.67–7.84) | 1.80 (0.20–2.38) |
| ETH | regimes | 1.45 (0.23–2.87) | 4.29 (2.87–8.88) | 7.95 (2.84–8.76) | 1.16 (0.26–2.90) |
| SOL | one vol | **2.55** (0.17–2.50) | 4.93 (2.73–8.42) | 7.72 (2.67–7.84) | **3.02** (0.17–2.41) |
| SOL | regimes | 1.51 (0.23–3.02) | 4.88 (2.90–9.41) | 8.13 (2.76–8.82) | 2.44 (0.23–2.93) |

In per cent of about 1,720 days each; bold is outside the band. Over all five horizons and four percentiles (60
cells): one vol is outside its band in 17, the regimes in 1 (BTC's 91-day move above the 95th percentile, 16.3 % of
days against a band that ends at 16.2 %: a coin that rose, forecast with the martingale's drift). A 95 % band leaves
about 3 of 60 outside when the model is true, and the cells are not independent.

Out of sample: the regimes refitted on the first three years (to 10 November 2024) and tested on the two after, 60
cells again: the regimes outside in none, and one vol outside in none either. Those two years were quieter, and 720
days cannot tell the two models apart; what the out-of-sample run shows is that parameters fitted earlier did not
fail later, not that they were needed.

What this is not. (1) The vol the model is given is the realised vol of the 90 days before: the history of the
implied vols a ticket carries is not held. (2) The up side is not as comfortable as the down side: BTC's 14-day
move went above the 99th percentile on 2.96 % of days, at the very edge of the band, and SOL's on 2.44 %; the model is
close to symmetric in logs and these coins' rallies were not. A margin called on a position that gains when the coin
rises reads low by that much against this history. (3) The band is wide because five years are short: at the 1st and
99th percentile it runs from about 0.2 to 3 %, so the test rejects a bad model, it does not certify a good one. (4)
It tests the level, not a portfolio: an option's exposure also depends on the vol the paths carry, which is not
backtested. (5) The engine's ten-business-day margin period is 10/250 of a year, 14.6 days on the regimes' 365-day
clock; the test's 14 days is a little short of it. (6) The in-sample run uses regimes fitted to the same five years.

## 8c. Fees (0.25.0)

A trade's fees (`terms.fees`, `backend/pricing/fees.py`: any number of known payments, each a type, PAY or RECEIVE, an
amount in the trade's currency and a date; an option's premium is one) are part of its value and of its exposure. At
every date on every path the run adds the value of the fees dated after it, from our side (+ received, − paid),
discounted on the flat zero the engine already uses along a path; today's value includes the fees still to come;
and the value a margin period earlier includes the fees dated after THAT time, so a fee paid inside a margin period
is a payment the collateral had not yet seen. A fee dated on a date or before it is paid; one dated on the valuation date is paid that day, so it is in the
ticket's value net of fees and not in a run. On all four runs
(`/api/xva/simulate`, `/currency`, `/currency-option`, `/currency-package`: `fees` in the request, `fees` in the
answer with their count, value today and value on the grid).

A fee we are owed is exposure until it is paid; a premium we still owe lowers ours and raises the counterparty's.
A known payment is not a risk: initial margin is the move about its mean and does not change. Checked exactly: a fee
received at settlement gives the same paths, margin and every XVA as the same forward struck lower by that amount
(`tests/test_fees.py`). Limits: one currency (the trade's); the rates run does not bridge a fee, so one paid inside
a margin period is read as paid evenly over the step; a fee dated after the trade's last date is in its value and
not in a simulated exposure beyond that date; the capital add-on does not see fees.

## Excel replication

`xva_rates` in the Methodology tab (`backend/methodology/xva_workbook.py`): the same simulation on a 2-year pay-fixed swap at 200 paths, with the engine's random draws as values (ENGINE mode reproduces every EE, ENE, PFE and XVA to rounding; the Checks sheet says so) or Excel's own draws (LIVE mode, with a Convergence sheet). Sheets: Model (the exact-fit step, the grid, α(t)), Calibration (the basket, the closed-form model vol per point, the objective and RMSE, an RMSE grid around the fit), Bonds, Normals, Paths, Exposure (CSA preset or your terms, the Brownian-bridge lag, collateral, residuals), Waterfall, Engine, Convergence. The grid and calibration dates are written as values on the engine's own day count (valuation + round(t·365), the instruments at 365.25), so every discount factor matches the engine to the day; evaluated with a spreadsheet engine, all 86 checks pass at 6e-13 relative in ENGINE mode.

`xva_fx` and `xva_crypto` (`backend/methodology/fx_xva_workbook.py`, one builder for both): the forward engine on a 6-month EURUSD forward (buy EUR 10m) and a 6-month BTCUSD NDF (buy 10 BTC), struck at the fair forward from the same parity formulas as the forward books, 200 paths with the engine's draws (ENGINE) or Excel's (LIVE). Sheets: Model (the forward, DF_q(T) and the quote zero from the curve, the monthly grid with DF_q(t,T) on the flat quote zero as the engine has it, V(0)), Calibration (the pair's surface as quoted; ATM, RR25 and BF25 interpolated to the forward's tenor and the Malz smile fixed point at K = F laid out iteration by iteration, exactly as `fx_vol.vol_at` does it; the engine's default, labelled, when the account has no surface for the pair), Normals, Paths (ΣZ, W, F_t, V), Exposure (the same presets and margin-period bridge; the move over the margin period per path, and the initial margin as its 99th percentile rise and fall about the mean, each way), Waterfall (the add-on of the pair's own class: 4 % for the currency pair, 32 % for the Group 2a digital asset, on the notional at spot), Engine, Convergence. Evaluated with a spreadsheet engine on 10 November 2026 after the margin and capital change, all 51 checks pass in each book and all 87 in the rates book, under every preset.
Since 0.24.0 the `xva_crypto` book also carries the engine's vol regimes: on its Normals sheet, the variance each step
accumulated on each path (U) and the share of it before the margin-period date for each preset (Ω), as the engine
drew them; the forward is built step by step on U and the bridge runs on Ω. Its 51 checks pass under every preset;
a margin period typed by hand keeps the preset's Ω. Its Paths sheet has Z, F_t and V (no ΣZ and W: the forward is built
from the step before). `xva_fx` is unchanged.

## Incremental XVA on the ticket

On a digital asset the two figures on the XVA tab are not like for like since 0.24.0: the stand-alone run has the
asset's vol regimes (§8b), and the incremental figure below is computed on the credit engine's paths, which carry one
vol per factor. A margined digital-asset trade's stand-alone margin and MVA are therefore a few per cent above what
the same trade adds on the credit engine's paths.

The number a desk quotes pre-trade is not the trade's stand-alone XVA but the change in the counterparty's
reserves: the netting set valued on the credit engine's risk-neutral paths with the trade and without it,
same paths (common random numbers, seed 7), difference per component. `POST /api/xva/incremental` takes
the ticket's booking body (`trade`: instrument, terms, legs; the legs are completed per currency
convention exactly as the booking route stores them) or a stored `trade_id` (the marginal effect of
removing it), runs `ccr.report.counterparty_report` twice with `exposure=False`, and returns `without`,
`with`, `incremental` (CVA, DVA, FVA, FBA, KVA, MVA, total; costs negative, benefits positive), the two EE
profiles on one date grid, the CSA from the counterparty record, the paths and months, and the notes. It
covers every product the exposure paths value: swaps, swaptions, caps and floors, FX and digital-asset
forwards and options. The XVA tab of every ticket shows it under the stand-alone number with the label
"the charge the desk would quote; the number above is the trade on its own"; a freshly booked or an opened
trade shows the marginal form. Limits stated in the engine's notes: vol held flat along the paths, the
risk-neutral measure's calibration, the CSA as recorded.

The stand-alone option XVA (`/api/xva/currency-option`, `pricing/fx_xva.option_xva`) gives an FX or
digital-asset option of any style the same tab as the forward: the spot is simulated lognormal (a digital asset's on the clock of its vol regimes, §8b, the option still marked at the surface's vol) at the option's
vol and, on every path, the option is valued with its closed form exactly as the credit engine values it
(`ccr/options.value_fx_option`): before expiry the holder's value with the time left, barriers and touches
carrying which paths have knocked (watched on the grid dates and between them since 0.30.0: `pricing/fx_xva.knocked_by`,
the Brownian bridge's crossing probability on each step's own variance; the credit engine still watches on its
dates alone), an American option as its European (a lower
bound); at and after expiry the payoff fixed at the expiry grid point and discounted to settlement. A bought
option's exposure is one-sided after the premium (CVA, no DVA); a sold one the reverse. The ticket draws the
simulated paths behind EE, ENE and PFE, and the on-chain comparison runs the same paths under atomic settlement.

**A package of legs as one netting set** (`/api/xva/currency-package`, `pricing/fx_xva.package_xva`; 10 November
2026). A ticket with further legs on its DETAILS tab (a strip, a collar, a forward with an option) is run as one
set: the body of every leg goes in `trades`, each is read exactly as its own route reads it, and all are valued
on one grid (to the longest settlement: weekly when that is a year or less, monthly beyond, §8d) and one driver. Every forward of the pair is its own forward
today times the same driftless lognormal M_t (one factor, carry deterministic), so each leg starts at its own
price and the legs move together; a forward leg is marked ±N·(F_i·M_t − K)·DF, an option leg is valued in its
style's closed form as on its own. A leg stays to the first grid date at or after its settlement, where it is
its settled amount, and is nothing after: a settlement between two grid dates is carried up to one step longer,
never dropped. The summed paths go through the same
waterfall, so exposure nets path by path before any charge is taken. The driver's vol is the surface's ATM term
structure (each option at the smile of each path's moneyness), or in flat mode the longest leg's vol with each
option at its own. Initial margin is the desk's amount or the engine's estimate from the package's own paths, so
it follows the legs as they settle: a calendar spread posts little while both legs stand and the far leg's margin
once the near one has settled. The capital add-on is SA-CCR's on the legs together (below): inside one hedging
set a bought and a sold forward of the same terms carry none; under the older CEM choice each leg's add-on is
added while it is alive. One run takes up to 24 legs, settlements up to ten years out, and
legs × paths × steps up to four million (the route says how many paths fit; the steps are the run's own, so a
year of weekly steps lets 24 legs run at 3,200 paths and seven legs at 10,000).
A package of one leg is that leg's own run, draw for draw (`tests/test_package_xva.py`). The answer has the shape
of the single-trade routes plus a row per leg (its value, when it settles, its own peak expected exposure), which
the tab shows as what netting is worth. `POST /api/xva/incremental` takes the same `trades` list, so the charge
in the counterparty's netting set is the package's. Limits: one pair per package; the legs share one factor, so
a calendar spread's exposure to the SHAPE of the forward curve or of the vol term structure moving is not
simulated; an expiry or a settlement between two grid dates is read at the later one, so a leg can stand up to
a month longer than its contract (on its own grid a leg's settlement is the last date).

**Wrong-way risk** (`pricing/xva_engine.path_survival`, 10 November 2026). On a currency or digital-asset
ticket a party's default can be tied to the asset. In the manner of Hull and White ("CVA and Wrong-Way Risk",
Financial Analysts Journal 68(5), 2012): an intensity that is a function of a simulated variable, with a
time-dependent level calibrated to the credit curve. The variable (the asset against its forward, not the
value of the portfolio) and the functional form (exponential) are this engine's, so the direction is the desk's
input and is not derived from the trade. The default intensity on path p at grid date i is
h_i(p) = c_i · (asset / its forward)^b = c_i · exp(b · ln M_i(p)), and survival is
q_i(p) = q_{i−1}(p) · exp(−h_i(p) · Δt). c_i is solved date by date (Newton) so that the MEAN survival across
paths is the credit curve's at that date: the curve is repriced exactly, and b only moves default probability
between paths. The variable is the trade's own driver, the asset's forward to the trade's settlement against
that forward today; for an option with carry it is not the spot against its forward at each date (the two
differ by a deterministic factor and agree at settlement). The intensity of a step is read at the END of the
step, the date of that step's exposure. CVA is then LGD · Σ_i E[exposure_i(p) · (q_{i−1}(p) − q_i(p))] · DF_i, with the exposure after
collateral and margin as before; DVA likewise with our own default. The desk's input is not b but its meaning:
the multiple the intensity takes when the asset halves against its forward (`cp_hazard_if_halves`,
`own_hazard_if_halves`; b = −log2 of it; 1 = independent, the default, which is the calculation before this
existed, number for number). A counterparty that is long the asset worsens as it falls: being owed when it has
fallen (a sold forward, a bought put) is the wrong way and CVA rises; being owed when it has risen is the right
way and it falls. The answer carries `wwr`: the two inputs and CVA and DVA as they would be with independence, and
the tab shows both. Checked in `tests/test_wrong_way_risk.py`: the mean survival equals the curve at every date;
on two states the solved intensities satisfy the definition; the Monte Carlo agrees with a Gauss–Hermite
quadrature of the same definition that shares no code with it (bought and sold, three multiples, within 2 % at
40,000 paths); with the link off every component is unchanged. These check the code against its own definition.
The one outside figure so far: the validator's own simulation (4 million paths, another generator, another
root-finder) of a sold and a bought three-month forward at × 3 and independent, each within 1 % of the engine at
20,000 paths, inside its sampling error. Limits: the multiple is the desk's judgement, not calibrated to anything (a
crypto counterparty has no traded credit curve to regress on); one link per party for the whole life; the link
is to the asset of the ticket only; funding, capital and margin terms do not see it; the netting-set charge
(`/api/xva/incremental`, the credit engine) does not model it yet; a rates ticket keeps the multiplier
(`wwr_multiplier`), which currency tickets no longer show and the currency routes refuse together with a link
(one or the other: a multiplier on top of a modelled link would count the effect twice).

**Vol along the paths.** Both stand-alone engines and the credit engine use the surface, not one number held:
the spot steps with the piecewise forward vols of the pair's ATM term structure (`fx_vol.step_vols`), so its
log-variance at every grid date is the surface's ATM variance there; an option is valued at each date at the
forward vol for its remaining life with the quoted risk reversal and butterfly at the remaining tenor, read at
the delta of the path's own forward against the strike (`fx_vol.path_vols`, sticky-delta); paths are valued in
eight vol buckets. The ticket's VOL switch chooses SURFACE (the default) or FLAT, the one-vol case the Excel
books `xva_fx` and `xva_crypto` replicate. Vol of vol is not modelled; a stochastic-vol model is on the roadmap
behind its own validation gate. A pair without a surface uses the demo default, and the run says so.

## Parameters and defaults

CDS: counterparty 85bp, own 42bp (flat, or a term curve); LGD 40 % both sides; ftp 55bp; fba_ratio 0.55; hurdle 12 %; capital model SA-CCR; counterparty risk weight 100 %; WWR 1. Monthly grid for a swap; for a currency or digital-asset ticket weekly to a year and monthly beyond (§8d); `n_paths` from the ticket (2000 default).

## Limits, stated

- One factor for rates (HW1F) and a flat vol for forwards: no smile in the exposure.
- A digital asset's simulated level is backtested against five years of closes (§8e): the regimes are inside their bands, one vol is not; the vol in that test is realised, not the implied vol a ticket carries; the up side sits at the edge of its band on BTC and SOL; five years cannot certify a 1st percentile.
- CVA and DVA use the credit triangle with a flat LGD; no recovery uncertainty, no correlation between credit and market beyond the WWR multiplier.
- Initial margin is the desk's amount or the engine's estimate at current volatility (above); ISDA SIMM is licensed and is not implemented.
- KVA's SA-CCR add-on is by asset class since 4 November 2026 (`pricing/sa_ccr.py`: rates, FX, the cryptoasset class, options at their supervisory delta); the CVA-capital leg and the collateral regimes are described in `docs/capital.md`.
