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
  { title: 'DIGITAL ASSETS', status: 'PARTIAL', items: [
    ['DONE', 'Crypto NDF / NDO in the canonical record (ISDA Digital Asset Derivatives Definitions vocabulary)'],
    ['DONE', 'Excel replications for crypto NDF and NDO (parity forward, Black-76)'],
    ['NEXT', 'Crypto option pricing in the engine and the trade window; venue adapters for crypto OTC desks'],
  ]},
  { title: 'PHASE 2 · FX & CREDIT', status: 'PLANNED', items: [
    ['NEXT', 'FX forwards, NDFs and options; cross-currency swaps'],
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
      <footer className="doc-foot">Commits are the source of truth: <a href="https://github.com/MikoDevedzic/rijeka/commits/main" target="_blank" rel="noopener noreferrer">github.com/MikoDevedzic/rijeka</a></footer>
    </div>
  )
}
