const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

// ── CompareWorkspace — rebrand to PROMETHEUS ──────────────────────────────────
const cmpPath = path.join(ROOT, 'components', 'blotter', 'CompareWorkspace.jsx');
let cmp = fs.readFileSync(cmpPath, 'utf8');

// Replace all KRATOS references
cmp = cmp
  .replace(/⚔ KRATOS/g, '🔥 PROMETHEUS')
  .replace(/⚔ SEND/g, '🔥 SEND')
  .replace(/KRATOS IS READY/g, 'PROMETHEUS IS READY')
  .replace(/KRATOS IS THINKING\.\.\./g, 'PROMETHEUS IS THINKING...')
  .replace(/UNLEASH KRATOS/g, 'IGNITE PROMETHEUS')
  .replace(/KRATOS/g, 'PROMETHEUS')
  .replace(/Your derivatives intelligence — ask anything/g, 'Derivatives intelligence for everyone — ask anything')
  .replace(/Ask KRATOS anything about these trades\.\.\./g, 'Ask PROMETHEUS anything about these trades...')
  .replace(/Ask PROMETHEUS anything about these trades/g, 'Ask PROMETHEUS anything about these trades')

// Update button to fire gradient — amber to orange to deep red
cmp = cmp.replace(
  `background: showAi
              ? 'linear-gradient(135deg, #4a0080, #6b00b3)'
              : 'linear-gradient(135deg, #2a0050, #3d0080)',
            border: '1px solid #8b00ff',
            color: '#e0aaff',
            fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
            letterSpacing:'0.12em', padding:'0.28rem 0.9rem',
            borderRadius:2, cursor:'pointer', transition:'all 0.2s',
            boxShadow: showAi ? '0 0 12px rgba(139,0,255,0.4)' : '0 0 6px rgba(139,0,255,0.2)',
            textShadow: '0 0 8px rgba(224,170,255,0.6)',`,
  `background: showAi
              ? 'linear-gradient(135deg, #7a2800, #c45200, #e87000)'
              : 'linear-gradient(135deg, #4a1800, #8a3600, #b85000)',
            border: '1px solid #e87000',
            color: '#ffd080',
            fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
            letterSpacing:'0.12em', padding:'0.28rem 0.9rem',
            borderRadius:2, cursor:'pointer', transition:'all 0.2s',
            boxShadow: showAi ? '0 0 14px rgba(232,112,0,0.5)' : '0 0 6px rgba(232,112,0,0.2)',
            textShadow: '0 0 8px rgba(255,208,128,0.7)',`
);

// Update hover effects
cmp = cmp.replace(
  `onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 0 16px rgba(139,0,255,0.6)';e.currentTarget.style.color='#fff'}}
          onMouseLeave={e=>{e.currentTarget.style.boxShadow=showAi?'0 0 12px rgba(139,0,255,0.4)':'0 0 6px rgba(139,0,255,0.2)';e.currentTarget.style.color='#e0aaff'}}`,
  `onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 0 20px rgba(232,112,0,0.7)';e.currentTarget.style.color='#fff'}}
          onMouseLeave={e=>{e.currentTarget.style.boxShadow=showAi?'0 0 14px rgba(232,112,0,0.5)':'0 0 6px rgba(232,112,0,0.2)';e.currentTarget.style.color='#ffd080'}}`
);

// Update panel header color
cmp = cmp.replace(
  `fontSize:'0.65rem',fontWeight:700,letterSpacing:'0.12em',color:'#e0aaff',textShadow:'0 0 8px rgba(139,0,255,0.6)'`,
  `fontSize:'0.65rem',fontWeight:700,letterSpacing:'0.12em',color:'#ffd080',textShadow:'0 0 10px rgba(232,112,0,0.7)'`
);

// Update IGNITE PROMETHEUS button
cmp = cmp.replace(
  `background:'linear-gradient(135deg, #4a0080, #6b00b3)',
              border:'1px solid #8b00ff', color:'#e0aaff',
              fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
              letterSpacing:'0.1em', padding:'0.3rem 0.85rem', borderRadius:2,
              cursor:'pointer', opacity: loading ? 0.6 : 1,
              boxShadow:'0 0 10px rgba(139,0,255,0.4)',
              textShadow:'0 0 6px rgba(224,170,255,0.5)',`,
  `background:'linear-gradient(135deg, #7a2800, #c45200, #e87000)',
              border:'1px solid #e87000', color:'#ffd080',
              fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
              letterSpacing:'0.1em', padding:'0.3rem 0.85rem', borderRadius:2,
              cursor:'pointer', opacity: loading ? 0.6 : 1,
              boxShadow:'0 0 12px rgba(232,112,0,0.4)',
              textShadow:'0 0 6px rgba(255,208,128,0.6)',`
);

// Update SEND button
cmp = cmp.replace(
  `background:'linear-gradient(135deg, #4a0080, #6b00b3)',
            border:'1px solid #8b00ff', color:'#e0aaff',
            fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
            padding:'0.35rem 0.85rem', borderRadius:2, cursor:'pointer',
            opacity: loading||!question.trim() ? 0.5 : 1,
            boxShadow:'0 0 8px rgba(139,0,255,0.3)',`,
  `background:'linear-gradient(135deg, #7a2800, #c45200)',
            border:'1px solid #e87000', color:'#ffd080',
            fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
            padding:'0.35rem 0.85rem', borderRadius:2, cursor:'pointer',
            opacity: loading||!question.trim() ? 0.5 : 1,
            boxShadow:'0 0 8px rgba(232,112,0,0.3)',`
);

// Update message bubble colors
cmp = cmp.replace(
  `background: m.role==='user' ? 'rgba(74,0,128,0.3)' : 'var(--panel-2)',
            border: \`1px solid \${m.role==='user' ? 'rgba(139,0,255,0.4)' : 'var(--border)'}\`,`,
  `background: m.role==='user' ? 'rgba(122,40,0,0.3)' : 'var(--panel-2)',
            border: \`1px solid \${m.role==='user' ? 'rgba(232,112,0,0.4)' : 'var(--border)'}\`,`
);

cmp = cmp.replace(
  `color: m.role==='user' ? '#e0aaff' : 'var(--text)',`,
  `color: m.role==='user' ? '#ffd080' : 'var(--text)',`
);

// Update quick action button hovers
cmp = cmp.replace(
  `onMouseEnter={e=>{e.target.style.borderColor='var(--purple)';e.target.style.color='var(--purple)'}}
                onMouseLeave={e=>{e.target.style.borderColor='var(--border)';e.target.style.color='var(--text-dim)'}}`,
  `onMouseEnter={e=>{e.target.style.borderColor='#e87000';e.target.style.color='#ffd080'}}
                onMouseLeave={e=>{e.target.style.borderColor='var(--border)';e.target.style.color='var(--text-dim)'}}`
);

// Update thinking indicator
cmp = cmp.replace(
  `fontSize:'0.68rem', color:'var(--text-dim)', letterSpacing:'0.08em'`,
  `fontSize:'0.68rem', color:'#e87000', letterSpacing:'0.08em'`
);

fs.writeFileSync(cmpPath, cmp, 'utf8');
console.log('✅  CompareWorkspace — rebranded to PROMETHEUS');

// ── AiGate — rebrand ──────────────────────────────────────────────────────────
const gatePath = path.join(ROOT, 'components', 'common', 'AiGate.jsx');
let gate = fs.readFileSync(gatePath, 'utf8');

gate = gate
  .replace(/KRATOS/g, 'PROMETHEUS')
  .replace(/⚔/g, '🔥')
  .replace(/battle-tested analysis/g, 'knowledge for everyone')
  .replace(/background:'var\(--purple\)'/g, "background:'linear-gradient(135deg, #7a2800, #c45200)'")
  .replace(/color:'var\(--purple\)'/g, "color:'#ffd080'")

// Update the upgrade button styling
gate = gate.replace(
  `background:'var(--purple)', color:'#fff', textDecoration:'none',`,
  `background:'linear-gradient(135deg, #7a2800, #c45200, #e87000)', color:'#ffd080', textDecoration:'none',`
);

// Update the icon
gate = gate.replace(
  `fontSize:'2rem', marginBottom:'0.5rem', opacity:0.4,`,
  `fontSize:'2.5rem', marginBottom:'0.5rem', opacity:0.6,`
);

fs.writeFileSync(gatePath, gate, 'utf8');
console.log('✅  AiGate — rebranded to PROMETHEUS');

// ── Architecture doc update ───────────────────────────────────────────────────
const archPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs\\ARCHITECTURE_v9.md';
let arch = fs.readFileSync(archPath, 'utf8');

arch = arch
  .replace(/KRATOS/g, 'PROMETHEUS')
  .replace(/⚔ KRATOS/g, '🔥 PROMETHEUS')
  .replace(/god of strength and power/g, 'the Titan who stole fire from the gods and gave it to mortals')
  .replace(/Symbol: ⚔/g, 'Symbol: 🔥')
  .replace(/Color: Deep purple gradient \(#4a0080 → #6b00b3\), glow #8b00ff/g,
    'Color: Fire gradient (#4a1800 → #c45200 → #e87000), glow rgba(232,112,0,0.5)')
  .replace(/Floor chatter: "Just ask KRATOS".*$/m,
    'Floor chatter: "Ask PROMETHEUS" / "PROMETHEUS flagged it" / "What does PROMETHEUS say?" / "Run it through PROM"')

// Update the brand story
arch = arch.replace(
  `KRATOS is Rijeka's AI intelligence layer, named after the Greek god of strength and power.
Powered by Claude (Anthropic) via FastAPI proxy — users never need their own API key.`,
  `PROMETHEUS is Rijeka's AI intelligence layer.

Named after the Titan who stole fire from the gods and gave knowledge to ordinary mortals —
exactly what Rijeka does: transfers institutional derivatives intelligence to everyone.

*"The gods kept fire. The banks kept derivatives intelligence. We built PROMETHEUS."*

Powered by Claude (Anthropic) via FastAPI proxy — users never need their own API key.`
);

fs.writeFileSync(archPath, arch, 'utf8');
console.log('✅  ARCHITECTURE_v9.md — updated to PROMETHEUS');

console.log('\n════════════════════════════════════════════════════════');
console.log('🔥 PROMETHEUS IS LIVE');
console.log('');
console.log('  Fire gradient button: #4a1800 → #c45200 → #e87000');
console.log('  Amber glow on hover');
console.log('  Golden text: #ffd080');
console.log('  "IGNITE PROMETHEUS" primary action');
console.log('  "PROMETHEUS IS THINKING..." while analysing');
console.log('  Fire theme throughout — messages, sends, panel');
console.log('');
console.log('The myth: Prometheus stole fire from the gods.');
console.log('Rijeka steals derivatives intelligence from the banks.');
console.log('Both give it to ordinary people.');
console.log('════════════════════════════════════════════════════════');
