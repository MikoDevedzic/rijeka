const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

// ── 1. CompareWorkspace — rebrand AI panel to KRATOS ─────────────────────────
const cmpPath = path.join(ROOT, 'components', 'blotter', 'CompareWorkspace.jsx');
let cmp = fs.readFileSync(cmpPath, 'utf8');

cmp = cmp
  .replace(/AI TRADE ANALYST/g, 'KRATOS')
  .replace(/AI ANALYST/g, 'KRATOS')
  .replace(/◆ AI ANALYST/g, '⚔ KRATOS')
  .replace(/◆ KRATOS/g, '⚔ KRATOS')
  .replace(/Ask anything about these trades/g, 'Your derivatives intelligence — ask anything')
  .replace(/Ask about these trades\.\.\. \(Enter to send\)/g, 'Ask KRATOS anything about these trades...')
  .replace(/READY TO ANALYSE \$\{trades\.length\} TRADES/g, 'KRATOS IS READY — ${trades.length} TRADES LOADED')
  .replace(/ANALYSING TRADES\.\.\./g, 'KRATOS IS THINKING...')
  .replace(/ANALYSE DIFFERENCES/g, 'UNLEASH KRATOS')
  .replace(/color:'var\(--purple\)'/g, "color:'var(--purple)'")

// Update the AI button styling to make KRATOS stand out
cmp = cmp.replace(
  `  onClick={() => setShowAi(v => !v)}
          style={{
            background: showAi ? 'color-mix(in srgb,var(--purple) 15%,transparent)' : 'transparent',
            border: \`1px solid \${showAi ? 'var(--purple)' : 'var(--border)'}\`,
            color: showAi ? 'var(--purple)' : 'var(--text-dim)',
            fontFamily:'var(--mono)', fontSize:'0.62rem', fontWeight:700,
            letterSpacing:'0.08em', padding:'0.25rem 0.75rem',
            borderRadius:2, cursor:'pointer', transition:'all 0.12s',
          }}
        >⚔ KRATOS</button>`,
  `  onClick={() => setShowAi(v => !v)}
          style={{
            background: showAi
              ? 'linear-gradient(135deg, #4a0080, #6b00b3)'
              : 'linear-gradient(135deg, #2a0050, #3d0080)',
            border: '1px solid #8b00ff',
            color: '#e0aaff',
            fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
            letterSpacing:'0.12em', padding:'0.28rem 0.9rem',
            borderRadius:2, cursor:'pointer', transition:'all 0.2s',
            boxShadow: showAi ? '0 0 12px rgba(139,0,255,0.4)' : '0 0 6px rgba(139,0,255,0.2)',
            textShadow: '0 0 8px rgba(224,170,255,0.6)',
          }}
          onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 0 16px rgba(139,0,255,0.6)';e.currentTarget.style.color='#fff'}}
          onMouseLeave={e=>{e.currentTarget.style.boxShadow=showAi?'0 0 12px rgba(139,0,255,0.4)':'0 0 6px rgba(139,0,255,0.2)';e.currentTarget.style.color='#e0aaff'}}
        >⚔ KRATOS</button>`
);

// Update total diffs badge and section diffs color to match KRATOS theme
cmp = cmp.replace(
  `trades loaded · Ask anything about these trades`,
  `trades loaded · Your derivatives intelligence`
);

// Update quick question buttons
cmp = cmp.replace(
  `'What are the key differences?',
                'Which trade has more curve risk?',
                'Compare the cashflow profiles',
                'Any structural concerns?',`,
  `'What are the key differences?',
                'Which trade has more curve risk?',
                'Any structural concerns?',
                'Summarise for my MD',`
);

// Update SEND button to KRATOS purple
cmp = cmp.replace(
  `          background:'var(--purple)', border:'none', color:'#fff',
            fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
            padding:'0.35rem 0.85rem', borderRadius:2, cursor:'pointer',
            opacity: loading||!question.trim() ? 0.5 : 1,
          }}
        >SEND</button>`,
  `          background:'linear-gradient(135deg, #4a0080, #6b00b3)',
            border:'1px solid #8b00ff', color:'#e0aaff',
            fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
            padding:'0.35rem 0.85rem', borderRadius:2, cursor:'pointer',
            opacity: loading||!question.trim() ? 0.5 : 1,
            boxShadow:'0 0 8px rgba(139,0,255,0.3)',
          }}
        >⚔ SEND</button>`
);

// UNLEASH KRATOS button styling
cmp = cmp.replace(
  `              background:'var(--purple)', border:'none', color:'#fff',
              fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
              letterSpacing:'0.1em', padding:'0.3rem 0.85rem', borderRadius:2,
              cursor:'pointer', opacity: loading ? 0.6 : 1,`,
  `              background:'linear-gradient(135deg, #4a0080, #6b00b3)',
              border:'1px solid #8b00ff', color:'#e0aaff',
              fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
              letterSpacing:'0.1em', padding:'0.3rem 0.85rem', borderRadius:2,
              cursor:'pointer', opacity: loading ? 0.6 : 1,
              boxShadow:'0 0 10px rgba(139,0,255,0.4)',
              textShadow:'0 0 6px rgba(224,170,255,0.5)',`
);

// Panel header color
cmp = cmp.replace(
  `fontSize:'0.65rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--purple)'`,
  `fontSize:'0.65rem',fontWeight:700,letterSpacing:'0.12em',color:'#e0aaff',textShadow:'0 0 8px rgba(139,0,255,0.6)'`
);

// Message bubbles — user messages in KRATOS purple
cmp = cmp.replace(
  `background: m.role==='user' ? 'color-mix(in srgb,var(--purple) 12%,transparent)' : 'var(--panel-2)',
            border: \`1px solid \${m.role==='user' ? 'color-mix(in srgb,var(--purple) 30%,transparent)' : 'var(--border)'}\`,`,
  `background: m.role==='user' ? 'rgba(74,0,128,0.3)' : 'var(--panel-2)',
            border: \`1px solid \${m.role==='user' ? 'rgba(139,0,255,0.4)' : 'var(--border)'}\`,`
);

cmp = cmp.replace(
  `color: m.role==='user' ? 'var(--purple)' : 'var(--text)',`,
  `color: m.role==='user' ? '#e0aaff' : 'var(--text)',`
);

fs.writeFileSync(cmpPath, cmp, 'utf8');
console.log('✅  CompareWorkspace — rebranded to KRATOS');

// ── 2. AiGate — rebrand upgrade prompt ───────────────────────────────────────
const gatePath = path.join(ROOT, 'components', 'common', 'AiGate.jsx');
let gate = fs.readFileSync(gatePath, 'utf8');

gate = gate
  .replace(/AI ANALYST — TRADER ACCESS REQUIRED/g, 'KRATOS — TRADER ACCESS REQUIRED')
  .replace(/AI-powered trade analysis/g, 'KRATOS derivatives intelligence')
  .replace(/intelligent insights/g, 'battle-tested analysis')
  .replace(/>◆</g, '>⚔<')

fs.writeFileSync(gatePath, gate, 'utf8');
console.log('✅  AiGate — rebranded to KRATOS');

// ── 3. Update architecture doc ────────────────────────────────────────────────
const archPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs\\ARCHITECTURE_v9.md';
let arch = fs.readFileSync(archPath, 'utf8');

arch = arch.replace(
  /AI analyst/g, 'KRATOS'
).replace(
  /AI Analyst/g, 'KRATOS'
).replace(
  /AI ANALYST/g, 'KRATOS'
);

// Add KRATOS section if not present
if (!arch.includes('## KRATOS')) {
  arch = arch.replace(
    `## Downstream System Data Consumption`,
    `## KRATOS — Rijeka's Derivatives Intelligence

KRATOS is Rijeka's AI intelligence layer, named after the Greek god of strength and power.
Powered by Claude (Anthropic) via FastAPI proxy — users never need their own API key.

**Access:** TRADER and ADMIN roles only. VIEWERs see upgrade prompt with hello@rijeka.app CTA.

**Current capabilities (Sprint 2):**
- Trade comparison analysis — key differences, risk implications, structural concerns
- Multi-turn conversation — follow-up questions work
- Full trade economics as context: legs, rates, counterparty, tenor, notional

**Sprint 3 capabilities:**
- Live NPV, Greeks, XVA in context — KRATOS sees real numbers
- Per-trade insights on pricing tab: "KRATOS says: elevated long-end duration"
- Pre-trade analysis: compare 3 structures before booking

**Sprint 4+:**
- KRATOS alerts: VaR breach, margin call incoming, unusual position
- KRATOS digest: daily market summary personalised to your book
- KRATOS explain: plain English explanation of any risk metric
- Voice interface: "Ask KRATOS" via microphone on trading floor

**Branding:**
- Symbol: ⚔
- Color: Deep purple gradient (#4a0080 → #6b00b3), glow #8b00ff
- Tagline: "Your derivatives intelligence"
- Floor chatter: "Just ask KRATOS" / "KRATOS flagged it" / "What does KRATOS say?"

---

## Downstream System Data Consumption`
  );
}

fs.writeFileSync(archPath, arch, 'utf8');
console.log('✅  ARCHITECTURE_v9.md — KRATOS section added');

console.log('\n════════════════════════════════════════════════════════');
console.log('KRATOS is live.');
console.log('');
console.log('  ⚔ Deep purple gradient button');
console.log('  ⚔ Purple glow on hover and when active');
console.log('  ⚔ "UNLEASH KRATOS" primary action button');
console.log('  ⚔ "KRATOS IS THINKING..." while analysing');
console.log('  ⚔ "KRATOS IS READY" when panel opens');
console.log('  ⚔ Added: "Summarise for my MD" quick question');
console.log('  ⚔ Architecture doc updated with full KRATOS roadmap');
console.log('════════════════════════════════════════════════════════');
