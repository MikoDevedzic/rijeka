-- 2026-11-17_legal_entity_margin_version.sql: legal_entities.simm_version is dropped.
--
-- The column held a version string of a licensed margin methodology ('v2.6' by default) that the engine has
-- never computed and no screen has shown. From 0.54.1 nothing reads or writes it: the model, the API, the demo
-- and the seed no longer name it, and an insert relies on the column's own default while it still exists.
--
-- Apply only once 0.54.1 or later is deployed: an older API selects the column by name and would fail without
-- it. Idempotent: IF EXISTS. Destructive by nature (a column and its values go); the values are the default
-- string on every row, or what an onboarding form sent, and are used by nothing.

ALTER TABLE public.legal_entities DROP COLUMN IF EXISTS simm_version;
