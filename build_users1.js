const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ── SQL migration ─────────────────────────────────────────────────────────────
const sql = `-- ============================================================
-- Rijeka — User management migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add email to profiles (so we can show it without joining auth.users)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. Ensure role column has proper default and constraint
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'viewer';

-- 3. Drop existing role constraint if any, re-add with all roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('viewer', 'trader', 'admin'));

-- 4. Update the handle_new_user trigger to capture email
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, trader_id, role, email, full_name, created_at)
  VALUES (
    NEW.id,
    LOWER(SPLIT_PART(NEW.email, '@', 1)) || '_' ||
      LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0'),
    'viewer',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Backfill email for existing profiles from auth.users
UPDATE profiles p
SET email = u.email,
    full_name = COALESCE(u.raw_user_meta_data->>'full_name', SPLIT_PART(u.email, '@', 1))
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 6. Make your account admin (update with your user ID)
UPDATE profiles
SET role = 'admin'
WHERE email = 'miko.devedzic@gmail.com';

-- 7. RLS on profiles — admin can see all, users see own
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_see_own_profile" ON profiles;
DROP POLICY IF EXISTS "admin_see_all_profiles" ON profiles;
DROP POLICY IF EXISTS "admin_update_profiles" ON profiles;

CREATE POLICY "users_see_own_profile"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "admin_see_all_profiles"
  ON profiles FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_update_profiles"
  ON profiles FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 8. Verify
SELECT id, trader_id, email, role, is_active, created_at
FROM profiles
ORDER BY created_at;
`;

fs.mkdirSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs', { recursive: true });
fs.writeFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs\\users_migration.sql', sql, 'utf8');
console.log('wrote: docs/users_migration.sql');

// ── Users.jsx ─────────────────────────────────────────────────────────────────
write('components/admin/Users.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'

const ROLE_META = {
  viewer: { color: 'var(--text-dim)', label: 'VIEWER',  desc: 'Read only — no AI access' },
  trader: { color: 'var(--accent)',   label: 'TRADER',  desc: 'Full access — AI enabled' },
  admin:  { color: 'var(--amber)',    label: 'ADMIN',   desc: 'Admin — manage users' },
}

export default function Users() {
  const { profile: me } = useAuthStore()
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [saving, setSaving] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (err) { setError(err.message); setLoading(false); return }
    setUsers(data || [])
    setLoading(false)
  }

  async function updateRole(userId, role) {
    setSaving(userId)
    const { error: err } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId)
    if (err) { setError(err.message); setSaving(null); return }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
    setSaving(null)
  }

  async function toggleActive(userId, current) {
    setSaving(userId)
    const { error: err } = await supabase
      .from('profiles')
      .update({ is_active: !current })
      .eq('id', userId)
    if (err) { setError(err.message); setSaving(null); return }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: !current } : u))
    setSaving(null)
  }

  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (u.email||'').toLowerCase().includes(q)
      || (u.trader_id||'').toLowerCase().includes(q)
      || (u.full_name||'').toLowerCase().includes(q)
  })

  const counts = {
    total:  users.length,
    admin:  users.filter(u => u.role === 'admin').length,
    trader: users.filter(u => u.role === 'trader').length,
    viewer: users.filter(u => u.role === 'viewer').length,
    active: users.filter(u => u.is_active !== false).length,
  }

  const mono = { fontFamily: 'var(--mono)' }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'var(--bg)', ...mono }}>

      {/* Header */}
      <div style={{ padding:'1.25rem 2rem', borderBottom:'1px solid var(--border)', background:'var(--panel)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1rem' }}>
          <div>
            <h2 style={{ fontSize:'1rem', fontWeight:700, letterSpacing:'0.14em', margin:0, color:'var(--text)' }}>USER MANAGEMENT</h2>
            <p style={{ fontSize:'0.65rem', color:'var(--text-dim)', margin:'0.25rem 0 0', letterSpacing:'0.06em' }}>
              Manage access levels and AI permissions
            </p>
          </div>
          <button onClick={fetchUsers} style={{
            background:'transparent', border:'1px solid var(--border)', color:'var(--text-dim)',
            ...mono, fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.1em',
            padding:'0.35rem 0.85rem', borderRadius:2, cursor:'pointer',
          }}>REFRESH</button>
        </div>

        {/* Stats bar */}
        <div style={{ display:'flex', gap:'1.5rem' }}>
          {[
            { label:'TOTAL', val: counts.total, color:'var(--text)' },
            { label:'ACTIVE', val: counts.active, color:'var(--accent)' },
            { label:'ADMIN', val: counts.admin, color:'var(--amber)' },
            { label:'TRADER', val: counts.trader, color:'var(--accent)' },
            { label:'VIEWER', val: counts.viewer, color:'var(--text-dim)' },
          ].map(s => (
            <div key={s.label} style={{ display:'flex', flexDirection:'column', gap:'0.1rem' }}>
              <span style={{ fontSize:'1.1rem', fontWeight:700, color:s.color, lineHeight:1 }}>{s.val}</span>
              <span style={{ fontSize:'0.58rem', color:'var(--text-dim)', letterSpacing:'0.1em' }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Role legend */}
      <div style={{ display:'flex', gap:'1.5rem', padding:'0.6rem 2rem', borderBottom:'1px solid var(--border)', background:'var(--bg-deep)', flexShrink:0 }}>
        {Object.entries(ROLE_META).map(([role, meta]) => (
          <div key={role} style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.1em', color:meta.color, padding:'0.1rem 0.4rem', border:\`1px solid \${meta.color}60\`, borderRadius:2 }}>{meta.label}</span>
            <span style={{ fontSize:'0.6rem', color:'var(--text-dim)' }}>{meta.desc}</span>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding:'0.75rem 2rem', borderBottom:'1px solid var(--border)', background:'var(--panel)', flexShrink:0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by email, name, or trader ID..."
          style={{
            background:'var(--panel-2)', border:'1px solid var(--border)', color:'var(--text)',
            ...mono, fontSize:'0.7rem', padding:'0.4rem 0.75rem', borderRadius:2,
            outline:'none', width:'360px', transition:'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{ margin:'0.75rem 2rem', padding:'0.6rem 1rem', background:'color-mix(in srgb,var(--red) 10%,transparent)', border:'1px solid color-mix(in srgb,var(--red) 30%,transparent)', borderRadius:3, color:'var(--red)', fontSize:'0.7rem' }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ flex:1, overflow:'auto' }}>
        {loading ? (
          <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-dim)', fontSize:'0.7rem', letterSpacing:'0.12em' }}>LOADING USERS...</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', ...mono, fontSize:'0.7rem' }}>
            <thead>
              <tr style={{ background:'var(--panel-2)', position:'sticky', top:0, zIndex:2 }}>
                {['USER','TRADER ID','ROLE','AI ACCESS','STATUS','JOINED','ACTIONS'].map(h => (
                  <th key={h} style={{ padding:'0.55rem 1.25rem', textAlign:'left', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.1em', color:'var(--text-dim)', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ padding:'3rem', textAlign:'center', color:'var(--text-dim)', fontSize:'0.7rem', letterSpacing:'0.1em' }}>NO USERS FOUND</td></tr>
              ) : filtered.map(u => {
                const rm = ROLE_META[u.role] || ROLE_META.viewer
                const isMe = u.id === me?.id
                const isSaving = saving === u.id
                const aiEnabled = u.role === 'trader' || u.role === 'admin'
                const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—'

                return (
                  <tr key={u.id} style={{
                    borderBottom: '1px solid color-mix(in srgb,var(--border) 50%,transparent)',
                    background: isMe ? 'color-mix(in srgb,var(--accent) 4%,transparent)' : 'transparent',
                    transition: 'background 0.1s',
                    opacity: u.is_active === false ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!isMe) e.currentTarget.style.background = 'var(--panel)' }}
                  onMouseLeave={e => { if (!isMe) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* User */}
                    <td style={{ padding:'0.65rem 1.25rem' }}>
                      <div style={{ fontWeight:600, color:'var(--text)' }}>
                        {u.full_name || u.email?.split('@')[0] || '—'}
                        {isMe && <span style={{ marginLeft:'0.5rem', fontSize:'0.58rem', color:'var(--accent)', border:'1px solid var(--accent)', padding:'0.05rem 0.3rem', borderRadius:2 }}>YOU</span>}
                      </div>
                      <div style={{ fontSize:'0.62rem', color:'var(--text-dim)', marginTop:'0.1rem' }}>{u.email || '—'}</div>
                    </td>

                    {/* Trader ID */}
                    <td style={{ padding:'0.65rem 1.25rem', color:'var(--text-dim)', fontSize:'0.65rem', letterSpacing:'0.04em' }}>
                      {u.trader_id || '—'}
                    </td>

                    {/* Role */}
                    <td style={{ padding:'0.65rem 1.25rem' }}>
                      {isMe ? (
                        <span style={{ fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.1em', color:rm.color, padding:'0.15rem 0.5rem', border:\`1px solid \${rm.color}60\`, borderRadius:2 }}>{rm.label}</span>
                      ) : (
                        <select
                          value={u.role}
                          disabled={isSaving}
                          onChange={e => updateRole(u.id, e.target.value)}
                          style={{
                            background:'var(--panel-2)', border:\`1px solid \${rm.color}60\`,
                            color:rm.color, ...mono, fontSize:'0.65rem', fontWeight:700,
                            letterSpacing:'0.08em', padding:'0.2rem 0.5rem', borderRadius:2,
                            cursor:'pointer', outline:'none',
                          }}
                        >
                          <option value="viewer">VIEWER</option>
                          <option value="trader">TRADER</option>
                          <option value="admin">ADMIN</option>
                        </select>
                      )}
                    </td>

                    {/* AI Access */}
                    <td style={{ padding:'0.65rem 1.25rem' }}>
                      <span style={{
                        fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.08em',
                        color: aiEnabled ? 'var(--accent)' : 'var(--text-dim)',
                        padding:'0.15rem 0.5rem',
                        background: aiEnabled ? 'color-mix(in srgb,var(--accent) 10%,transparent)' : 'transparent',
                        border: \`1px solid \${aiEnabled ? 'color-mix(in srgb,var(--accent) 30%,transparent)' : 'var(--border)'}\`,
                        borderRadius:2,
                      }}>
                        {aiEnabled ? '◆ ENABLED' : '— DISABLED'}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={{ padding:'0.65rem 1.25rem' }}>
                      <span style={{
                        fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.08em',
                        color: u.is_active !== false ? 'var(--accent)' : 'var(--red)',
                      }}>
                        {u.is_active !== false ? '● ACTIVE' : '● INACTIVE'}
                      </span>
                    </td>

                    {/* Joined */}
                    <td style={{ padding:'0.65rem 1.25rem', color:'var(--text-dim)', fontSize:'0.65rem' }}>
                      {joined}
                    </td>

                    {/* Actions */}
                    <td style={{ padding:'0.65rem 1.25rem' }}>
                      {!isMe && (
                        <button
                          onClick={() => toggleActive(u.id, u.is_active !== false)}
                          disabled={isSaving}
                          style={{
                            background:'transparent',
                            border: \`1px solid \${u.is_active !== false ? 'var(--border)' : 'var(--accent)'}\`,
                            color: u.is_active !== false ? 'var(--text-dim)' : 'var(--accent)',
                            ...mono, fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.08em',
                            padding:'0.2rem 0.6rem', borderRadius:2, cursor:'pointer',
                            opacity: isSaving ? 0.5 : 1,
                          }}
                        >
                          {u.is_active !== false ? 'DEACTIVATE' : 'REACTIVATE'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer note */}
      <div style={{ padding:'0.6rem 2rem', borderTop:'1px solid var(--border)', background:'var(--bg-deep)', flexShrink:0 }}>
        <span style={{ fontSize:'0.6rem', color:'var(--text-dim)', letterSpacing:'0.08em' }}>
          Role changes take effect immediately · Deactivated users cannot log in · AI access requires TRADER or ADMIN role
        </span>
      </div>
    </div>
  )
}
`);

// ── Update CfgNav to add ADMIN section ────────────────────────────────────────
write('components/layout/CfgNav.jsx', `import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const SECTIONS = [
  {
    id: 'market-data',
    label: 'MARKET DATA',
    roles: ['viewer','trader','admin'],
    items: [{ label:'RATES CURVES', path:'/configurations/market-data/curves' }],
  },
  {
    id: 'infrastructure',
    label: 'INFRASTRUCTURE',
    roles: ['viewer','trader','admin'],
    items: [{ label:'ORG HIERARCHY', path:'/configurations/org-hierarchy' }],
  },
  {
    id: 'onboarding',
    label: 'ONBOARDING',
    roles: ['viewer','trader','admin'],
    items: [
      { label:'LEGAL ENTITIES',  path:'/configurations/legal-entities' },
      { label:'COUNTERPARTIES',  path:'/configurations/counterparties' },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    roles: ['admin'],
    items: [{ label:'USERS', path:'/configurations/users' }],
  },
]

export default function CfgNav() {
  const { profile } = useAuthStore()
  const [collapsed, setCollapsed] = useState({})
  const toggle = id => setCollapsed(s => ({ ...s, [id]: !s[id] }))
  const role = profile?.role || 'viewer'

  return (
    <nav style={{ width:'200px', minWidth:'200px', background:'var(--panel)', borderRight:'1px solid var(--border)', overflowY:'auto', padding:'1rem 0' }}>
      {SECTIONS.filter(s => s.roles.includes(role)).map(sec => {
        const isOpen = !collapsed[sec.id]
        return (
          <div key={sec.id} style={{ marginBottom:'0.25rem' }}>
            <button onClick={() => toggle(sec.id)} style={{
              width:'100%', background:'none', border:'none',
              padding:'0.45rem 1rem', display:'flex', alignItems:'center',
              justifyContent:'space-between', cursor:'pointer',
              fontFamily:'var(--mono)', fontSize:'0.58rem', fontWeight:700,
              letterSpacing:'0.14em',
              color: sec.id==='admin' ? 'var(--amber)' : 'var(--text-dim)',
            }}>
              <span>{sec.label}</span>
              <span style={{ fontSize:'0.55rem', opacity:0.6 }}>{isOpen?'▾':'▸'}</span>
            </button>
            {isOpen && sec.items.map(item => (
              <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
                display:'block', padding:'0.35rem 1rem 0.35rem 1.5rem',
                fontFamily:'var(--mono)', fontSize:'0.68rem', letterSpacing:'0.06em',
                color: isActive ? 'var(--accent)' : 'var(--text)',
                textDecoration:'none',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                transition:'all 0.12s',
              })}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
`);

// ── Update App.jsx to add /configurations/users route ────────────────────────
const appPath = path.join(ROOT, 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

app = app.replace(
  `import Counterparties   from './components/onboarding/Counterparties'`,
  `import Counterparties   from './components/onboarding/Counterparties'
import Users            from './components/admin/Users'`
);

app = app.replace(
  `              <Route path="counterparties"     element={<Counterparties />} />`,
  `              <Route path="counterparties"     element={<Counterparties />} />
              <Route path="users"              element={<Users />} />`
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('wrote: App.jsx — /configurations/users route added');

console.log('\n✅  Script 1 complete');
console.log('\nNow apply the SQL migration:');
console.log('  Supabase → SQL Editor → paste docs/users_migration.sql → Run');
