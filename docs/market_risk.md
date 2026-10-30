# Market risk: ladder, VaR, stress, limits

Engine: `backend/risk/`; page: `RISK` next to P&L; settings and limits under `Configurations › Market Risk`.

## The ladder

For every live trade and every curve it is valued on, each tenor bucket's quotes are bumped +1bp and the trade is repriced on the as-of market through the production pricers. The result is key-rate IR01 by (curve, bucket); the buckets (0-1Y, 1-5Y, 5-10Y, 10Y+) are the same the P&L explain uses, so a day's rates P&L and the ladder speak the same language. Spot deltas (FX01, BTC01) are the pricers' PV for +1 % spot. Totals are in the reporting currency at the close.

## VaR: historical simulation by full revaluation

Risk factors are the curve quotes (par rates, in basis points, tenor by tenor) and the spots (log returns). For every historical day *i* in the window, today's market is shifted by that day's observed changes and every live trade is repriced on it through the production pricers:

    P&L_i = Σ_trade [ NPV(trade, M + Δ_i) − NPV(trade, M) ] · fx

VaR at confidence *q* is the empirical *q*-quantile of the losses; expected shortfall is the mean loss beyond it; the horizon scales by √h. Only days on which every factor the book is exposed to has an observation are used; factors with no history are listed on the page, not dropped quietly. A tenor without its own history that day takes the average change of its bucket. The bootstrapped curves are cached per shifted market, so a day costs one bootstrap per curve and one valuation per trade; beyond a budget of valuations (60,000 per report) the full revaluation is skipped and the ladder VaR reported, with a note.

The ladder VaR is computed alongside as the linear comparison:

    P&L_i = Σ_curve Σ_bucket KR01[c,b] · Δ_i[c,b]  +  Σ_asset spot01[a] · r_i[a]

The difference between the two is the convexity and the inside-bucket curve shape that the ladder cannot see. The firm chooses the headline method (Configurations › Market Risk › VaR settings): full revaluation by default, the ladder when speed matters more.

Parameters (the firm's, set by the risk manager): confidence (0.99), secondary confidence (0.95), horizon (1 day), window (730 days), minimum observations (60; below it the page says the number is not meaningful).

## History

Risk-factor history comes from the public sources the demo already prices on: Treasury par yields and NY Fed SOFR; ECB €STR and the AAA par curve; Bank of England SONIA and gilt yields; ECB reference FX rates; Coinbase daily closes. Each day's curve is built with the same spread schedules as the live demo curve and stored as the template account's snapshot, so the daily rebuild simply extends the series. `risk-backfill.yml` fetches two years on dispatch.

## Stress

Named scenarios by full revaluation: every live trade is repriced on the shifted market and the P&L is the difference. Rates scenarios shift quotes in basis points, parallel or by tenor bucket; FX scenarios move the non-USD asset by a percentage (a USD-first quote such as USDJPY moves the other way); digital assets likewise. The catalogue: parallel ±25 and ±100bp, steepener and flattener (±25 short against long), USD ±10 %, digital assets ±30 %, and a combined risk-off (rates −50, USD +5 %, digital assets −30 %).

## Limits

A limit names a metric, a scope and a value. Metrics: `VAR_99_1D`, `VAR_95_1D`, `ES_99_1D`, `VAR_H`; `IR01`, `IR01:<curve>`, `KR01:<curve>:<bucket>`; `SPOT01:<asset>`; `NPV`; `STRESS:<scenario>`. Scope: the book total, a desk or a book (VaR, ES and stress are book-level in this foundation). Utilisation is |value| / limit; a warning at the configured level, a breach at 100 %. Limits are the firm's, set by the `risk` or `admin` role or a firm admin, and are evaluated on every member's book; breaches reach the home inbox after the daily run.

## Backtesting

Every stored P&L date is paired with the VaR that was standing the evening before (the latest stored risk report dated before it). An exception is a day whose loss exceeded that VaR. Three P&L measures can be tested: **clean** (the market P&L of the positions held at the previous close, which is what the VaR claims to cover), **hypothetical** (clean without carry) and **dirty** (everything, trading included). Over the window the exception count is read two ways:

- the Basel traffic light: the cumulative binomial probability of that many exceptions or fewer at the stated confidence, green below 95 %, yellow to 99.99 %, red beyond, which at 250 days and 99 % is the familiar 0-4 / 5-9 / 10+;
- Kupiec's proportion-of-failures test: LR = −2 ln[(1−p)^(n−x) p^x] + 2 ln[(1−x/n)^(n−x) (x/n)^x] against a chi-square with one degree of freedom, two-sided, so far too few exceptions is also a finding.

The 95 % VaR and the ladder VaR are backtested alongside the headline. Nothing new is stored; the test reads the two daily series (`pnl_daily`, `risk_daily`) and needs sixty paired days before it says anything and 250 to be read the usual way. `GET /api/risk/backtest?measure=clean&days=250`.

## Roadmap for VaR

- Parametric (variance-covariance) VaR from the factor covariance, with the same ladder; a cross-check, not a replacement.
- Monte Carlo VaR on the calibrated HW1F and lognormal spot models the XVA engine already uses.
- Filtered historical simulation (EWMA / GARCH volatility scaling) so a calm window does not understate a stressed present.
- Stressed VaR on a chosen crisis window, and expected shortfall at 97.5 % with liquidity horizons in the FRTB sense.
- Vega and the vol surfaces as risk factors.
