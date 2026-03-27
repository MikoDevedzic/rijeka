
-- ============================================================
-- Rijeka — Sprint 3E: Option leg types
-- Paste into Supabase SQL Editor → Run
-- ============================================================

-- Drop the existing leg_type CHECK constraint
ALTER TABLE trade_legs DROP CONSTRAINT IF EXISTS trade_legs_leg_type_check;

-- Re-add with option leg types included
ALTER TABLE trade_legs ADD CONSTRAINT trade_legs_leg_type_check CHECK (
  leg_type IN (
    -- Linear instruments (Sprint 2-3)
    'FIXED', 'FLOAT', 'ZERO_COUPON', 'INFLATION',
    'CMS', 'CDS_FEE', 'CDS_CONTINGENT',
    'TOTAL_RETURN', 'EQUITY_RETURN', 'EQUITY_FWD',
    'VARIANCE', 'DIVIDEND',
    'COMMODITY_FLOAT', 'EMISSIONS_FLOAT',
    'RPA_FEE', 'RPA_CONTINGENT',
    -- Options (Sprint 3E)
    'IR_SWAPTION', 'CAP_FLOOR',
    'FX_OPTION',
    'EQUITY_OPTION',
    'COMMODITY_OPTION',
    'CDS_OPTION'
  )
);

-- Verify
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'trade_legs'::regclass
  AND conname = 'trade_legs_leg_type_check';
