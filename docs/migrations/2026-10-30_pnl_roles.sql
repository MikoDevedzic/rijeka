-- P&L control roles. profiles.role gains CONTROLLER (signs the day after the trader; cannot book)
-- and MANAGEMENT (sees every book in the firm; cannot book). The existing trigger copies the
-- role into the auth user's metadata. Run in the Supabase SQL editor. Idempotent.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['viewer'::text, 'trader'::text, 'controller'::text, 'management'::text, 'admin'::text]));
