// swaptionVols.js — Sprint 6A
// Bloomberg tickers via ICAP (ICPL source): USSNA[expiry_code][tenor_code] ICPL Curncy
// Field: MID (bp normal vol). ICAP surface goes to 9Y tenor max.
// 10Y expiry code: 101 (ICPL) — not J (J is BGN only, confirmed from Excel)
// Source confirmed working via BDP in Excel.

export const SWAPTION_EXPIRIES = ['1Y','2Y','3Y','5Y','7Y','10Y'];
export const SWAPTION_TENORS   = ['1Y','2Y','3Y','5Y','7Y','9Y'];

const EXPIRY_CODE = {'1Y':'1','2Y':'2','3Y':'3','5Y':'5','7Y':'7','10Y':'10'};
const TENOR_CODE  = {'1Y':'1','2Y':'2','3Y':'3','5Y':'5','7Y':'7','9Y':'9'};

function bbgTicker(e,t){
  return 'USSNA'+EXPIRY_CODE[e]+TENOR_CODE[t]+' ICPL Curncy';
}

export const SWAPTION_VOL_GRID = SWAPTION_EXPIRIES.map((expiry) => ({
  expiry,
  cells: SWAPTION_TENORS.map((tenor) => ({
    tenor, ticker: bbgTicker(expiry,tenor), vol_bp: null, enabled: true,
  })),
}));

export const SWVOL_CURVE_ID = 'USD_SWVOL_ATM';

// HW1F calibration basket — co-terminal (sum to 5Y) + diagonal + long-end
export const HW1F_CALIBRATION_BASKET = [
  {expiry:'1Y', tenor:'4Y', ticker:'USSNA14 ICPL Curncy',  role:'co_terminal'},
  {expiry:'2Y', tenor:'3Y', ticker:'USSNA23 ICPL Curncy',  role:'co_terminal'},
  {expiry:'3Y', tenor:'2Y', ticker:'USSNA32 ICPL Curncy',  role:'co_terminal'},
  {expiry:'4Y', tenor:'1Y', ticker:'USSNA41 ICPL Curncy',  role:'co_terminal'},
  {expiry:'1Y', tenor:'5Y', ticker:'USSNA15 ICPL Curncy',  role:'diagonal'},
  {expiry:'2Y', tenor:'5Y', ticker:'USSNA25 ICPL Curncy',  role:'diagonal'},
  {expiry:'5Y', tenor:'5Y', ticker:'USSNA55 ICPL Curncy',  role:'diagonal'},
  {expiry:'1Y', tenor:'9Y', ticker:'USSNA19 ICPL Curncy',  role:'long_end'},
  {expiry:'5Y', tenor:'9Y', ticker:'USSNA59 ICPL Curncy',  role:'long_end'},
  {expiry:'10Y',tenor:'9Y', ticker:'USSNA109 ICPL Curncy', role:'long_end'},
];

export function getVolBp(g,e,t){
  const row=g.find((r)=>r.expiry===e);
  return row?.cells.find((c)=>c.tenor===t)?.vol_bp??null;
}