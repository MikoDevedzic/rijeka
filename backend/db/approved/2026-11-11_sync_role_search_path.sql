-- 2026-11-11_sync_role_search_path.sql: public.sync_role_to_user_metadata() names its search path.
--
-- The function is SECURITY DEFINER (it copies a profile's new role into auth.users, which the caller cannot write)
-- and named no search path, so any unqualified name in it would resolve through whatever the caller's session had
-- set. Its body names auth.users in full and calls only a built-in, so nothing resolves differently today; this
-- pins it, as 2026-11-09_is_admin_search_path.sql pinned is_admin() and as the other definer functions already are.
--
-- Idempotent: it sets one attribute of one function. The body, the owner, the grants and the trigger that calls
-- it (on_profile_role_change) are unchanged.

ALTER FUNCTION public.sync_role_to_user_metadata() SET search_path = public, pg_temp;
