-- trades.structure: let it carry an option's style.
-- The column was created with an inline CHECK over ten swap structures (trades_structure_check,
-- docs/schema.sql), which rejected the first FX option booked with structure = BARRIER on
-- 2026-11-02. Per-instrument allowlists are the rule since migration 007 (the IR_SWAP one stays),
-- so the inline CHECK goes and an FX_OPTION one takes its place: the six styles
-- (pricing/fx_exotic.STYLES) and VANILLA for the rows booked before the structure followed the
-- style. Those rows are NOT backfilled: structure is in the canonical record that was hashed and
-- signed on-chain for the confirmed ones, and the blotter already reads their style from the
-- terms (api/routes/trades.display_structure).
-- After running this, delete STORED_STRUCTURES in backend/api/routes/trades.py so new bookings
-- store the style itself.
BEGIN;
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_structure_check;
ALTER TABLE trades DROP CONSTRAINT IF EXISTS chk_trades_fx_option_structure_valid;
ALTER TABLE trades
  ADD CONSTRAINT chk_trades_fx_option_structure_valid
  CHECK (instrument_type <> 'FX_OPTION'
         OR structure IN ('EUROPEAN', 'AMERICAN', 'DIGITAL', 'BARRIER', 'DOUBLE_BARRIER', 'TOUCH', 'VANILLA'));
COMMIT;
-- Verify: SELECT conname FROM pg_constraint WHERE conrelid = 'trades'::regclass AND conname LIKE '%structure%';
--   expect chk_trades_ir_swap_structure_valid and chk_trades_fx_option_structure_valid, no trades_structure_check.
