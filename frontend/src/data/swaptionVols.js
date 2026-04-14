// swaptionVols.js — Sprint 8
// ─────────────────────────────────────────────────────────────────────────────
// ATM surface:   USSNA[exp][ten] ICPL Curncy   — ICAP source, normal vol bp
// OTM negative:  USW[X]A[exp][ten] SMKO Curncy — Bloomberg SMKO source
//   USWG = -200bp absolute  |  USWE = -100bp  |  USWC = -50bp  |  USWB = -25bp
// OTM positive:  +25/+50/+100/+200bp tickers NOT YET IDENTIFIED in Bloomberg
//                (separate series — need to locate from Bloomberg)
// FWD rate:      USSKA[exp][ten] SMKO Curncy   — ATM forward rate %
//
// IMPORTANT: SMKO tickers return ABSOLUTE vols in bp (e.g. 112.28 bp)
//            ICPL tickers return ABSOLUTE vols in bp (e.g. 83.98 bp)
//            VCUB screen shows SPREADS vs ATM (e.g. +18.74 bp)
//            Conversion: spread = abs_vol - atm_vol (done automatically on save)
//
// Expiry codes (shared across ICPL and SMKO):
//   3M→C | 6M→F | 1Y→1 | 2Y→2 | 3Y→3 | 5Y→5 | 7Y→7 | 10Y→J | 15Y→K | 20Y→L
// Tenor codes:
//   1Y→1 | 2Y→2 | 3Y→3 | 5Y→5 | 7Y→7 | 9Y→9 | 10Y→10
// ─────────────────────────────────────────────────────────────────────────────

export const SWAPTION_EXPIRIES = ['1Y','2Y','3Y','5Y','7Y','10Y'];
export const SWAPTION_TENORS   = ['1Y','2Y','3Y','5Y','7Y','9Y'];

// ── Expiry / Tenor code maps (used for both ICPL and SMKO tickers) ─────────
export const EXPIRY_CODE = {
  '3M':'C', '6M':'F', '1Y':'1', '2Y':'2', '3Y':'3',
  '5Y':'5', '7Y':'7', '10Y':'J', '15Y':'K', '20Y':'L',
};
export const TENOR_CODE = {
  '1Y':'1', '2Y':'2', '3Y':'3', '5Y':'5',
  '7Y':'7', '9Y':'9', '10Y':'10',
};

// ── ATM tickers — ICAP (ICPL source) ──────────────────────────────────────
// Field: MID · Normal vol bp · ATM straddle
export function atmTicker(exp, ten) {
  return `USSNA${EXPIRY_CODE[exp]}${TENOR_CODE[ten]} ICPL Curncy`;
}

export const SWAPTION_VOL_GRID = SWAPTION_EXPIRIES.map(expiry => ({
  expiry,
  cells: SWAPTION_TENORS.map(tenor => ({
    tenor,
    ticker: atmTicker(expiry, tenor),
    vol_bp: null,
    enabled: true,
  })),
}));

export const SWVOL_CURVE_ID = 'USD_SWVOL_ATM';

// Tenors available in Bloomberg SMKO OTM surface
// Confirmed from ticker list: 1Y, 2Y, 5Y, 10Y only
// 3Y, 7Y, 9Y not available — covered by SABR interpolation
export const OTM_SNAP_TENORS   = ['1Y','2Y','5Y','10Y'];
export const OTM_INTERP_TENORS = ['3Y','7Y','9Y'];  // no SMKO data — SABR fills these
// Negative side: Bloomberg SMKO tickers available
// Positive side: tickers not yet identified — manual entry only
export const OTM_STRIKE_OFFSETS = [-200, -100, -50, -25, 25, 50, 100, 200];

export const OTM_STRIKE_LABELS = {
  '-200': '-200bp', '-100': '-100bp', '-50': '-50bp', '-25': '-25bp',
  '25':   '+25bp',  '50':   '+50bp',  '100': '+100bp', '200': '+200bp',
};

// Strike → Bloomberg SMKO ticker prefix
// Source: confirmed from Bloomberg DES + full ticker list
// All 8 OTM strikes + ATM confirmed:
export const OTM_SMKO_PREFIX = {
  '-200': 'USWG',   // USD Swaption Absolute OTM NVOL -200bp
  '-100': 'USWE',   // USD Swaption Absolute OTM NVOL -100bp
  '-50':  'USWC',   // USD Swaption Absolute OTM NVOL  -50bp
  '-25':  'USWB',   // USD Swaption Absolute OTM NVOL  -25bp
  '25':   'USWL',   // USD Swaption Absolute OTM NVOL  +25bp
  '50':   'USWM',   // USD Swaption Absolute OTM NVOL  +50bp
  '100':  'USWO',   // USD Swaption Absolute OTM NVOL +100bp
  '200':  'USWR',   // USD Swaption Absolute OTM NVOL +200bp
};

// Build SMKO OTM ticker for negative strikes
// Format: USW[X]A[expiry_code][tenor_code] SMKO Curncy
export function otmTicker(offset, exp, ten) {
  const prefix = OTM_SMKO_PREFIX[String(offset)];
  if (!prefix) return null;  // positive OTM — no ticker yet
  return `${prefix}A${EXPIRY_CODE[exp]}${TENOR_CODE[ten]} SMKO Curncy`;
}

// FWD rate tickers — ATM forward swap rate (not vol)
// USSKA[exp][ten] SMKO Curncy
export function fwdRateTicker(exp, ten) {
  return `USSKA${EXPIRY_CODE[exp]}${TENOR_CODE[ten]} SMKO Curncy`;
}

// Build the full OTM skew ticker grid — negative strikes only (SMKO)
// Returns array of { offset_bp, expiry, tenor, ticker, has_ticker }
export function buildOtmTickerGrid() {
  const out = [];
  SWAPTION_EXPIRIES.forEach(exp => {
    SWAPTION_TENORS.forEach(ten => {
      OTM_STRIKE_OFFSETS.forEach(off => {
        const ticker = otmTicker(off, exp, ten);
        out.push({
          offset_bp: off,
          expiry: exp,
          tenor: ten,
          ticker,
          has_ticker: !!ticker,  // false for positive OTM
        });
      });
    });
  });
  return out;
}

// ── HW1F calibration basket ────────────────────────────────────────────────
export const HW1F_CALIBRATION_BASKET = [
  { expiry:'1Y', tenor:'4Y', ticker:'USSNA14 ICPL Curncy',  role:'co_terminal' },
  { expiry:'2Y', tenor:'3Y', ticker:'USSNA23 ICPL Curncy',  role:'co_terminal' },
  { expiry:'3Y', tenor:'2Y', ticker:'USSNA32 ICPL Curncy',  role:'co_terminal' },
  { expiry:'4Y', tenor:'1Y', ticker:'USSNA41 ICPL Curncy',  role:'co_terminal' },
  { expiry:'1Y', tenor:'5Y', ticker:'USSNA15 ICPL Curncy',  role:'diagonal'    },
  { expiry:'2Y', tenor:'5Y', ticker:'USSNA25 ICPL Curncy',  role:'diagonal'    },
  { expiry:'5Y', tenor:'5Y', ticker:'USSNA55 ICPL Curncy',  role:'diagonal'    },
  { expiry:'1Y', tenor:'9Y', ticker:'USSNA19 ICPL Curncy',  role:'long_end'    },
  { expiry:'5Y', tenor:'9Y', ticker:'USSNA59 ICPL Curncy',  role:'long_end'    },
  { expiry:'10Y',tenor:'9Y', ticker:'USSNA109 ICPL Curncy', role:'long_end'    },
];

// ── Expiry / tenor in years ────────────────────────────────────────────────
export const EXPIRY_YEARS = {
  '1Y':1, '2Y':2, '3Y':3, '5Y':5, '7Y':7, '10Y':10,
};
export const TENOR_YEARS = {
  '1Y':1, '2Y':2, '3Y':3, '5Y':5, '7Y':7, '9Y':9,
};

// ── Helper ─────────────────────────────────────────────────────────────────
export function getVolBp(g, e, t) {
  const row = g.find(r => r.expiry === e);
  return row?.cells.find(c => c.tenor === t)?.vol_bp ?? null;
}

// ── Notes for UI display ──────────────────────────────────────────────────
export const VCUB_SKEW_NOTE =
  'Bloomberg VCUB → 14) OTM Swaptions / SABR · Normal Vol Skew · BVOL · Mid\n' +
  'Shows SPREADS vs ATM. SMKO tickers give ABSOLUTE vols.\n' +
  'Use ABSOLUTE VOL mode to snap SMKO tickers directly.';

export const OTM_POSITIVE_NOTE =
  'All 8 OTM strikes confirmed: ±25/±50/±100/±200bp SMKO tickers available.\n' +
  'Full snap supported. Use ABSOLUTE VOL mode → SNAP SMKO TICKERS.';

// Empty skew grid initialiser
export function emptySkewGrid() {
  const grid = {};
  SWAPTION_EXPIRIES.forEach(exp => {
    grid[exp] = {};
    SWAPTION_TENORS.forEach(ten => {
      grid[exp][ten] = {};
      OTM_STRIKE_OFFSETS.forEach(off => { grid[exp][ten][off] = null; });
    });
  });
  return grid;
}
