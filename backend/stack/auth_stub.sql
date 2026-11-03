-- auth_stub.sql — the Supabase pieces docs/schema.sql relies on, stubbed for a plain PostgreSQL 16.
--
-- Supabase provides an `auth` schema (users, uid(), role(), jwt()), the `authenticated` / `anon` /
-- `service_role` roles, the `supabase_realtime` publication and the pgcrypto / uuid-ossp extensions.
-- This file creates exactly what the schema and the dated migrations reference, nothing more, and
-- every statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE), so it is also safe on a database
-- where GoTrue has already created `auth.users` (docker-compose: the `auth` service migrates first).
--
-- What is referenced and why it is here:
--   auth.users            29 foreign keys (profiles and the business tables), the sign-up trigger
--                         on_auth_user_created (handle_new_user reads email and raw_user_meta_data),
--                         sync_role_to_user_metadata and demo.py (UPDATE raw_user_meta_data)
--   auth.uid()            43 row-level-security policies and the chat_can_read / is_admin / my_firm_id
--                         functions; Supabase sets request.jwt.claim.sub per request, so here it is
--                         NULL unless a session sets it, and the API (owner / superuser) bypasses RLS
--   auth.role(), auth.jwt()  stubs of the same shape, for anything that reads them in a session
--   authenticated, anon, service_role   policies say "TO authenticated"; the other two complete the set
--   supabase_realtime     2026-11-02_trades_realtime.sql adds public.trades to it
--   pgcrypto, uuid-ossp   gen_random_uuid() is built in since PostgreSQL 13; the extensions are created
--                         where available so a uuid_generate_v4() default would also work

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS auth;

-- The columns of Supabase's initial auth.users (the platform pre-creates this table and GoTrue's own
-- migrations add the rest on top with IF NOT EXISTS), so docker-compose can start GoTrue after this
-- stub exactly as a Supabase project does. The schema touches id, email and raw_user_meta_data.
-- encrypted_password holds nothing here: tokens are minted by stack/token.py against a local key.
CREATE TABLE IF NOT EXISTS auth.users (
    instance_id          uuid,
    id                   uuid PRIMARY KEY,
    aud                  varchar(255),
    role                 varchar(255),
    email                varchar(255) UNIQUE,
    encrypted_password   varchar(255),
    confirmed_at         timestamptz,
    invited_at           timestamptz,
    confirmation_token   varchar(255),
    confirmation_sent_at timestamptz,
    recovery_token       varchar(255),
    recovery_sent_at     timestamptz,
    email_change_token   varchar(255),
    email_change         varchar(255),
    email_change_sent_at timestamptz,
    last_sign_in_at      timestamptz,
    raw_app_meta_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw_user_meta_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_super_admin       boolean,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Supabase's auth.uid(): the JWT subject the API gateway sets on the session. NULL here.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- The roles the policies name. NOLOGIN: nothing connects as them in this stack.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END $$;

-- The realtime publication the trades migration adds to. Created empty (not FOR ALL TABLES) so
-- "ALTER PUBLICATION supabase_realtime ADD TABLE public.trades" is the operation it expects.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;
