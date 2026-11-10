# XVA: every component, as the engine computes it

Engine: `backend/pricing/xva_engine.py` (`run_waterfall`), collateral model `backend/pricing/csa.py`, rates exposure from the HW1F Monte Carlo (`xva.py`), FX and digital-asset exposure from a lognormal forward (`fx_xva.py`). Signs follow the desk convention: costs negative, benefits positive, and

    ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA.

## 1. Exposure paths

Rates: Monte Carlo MtM paths V(t) of the trade under a Hull-White one-factor model calibrated to the swaption surface, on a monthly grid to maturity; `n_paths` paths. FX and digital assets: V(t) = ±N·(F_t − K)·DF_q(t,T) with F_t lognormal at a flat vol σ under the T-forward measure (driftless), σ a desk input per pair (no public vol surface, said so on the ticket). Both hand the same shape to the waterfall: paths from our side (positive = the counterparty owes us), V(0), and the discount factors P(0, t_k).

## 2. Collateral: the CSA turns V into a residual exposure

Variation margin held against the lagged MtM, from our side (+ = we hold theirs):

    C(t) = max(V(t−δ) − TH_cp, 0) − max(−V(t−δ) − TH_own, 0),   zeroed when |C| < MTA

δ is the margin period of risk in years (mpor_days / 250); V(t−δ) is taken on the path by a Brownian bridge between grid points. Initial margin is exchanged symmetrically and amortises with residual maturity: IM(t) = IM₀ · (M − t)/M. The residuals are

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
    KVA  = − hurdle · Σ_i K(t_i) · Δt · P(0,t_i)

## 7. MVA

Initial margin posted is funded at the funding spread less whatever the collateral earns:

    IM_post(t_i) = max( q₀.₉₉( mean(Δ_i) − Δ_i ), 0 ),   IM_recv(t_i) = max( q₀.₉₉( Δ_i − mean(Δ_i) ), 0 ),   Δ_i = V(t_i) − V(t_i − δ)
    MVA = − Σ_i IM_post(t_i) · max(ftp(t_i) − pickup, 0) · Δt · P(0,t_i)

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
regulatory figure (about half of a SIMM-weighted figure on the pinned 5-year swap); it is a cross-section of the
paths at each date, not a margin recomputed on each path; one confidence for every asset class. The answer names
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
which made a digital asset's KVA a rounding. Limits: a style whose size is a payout (a digital, a touch) enters
at its payout, which the rules do not name; a barrier enters at its vanilla delta; the counterparty's risk weight
is the ticket's input; the older CEM and internal-model choices are unchanged.

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

## Excel replication

`xva_rates` in the Methodology tab (`backend/methodology/xva_workbook.py`): the same simulation on a 2-year pay-fixed swap at 200 paths, with the engine's random draws as values (ENGINE mode reproduces every EE, ENE, PFE and XVA to rounding; the Checks sheet says so) or Excel's own draws (LIVE mode, with a Convergence sheet). Sheets: Model (the exact-fit step, the grid, α(t)), Calibration (the basket, the closed-form model vol per point, the objective and RMSE, an RMSE grid around the fit), Bonds, Normals, Paths, Exposure (CSA preset or your terms, the Brownian-bridge lag, collateral, residuals), Waterfall, Engine, Convergence. The grid and calibration dates are written as values on the engine's own day count (valuation + round(t·365), the instruments at 365.25), so every discount factor matches the engine to the day; evaluated with a spreadsheet engine, all 86 checks pass at 6e-13 relative in ENGINE mode.

`xva_fx` and `xva_crypto` (`backend/methodology/fx_xva_workbook.py`, one builder for both): the forward engine on a 6-month EURUSD forward (buy EUR 10m) and a 6-month BTCUSD NDF (buy 10 BTC), struck at the fair forward from the same parity formulas as the forward books, 200 paths with the engine's draws (ENGINE) or Excel's (LIVE). Sheets: Model (the forward, DF_q(T) and the quote zero from the curve, the monthly grid with DF_q(t,T) on the flat quote zero as the engine has it, V(0)), Calibration (the pair's surface as quoted; ATM, RR25 and BF25 interpolated to the forward's tenor and the Malz smile fixed point at K = F laid out iteration by iteration, exactly as `fx_vol.vol_at` does it; the engine's default, labelled, when the account has no surface for the pair), Normals, Paths (ΣZ, W, F_t, V), Exposure (the same presets and margin-period bridge; the move over the margin period per path, and the initial margin as its 99th percentile rise and fall about the mean, each way), Waterfall (the add-on of the pair's own class: 4 % for the currency pair, 32 % for the Group 2a digital asset, on the notional at spot), Engine, Convergence. Evaluated with a spreadsheet engine on 10 November 2026 after the margin and capital change, all 51 checks pass in each book and all 87 in the rates book, under every preset.

## Incremental XVA on the ticket

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
digital-asset option of any style the same tab as the forward: the spot is simulated lognormal at the option's
vol and, on every path, the option is valued with its closed form exactly as the credit engine values it
(`ccr/options.value_fx_option`): before expiry the holder's value with the time left, barriers and touches
carrying which paths have knocked (monitored at the grid points), an American option as its European (a lower
bound); at and after expiry the payoff fixed at the expiry grid point and discounted to settlement. A bought
option's exposure is one-sided after the premium (CVA, no DVA); a sold one the reverse. The ticket draws the
simulated paths behind EE, ENE and PFE, and the on-chain comparison runs the same paths under atomic settlement.

**A package of legs as one netting set** (`/api/xva/currency-package`, `pricing/fx_xva.package_xva`; 10 November
2026). A ticket with further legs on its DETAILS tab (a strip, a collar, a forward with an option) is run as one
set: the body of every leg goes in `trades`, each is read exactly as its own route reads it, and all are valued
on one grid (monthly to the longest settlement) and one driver. Every forward of the pair is its own forward
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
legs × paths × monthly steps up to four million (the route says how many paths fit).
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

CDS: counterparty 85bp, own 42bp (flat, or a term curve); LGD 40 % both sides; ftp 55bp; fba_ratio 0.55; hurdle 12 %; capital model SA-CCR; counterparty risk weight 100 %; WWR 1. Monthly grid; `n_paths` from the ticket (2000 default).

## Limits, stated

- One factor for rates (HW1F) and a flat vol for forwards: no smile in the exposure.
- CVA and DVA use the credit triangle with a flat LGD; no recovery uncertainty, no correlation between credit and market beyond the WWR multiplier.
- Initial margin is the desk's amount or the engine's estimate at current volatility (above); ISDA SIMM is licensed and is not implemented.
- KVA's SA-CCR add-on is by asset class since 4 November 2026 (`pricing/sa_ccr.py`: rates, FX, the cryptoasset class, options at their supervisory delta); the CVA-capital leg and the collateral regimes are described in `docs/capital.md`.
