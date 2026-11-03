// ROADMAP — what is built, what is being built, what comes next. Honest statuses only.
import './Docs.css'

const PHASES = [
  { title: 'PHASE 1 · RATES', status: 'LIVE', items: [
    ['DONE', 'OIS bootstrap, IRS / OIS / basis pricing, cashflows, IR01'],
    ['DONE', 'European swaptions and caps/floors (Bachelier), SABR β=0 surface, Bermudans (HW1F trinomial)'],
    ['DONE', 'XVA Monte Carlo on HW1F calibrated to the surface; CSA presets with margin period of risk; SIMM IM'],
    ['DONE', 'On-chain bilateral confirmation: canonical record v2 → EIP-712 → registry on Sepolia; amend and terminate; public verifier'],
    ['DONE', 'Messenger: firms, rooms, trade cards, wallet countersigning; Telegram mirror; Market News room'],
    ['DONE', 'Hosted demo: sandbox workspace on sign-in, demo counterparty, Excel methodology replications'],
    ['DONE', 'Open-box replications: every workbook with a cover and verdict, the ticket rebuilt in cells with links into the maths, a derivation ledger, a scenario chart and a Checks sheet; SHOW MATH on the ticket annotates each number with its formula'],
    ['DONE', 'XVA replication for rates: the Hull-White Monte Carlo rebuilt in cells from the engine\'s own draws (or re-rolled live), the swaption calibration with an RMSE grid around the fit, the CSA and margin-period bridge, the full waterfall, a convergence sheet'],
    ['NOW',  'Go-live of the hosted demo (app.rijeka.app) and the first recorded walkthrough'],
    ['NEXT', 'Shared market-data feed with a factor-model simulator so curves move; P&L and XVA tick on the desk'],
    ['NEXT', 'House dealer: Rijeka quotes mid ± spread so a solo learner always has a counterparty (paper only)'],
    ['NEXT', 'Cohorts and labs for classrooms and graduate programmes: paired firms, limits, a leaderboard'],
  ]},
  { title: 'DESK MODULES', status: 'PARTIAL', items: [
    ['DONE', 'Scenario P&L attribution per trade: theta, IR01, IR01_DISC, gamma, vega, carry, roll-down, unexplained (never absorbed)'],
    ['DONE', 'P&L tab: day, MTD and YTD split market vs trading; attribution by sequential full revaluation (carry, cash, curves by tenor bucket, spot, points, residual); roll-up desk → book → trade; trader and controller sign-off; management view'],
    ['DONE', 'P&L: a VOL step for every surface a trade is valued on (FX option surfaces by tenor bucket, the swaption ATM grid by expiry), after spot and points, before the residual'],
    ['NEXT', 'P&L: cap vol as a step, amendment effects separated, IPV tolerances, a published PDF report per signed day'],
    ['NEXT', 'IPV: independent price verification of the book against an external snapshot, with tolerances and a sign-off trail'],
    ['DONE', 'Greeks and bump-and-reprice ladders; exposure profiles (EE, ENE, PFE) and SA-CCR EAD inside the XVA module'],
    ['DONE', 'CAPITAL tab on every ticket: SIMM IM, SA-CCR EAD by asset class (CRE52, SCO60.98), RWA, CCR and CVA capital (MAR50), KVA, MVA, leverage exposure and HQLA under collateral regimes (cash and government securities, stablecoin, tokenised fund shares, tokenised sovereign) and counterparty types; the Basel worked examples as the reference suite'],
    ['DONE', 'Risk → CAPITAL: the book under collateral regimes, every netting set re-collateralised channel by channel from the CSA as booked to on-chain under current rules and to the forward states, the attribution per step with its paragraph, the invariants stated'],
    ['NEXT', 'Capital next: FRTB sensitivities-based market-risk capital from the ladder, SIMM across risk classes with incremental IM and netting-set consolidation, a CSV import for a client book, an Excel replication'],
    ['DONE', 'MARKET RISK tab: key-rate IR01 ladder by bump-and-reprice, historical-simulation VaR by full revaluation (every trade repriced on each of two years of observed days, the ladder VaR alongside as the linear comparison), named stress by full revaluation, limits on any reported number with utilisation and breaches'],
    ['DONE', 'VaR backtesting: yesterday\'s VaR against today\'s clean, hypothetical or dirty P&L; exceptions, the Basel traffic light from the binomial, Kupiec\'s test; the 95% and ladder VaR alongside'],
    ['DONE', 'VaR: volatility surfaces as risk factors (every quote of an FX surface, the swaption grid point by point, repriced in full; a surface is secondary to the curves and spots and the page says its coverage); VOL stress scenarios; the ladder VaR carries vega; the demo\'s surfaces scaled day by day by realised vol, labelled'],
    ['NEXT', 'VaR family: parametric (variance-covariance), Monte Carlo on the XVA models, filtered historical (EWMA/GARCH), stressed VaR, FRTB expected shortfall with liquidity horizons; the smile\'s own moves on the ladder VaR'],
    ['NEXT', 'FRTB sensitivities-based capital from the same ladder'],
    ['NEXT', 'COLLATERAL tab: CSA terms per counterparty, daily VM and IM calls, disputes, settlement status, collateral inventory'],
    ['DONE', 'COUNTERPARTY CREDIT tab: netting sets on shared paths, real-world calibration from public history (two measures), CSA on the netted value, EE/EPE/PFE 95/97.5/99, CVA, credit limits with utilisation, stored daily run'],
    ['DONE', 'Counterparty credit: historical simulation of the exposure paths (blocks of observed daily changes, the same block for every factor) as the default real-world measure, Gaussian shocks as the alternative, chosen per firm'],
    ['DONE', 'Counterparty credit: caps, floors and European swaptions valued on the exposure paths (Bachelier on the path forward, today\'s ATM vol held flat, physical settlement at expiry)'],
    ['NEXT', 'Counterparty credit next: per-counterparty CDS and LGD, wrong-way risk, stressed EEPE, vol dynamics along the paths'],
  ]},
  { title: 'OPERATIONS AND CONTROL', status: 'PARTIAL', items: [
    ['DONE', 'Trade lifecycle events with pre/post state; cashflow generation; confirmation, amendment and termination on chain'],
    ['NEXT', 'Fixings and payments: public SOFR/€STR/SONIA ingestion, rate resets, payment calendar, settlement instructions'],
    ['NEXT', 'Portfolio reconciliation with counterparties: positions and valuations, breaks and ageing — the on-chain record makes this cheap'],
    ['NEXT', 'Regulatory reporting: UTI/UPI generation, EMIR and CFTC trade reports, margin and valuation reporting'],
    ['NEXT', 'Limits and pre-trade checks: notional, tenor, counterparty and product limits enforced at booking'],
    ['NEXT', 'Model governance: model inventory, validation status per product, change log, approval workflow'],
    ['NEXT', 'Entitlements and audit: roles per firm, four-eyes on sensitive actions, immutable audit trail'],
    ['PARTIAL', 'End-of-day batch: daily marks and attributed P&L rows stored per account; P&L sign-off. Next: official close, archived snapshots and reports'],
    ['NEXT', 'Public API and Python SDK with the same contracts the UI uses'],
  ]},
  { title: 'FX & DIGITAL ASSETS', status: 'LIVE', items: [
    ['DONE', 'FX spot, forwards and NDFs on G10 pairs and non-deliverable forwards on BTC, ETH and SOL on one interest-rate-parity model, each currency on its own curve, a digital asset at its funding rate; public spot feeds; one FX · CRYPTO page; booked and confirmed on chain in the ISDA Digital Asset Derivatives Definitions\' vocabulary; Excel replications for the EURUSD forward and the crypto NDF with the engine\'s NPV, FX01 / CRY01, IR01 and FUND01'],
    ['DONE', 'Digital-asset options on BTC, ETH and SOL: European, American, digital, barrier, double barrier and touch on the FX option engine with the funding rate as the carry, cash-settled (NDO); CRY01, IR01 (discounting) and FUND01; vol surfaces, VOL step, VaR, stress, exposure paths, canonical record, Excel replications'],
    ['DONE', 'XVA replication for FX and digital assets: the lognormal forward rebuilt in cells from the engine\'s draws (or re-rolled live), the pair\'s surface interpolated to the forward\'s tenor with the smile fixed point at the forward, the CSA and margin-period bridge, IM from the spot sensitivity, the full waterfall, a convergence sheet'],
    ['NEXT', 'XVA replication for the real-world counterparty-credit paths (historical blocks)'],
    ['NEXT', 'Implied crypto vol surfaces from a venue (Deribit DVOL and chain marks) in place of the realised-vol-scaled synthetic ones; venue adapters for crypto OTC desks'],
  ]},
  { title: 'PHASE 2 · FX & CREDIT', status: 'PARTIAL', items: [
    ['DONE', 'FX options: European, American, digital, barrier, double barrier and touch, each against its QuantLib engine; FX vol surfaces (ATM, 25Δ risk reversal and butterfly per tenor, Malz smile in delta); vega on the ladder, VOL step in the P&L explain, vol in VaR and stress, on the exposure paths and in the canonical record; Excel replications for every style but American'],
    ['NEXT', 'Cross-currency swaps; vanna–volga on barriers and touches; Brownian-bridge barrier monitoring on the exposure paths'],
    ['NEXT', 'Stochastic vol on the exposure paths (Heston; a jump variant for digital assets) behind its own validation gate: today the surface\'s term structure and smile are applied along the paths, its level does not move'],
    ['NEXT', 'CDS and credit options; wrong-way risk in CVA'],
  ]},
  { title: 'PHASE 3 · EQUITY & COMMODITY', status: 'PLANNED', items: [['NEXT', 'Equity and commodity derivatives on the same pricing and confirmation rails']] },
  { title: 'PHASE 4 · RISK INFRASTRUCTURE', status: 'PLANNED', items: [
    ['NEXT', 'Firm admin, roles and audit; self-host packaging (docker-compose, migration runner)'],
    ['NEXT', 'External audit of the registry contract; Ethereum mainnet'],
    ['NEXT', 'Email confirmations adapter and a confirmations inbox for bank–corporate flow'],
  ]},
  { title: 'PROMETHEUS · AI LAYER', status: 'LIVE', items: [
    ['DONE', 'Read-only assistant inside the messenger; sees your book and the signed trades in a room, never changes anything'],
    ['NEXT', '"What does this headline mean for my book?" from the news room'],
  ]},
]

export default function Roadmap() {
  return (
    <div className="doc">
      <header className="doc-head">
        <h1>ROADMAP</h1>
        <p>Built in public. DONE means it is in the code and tested, NOW means it is being worked on this month, NEXT means it is planned
           and not started. Nothing here is a promise with a date.</p>
      </header>
      <div className="rm">
        {PHASES.map(ph => (
          <section key={ph.title} className="rm-phase">
            <h2>{ph.title} <span className={`rm-status ${ph.status.toLowerCase()}`}>{ph.status}</span></h2>
            <ul>
              {ph.items.map(([st, text], i) => <li key={i} className={st.toLowerCase()}><span className="rm-dot" /><span className="rm-st">{st}</span><span>{text}</span></li>)}
            </ul>
          </section>
        ))}
      </div>
      <section className="wwu">
        <h2>WORK WITH US</h2>
        <p>Specific asks get answers. Write to <a href="mailto:miko@rijeka.app">miko@rijeka.app</a> with the word in the subject, or start from the link. Nothing here is an offer of employment or equity.</p>
        <div className="wwu-grid">
          {[
            ['VALIDATE', 'Rebuild a product independently and be named on its report. SABR, the Hull–White tree, XVA, SIMM and the crypto products are waiting for a first validator. USD 250 for a confirmed S1/S2 pricing finding.', 'https://github.com/MikoDevedzic/rijeka/blob/main/docs/VALIDATION.md', 'THE CHARTER ↗'],
            ['AUDIT', 'A Solidity reviewer for the registry contract before anyone says the word mainnet. 16 Foundry tests and Sourcify verification are the starting point, not the finish.', 'https://github.com/MikoDevedzic/rijeka/tree/main/chain', 'THE CONTRACT ↗'],
            ['CONTRIBUTE', 'Code or docs with a DCO sign-off; engine and standard are Apache-2.0, the platform is BSL 1.1. Pricing changes come with a test, a before/after number and the methodology updated in the same pull request.', 'https://github.com/MikoDevedzic/rijeka/blob/main/CONTRIBUTING.md', 'CONTRIBUTING ↗'],
            ['PILOT', 'A bank, asset manager or corporate treasury willing to run the confirmation flow with a real counterparty on Sepolia, then mainnet.', 'mailto:miko@rijeka.app?subject=PILOT', 'WRITE TO US'],
            ['TEACH', 'A university or graduate programme that wants the cohort labs. We set up the firms and the market data; students book, price, confirm and verify.', 'mailto:miko@rijeka.app?subject=TEACH', 'WRITE TO US'],
            ['SPONSOR', 'Two concrete items: the external audit of the registry contract, and a year of hosting for university cohorts. Sponsors are named on the project page and have no say over validation.', 'https://github.com/sponsors/MikoDevedzic', 'GITHUB SPONSORS ↗'],
          ].map(([t, body, href, cta]) => (
            <article key={t} className="wwu-card">
              <h3>{t}</h3><p>{body}</p>
              <a className="doc-btn" href={href} target={href.startsWith('mailto') ? undefined : '_blank'} rel="noopener noreferrer">{cta}</a>
            </article>
          ))}
        </div>
      </section>
      <footer className="doc-foot">Commits are the source of truth: <a href="https://github.com/MikoDevedzic/rijeka/commits/main" target="_blank" rel="noopener noreferrer">github.com/MikoDevedzic/rijeka</a></footer>
    </div>
  )
}
