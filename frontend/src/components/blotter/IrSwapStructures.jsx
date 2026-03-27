// IrSwapStructures.jsx
// IR_SWAP variant definitions + STRUCTURE selector component
// Sprint 4A: IR_SWAP STRUCTURE consolidation
//
// instrument_type is always stored as IR_SWAP.
// terms.structure + trades.structure store the variant.
// Drives ISDA SIMM bucketing (Sprint 5) and blotter display.

// ── Structure Definitions ────────────────────────────────────
// Each entry defines the ISDA class, description, and default
// leg configuration that pre-populates the leg builder.
// fixed_rate left blank '' — trader must enter their rate.

export const IR_SWAP_STRUCTURES = [
  {
    value:       'VANILLA',
    label:       'VANILLA',
    description: 'Fixed / Float, same CCY',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'OIS',
    label:       'OIS',
    description: 'Daily compounding float, OIS curve',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 2,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'ANNUAL',
        reset_frequency: 'DAILY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        ois_compounding: 'FLAT', spread: 0,
        notional_type: 'BULLET', payment_lag: 2,
      },
    ],
  },
  {
    value:       'BASIS',
    label:       'BASIS',
    description: 'Float / Float, tenor spread',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FLOAT', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        reset_frequency: 'SEMI_ANNUAL', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0.001, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'XCCY',
    label:       'XCCY',
    description: 'Cross-currency, dual notional exchange',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FLOAT', direction: 'PAY',
        currency: 'USD',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        currency: 'EUR',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        reset_frequency: 'SEMI_ANNUAL', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'EUR_ESTR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'ZERO_COUPON',
    label:       'ZERO COUPON',
    description: 'Single bullet exchange at maturity',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: '30/360', payment_frequency: 'ZERO_COUPON',
        bdc: 'MOD_FOLLOWING',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'ZERO_COUPON',
        reset_frequency: 'ZERO_COUPON', bdc: 'MOD_FOLLOWING',
        forecast_curve_id: 'USD_SOFR', spread: 0,
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'STEP_UP',
    label:       'STEP UP',
    description: 'Step fixed rate — callable / structured',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'FIXED', direction: 'PAY',
        day_count: '30/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'STEP',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FLOAT', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'QUARTERLY',
        reset_frequency: 'QUARTERLY', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', forecast_curve_id: 'USD_SOFR',
        spread: 0, notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'INFLATION_ZC',
    label:       'INFLATION ZC',
    description: 'Zero-coupon CPI swap — LDI / pension',
    isda_class:  'Inflation',
    legs: [
      {
        leg_type: 'INFLATION', direction: 'PAY',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ZERO_COUPON',
        bdc: 'MOD_FOLLOWING', forecast_curve_id: 'USD_CPI',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FIXED', direction: 'RECEIVE',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ZERO_COUPON',
        bdc: 'MOD_FOLLOWING',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'INFLATION_YOY',
    label:       'INFLATION YOY',
    description: 'Year-on-year CPI swap',
    isda_class:  'Inflation',
    legs: [
      {
        leg_type: 'INFLATION', direction: 'PAY',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ANNUAL',
        bdc: 'MOD_FOLLOWING', forecast_curve_id: 'USD_CPI',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FIXED', direction: 'RECEIVE',
        day_count: 'ACT/ACT ISDA', payment_frequency: 'ANNUAL',
        bdc: 'MOD_FOLLOWING',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'CMS',
    label:       'CMS',
    description: 'Constant maturity swap rate vs fixed',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'CMS', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        forecast_curve_id: 'USD_SOFR',
        notional_type: 'BULLET', payment_lag: 0,
      },
      {
        leg_type: 'FIXED', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        fixed_rate: '', fixed_rate_type: 'FLAT',
        notional_type: 'BULLET', payment_lag: 0,
      },
    ],
  },
  {
    value:       'CMS_SPREAD',
    label:       'CMS SPREAD',
    description: 'Curve steepener / flattener (30Y−2Y)',
    isda_class:  'InterestRate',
    legs: [
      {
        leg_type: 'CMS', direction: 'PAY',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        forecast_curve_id: 'USD_SOFR',
        notional_type: 'BULLET', payment_lag: 0,
        // cms_tenor: '30Y' — stored in leg terms
      },
      {
        leg_type: 'CMS', direction: 'RECEIVE',
        day_count: 'ACT/360', payment_frequency: 'SEMI_ANNUAL',
        bdc: 'MOD_FOLLOWING', stub_type: 'SHORT_FRONT',
        forecast_curve_id: 'USD_SOFR',
        notional_type: 'BULLET', payment_lag: 0,
        // cms_tenor: '2Y' — stored in leg terms
      },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────

export function getStructureByValue(value) {
  return IR_SWAP_STRUCTURES.find(s => s.value === value)
    ?? IR_SWAP_STRUCTURES[0];    // default VANILLA
}

/**
 * Returns a leg array ready to load into the leg builder.
 * Each leg gets a fresh UUID and seq index.
 * Caller may override currency / notional / dates after the call.
 */
export function getStructureLegs(structureValue) {
  const s = getStructureByValue(structureValue);
  return s.legs.map((leg, i) => ({
    ...leg,
    leg_id:  crypto.randomUUID(),
    leg_ref: `L${i + 1}`,
    leg_seq: i,
  }));
}

// ── IrSwapStructureSelector component ───────────────────────

export default function IrSwapStructureSelector({ value, onChange }) {
  return (
    <div className="structure-selector">
      <label className="structure-selector__label">STRUCTURE</label>
      <div className="structure-selector__grid">
        {IR_SWAP_STRUCTURES.map(s => (
          <button
            key={s.value}
            type="button"
            className={`structure-btn${value === s.value ? ' structure-btn--active' : ''}`}
            onClick={() => onChange(s.value)}
            title={s.description}
          >
            <span className="structure-btn__label">{s.label}</span>
            <span className="structure-btn__desc">{s.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
