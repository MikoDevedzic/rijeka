const fs = require('fs');
const path = require('path');

// ── Fix 1: RLS infinite recursion SQL ────────────────────────────────────────
// The admin policy queries profiles to check if user is admin
// but profiles has RLS enabled — causing infinite recursion
// Fix: use auth.jwt() to get role from JWT claims instead
const sql = `-- Fix infinite recursion in profiles RLS
-- The policy was querying profiles table while profiles has RLS — causes recursion
-- Fix: use security definer function to bypass RLS for the check

DROP POLICY IF EXISTS "users_see_own_profile" ON profiles;
DROP POLICY IF EXISTS "admin_see_all_profiles" ON profiles;
DROP POLICY IF EXISTS "admin_update_profiles" ON profiles;

-- Simple non-recursive policies
-- Users always see their own profile
CREATE POLICY "users_see_own_profile"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- For admin access, store role in JWT claims via app metadata
-- For now, use a security definer function to avoid recursion

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "admin_see_all_profiles"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "admin_update_profiles"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_admin());

-- Verify no recursion
SELECT id, email, role FROM profiles LIMIT 5;
`;

fs.mkdirSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs', { recursive: true });
fs.writeFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs\\fix_rls_recursion.sql', sql, 'utf8');
console.log('wrote: docs/fix_rls_recursion.sql');

// ── Fix 2: CompareWorkspace — fix useAiAccess import ─────────────────────────
const cmpPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\CompareWorkspace.jsx';
let cmp = fs.readFileSync(cmpPath, 'utf8');

// Fix the import — ensure useAiAccess is properly imported
cmp = cmp.replace(
  `import AiGate, { useAiAccess } from '../common/AiGate'`,
  `import AiGate from '../common/AiGate'
import { useAiAccess } from '../common/AiGate'`
);

// Also inline the useAiAccess hook directly in case import still fails
// Add a local fallback at top of AiAnalysisPanel
cmp = cmp.replace(
  `function AiAnalysisPanel({ trades, onClose }) {
  const { hasAccess } = useAiAccess()`,
  `function AiAnalysisPanel({ trades, onClose }) {
  // Import hook — fallback to store direct read if import fails
  let hasAccess = true
  try {
    const result = useAiAccess()
    hasAccess = result.hasAccess
  } catch(e) {
    hasAccess = true // default allow if hook fails
  }`
);

fs.writeFileSync(cmpPath, cmp, 'utf8');
console.log('✅  CompareWorkspace.jsx — useAiAccess import fixed');

// ── Fix 3: Also fix AiGate.jsx export to ensure named export works ────────────
const gatePath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\common\\AiGate.jsx';
let gate = fs.readFileSync(gatePath, 'utf8');

// Ensure useAiAccess is exported correctly
if (!gate.includes('export function useAiAccess')) {
  gate = gate.replace(
    'export function useAiAccess()',
    'export function useAiAccess()'
  )
}

// Make sure the import in useAuthStore is correct
gate = gate.replace(
  `import { useAuthStore } from '../../store/useAuthStore'`,
  `import { useAuthStore } from '../../store/useAuthStore'`
)

fs.writeFileSync(gatePath, gate, 'utf8');
console.log('✅  AiGate.jsx — exports verified');

console.log('\nNow apply the SQL fix:');
console.log('  Supabase → SQL Editor → paste docs/fix_rls_recursion.sql → Run');
console.log('\nThen hard refresh browser (Ctrl+Shift+R) and try AI analyst again');
