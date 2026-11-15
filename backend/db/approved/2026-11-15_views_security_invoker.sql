-- 2026-11-15_views_security_invoker.sql: five views read with the caller's rights, not their owner's.
--
-- pnl_daily_by_desk, pnl_mtd_by_trade, trade_latest_event, cashflow_net_by_date and cashflows_upcoming were made
-- before October 2026 as plain views. A plain view reads its tables with the rights of the role that owns it, so
-- the row-level security of the tables underneath (trades, trade_events, cashflows, the P&L tables) did not apply
-- to a reader of the view: an account could read other accounts' rows through it. Supabase's security advisor
-- reports each of the five as an error. With security_invoker a view reads as the caller, and the tables' own
-- policies decide what it returns.
--
-- No code reads these views: the API queries the tables. Nothing is dropped, no grant and no policy changes.
-- Idempotent: it sets one option on each view; a view that is absent is skipped.

ALTER VIEW IF EXISTS public.pnl_daily_by_desk    SET (security_invoker = true);
ALTER VIEW IF EXISTS public.pnl_mtd_by_trade     SET (security_invoker = true);
ALTER VIEW IF EXISTS public.trade_latest_event   SET (security_invoker = true);
ALTER VIEW IF EXISTS public.cashflow_net_by_date SET (security_invoker = true);
ALTER VIEW IF EXISTS public.cashflows_upcoming   SET (security_invoker = true);
