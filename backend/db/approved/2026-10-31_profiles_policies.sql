-- profiles: who may change what through the Supabase API (the backend uses the postgres role and is not bound by this).
--   * anyone may read their own row; admins may read every row (unchanged)
--   * a user may update their own row but may not change their role that way (role changes go through the API)
--   * an admin may update any row, and the row must still satisfy the admin check after the write
DROP POLICY IF EXISTS admin_update_profiles ON public.profiles;
DROP POLICY IF EXISTS users_update_own_profile ON public.profiles;
CREATE POLICY users_update_own_profile ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role IS NOT DISTINCT FROM (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY admin_update_profiles ON public.profiles FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
