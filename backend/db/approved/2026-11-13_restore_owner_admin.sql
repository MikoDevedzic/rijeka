-- 2026-11-13_restore_owner_admin.sql: the owner's account on the hosted desk holds the admin role again.
--
-- On 13 November 2026 the owner found that no account of his held the admin role, so nobody could open the Users
-- page to give it back. Nothing records a role change, so how it was lost is not known; the one path in the code
-- that takes admin away without a way back was the role chip, open to an administrator from 29 October until
-- 0.22.1 (11 November). No migration applied by the runner changes the role of an existing account.
--
-- This list is applied by every desk that runs the software, so the statement must do nothing anywhere but on
-- the hosted one (Magnus, 13 November: on a self-hosted desk where someone had signed up at this address, it
-- would have made that account an administrator). It acts only where both hold:
--   * the runner's ledger has an entry applied before 11 November 2026. The runner first shipped on 9 November
--     and applied its first files to the hosted desk that day; a desk set up later, or one that has no ledger
--     (the local stack), is not touched. Not closed: a self-hosted desk that deployed the runner in those two days;
--   * the account at the address has confirmed it (read through to_jsonb, so a database whose auth.users has no
--     such column runs this and changes nothing).
-- Where they do not hold it changes nothing and is recorded as applied. The trigger on profiles.role carries the
-- role into the account's metadata, as it does for a change made on the Users page.
--
-- Idempotent: an account that is already an administrator is left as it is. To undo it, set the role back on the
-- Users page; the role the account held before is not recorded anywhere.

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE applied_at < TIMESTAMPTZ '2026-11-11 00:00:00+00') THEN
    RETURN;
  END IF;
  UPDATE public.profiles
     SET role = 'admin'
   WHERE role IS DISTINCT FROM 'admin'
     AND id IN (SELECT u.id FROM auth.users u
                 WHERE lower(u.email) = 'miko@rijeka.app' AND to_jsonb(u) ->> 'email_confirmed_at' IS NOT NULL);
END
$$;
