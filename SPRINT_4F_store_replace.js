// SPRINT_4F_store_replace.js
// Complete replacement of useMarketDataStore.js with real save/load implementations
// Run from Rijeka root: node SPRINT_4F_store_replace.js

const fs = require('fs');
const FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\store\\useMarketDataStore.js';

const content = `import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { RATES_CURVES, CCY_GROUPS, getCurve } from '../data/ratesCurves';

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000';

// Deep-clone instruments so quote edits don't mutate the module-level array
const cloneInstruments = (curves) =>
  curves.map((c) => ({
    ...c,
    instruments: c.instruments ? c.instruments.map((i) => ({ ...i })) : undefined,
    spreads: c.spreads ? { ...c.spreads } : undefined,
  }));

const initialCurves = cloneInstruments(RATES_CURVES);

// Build initial openGroups — all groups open
const initialOpenGroups = {};
CCY_GROUPS.forEach((g) => { initialOpenGroups[g.ccy] = true; });

const useMarketDataStore = create((set, get) => ({
  // ── Curve data (mutable copies) ──────────────────────────────────────────
  curves: initialCurves,

  // ── Curves workspace state ────────────────────────────────────────────────
  selectedCurveId: null,
  innerTab: 'def',
  typeFilter: 'all',
  openGroups: initialOpenGroups,
  curveInterp: {},
  fundingMode: {},

  // ── Snapshot state per curveId ────────────────────────────────────────────
  snapshotSaving: {},   // { [curveId]: bool }
  snapshotSaved:  {},   // { [curveId]: { date, source } }
  snapshotError:  {},   // { [curveId]: string }

  // ── Actions ───────────────────────────────────────────────────────────────
  selectCurve: (id) => set({ selectedCurveId: id, innerTab: 'def' }),
  setInnerTab: (tab) => set({ innerTab: tab }),
  setTypeFilter: (f) => set({ typeFilter: f }),
  toggleGroup: (ccy) =>
    set((s) => ({ openGroups: { ...s.openGroups, [ccy]: !s.openGroups[ccy] } })),
  setInterp: (curveId, interpId) =>
    set((s) => ({ curveInterp: { ...s.curveInterp, [curveId]: interpId } })),
  setFundingMode: (curveId, mode) =>
    set((s) => ({ fundingMode: { ...s.fundingMode, [curveId]: mode } })),

  toggleInstrument: (curveId, idx, enabled) =>
    set((s) => ({
      curves: s.curves.map((c) =>
        c.id !== curveId ? c : {
          ...c,
          instruments: c.instruments.map((inst, i) =>
            i === idx ? { ...inst, en: enabled } : inst
          ),
        }
      ),
    })),

  updateQuote: (curveId, idx, value) => {
    const v = parseFloat(value);
    if (isNaN(v)) return;
    set((s) => ({
      curves: s.curves.map((c) =>
        c.id !== curveId ? c : {
          ...c,
          instruments: c.instruments.map((inst, i) =>
            i === idx ? { ...inst, quote: v } : inst
          ),
        }
      ),
    }));
  },

  updateSpread: (curveId, key, value) => {
    const v = parseFloat(value);
    if (isNaN(v)) return;
    set((s) => ({
      curves: s.curves.map((c) =>
        c.id !== curveId ? c : { ...c, spreads: { ...c.spreads, [key]: v } }
      ),
    }));
  },

  applyFlatSpread: (curveId, value) => {
    const v = parseFloat(value);
    if (isNaN(v)) return;
    set((s) => ({
      curves: s.curves.map((c) => {
        if (c.id !== curveId) return c;
        const newSpreads = {};
        Object.keys(c.spreads).forEach((k) => { newSpreads[k] = v; });
        return { ...c, spreads: newSpreads };
      }),
    }));
  },

  resetSpreads: (curveId) => {
    const original = getCurve(curveId);
    if (!original?.spreads) return;
    set((s) => ({
      curves: s.curves.map((c) =>
        c.id !== curveId ? c : { ...c, spreads: { ...original.spreads } }
      ),
    }));
  },

  // ── Sprint 4F: market data persistence ───────────────────────────────────

  /**
   * Save current quotes for a curve to market_data_snapshots.
   * rate stored as % (5.310), matching ratesCurves.js convention.
   */
  saveSnapshot: async (curveId, valuationDate) => {
    set((s) => ({
      snapshotSaving: { ...s.snapshotSaving, [curveId]: true },
      snapshotError:  { ...s.snapshotError,  [curveId]: null },
    }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const curve = get().curves.find((c) => c.id === curveId);
      if (!curve) throw new Error('Curve not found: ' + curveId);
      if (!curve.instruments?.length) throw new Error('No instruments on curve');

      const quotes = curve.instruments.map((inst) => ({
        tenor:      inst.tenor,
        quote_type: inst.type,
        rate:       inst.quote,
        enabled:    inst.en !== false,
      }));

      const res = await fetch(API + '/api/market-data/snapshots', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          curve_id:       curveId,
          valuation_date: valuationDate || new Date().toISOString().slice(0, 10),
          quotes,
          source: 'MANUAL',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Save failed');
      }

      const saved = await res.json();
      set((s) => ({
        snapshotSaving: { ...s.snapshotSaving, [curveId]: false },
        snapshotSaved:  { ...s.snapshotSaved,  [curveId]: { date: saved.valuation_date, source: saved.source } },
      }));
    } catch (e) {
      set((s) => ({
        snapshotSaving: { ...s.snapshotSaving, [curveId]: false },
        snapshotError:  { ...s.snapshotError,  [curveId]: e.message },
      }));
    }
  },

  /**
   * Load the latest snapshot for a curve from DB and update store quotes.
   * Non-fatal if no snapshot exists — workspace still usable with defaults.
   */
  loadLatestSnapshot: async (curveId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(API + '/api/market-data/snapshots/' + curveId + '/latest', {
        headers: { 'Authorization': 'Bearer ' + session.access_token },
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.exists || !data.quotes?.length) return;

      set((s) => ({
        curves: s.curves.map((c) => {
          if (c.id !== curveId) return c;
          const updated = c.instruments.map((inst) => {
            const match = data.quotes.find((q) => q.tenor === inst.tenor);
            if (!match) return inst;
            return { ...inst, quote: match.rate, en: match.enabled !== false };
          });
          return { ...c, instruments: updated };
        }),
        snapshotSaved: {
          ...s.snapshotSaved,
          [curveId]: { date: data.valuation_date, source: data.source },
        },
      }));
    } catch (_) {
      // Non-fatal
    }
  },

  // Computed helper — get a curve from the mutable copy
  getCurveById: (id) => get().curves.find((c) => c.id === id),
}));

export default useMarketDataStore;
`;

fs.writeFileSync(FILE, content, 'utf8');
console.log('Done. useMarketDataStore.js written with real saveSnapshot + loadLatestSnapshot.');
