# Rijeka — Exotic Options Roadmap
*Private & Confidential. Do not commit to GitHub.*
*To be incorporated into ARCHITECTURE_v16.md*

## Current Options Coverage (Sprint 3E-3F)

### RATES
- IR_SWAPTION (European)
- BERMUDAN_SWAPTION
- INTEREST_RATE_CAP
- INTEREST_RATE_FLOOR
- INTEREST_RATE_COLLAR
- CALLABLE_SWAP (Bermudan/European cancel right)
- CANCELLABLE_SWAP (same, different party)
- CAPPED_SWAP / FLOORED_SWAP / COLLARED_SWAP (embedded optionality on float leg)

### FX
- FX_OPTION (vanilla, barrier, digital)
- FX_DIGITAL_OPTION
- EXTENDABLE_FORWARD

### EQUITY
- EQUITY_OPTION (European/American, single name/index)

### CREDIT
- CDS_OPTION (payer/receiver, knockout)

### COMMODITY
- COMMODITY_OPTION (vanilla)
- COMMODITY_ASIAN_OPTION (full period, partial, bullet, custom schedule)

---

## Exotic Options To Add (Future Sprints)

### RATES (priority order)
1. INFLATION_CAP_FLOOR — cap/floor on CPI/RPI/HICP index. Increasingly common for LDI.
2. CMS_CAP_FLOOR — cap/floor on a CMS rate (e.g. 10Y swap rate).
3. SPREAD_OPTION — option on the spread between two rates (10Y-2Y, LIBOR-OIS, etc.)
4. BOND_OPTION — option to buy/sell a bond at a fixed price. European or American.
5. MIDCURVE_SWAPTION — swaption that starts in the future (e.g. 1Yx5Y = exercise in 1Y into 5Y swap)

### FX (priority order)
1. FX_ASIAN_OPTION — payoff based on average spot over observation period. Heavy EM/commodity use.
2. FX_BARRIER_WINDOW — barrier only active during a specific observation window (vs continuous).
3. FX_DOUBLE_BARRIER — two simultaneous barriers (e.g. up-and-out + down-and-out). Common in EM.
4. FX_COMPOUND_OPTION — option on an option (call on call, etc.). Rare but exists.
5. FX_ONE_TOUCH — pays fixed payout if spot touches barrier any time before expiry.
6. FX_NO_TOUCH — pays fixed payout if spot NEVER touches barrier before expiry.
7. FX_ACCUMULATOR — daily knock-in/out with obligated forward purchases. Heavy in EM corporate.
8. NDF_OPTION — option on a non-deliverable forward. Same as FX_OPTION but NDF settlement.
9. CROSS_CURRENCY_OPTION — option on a XCCY basis spread.
10. FX_BEST_OF / FX_WORST_OF — basket options on multiple FX pairs.
11. POWER_REVERSE_DUAL_CURRENCY — structured product, FX + rates, common in Japan.

### EQUITY (priority order)
1. VARIANCE_SWAP_OPTION — option on realised variance. Exotic vol desk product.
2. DISPERSION_TRADE — short index vol, long single-stock vol (structured basket).
3. LOOKBACK_OPTION — payoff based on best or worst price over period.
4. BARRIER_EQUITY_OPTION — knock-in/knock-out equity option.
5. ASIAN_EQUITY_OPTION — average price equity option.
6. CLIQUET_OPTION — series of at-the-money options, reset periodically. Insurance/pension use.
7. OUTPERFORMANCE_OPTION — option on relative performance of two equities/indices.

### CREDIT (priority order)
1. FIRST_TO_DEFAULT_OPTION — option contingent on first default in a basket.
2. NTH_TO_DEFAULT — option on Nth default in basket.
3. CREDIT_SPREAD_OPTION — option on credit spread, not CDS spread.
4. CLN_OPTION — option embedded in a credit-linked note.

### COMMODITY (priority order)
1. SPREAD_OPTION (commodity) — option on crack spread, spark spread, dark spread, etc.
2. SWAPTION_COMMODITY — option to enter a commodity swap.
3. SWING_OPTION — right to take/deliver variable quantities at fixed price. Gas/power markets.
4. TOLLING_AGREEMENT — option to use power plant capacity. Power desks.
5. WEATHER_DERIVATIVE — option on temperature, rainfall, wind. HDD/CDD indices.
6. FREIGHT_OPTION — option on freight rates (FFAs). Shipping desks.

### RATES — STRUCTURED PRODUCTS (longer term)
1. RANGE_ACCRUAL — fixed rate paid only for days when float rate is within a range.
2. TARGET_REDEMPTION_NOTE (TARN) — terminates when cumulative coupon target reached.
3. POWER_SWAP — payoff is a power function of the floating rate.
4. CORRIDOR_SWAP — combination of two caps/floors creating a corridor payoff.
5. SNOWBALL — coupon depends on previous period's coupon. Path-dependent.
6. STEEPENER / FLATTENER — structured bet on yield curve shape. CMS spread options.

---

## Architecture Decision: Where These Live in Rijeka

All exotics follow the same pattern as current options:
- Leg type added to trade_legs_leg_type_check CHECK constraint (SQL migration)
- Leg type added to VALID_LEG_TYPES in trade_legs.py (backend)
- LD default + TEMPLATE + Form component + LegForm case added to NewTradeWorkspace.jsx
- Pricing: initially STUB (show terms, no NPV), full pricer added in later sprint

Exotic pricer models (Sprint 7+):
- Black-Scholes for vanilla options
- Bachelier for negative rates
- SABR for smile-aware IR options
- Local vol / stochastic vol for barrier/path-dependent
- Monte Carlo for path-dependent (Asian, barrier window, accumulator)
- Hull-White trinomial for Bermudan/callable

---

*Last updated: Sprint 3F — March 2026*
*Next exotic sprint: Sprint 7 (after Sprint 6 regulatory/billing)*
