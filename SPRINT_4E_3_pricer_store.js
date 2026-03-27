// SPRINT_4E_3_pricer_store.js
// Writes: frontend/src/store/usePricerStore.js
// Adds: curve mode (flat|market), pillar state, buildCurveInputs()
// Run from Rijeka root: node SPRINT_4E_3_pricer_store.js

const fs = require('fs');
const path = require('path');

const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

const content = `// usePricerStore.js — Sprint 4E (curve bootstrap)
// Manages: pricing results, curve mode (flat|market), pillar quote state.

import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Default pillar templates by curve type ───────────────────────────────────

const OIS_PILLARS = [
  { tenor: 'ON',  quote_type: 'DEPOSIT',  rate: '' },
  { tenor: '1W',  quote_type: 'DEPOSIT',  rate: '' },
  { tenor: '1M',  quote_type: 'DEPOSIT',  rate: '' },
  { tenor: '3M',  quote_type: 'DEPOSIT',  rate: '' },
  { tenor: '6M',  quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '9M',  quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '1Y',  quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '2Y',  quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '3Y',  quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '5Y',  quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '7Y',  quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '10Y', quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '15Y', quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '20Y', quote_type: 'OIS_SWAP', rate: '' },
  { tenor: '30Y', quote_type: 'OIS_SWAP', rate: '' },
];

const IRS_PILLARS = [
  { tenor: 'ON',  quote_type: 'DEPOSIT', rate: '' },
  { tenor: '1W',  quote_type: 'DEPOSIT', rate: '' },
  { tenor: '1M',  quote_type: 'DEPOSIT', rate: '' },
  { tenor: '3M',  quote_type: 'DEPOSIT', rate: '' },
  { tenor: '6M',  quote_type: 'DEPOSIT', rate: '' },
  { tenor: '1Y',  quote_type: 'IRS',     rate: '' },
  { tenor: '2Y',  quote_type: 'IRS',     rate: '' },
  { tenor: '3Y',  quote_type: 'IRS',     rate: '' },
  { tenor: '5Y',  quote_type: 'IRS',     rate: '' },
  { tenor: '7Y',  quote_type: 'IRS',     rate: '' },
  { tenor: '10Y', quote_type: 'IRS',     rate: '' },
  { tenor: '20Y', quote_type: 'IRS',     rate: '' },
  { tenor: '30Y', quote_type: 'IRS',     rate: '' },
];

function defaultPillars(curveId) {
  const id = (curveId || '').toUpperCase();
  if (
    id.includes('SOFR') || id.includes('SONIA') || id.includes('ESTR') ||
    id.includes('TONAR') || id.includes('CORRA') || id.includes('OIS')
  ) {
    return OIS_PILLARS.map(p => ({ ...p }));
  }
  return IRS_PILLARS.map(p => ({ ...p }));
}

// ── Formatters (exported) ────────────────────────────────────────────────────

export function fmtCcy(amount, ccy = 'USD') {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: ccy,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

export function fmtBps(rate) {
  if (rate == null || isNaN(rate)) return '—';
  return \`\${(rate * 10000).toFixed(2)} bps\`;
}

export function fmtPct(rate) {
  if (rate == null || isNaN(rate)) return '—';
  return \`\${(rate * 100).toFixed(4)}%\`;
}

// ── Store ────────────────────────────────────────────────────────────────────

const usePricerStore = create((set, get) => ({

  // Pricing results keyed by tradeId
  resultsByTrade: {},

  // Per-trade loading / error flags
  loadingByTrade: {},
  errorByTrade: {},

  // Curve state keyed by curveId:
  //   { mode: 'flat'|'market', flat_rate: number, pillars: PillarRow[] }
  curveStates: {},

  // ── Curve state management ────────────────────────────────────────────────

  /**
   * Initialize state for a list of curve IDs if not already present.
   * Called by TradeWorkspace when the PRICING tab opens.
   */
  initCurveState(curveIds, defaultRate = 0.0525) {
    const existing = get().curveStates;
    const updates = {};
    for (const id of curveIds) {
      if (!existing[id]) {
        updates[id] = {
          mode: 'flat',
          flat_rate: defaultRate,
          pillars: defaultPillars(id),
        };
      }
    }
    if (Object.keys(updates).length > 0) {
      set(s => ({ curveStates: { ...s.curveStates, ...updates } }));
    }
  },

  setCurveMode(curveId, mode) {
    set(s => ({
      curveStates: {
        ...s.curveStates,
        [curveId]: { ...(s.curveStates[curveId] || {}), mode },
      },
    }));
  },

  setFlatRate(curveId, pctValue) {
    // pctValue is from UI: 5.25 → stored as 0.0525
    const rate = parseFloat(pctValue);
    set(s => ({
      curveStates: {
        ...s.curveStates,
        [curveId]: {
          ...(s.curveStates[curveId] || {}),
          flat_rate: isNaN(rate) ? 0 : rate / 100,
        },
      },
    }));
  },

  setPillarRate(curveId, index, rawValue) {
    set(s => {
      const cs = s.curveStates[curveId];
      if (!cs) return s;
      const pillars = cs.pillars.map((p, i) =>
        i === index ? { ...p, rate: rawValue } : p
      );
      return { curveStates: { ...s.curveStates, [curveId]: { ...cs, pillars } } };
    });
  },

  setPillarType(curveId, index, quoteType) {
    set(s => {
      const cs = s.curveStates[curveId];
      if (!cs) return s;
      const pillars = cs.pillars.map((p, i) =>
        i === index ? { ...p, quote_type: quoteType } : p
      );
      return { curveStates: { ...s.curveStates, [curveId]: { ...cs, pillars } } };
    });
  },

  // ── Serialize to API payload ───────────────────────────────────────────────

  /**
   * Build the curves[] array for the /api/pricer/price request.
   * Switches between flat_rate (mode='flat') and quotes[] (mode='market').
   */
  buildCurveInputs(curveIds) {
    const { curveStates } = get();
    return curveIds.map(id => {
      const cs = curveStates[id];
      if (!cs || cs.mode === 'flat') {
        return { curve_id: id, flat_rate: cs?.flat_rate ?? 0.0525 };
      }
      // Market mode: filter out blank rows, convert % → decimal
      const quotes = cs.pillars
        .filter(p => p.rate !== '' && p.rate !== null && !isNaN(parseFloat(p.rate)))
        .map(p => ({
          tenor: p.tenor,
          quote_type: p.quote_type,
          rate: parseFloat(p.rate) / 100,
        }));
      if (quotes.length < 2) {
        // Insufficient quotes — fall back to flat
        return { curve_id: id, flat_rate: cs.flat_rate ?? 0.0525 };
      }
      return { curve_id: id, quotes };
    });
  },

  // ── Price trade ────────────────────────────────────────────────────────────

  async priceTrade(tradeId, curveInputs, valuationDate) {
    set(s => ({
      loadingByTrade: { ...s.loadingByTrade, [tradeId]: true },
      errorByTrade:   { ...s.errorByTrade,   [tradeId]: null },
    }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(\`\${API}/api/pricer/price\`, {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${session.access_token}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trade_id: tradeId,
          curves: curveInputs,
          ...(valuationDate ? { valuation_date: valuationDate } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Pricing failed');
      }

      const result = await res.json();
      set(s => ({
        resultsByTrade: { ...s.resultsByTrade, [tradeId]: result },
        loadingByTrade: { ...s.loadingByTrade, [tradeId]: false },
      }));
      return result;
    } catch (e) {
      set(s => ({
        loadingByTrade: { ...s.loadingByTrade, [tradeId]: false },
        errorByTrade:   { ...s.errorByTrade,   [tradeId]: e.message },
      }));
      throw e;
    }
  },

  // ── Generate cashflows ─────────────────────────────────────────────────────

  async generateCashflows(tradeId, curveInputs, valuationDate) {
    set(s => ({
      loadingByTrade: { ...s.loadingByTrade, [tradeId]: true },
      errorByTrade:   { ...s.errorByTrade,   [tradeId]: null },
    }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(\`\${API}/api/pricer/cashflows/generate\`, {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${session.access_token}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trade_id: tradeId,
          curves: curveInputs,
          ...(valuationDate ? { valuation_date: valuationDate } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Cashflow generation failed');
      }

      const result = await res.json();
      set(s => ({
        loadingByTrade: { ...s.loadingByTrade, [tradeId]: false },
      }));
      return result;
    } catch (e) {
      set(s => ({
        loadingByTrade: { ...s.loadingByTrade, [tradeId]: false },
        errorByTrade:   { ...s.errorByTrade,   [tradeId]: e.message },
      }));
      throw e;
    }
  },

}));

export default usePricerStore;
`;

const dest = path.join(RIJEKA, 'frontend', 'src', 'store', 'usePricerStore.js');
fs.writeFileSync(dest, content, 'utf8');
console.log('✓ Written: ' + dest);
