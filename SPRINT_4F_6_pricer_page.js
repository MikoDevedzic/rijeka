// SPRINT_4F_6_pricer_page.js
// Writes: frontend/src/components/pricer/PricerPage.jsx
//         frontend/src/components/pricer/PricerPage.css
// The PRICER tile destination — standalone trade pricer with auto-loaded curves.
// Run from Rijeka root: node SPRINT_4F_6_pricer_page.js

const fs = require('fs');
const path = require('path');
const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const DIR = path.join(RIJEKA, 'frontend', 'src', 'components', 'pricer');

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// ── JSX ───────────────────────────────────────────────────────────────────────
const jsx = `// PricerPage.jsx — Sprint 4F
// Standalone pricer: select trade → auto-load curves from DB → run → NPV + Greeks.
// Accessible via PRICER tile in CommandCenter.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import usePricerStore, { fmtCcy, fmtBps } from '../../store/usePricerStore';
import './PricerPage.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { 'Authorization': \`Bearer \${session?.access_token}\`, 'Content-Type': 'application/json' };
}

function npvColor(v) {
  if (v == null) return 'var(--text-dim)';
  return v >= 0 ? 'var(--accent)' : 'var(--red)';
}

function fmtAmt(v, ccy = 'USD') {
  if (v == null || isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '-';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── CurveRow — single curve in the override panel ─────────────────────────────
function CurveRow({ curveId, override, onToggleOverride, onRateChange }) {
  return (
    <div className="pp-curve-row">
      <span className="pp-curve-id">{curveId}</span>
      <label className="pp-override-toggle">
        <input
          type="checkbox"
          checked={override.enabled}
          onChange={e => onToggleOverride(curveId, e.target.checked)}
        />
        <span>override</span>
      </label>
      {override.enabled && (
        <>
          <input
            className="pp-rate-input"
            type="text"
            inputMode="decimal"
            value={override.rate}
            onChange={e => onRateChange(curveId, e.target.value)}
            placeholder="5.25"
          />
          <span className="pp-rate-unit">%</span>
        </>
      )}
      {!override.enabled && (
        <span className="pp-auto-badge">AUTO — from market data</span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PricerPage() {
  const [trades, setTrades]               = useState([]);
  const [selectedTradeId, setSelectedId]  = useState('');
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [legs, setLegs]                   = useState([]);
  const [curveIds, setCurveIds]           = useState([]);
  const [overrides, setOverrides]         = useState({});
  const [valuationDate, setValDate]       = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult]               = useState(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [tradesLoading, setTradesLoading] = useState(true);

  // Load trades list on mount
  useEffect(() => {
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(\`\${API}/api/trades/?store=PRODUCTION&status=LIVE\`, { headers: h });
        let data = await res.json();
        // Also load WORKING/PENDING for testing
        const res2 = await fetch(\`\${API}/api/trades/\`, { headers: h });
        data = await res2.json();
        setTrades(Array.isArray(data) ? data : []);
      } catch (e) {
        setError('Failed to load trades: ' + e.message);
      } finally {
        setTradesLoading(false);
      }
    })();
  }, []);

  // When trade selected: load legs, derive curve IDs
  useEffect(() => {
    if (!selectedTradeId) { setLegs([]); setCurveIds([]); setResult(null); return; }
    const trade = trades.find(t => t.id === selectedTradeId);
    setSelectedTrade(trade || null);
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(\`\${API}/api/trade-legs/\${selectedTradeId}\`, { headers: h });
        const legsData = await res.json();
        setLegs(Array.isArray(legsData) ? legsData : []);
        // Derive unique curve IDs from legs
        const ids = new Set();
        (Array.isArray(legsData) ? legsData : []).forEach(leg => {
          if (leg.discount_curve_id) ids.add(leg.discount_curve_id);
          if (leg.forecast_curve_id) ids.add(leg.forecast_curve_id);
        });
        if (ids.size === 0) ids.add('default');
        const idArr = Array.from(ids);
        setCurveIds(idArr);
        // Init overrides (default: auto, no override)
        const ov = {};
        idArr.forEach(id => { ov[id] = { enabled: false, rate: '5.25' }; });
        setOverrides(ov);
        setResult(null);
      } catch (e) {
        setError('Failed to load legs: ' + e.message);
      }
    })();
  }, [selectedTradeId, trades]);

  const handleToggleOverride = useCallback((curveId, enabled) => {
    setOverrides(o => ({ ...o, [curveId]: { ...o[curveId], enabled } }));
  }, []);

  const handleRateChange = useCallback((curveId, rate) => {
    setOverrides(o => ({ ...o, [curveId]: { ...o[curveId], rate } }));
  }, []);

  const handleRun = useCallback(async () => {
    if (!selectedTradeId) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const h = await authHeaders();
      // Build curve inputs: override = flat_rate, auto = no flat_rate (backend auto-loads)
      const curves = curveIds.map(id => {
        const ov = overrides[id] || {};
        if (ov.enabled) {
          return { curve_id: id, flat_rate: parseFloat(ov.rate) / 100 };
        }
        return { curve_id: id };  // no flat_rate → backend auto-loads from DB
      });
      const res = await fetch(\`\${API}/api/pricer/price\`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ trade_id: selectedTradeId, valuation_date: valuationDate, curves }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Pricing failed');
      }
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedTradeId, curveIds, overrides, valuationDate]);

  const ccy = selectedTrade?.notional_ccy || 'USD';

  return (
    <div className="pp-root">

      {/* ── Header ── */}
      <div className="pp-header">
        <span className="pp-title">PRICER</span>
        <span className="pp-sub">Full revaluation · IR swap NPV + Greeks</span>
      </div>

      <div className="pp-body">

        {/* ── Left: trade selector + curve panel ── */}
        <div className="pp-left">

          {/* Trade selector */}
          <div className="pp-section">
            <div className="pp-section-hdr">SELECT TRADE</div>
            <div className="pp-field">
              <label>VALUATION DATE</label>
              <input
                type="date"
                className="pp-date-input"
                value={valuationDate}
                onChange={e => setValDate(e.target.value)}
              />
            </div>
            <div className="pp-field">
              <label>TRADE</label>
              {tradesLoading
                ? <div className="pp-loading">Loading trades...</div>
                : <select
                    className="pp-select"
                    value={selectedTradeId}
                    onChange={e => setSelectedId(e.target.value)}
                  >
                    <option value="">— select trade —</option>
                    {trades.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.trade_ref} · {t.instrument_type} · {t.notional_ccy} {t.notional?.toLocaleString('en-US', {maximumFractionDigits:0})} · {t.status}
                      </option>
                    ))}
                  </select>
              }
            </div>
            {selectedTrade && (
              <div className="pp-trade-meta">
                <span className="pp-meta-item">{selectedTrade.asset_class}</span>
                <span className="pp-meta-item">{selectedTrade.instrument_type}</span>
                <span className="pp-meta-item">{selectedTrade.maturity_date}</span>
                <span className="pp-meta-item">{selectedTrade.counterparty_id?.slice(0,8)}...</span>
              </div>
            )}
          </div>

          {/* Curve panel */}
          {curveIds.length > 0 && (
            <div className="pp-section">
              <div className="pp-section-hdr">CURVE INPUTS</div>
              <p className="pp-curve-hint">
                By default curves are auto-loaded from saved market data.
                Toggle override to enter a flat rate manually.
              </p>
              {curveIds.map(id => (
                <CurveRow
                  key={id}
                  curveId={id}
                  override={overrides[id] || { enabled: false, rate: '5.25' }}
                  onToggleOverride={handleToggleOverride}
                  onRateChange={handleRateChange}
                />
              ))}
              {error && <div className="pp-error">{error}</div>}
              <button
                className="pp-run-btn"
                onClick={handleRun}
                disabled={loading || !selectedTradeId}
              >
                {loading ? '⟳  PRICING...' : '▶  RUN PRICER'}
              </button>
            </div>
          )}
        </div>

        {/* ── Right: results ── */}
        <div className="pp-right">
          {!result && !loading && (
            <div className="pp-empty">
              {selectedTradeId
                ? 'Click RUN PRICER to price this trade'
                : 'Select a trade to begin'}
            </div>
          )}

          {loading && (
            <div className="pp-empty">Pricing...</div>
          )}

          {result && (
            <>
              {/* Top metrics */}
              <div className="pp-metrics">
                <div className="pp-metric primary">
                  <div className="pp-metric-label">NPV</div>
                  <div className="pp-metric-value" style={{color:npvColor(result.npv)}}>
                    {fmtAmt(result.npv, ccy)}
                  </div>
                  <div className="pp-metric-sub">{result.valuation_date} · {result.curve_mode}</div>
                </div>
                <div className="pp-metric">
                  <div className="pp-metric-label">PV01</div>
                  <div className="pp-metric-value" style={{color:'var(--blue)'}}>
                    {fmtAmt(result.pv01, ccy)}
                  </div>
                  <div className="pp-metric-sub">+1bp parallel shift</div>
                </div>
                <div className="pp-metric">
                  <div className="pp-metric-label">DV01</div>
                  <div className="pp-metric-value" style={{color:'var(--blue)'}}>
                    {fmtAmt(result.dv01, ccy)}
                  </div>
                  <div className="pp-metric-sub">discount curve only</div>
                </div>
                <div className="pp-metric">
                  <div className="pp-metric-label">THETA</div>
                  <div className="pp-metric-value" style={{color:npvColor(result.theta)}}>
                    {fmtAmt(result.theta, ccy)}
                  </div>
                  <div className="pp-metric-sub">per day</div>
                </div>
              </div>

              {/* Per-leg PV breakdown */}
              <div className="pp-section-hdr" style={{marginTop:'1rem'}}>LEG PV BREAKDOWN</div>
              <div className="pp-leg-table-wrap">
                <table className="pp-leg-table">
                  <thead>
                    <tr>
                      <th>LEG</th>
                      <th>TYPE</th>
                      <th>DIR</th>
                      <th>CCY</th>
                      <th style={{textAlign:'right'}}>PV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.legs || []).map((leg, i) => (
                      <tr key={i}>
                        <td className="pp-mono">{leg.leg_ref}</td>
                        <td style={{color:'var(--text-dim)'}}>{leg.leg_type}</td>
                        <td>
                          <span style={{color:leg.direction==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.62rem'}}>
                            {leg.direction}
                          </span>
                        </td>
                        <td style={{color:'var(--text-dim)'}}>{leg.currency}</td>
                        <td className="pp-mono" style={{textAlign:'right',color:npvColor(leg.pv),fontWeight:700}}>
                          {fmtAmt(leg.pv, leg.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cashflow schedule */}
              <div className="pp-section-hdr" style={{marginTop:'1rem'}}>PROJECTED CASHFLOWS</div>
              <div className="pp-cf-table-wrap">
                <table className="pp-cf-table">
                  <thead>
                    <tr>
                      <th>PAYMENT DATE</th>
                      <th>LEG</th>
                      <th>DIR</th>
                      <th style={{textAlign:'right'}}>RATE</th>
                      <th style={{textAlign:'right'}}>DCF</th>
                      <th style={{textAlign:'right'}}>AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.legs || []).flatMap(leg =>
                      (leg.cashflows || []).map((cf, i) => ({
                        ...cf, leg_ref: leg.leg_ref, direction: leg.direction, currency: leg.currency
                      }))
                    ).sort((a,b) => a.payment_date > b.payment_date ? 1 : -1)
                     .map((cf, i) => (
                      <tr key={i}>
                        <td className="pp-mono">{cf.payment_date}</td>
                        <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.leg_ref}</td>
                        <td>
                          <span style={{color:cf.direction==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.62rem'}}>
                            {cf.direction}
                          </span>
                        </td>
                        <td className="pp-mono" style={{textAlign:'right',color:'var(--text-dim)'}}>
                          {cf.rate != null ? (cf.rate * 100).toFixed(4) + '%' : '—'}
                        </td>
                        <td className="pp-mono" style={{textAlign:'right',color:'var(--text-dim)'}}>
                          {cf.dcf != null ? cf.dcf.toFixed(4) : '—'}
                        </td>
                        <td className="pp-mono" style={{textAlign:'right',color:cf.direction==='PAY'?'var(--red)':'var(--accent)',fontWeight:600}}>
                          {cf.amount != null
                            ? (cf.direction==='PAY'?'-':'+') + Math.abs(cf.amount).toLocaleString('en-US',{maximumFractionDigits:0})
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
`;

// ── CSS ───────────────────────────────────────────────────────────────────────
const css = `/* PricerPage.css — Sprint 4F */

.pp-root { display:flex; flex-direction:column; height:100%; overflow:hidden; background:var(--bg); }

.pp-header { display:flex; align-items:baseline; gap:1rem; padding:0.75rem 1.5rem; border-bottom:1px solid var(--border); background:var(--panel); flex-shrink:0; }
.pp-title { font-size:0.8rem; font-weight:700; letter-spacing:0.14em; color:var(--accent); }
.pp-sub { font-size:0.62rem; color:var(--text-dim); letter-spacing:0.08em; }

.pp-body { display:flex; flex:1; overflow:hidden; }

.pp-left { width:360px; min-width:300px; border-right:1px solid var(--border); display:flex; flex-direction:column; overflow-y:auto; }
.pp-right { flex:1; overflow-y:auto; padding:1rem 1.5rem; }

.pp-section { border-bottom:1px solid var(--border); padding:0.75rem 1rem; }
.pp-section-hdr { font-size:0.6rem; font-weight:700; letter-spacing:0.14em; color:var(--text-dim); padding:0.5rem 1rem; background:var(--bg-deep); border-bottom:1px solid var(--border); }

.pp-field { display:flex; flex-direction:column; gap:0.2rem; margin-bottom:0.6rem; }
.pp-field label { font-size:0.58rem; font-weight:700; letter-spacing:0.1em; color:var(--text-dim); }
.pp-date-input, .pp-select { background:var(--panel-2); border:1px solid var(--border); color:var(--text); font-family:var(--mono); font-size:0.7rem; padding:0.3rem 0.5rem; border-radius:2px; outline:none; width:100%; box-sizing:border-box; }
.pp-date-input:focus, .pp-select:focus { border-color:var(--accent); }

.pp-trade-meta { display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.4rem; }
.pp-meta-item { font-size:0.58rem; font-family:var(--mono); color:var(--text-dim); background:var(--panel-2); padding:0.1rem 0.4rem; border-radius:2px; }

.pp-curve-hint { font-size:0.6rem; color:var(--text-dim); line-height:1.5; margin-bottom:0.5rem; }

.pp-curve-row { display:flex; align-items:center; gap:0.5rem; padding:0.35rem 0; border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent); }
.pp-curve-id { font-size:0.62rem; font-weight:700; font-family:var(--mono); color:var(--text); min-width:80px; }
.pp-override-toggle { display:flex; align-items:center; gap:0.25rem; font-size:0.58rem; color:var(--text-dim); cursor:pointer; }
.pp-rate-input { background:var(--bg-deep); border:1px solid var(--border); color:var(--text); font-family:var(--mono); font-size:0.7rem; padding:0.2rem 0.4rem; border-radius:2px; outline:none; width:60px; text-align:right; }
.pp-rate-input:focus { border-color:var(--accent); }
.pp-rate-unit { font-size:0.62rem; color:var(--text-dim); }
.pp-auto-badge { font-size:0.55rem; color:var(--accent); font-family:var(--mono); letter-spacing:0.06em; opacity:0.7; }

.pp-run-btn { width:100%; margin-top:0.75rem; padding:0.5rem; background:rgba(14,201,160,0.07); border:1px solid var(--accent); border-radius:2px; font-family:var(--mono); font-size:0.68rem; font-weight:700; letter-spacing:0.1em; color:var(--accent); cursor:pointer; transition:background 0.12s; }
.pp-run-btn:hover:not(:disabled) { background:rgba(14,201,160,0.16); }
.pp-run-btn:disabled { opacity:0.35; cursor:not-allowed; }

.pp-error { font-size:0.62rem; color:var(--red); padding:0.4rem 0; font-family:var(--mono); }
.pp-loading { font-size:0.62rem; color:var(--text-dim); font-family:var(--mono); }
.pp-empty { display:flex; align-items:center; justify-content:center; height:200px; font-size:0.68rem; letter-spacing:0.1em; color:var(--text-dim); text-align:center; }

.pp-metrics { display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-bottom:0.75rem; }
.pp-metric { background:var(--panel); border:1px solid var(--border); border-radius:3px; padding:0.6rem 0.75rem; }
.pp-metric.primary { grid-column:span 2; }
.pp-metric-label { font-size:0.58rem; font-weight:700; letter-spacing:0.12em; color:var(--text-dim); margin-bottom:0.2rem; }
.pp-metric-value { font-size:1.1rem; font-weight:700; font-family:var(--mono); }
.pp-metric.primary .pp-metric-value { font-size:1.5rem; }
.pp-metric-sub { font-size:0.58rem; color:var(--text-dim); margin-top:0.15rem; }

.pp-leg-table-wrap, .pp-cf-table-wrap { overflow-x:auto; margin-bottom:0.5rem; }
.pp-leg-table, .pp-cf-table { width:100%; border-collapse:collapse; font-size:0.68rem; font-family:var(--mono); }
.pp-leg-table th, .pp-cf-table th { padding:0.35rem 0.75rem; text-align:left; font-size:0.58rem; font-weight:700; letter-spacing:0.1em; color:var(--text-dim); border-bottom:1px solid var(--border); background:var(--panel-2); }
.pp-leg-table td, .pp-cf-table td { padding:0.35rem 0.75rem; border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent); }
.pp-leg-table tr:hover td, .pp-cf-table tr:hover td { background:rgba(255,255,255,0.015); }
.pp-mono { font-family:var(--mono); }
`;

fs.writeFileSync(path.join(DIR, 'PricerPage.jsx'), jsx, 'utf8');
fs.writeFileSync(path.join(DIR, 'PricerPage.css'), css, 'utf8');
console.log('✓ Written: PricerPage.jsx + PricerPage.css');
