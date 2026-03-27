
-- ============================================================
-- Rijeka — Sprint 3F: Extended option leg types
-- Paste into Supabase SQL Editor → Run
-- ============================================================

ALTER TABLE trade_legs DROP CONSTRAINT IF EXISTS trade_legs_leg_type_check;

ALTER TABLE trade_legs ADD CONSTRAINT trade_legs_leg_type_check CHECK (
  leg_type IN (
    -- Linear (Sprint 2-3)
    'FIXED', 'FLOAT', 'ZERO_COUPON', 'INFLATION',
    'CMS', 'CDS_FEE', 'CDS_CONTINGENT',
    'TOTAL_RETURN', 'EQUITY_RETURN', 'EQUITY_FWD',
    'VARIANCE', 'DIVIDEND',
    'COMMODITY_FLOAT', 'EMISSIONS_FLOAT',
    'RPA_FEE', 'RPA_CONTINGENT',
    -- Options Sprint 3E
    'IR_SWAPTION', 'CAP_FLOOR',
    'FX_OPTION',
    'EQUITY_OPTION',
    'COMMODITY_OPTION',
    'CDS_OPTION',
    -- Options Sprint 3F
    'BERMUDAN_SWAPTION',
    'CALLABLE_SWAP_OPTION',   -- the embedded swaption leg within a callable swap
    'CAPPED_FLOORED_FLOAT',   -- float leg with embedded cap/floor/collar
    'EXTENDABLE_FORWARD',
    'COMMODITY_ASIAN_OPTION'  -- enhanced commodity option with averaging window control
  )
);

-- Verify
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'trade_legs'::regclass
  AND conname = 'trade_legs_leg_type_check';
