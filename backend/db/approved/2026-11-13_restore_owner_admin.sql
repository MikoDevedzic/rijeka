-- 2026-11-13_restore_owner_admin.sql: the owner's account on the hosted desk holds the admin role again.
--
-- On 13 November 2026 the owner found that no account of his held the admin role, so nobody could open the Users
-- page to give it back. Nothing records a role change, so how it was lost is not known; the one path in the code
-- that takes admin away without a way back was the role chip, open to an administrator from 29 October until
-- 0.22.1 (11 November). No migration applied by the runner changes the role of an existing account.
--
-- One row, by the address of an account whose address was confirmed: an account that only claims the address
-- (sign-up without confirmation) is not touched. Where there is no such account (a new database, a self-hosted
-- desk) it changes nothing; the confirmation is read through to_jsonb so that a database whose auth.users has no
-- such column (the local stack's) runs the statement and changes nothing. The trigger on profiles.role carries the role into the account's metadata, as it does
-- for a change made on the Users page.
--
-- Idempotent: an account that is already an administrator is left as it is.

UPDATE public.profiles
   SET role = 'admin'
 WHERE role IS DISTINCT FROM 'admin'
   AND id IN (SELECT u.id FROM auth.users u
               WHERE lower(u.email) = 'miko@rijeka.app' AND to_jsonb(u) ->> 'email_confirmed_at' IS NOT NULL);
