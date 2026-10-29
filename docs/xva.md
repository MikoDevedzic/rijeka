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

Presets: UNCOLLATERALISED (no VM, no IM); BILATERAL (daily VM, 10 business-day MPoR, SIMM IM, thresholds and MTA from the request); ON_CHAIN (continuous VM, zero threshold and MTA, 5 business-day MPoR, SIMM IM scaled √(5/10)). The CSA is the single object that distinguishes the three; everything below is a function of E⁺, E⁻ and δ.

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

    IM₀ = RW_SIMM(tenor) · √(MPoR/10) · |IR01|          (rates; FX: SIMM FX delta weight · |FX01|; digital assets: an assumed weight, labelled)
    MVA = − Σ_i IM(t_i) · max(ftp(t_i) − pickup, 0) · Δt · P(0,t_i)

The SIMM weights are calibrated to a 10-business-day MPoR; the √(MPoR/10) scaling is the ISDA/BCBS-IOSCO rule for a different one, which is how the on-chain CSA's 5-day MPoR reduces IM.

## 8. What the on-chain CSA changes, quantified

Same trade, same model, three CSAs: uncollateralised, bilateral (10bd MPoR), on-chain (5bd MPoR, continuous VM, no threshold, no MTA). CVA falls with the residual exposure; MVA falls with √(5/10) on the IM; KVA falls through the smaller RC and MF. The ticket's XVA tab shows all three side by side; the difference is the business case for confirming and margining on chain, in the counterparty's own numbers.

## Parameters and defaults

CDS: counterparty 85bp, own 42bp (flat, or a term curve); LGD 40 % both sides; ftp 55bp; fba_ratio 0.55; hurdle 12 %; capital model SA-CCR; counterparty risk weight 100 %; WWR 1. Monthly grid; `n_paths` from the ticket (2000 default).

## Limits, stated

- One factor for rates (HW1F) and a flat vol for forwards: no smile in the exposure.
- CVA and DVA use the credit triangle with a flat LGD; no recovery uncertainty, no correlation between credit and market beyond the WWR multiplier.
- IM amortises linearly with residual maturity; a full SIMM IM profile along the path is on the roadmap.
- KVA uses supervisory add-ons for interest rate only; FX and digital-asset add-ons follow.
