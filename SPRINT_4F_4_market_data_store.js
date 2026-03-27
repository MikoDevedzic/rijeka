// SPRINT_4F_4_market_data_store.js
// Patches useMarketDataStore.js to add saveSnapshot() and loadLatestSnapshot()
// Run from Rijeka root: node SPRINT_4F_4_market_data_store.js

const fs = require('fs');
const path = require('path');
const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const FILE = path.join(RIJEKA, 'frontend', 'src', 'store', 'useMarketDataStore.js');

let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('saveSnapshot')) {
  console.log('i Already patched'); process.exit(0);
}

// Add supabase import
src = src.replace(
  "import { create } from 'zustand';",
  "import { create } from 'zustand';\nimport { supabase } from '../lib/supabase';"
);

const API = `\`\${import.meta.env.VITE_API_URL || 'http://localhost:8000'}\``;

// Inject save/load actions before the closing })); of the store
const newActions = `
  // ── Sprint 4F: market data persistence ──────────────────────────────────────

  // Save state for snapshotSaving/loading per curveId
  snapshotSaving: {},   // { [curveId]: bool }
  snapshotSaved:  {},   // { [curveId]: { date, source } }
  snapshotError:  {},   // { [curveId]: string }

  /**
   * Save the current quotes for a curve to market_data_snapshots in Supabase.
   * Converts the enabled instruments to [{tenor, quote_type, rate, enabled}].
   * rate stored as % (5.310), matching ratesCurves.js convention.
   */
  saveSnapshot: async (curveId, valuationDate) => {
    set(s => ({ snapshotSaving: { ...s.snapshotSaving, [curveId]: true },
                snapshotError:  { ...s.snapshotError,  [curveId]: null } }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const curve = get().curves.find(c => c.id === curveId);
      if (!curve) throw new Error('Curve not found');

      const quotes = (curve.instruments || []).map(inst => ({
        tenor:      inst.tenor,
        quote_type: inst.type,
        rate:       inst.quote,       // already in % e.g. 5.310
        enabled:    inst.en !== false,
      }));

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const res = await fetch(\`\${API_URL}/api/market-data/snapshots\`, {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${session.access_token}\`,
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
      set(s => ({
        snapshotSaving: { ...s.snapshotSaving, [curveId]: false },
        snapshotSaved:  { ...s.snapshotSaved,  [curveId]: { date: saved.valuation_date, source: saved.source } },
      }));
    } catch (e) {
      set(s => ({
        snapshotSaving: { ...s.snapshotSaving, [curveId]: false },
        snapshotError:  { ...s.snapshotError,  [curveId]: e.message },
      }));
      throw e;
    }
  },

  /**
   * Load the latest snapshot for a curve from the DB and update store quotes.
   * Called on mount in OISDetail / BasisDetail when a curve is selected.
   */
  loadLatestSnapshot: async (curveId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const res = await fetch(\`\${API_URL}/api/market-data/snapshots/\${curveId}/latest\`, {
        headers: { 'Authorization': \`Bearer \${session.access_token}\` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.exists || !data.quotes?.length) return;

      // Update store quotes from DB snapshot
      const quotes = data.quotes;
      set(s => ({
        curves: s.curves.map(c => {
          if (c.id !== curveId) return c;
          const updated = c.instruments.map(inst => {
            const match = quotes.find(q => q.tenor === inst.tenor);
            if (!match) return inst;
            return { ...inst, quote: match.rate, en: match.enabled !== false };
          });
          return { ...c, instruments: updated };
        }),
        snapshotSaved: {
          ...s.snapshotSaved,
          [curveId]: { date: data.valuation_date, source: data.source }
        },
      }));
    } catch (_) {
      // Non-fatal — workspace still usable with default quotes
    }
  },

`;

// Insert before the closing })); 
src = src.replace(
  `  // Computed helper â€" get a curve from the mutable copy
  getCurveById: (id) => get().curves.find((c) => c.id === id),
}));`,
  newActions +
  `  // Computed helper — get a curve from the mutable copy
  getCurveById: (id) => get().curves.find((c) => c.id === id),
}));`
);

fs.writeFileSync(FILE, src, 'utf8');
console.log('✓ useMarketDataStore patched — saveSnapshot + loadLatestSnapshot added');
