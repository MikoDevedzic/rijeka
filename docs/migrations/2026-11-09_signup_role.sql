-- 2026-11-09_signup_role.sql: the role of a new account.
--
-- A new account is a viewer. The application raises it to trader when it provisions the workspace
-- (api/routes/demo.py), and only an admin assigns any other role (the Users page).
--
-- Idempotent: it replaces the body of public.handle_new_user() and nothing else. The trigger on auth.users, the
-- profiles table and every existing profile are unchanged.

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  proposed_id TEXT;
  final_id    TEXT;
  counter     INT := 2;
BEGIN
  proposed_id := UPPER(SPLIT_PART(NEW.email, '@', 1));
  proposed_id := REGEXP_REPLACE(proposed_id, '[^A-Z.]', '.', 'g');
  proposed_id := REGEXP_REPLACE(proposed_id, '\.+', '.', 'g');
  proposed_id := BTRIM(proposed_id, '.');

  final_id := proposed_id;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE trader_id = final_id) LOOP
    final_id := proposed_id || '_' || counter;
    counter  := counter + 1;
  END LOOP;

  -- the role of a new account is set here
  INSERT INTO public.profiles (id, trader_id, role, email)
  VALUES (NEW.id, final_id, 'viewer', NEW.email)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
