// useXVAStore.js — Sprint 6A
// Mirrors useMarketDataStore pattern exactly.
// Serialises vol quotes as {tenor:'1Yx5Y', quote_type:'SWVOL', rate:vol_bp}
// so market_data.py PillarQuoteIn validation passes without backend changes.

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { SWAPTION_VOL_GRID, SWVOL_CURVE_ID } from '../data/swaptionVols';

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000';
const cloneGrid = (g) => g.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c })) }));

const useXVAStore = create((set, get) => ({
  grid: cloneGrid(SWAPTION_VOL_GRID),
  snapshotSaving: false,
  snapshotSaved:  null,
  snapshotError:  null,
  calibration:    null,

  updateVol: (expiry, tenor, vol_bp) => {
    const v = parseFloat(vol_bp);
    set((s) => ({
      grid: s.grid.map((row) =>
        row.expiry !== expiry ? row : {
          ...row,
          cells: row.cells.map((c) =>
            c.tenor !== tenor ? c : { ...c, vol_bp: isNaN(v) ? null : v }
          ),
        }
      ),
    }));
  },

  toggleCell: (expiry, tenor, enabled) =>
    set((s) => ({
      grid: s.grid.map((row) =>
        row.expiry !== expiry ? row : {
          ...row,
          cells: row.cells.map((c) => c.tenor !== tenor ? c : { ...c, enabled }),
        }
      ),
    })),

  saveSnapshot: async (valuationDate, source) => {
    set({ snapshotSaving: true, snapshotError: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const grid = get().grid;
      const quotes = grid.flatMap((row) =>
        row.cells
          .filter((c) => c.vol_bp !== null && c.vol_bp !== undefined)
          .map((c) => ({
            tenor:      row.expiry + 'x' + c.tenor,
            quote_type: 'SWVOL',
            rate:       c.vol_bp,
            enabled:    c.enabled,
            expiry:     row.expiry,
            swp_tenor:  c.tenor,
            ticker:     c.ticker,
          }))
      );
      if (!quotes.length) throw new Error('No vol data to save');
      const res = await fetch(API + '/api/market-data/snapshots', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curve_id:       SWVOL_CURVE_ID,
          valuation_date: valuationDate || new Date().toISOString().slice(0, 10),
          quotes,
          source: source || 'MANUAL',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Save failed');
      }
      const saved = await res.json();
      set({ snapshotSaving: false, snapshotSaved: { date: saved.valuation_date, source: saved.source } });
    } catch (e) {
      set({ snapshotSaving: false, snapshotError: e.message });
    }
  },

  loadLatestSnapshot: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        API + '/api/market-data/snapshots/' + SWVOL_CURVE_ID + '/latest',
        { headers: { 'Authorization': 'Bearer ' + session.access_token } }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!data.exists || !data.quotes?.length) return;
      set((s) => ({
        grid: s.grid.map((row) => ({
          ...row,
          cells: row.cells.map((c) => {
            const match = data.quotes.find((q) =>
              q.tenor === row.expiry + 'x' + c.tenor ||
              (q.expiry === row.expiry && q.swp_tenor === c.tenor)
            );
            return match ? { ...c, vol_bp: match.rate, enabled: match.enabled !== false } : c; // ticker preserved from static definition
          }),
        })),
        snapshotSaved: { date: data.valuation_date, source: data.source },
      }));
    } catch (_) {}
  },

  setCalibration: (result) => set({ calibration: result }),

  getVol: (expiry, tenor) => {
    const row = get().grid.find((r) => r.expiry === expiry);
    return row?.cells.find((c) => c.tenor === tenor)?.vol_bp ?? null;
  },

  filledCount: () =>
    get().grid.reduce((n, row) => n + row.cells.filter((c) => c.vol_bp !== null).length, 0),
}));

export default useXVAStore;