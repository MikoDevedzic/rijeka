-- Fix infinite recursion in profiles RLS
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
