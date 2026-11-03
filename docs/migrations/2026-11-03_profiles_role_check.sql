-- profiles.role: one allowlist with every role the application knows. The two 30 October migrations
-- each rewrote profiles_role_check with their own list, and in filename order the P&L one (controller,
-- cfo, management) runs after the market-risk one (risk), so a database that applied them in that order
-- cannot store a `risk` profile. Idempotent; safe to run on any database.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('viewer', 'trader', 'admin', 'controller', 'cfo', 'management', 'risk'));
