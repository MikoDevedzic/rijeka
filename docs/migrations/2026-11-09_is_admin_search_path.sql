-- 2026-11-09_is_admin_search_path.sql: public.is_admin() resolves its table in the public schema.
--
-- The function is SECURITY DEFINER and named no search path, so the `profiles` it reads was whichever one the
-- caller's session resolved first. It now reads public.profiles whatever the session has set, as the other
-- definer functions already do (chat_can_read, chat_can_see, handle_new_user, my_firm_id).
--
-- Idempotent: it sets one attribute of one function. The body, the owner, the grants and every policy that calls
-- it are unchanged.

ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
