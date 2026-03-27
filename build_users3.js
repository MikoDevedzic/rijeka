const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ── AiGate component ──────────────────────────────────────────────────────────
write('components/common/AiGate.jsx', `import { useAuthStore } from '../../store/useAuthStore'

export function useAiAccess() {
  const { profile } = useAuthStore()
  const role = profile?.role || 'viewer'
  return {
    hasAccess: role === 'trader' || role === 'admin',
    role,
    isAdmin: role === 'admin',
    isTrader: role === 'trader',
    isViewer: role === 'viewer',
  }
}

export default function AiGate({ children, fallback }) {
  const { hasAccess } = useAiAccess()
  if (hasAccess) return children

  return fallback || (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height:'100%', gap:'1rem', padding:'3rem', textAlign:'center',
      fontFamily:'var(--mono)',
    }}>
      <div style={{
        fontSize:'2rem', marginBottom:'0.5rem', opacity:0.4,
      }}>◆</div>
      <div style={{
        fontSize:'0.8rem', fontWeight:700, letterSpacing:'0.15em', color:'var(--text)',
      }}>AI ANALYST — TRADER ACCESS REQUIRED</div>
      <div style={{
        fontSize:'0.68rem', color:'var(--text-dim)', lineHeight:1.7,
        maxWidth:'380px', letterSpacing:'0.04em',
      }}>
        AI-powered trade analysis is available on the Trader plan.
        Contact us to upgrade your account and unlock intelligent insights.
      </div>
      <a href="mailto:hello@rijeka.app?subject=Trader Access Request" style={{
        display:'inline-block', marginTop:'0.5rem',
        background:'var(--purple)', color:'#fff', textDecoration:'none',
        fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
        letterSpacing:'0.1em', padding:'0.6rem 1.5rem', borderRadius:2,
        transition:'opacity 0.15s',
      }}
      onMouseEnter={e=>e.target.style.opacity='0.85'}
      onMouseLeave={e=>e.target.style.opacity='1'}
      >
        REQUEST ACCESS → hello@rijeka.app
      </a>
      <div style={{ fontSize:'0.6rem', color:'var(--text-dim)', letterSpacing:'0.08em', marginTop:'0.25rem' }}>
        Current plan: VIEWER
      </div>
    </div>
  )
}
`);

// ── Update useAuthStore to fetch and expose role ──────────────────────────────
const authPath = path.join(ROOT, 'store', 'useAuthStore.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Add role refresh after profile fetch if not already there
if (!auth.includes('fetchProfile')) {
  // Add a fetchProfile helper that gets latest role from DB
  auth = auth.replace(
    `export const useAuthStore`,
    `async function fetchProfile(userId) {
  const { createClient } = await import('@supabase/supabase-js')
  const { supabase } = await import('../lib/supabase')
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}

export const useAuthStore`
  );
}

fs.writeFileSync(authPath, auth, 'utf8');
console.log('wrote: store/useAuthStore.js');

// ── Update CompareWorkspace AI panel to use role gate + backend ───────────────
const cmpPath = path.join(ROOT, 'components', 'blotter', 'CompareWorkspace.jsx');
let cmp = fs.readFileSync(cmpPath, 'utf8');

// Add AiGate import
cmp = cmp.replace(
  `import { useState } from 'react'
import { useTabStore } from '../../store/useTabStore'
import { supabase } from '../../lib/supabase'
import './CompareWorkspace.css'`,
  `import { useState } from 'react'
import { useTabStore } from '../../store/useTabStore'
import { supabase } from '../../lib/supabase'
import AiGate, { useAiAccess } from '../common/AiGate'
import './CompareWorkspace.css'`
);

// Add useAiAccess inside AiAnalysisPanel
cmp = cmp.replace(
  `function AiAnalysisPanel({ trades, onClose }) {
  const [loading, setLoading] = useState(false)`,
  `function AiAnalysisPanel({ trades, onClose }) {
  const { hasAccess } = useAiAccess()
  const [loading, setLoading] = useState(false)`
);

// Wrap the panel content with AiGate
cmp = cmp.replace(
  `  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--panel)',
      display: 'flex',
      flexDirection: 'column',
      height: '340px',
      flexShrink: 0,
    }}>
      {/* Panel header */}`,
  `  if (!hasAccess) return (
    <div style={{
      borderTop:'1px solid var(--border)',
      background:'var(--panel)',
      height:'220px',
      flexShrink:0,
    }}>
      <AiGate/>
    </div>
  )

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--panel)',
      display: 'flex',
      flexDirection: 'column',
      height: '340px',
      flexShrink: 0,
    }}>
      {/* Panel header */}`
);

// Fix the fetch call to go through backend
if (cmp.includes("fetch('http://localhost:8000/api/analyse/'")) {
  console.log('  CompareWorkspace already using backend URL — skipping');
} else {
  cmp = cmp.replace(
    `      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: newMessages,
        })
      })
      const data = await response.json()
      const reply = data.content?.[0]?.text || 'No response received.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])`,
    `      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const response = await fetch('http://localhost:8000/api/analyse/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${token}\`,
        },
        body: JSON.stringify({
          system: systemPrompt,
          messages: newMessages,
        })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.detail || \`Server error \${response.status}\`)
      }
      const data = await response.json()
      const reply = data.content?.[0]?.text || 'No response received.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])`
  );
}

fs.writeFileSync(cmpPath, cmp, 'utf8');
console.log('wrote: CompareWorkspace.jsx — role gate + backend call');

console.log('\n✅  Script 3 complete');
console.log('\nFull user role system:');
console.log('  VIEWER  → read only, no AI (default for new signups)');
console.log('  TRADER  → full blotter + AI analyst enabled');
console.log('  ADMIN   → everything + user management in Configurations');
console.log('');
console.log('ADMIN section only visible in nav for admin users');
console.log('AI panel shows upgrade prompt for viewers');
console.log('Upgrade CTA: hello@rijeka.app');
console.log('');
console.log('Your account (miko.devedzic@gmail.com) set to ADMIN by SQL migration');
