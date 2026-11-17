-- 2026-11-17_im_model_default.sql: a counterparty's margin basis no longer defaults to the name of a licensed
-- methodology.
--
-- counterparties.im_model was created with the default 'SIMM'. The engine has never computed that methodology
-- (it is licensed; the firm holds no licence), and since 0.30.3 the API writes 'MODEL' and every reader shows
-- the old value as MODEL: the initial margin is the amount the desk sets or the engine's own estimate. This
-- makes the column say so: the default becomes 'MODEL' and the rows still holding the old default are set to
-- 'MODEL'. No other value is touched, and the column keeps its NOT NULL.
--
-- Idempotent: a default set twice is the same default, and the second run of the update finds no row.
-- Safe at any time: every reader already treats the two values alike.

ALTER TABLE public.counterparties ALTER COLUMN im_model SET DEFAULT 'MODEL';

UPDATE public.counterparties SET im_model = 'MODEL' WHERE im_model = 'SIMM';
