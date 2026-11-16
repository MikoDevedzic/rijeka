import { create } from 'zustand';
import { RATES_CURVES, CCY_GROUPS, getCurve } from '../data/ratesCurves';
import { getSessionMaybe } from '../lib/session'

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
  typeFilter: 'OIS',
  openGroups: initialOpenGroups,
  curveInterp: {},
  fundingMode: {},

  // ── Snapshot state per curveId ────────────────────────────────────────────
  snapshotSaving: {},   // { [curveId]: bool }
  snapshotSaved:  {},   // { [curveId]: { date, source } }
  snapshotTried:  {},   // { [curveId]: true } once the stored quotes have been asked for and the API has answered or failed
  edited:         {},   // { [curveId]: true } once a quote or a switch of the curve has been changed by hand since it was loaded
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
      edited: s.edited[curveId] ? s.edited : { ...s.edited, [curveId]: true },
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
      edited: s.edited[curveId] ? s.edited : { ...s.edited, [curveId]: true },
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
      const session = await getSessionMaybe();
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

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 45000);
      const res = await fetch(API + '/api/market-data/snapshots', {
        signal: ctl.signal,
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
      clearTimeout(timer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Save failed');
      }

      const saved = await res.json();
      set((s) => ({
        snapshotSaving: { ...s.snapshotSaving, [curveId]: false },
        snapshotSaved:  { ...s.snapshotSaved,  [curveId]: { date: saved.valuation_date, source: saved.source } },
      }));
    } catch (e0) {
      const e = e0?.name === 'AbortError' ? new Error('Save timed out after 45 s. The API may be redeploying; try again in a minute.') : e0;
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
  // `keepEdits`: the list's own read ahead (CurvesSidebar) passes it, so an answer that arrives after the user has
  // begun to type in that curve does not replace what was typed. A curve's own page reads without it, as it always
  // has: opening a curve shows what is stored.
  loadLatestSnapshot: async (curveId, { keepEdits = false } = {}) => {
    let asked = false;                 // no session yet is not an answer: the list asks again
    try {
      const session = await getSessionMaybe();
      if (!session) return;
      asked = true;

      const res = await fetch(API + '/api/market-data/snapshots/' + curveId + '/latest', {
        headers: { 'Authorization': 'Bearer ' + session.access_token },
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.exists || !data.quotes?.length) return;
      if (keepEdits && get().edited[curveId]) return;

      set((s) => ({
        edited: s.edited[curveId] ? Object.fromEntries(Object.entries(s.edited).filter(([k]) => k !== curveId)) : s.edited,   // what is shown is what is stored again
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
    } catch {
      // Non-fatal
    } finally {
      if (asked) set((s) => (s.snapshotTried[curveId] ? s : { snapshotTried: { ...s.snapshotTried, [curveId]: true } }));
    }
  },

  // Computed helper — get a curve from the mutable copy
  getCurveById: (id) => get().curves.find((c) => c.id === id),
}));

export default useMarketDataStore;
