-- ============================================================
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
