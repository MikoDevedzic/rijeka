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
    ['NOW',  'Go-live of the hosted demo (app.rijeka.app) and the first recorded walkthrough'],
    ['NEXT', 'Shared market-data feed with a factor-model simulator so curves move; P&L and XVA tick on the desk'],
    ['NEXT', 'House dealer: Rijeka quotes mid ± spread so a solo learner always has a counterparty (paper only)'],
    ['NEXT', 'Cohorts and labs for classrooms and graduate programmes: paired firms, limits, a leaderboard'],
  ]},
  { title: 'DESK MODULES', status: 'PARTIAL', items: [
    ['DONE', 'Scenario P&L attribution per trade: theta, IR01, IR01_DISC, gamma, vega, carry, roll-down, unexplained (never absorbed)'],
    ['DONE', 'P&L tab: day, MTD and YTD split market vs trading; attribution by sequential full revaluation (carry, cash, curves by tenor bucket, spot, points, residual); roll-up desk → book → trade; trader and controller sign-off; management view'],
    ['NEXT', 'P&L: vol surfaces as a step, amendment effects separated, IPV tolerances, a published PDF report per signed day'],
    ['NEXT', 'IPV: independent price verification of the book against an external snapshot, with tolerances and a sign-off trail'],
    ['DONE', 'Greeks and bump-and-reprice ladders; exposure profiles (EE, ENE, PFE) and SA-CCR EAD inside the XVA module'],
    ['NEXT', 'MARKET RISK tab: historical and parametric VaR, stress scenarios, Greek ladders by bucket, FRTB sensitivities-based capital'],
    ['NEXT', 'COLLATERAL tab: CSA terms per counterparty, daily VM and IM calls, disputes, settlement status, collateral inventory'],
    ['NEXT', 'COUNTERPARTY CREDIT tab: limits against PFE, utilisation, netting sets, CVA desk view, wrong-way-risk flags'],
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
    ['DONE', 'FX spot, forwards and NDFs on G10 pairs and crypto forwards on one interest-rate-parity model, each currency on its own curve; FX · CRYPTO page; Excel replications for the EURUSD forward and the crypto NDF/NDO'],
    ['DONE', 'Crypto NDF / NDO in the canonical record (ISDA Digital Asset Derivatives Definitions vocabulary)'],
    ['DONE', 'Excel replications for crypto NDF and NDO (parity forward, Black-76)'],
    ['DONE', 'Crypto non-deliverable forwards on BTC, ETH and SOL: public spot feed, funding rate, cash-and-carry pricer, booking, on-chain confirmation (Configurations → Digital assets)'],
    ['NEXT', 'Crypto options in the engine and the page; venue adapters for crypto OTC desks'],
  ]},
  { title: 'PHASE 2 · FX & CREDIT', status: 'PARTIAL', items: [
    ['DONE', 'FX spot, forwards and NDFs on G10 pairs, priced on the same interest-rate-parity model as crypto, booked and confirmed on chain (FX · CRYPTO page)'],
    ['NEXT', 'FX options; cross-currency swaps; FX vol surface'],
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
