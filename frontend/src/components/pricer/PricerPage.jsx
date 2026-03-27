// PricerPage.jsx — Sprint 4G (curve bump + transparency)
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import './PricerPage.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function authHdrs() {
  const { data: { session } } = await supabase.auth.getSession();
  return { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' };
}


const QT_MAP = {
  'OISDeposit': 'DEPOSIT', 'Deposit': 'DEPOSIT',
  'OIS': 'OIS_SWAP', 'BASIS': 'IRS', 'FRA': 'FRA', 'FUTURES': 'FUTURES', 'IRS': 'IRS',
};
const mapQt = qt => QT_MAP[qt] || qt;

const fmtAmt  = v => v == null ? '—' : (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPct  = v => v == null ? '—' : v.toFixed(4) + '%';
const fmtDf   = v => v == null ? '—' : v.toFixed(6);
const fmtDcf  = v => v == null ? '—' : v.toFixed(4);
const npvClr  = v => v == null ? 'var(--text-dim)' : v >= 0 ? 'var(--accent)' : 'var(--red)';

// ── Curve panel with bump controls ────────────────────────────────────────────
function CurveBumpPanel({ curveIds, snapshotsByid, bumps, onBumpParallel, onBumpTenor, onToggleOverride, overrides, onRateChange, curvePillars }) {
  const [expanded, setExpanded] = useState({});

  return (
    <div className="pp-curve-panel">
      {curveIds.map(cid => {
        const snap = snapshotsByid[cid];
        const bump = bumps[cid] || { parallel: '', tenors: {} };
        const ov   = overrides[cid] || { enabled: false, rate: '5.25' };
        const isExp = expanded[cid];

        return (
          <div key={cid} className="pp-curve-block">
            {/* Header */}
            <div className="pp-curve-hdr" onClick={() => setExpanded(e => ({ ...e, [cid]: !e[cid] }))}>
              <span className="pp-curve-chevron">{isExp ? '▾' : '▸'}</span>
              <span className="pp-curve-id">{cid}</span>
              {snap
                ? <span className="pp-curve-snap-badge">saved {snap.date} · {snap.source}</span>
                : <span className="pp-curve-snap-badge warn">no snapshot</span>
              }
            </div>

            {isExp && (
              <div className="pp-curve-body">
                {/* Override toggle */}
                <div className="pp-override-row">
                  <label className="pp-override-toggle">
                    <input type="checkbox" checked={ov.enabled}
                      onChange={e => onToggleOverride(cid, e.target.checked)} />
                    <span>flat rate override</span>
                  </label>
                  {ov.enabled && (
                    <>
                      <input className="pp-rate-input" type="text" inputMode="decimal"
                        value={ov.rate} onChange={e => onRateChange(cid, e.target.value)} placeholder="5.25" />
                      <span className="pp-rate-unit">%</span>
                    </>
                  )}
                </div>

                {/* Parallel bump */}
                {!ov.enabled && (
                  <div className="pp-bump-row">
                    <span className="pp-bump-label">PARALLEL BUMP</span>
                    <input className="pp-bump-input" type="text" inputMode="decimal"
                      value={bump.parallel}
                      onChange={e => onBumpParallel(cid, e.target.value)}
                      placeholder="0" />
                    <span className="pp-bump-unit">bps</span>
                  </div>
                )}

                {/* Pillar table */}
                {!ov.enabled && snap?.quotes?.length > 0 && (
                  <table className="pp-pillar-table">
                    <thead>
                      <tr>
                        <th>TENOR</th>
                        <th className="r">QUOTE (%)</th>
                        <th className="r">BUMP (bps)</th>
                        <th className="r">EFFECTIVE (%)</th>
                        <th className="r">ZERO RATE</th>
                        <th className="r">DF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.quotes.filter(q => q.enabled !== false).map((q, i) => {
                        const tenorBump    = parseFloat(bump.tenors?.[q.tenor] || '0') || 0;
                        const parallelBump = parseFloat(bump.parallel || '0') || 0;
                        const effective    = q.rate + (tenorBump + parallelBump) / 100;
                        const hasBump      = tenorBump !== 0 || parallelBump !== 0;
                        const pil          = (curvePillars?.[cid] || [])[i];
                        return (
                          <tr key={i} className={hasBump ? 'bumped' : ''}>
                            <td className="pp-mono">{q.tenor}</td>
                            <td className="r pp-mono">{q.rate.toFixed(3)}</td>
                            <td className="r">
                              <input className="pp-tenor-bump" type="text" inputMode="decimal"
                                value={bump.tenors?.[q.tenor] || ''}
                                onChange={e => onBumpTenor(cid, q.tenor, e.target.value)}
                                placeholder="0" />
                            </td>
                            <td className={`r pp-mono ${hasBump ? 'bumped-val' : ''}`}>
                              {effective.toFixed(3)}
                            </td>
                            <td className="r pp-mono" style={{color:'var(--blue)',fontSize:'0.58rem'}}>
                              {pil ? pil.zero_rate.toFixed(4) + '%' : '—'}
                            </td>
                            <td className="r pp-mono" style={{color:'var(--text-dim)',fontSize:'0.58rem'}}>
                              {pil ? pil.df.toFixed(5) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Cashflow transparency table ────────────────────────────────────────────────
function CfTransparencyTable({ legs }) {
  const [expandedLeg, setExpandedLeg] = useState(null);

  const allCfs = legs.flatMap(leg =>
    (leg.cashflows || []).map(cf => ({ ...cf, leg_ref: leg.leg_ref, direction: leg.direction, currency: leg.currency }))
  ).sort((a, b) => a.payment_date > b.payment_date ? 1 : -1);

  if (!allCfs.length) return null;

  return (
    <div className="pp-cf-transparency">
      <div className="pp-section-hdr">CASHFLOW DETAIL — {allCfs.length} flows</div>
      <div className="pp-cf-scroll">
        <table className="pp-cf-detail-table">
          <thead>
            <tr>
              <th>PAY DATE</th>
              <th>LEG</th>
              <th>DIR</th>
              <th className="r">FWD / FIXED RATE</th>
              <th className="r">ZERO RATE</th>
              <th className="r">DF</th>
              <th className="r">DCF</th>
              <th className="r">AMOUNT</th>
              <th className="r">PV</th>
            </tr>
          </thead>
          <tbody>
            {allCfs.map((cf, i) => {
              const isPay = cf.direction === 'PAY';
              const clr = isPay ? 'var(--red)' : 'var(--accent)';
              return (
                <tr key={i}>
                  <td className="pp-mono">{cf.payment_date}</td>
                  <td className="pp-dim" style={{fontSize:'0.6rem'}}>{cf.leg_ref}</td>
                  <td><span style={{color:clr,fontWeight:700,fontSize:'0.6rem'}}>{cf.direction}</span></td>
                  <td className="r pp-mono" style={{color:'var(--blue)'}}>{fmtPct(cf.rate != null ? cf.rate * 100 : null)}</td>
                  <td className="r pp-mono" style={{color:'var(--text-dim)'}}>{fmtPct(cf.zero_rate != null ? cf.zero_rate * 100 : null)}</td>
                  <td className="r pp-mono" style={{color:'var(--text-dim)'}}>{fmtDf(cf.df)}</td>
                  <td className="r pp-mono" style={{color:'var(--text-dim)'}}>{fmtDcf(cf.dcf)}</td>
                  <td className="r pp-mono" style={{color:clr,opacity:0.8}}>
                    {cf.amount != null ? (isPay?'-':'+') + Math.abs(cf.amount).toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}
                  </td>
                  <td className="r pp-mono" style={{color:clr,fontWeight:700}}>
                    {cf.pv != null ? fmtAmt(cf.pv) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function PricerPage() {
  const [trades, setTrades]             = useState([]);
  const [selectedId, setSelectedId]     = useState('');
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [curveIds, setCurveIds]         = useState([]);
  const [snapshots, setSnapshots]       = useState({});   // { curveId: { date, source, quotes } }
  const [overrides, setOverrides]       = useState({});   // { curveId: { enabled, rate } }
  const [bumps, setBumps]               = useState({});   // { curveId: { parallel, tenors:{} } }
  const [valuationDate, setValDate]     = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult]             = useState(null);
  const [curvePillars, setCurvePillars] = useState({});
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [tradesLoading, setTradesLoading] = useState(true);

  // Load trades
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('trades').select('*').order('trade_date', { ascending: false });
        if (error) throw new Error(error.message);
        setTrades(data || []);
      } catch (e) { setError('Failed to load trades: ' + e.message); }
      finally { setTradesLoading(false); }
    })();
  }, []);

  // When trade selected: load legs → derive curve IDs → load snapshots
  useEffect(() => {
    if (!selectedId) { setCurveIds([]); setSnapshots({}); setResult(null); return; }
    setSelectedTrade(trades.find(t => t.id === selectedId) || null);
    (async () => {
      try {
        const h = await authHdrs();
        const res = await fetch(`${API}/api/trade-legs/${selectedId}`, { headers: h });
        const legsData = await res.json();
        const ids = new Set();
        (Array.isArray(legsData) ? legsData : []).forEach(leg => {
          if (leg.discount_curve_id) ids.add(leg.discount_curve_id);
          if (leg.forecast_curve_id) ids.add(leg.forecast_curve_id);
        });
        if (ids.size === 0) ids.add('default');
        const idArr = Array.from(ids);
        setCurveIds(idArr);

        // Init overrides + bumps
        const ov = {}, bmp = {};
        idArr.forEach(id => {
          ov[id]  = { enabled: false, rate: '5.25' };
          bmp[id] = { parallel: '', tenors: {} };
        });
        setOverrides(ov);
        setBumps(bmp);
        setResult(null);

        // Load snapshots for each curve
        const snaps = {};
        await Promise.all(idArr.map(async cid => {
          try {
            const r = await fetch(`${API}/api/market-data/snapshots/${cid}/latest`, { headers: h });
            const d = await r.json();
            if (d.exists) snaps[cid] = d;
          } catch (_) {}
        }));
        setSnapshots(snaps);
      } catch (e) { setError('Failed to load legs: ' + e.message); }
    })();
  }, [selectedId, trades]);

  // Bump handlers
  const onBumpParallel = useCallback((cid, val) => {
    setBumps(b => ({ ...b, [cid]: { ...b[cid], parallel: val } }));
  }, []);

  const onBumpTenor = useCallback((cid, tenor, val) => {
    setBumps(b => ({ ...b, [cid]: { ...b[cid], tenors: { ...b[cid]?.tenors, [tenor]: val } } }));
  }, []);

  const onToggleOverride = useCallback((cid, enabled) => {
    setOverrides(o => ({ ...o, [cid]: { ...o[cid], enabled } }));
  }, []);

  const onRateChange = useCallback((cid, rate) => {
    setOverrides(o => ({ ...o, [cid]: { ...o[cid], rate } }));
  }, []);

  // Build curve inputs for API
  const buildCurveInputs = useCallback(() => {
    return curveIds.map(cid => {
      const ov  = overrides[cid] || {};
      const bmp = bumps[cid]    || {};
      const snap = snapshots[cid];

      if (ov.enabled) {
        return { curve_id: cid, flat_rate: parseFloat(ov.rate) / 100 };
      }

      // Build quotes from snapshot + bumps
      if (snap?.quotes?.length >= 2) {
        const parallelBps = parseFloat(bmp.parallel || '0') || 0;
        const quotes = snap.quotes
          .filter(q => q.enabled !== false)
          .map(q => {
            const tenorBps = parseFloat(bmp.tenors?.[q.tenor] || '0') || 0;
            const totalBump = (parallelBps + tenorBps) / 100; // bps → %
            return {
              tenor:      q.tenor,
              quote_type: mapQt(q.quote_type),
              rate:       (q.rate + totalBump) / 100,
            };
          });
        if (quotes.length >= 2) return { curve_id: cid, quotes };
      }

      // No snapshot — send empty so backend auto-loads
      return { curve_id: cid };
    });
  }, [curveIds, overrides, bumps, snapshots]);

  const handleRun = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const h = await authHdrs();
      const curves = buildCurveInputs();
      const res = await fetch(`${API}/price`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ trade_id: selectedId, valuation_date: valuationDate, curves }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Pricing failed');
      }
      const data = await res.json();
      setResult(data);
      setCurvePillars(data.curve_pillars || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [selectedId, valuationDate, buildCurveInputs]);

  const ccy = selectedTrade?.notional_ccy || 'USD';
  const hasBumps = Object.values(bumps).some(b =>
    (parseFloat(b.parallel) || 0) !== 0 || Object.values(b.tenors || {}).some(v => (parseFloat(v) || 0) !== 0)
  );

  return (
    <div className="pp-root">
      <div className="pp-header">
        <span className="pp-title">PRICER</span>
        <span className="pp-sub">Full revaluation · IR swap NPV + Greeks · curve transparency</span>
        {hasBumps && <span className="pp-bump-active-badge">⚡ SCENARIO ACTIVE</span>}
      </div>

      <div className="pp-body">
        {/* ── Left panel ── */}
        <div className="pp-left">
          <div className="pp-section">
            <div className="pp-section-hdr">SELECT TRADE</div>
            <div className="pp-field">
              <label>VALUATION DATE</label>
              <input type="date" className="pp-date-input" value={valuationDate} onChange={e => setValDate(e.target.value)} />
            </div>
            <div className="pp-field">
              <label>TRADE</label>
              {tradesLoading
                ? <div className="pp-loading">Loading...</div>
                : <select className="pp-select" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                    <option value="">— select trade —</option>
                    {trades.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.trade_ref} · {t.instrument_type} · {t.notional_ccy} {(t.notional||0).toLocaleString('en-US',{maximumFractionDigits:0})} · {t.status}
                      </option>
                    ))}
                  </select>
              }
            </div>
            {selectedTrade && (
              <div className="pp-trade-meta">
                {[selectedTrade.asset_class, selectedTrade.instrument_type, selectedTrade.maturity_date].map((v,i) =>
                  <span key={i} className="pp-meta-item">{v}</span>
                )}
              </div>
            )}
          </div>

          {curveIds.length > 0 && (
            <div className="pp-section">
              <div className="pp-section-hdr">CURVE INPUTS & SCENARIO</div>
              <CurveBumpPanel
                curveIds={curveIds}
                snapshotsByid={snapshots}
                bumps={bumps}
                overrides={overrides}
                onBumpParallel={onBumpParallel}
                onBumpTenor={onBumpTenor}
                onToggleOverride={onToggleOverride}
                onRateChange={onRateChange}
                curvePillars={curvePillars}
              />
              {error && <div className="pp-error">{error}</div>}
              <button className="pp-run-btn" onClick={handleRun} disabled={loading || !selectedId}>
                {loading ? '⟳  PRICING...' : hasBumps ? '▶  RUN SCENARIO' : '▶  RUN PRICER'}
              </button>
            </div>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="pp-right">
          {!result && !loading && (
            <div className="pp-empty">{selectedId ? 'Click RUN PRICER to price this trade' : 'Select a trade to begin'}</div>
          )}
          {loading && <div className="pp-empty">Pricing...</div>}

          {result && (
            <>
              {/* Top metrics */}
              <div className="pp-metrics">
                <div className="pp-metric primary">
                  <div className="pp-metric-label">NPV {hasBumps ? '(SCENARIO)' : ''}</div>
                  <div className="pp-metric-value" style={{color:npvClr(result.npv)}}>{fmtAmt(result.npv)}</div>
                  <div className="pp-metric-sub">{result.valuation_date} · {result.curve_mode}</div>
                </div>
                <div className="pp-metric">
                  <div className="pp-metric-label">PV01</div>
                  <div className="pp-metric-value" style={{color:'var(--blue)'}}>{fmtAmt(result.pv01)}</div>
                  <div className="pp-metric-sub">+1bp parallel</div>
                </div>
                <div className="pp-metric">
                  <div className="pp-metric-label">DV01</div>
                  <div className="pp-metric-value" style={{color:'var(--blue)'}}>{fmtAmt(result.dv01)}</div>
                  <div className="pp-metric-sub">discount only</div>
                </div>
                <div className="pp-metric">
                  <div className="pp-metric-label">THETA</div>
                  <div className="pp-metric-value" style={{color:npvClr(result.theta)}}>{fmtAmt(result.theta)}</div>
                  <div className="pp-metric-sub">per day</div>
                </div>
              </div>



              {/* Leg PV breakdown */}
              <div className="pp-section-hdr" style={{marginTop:'1rem'}}>LEG PV BREAKDOWN</div>
              <table className="pp-leg-table">
                <thead>
                  <tr><th>LEG</th><th>TYPE</th><th>DIR</th><th>DISC CURVE</th><th>FCAST CURVE</th><th className="r">PV</th></tr>
                </thead>
                <tbody>
                  {result.legs.map((leg, i) => (
                    <tr key={i}>
                      <td className="pp-mono">{leg.leg_ref}</td>
                      <td className="pp-dim">{leg.leg_type}</td>
                      <td><span style={{color:leg.direction==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.6rem'}}>{leg.direction}</span></td>
                      <td className="pp-dim pp-mono" style={{fontSize:'0.6rem'}}>{leg.discount_curve_id || curveIds[0] || '—'}</td>
                      <td className="pp-dim pp-mono" style={{fontSize:'0.6rem'}}>{leg.forecast_curve_id || curveIds[0] || '—'}</td>
                      <td className="r pp-mono" style={{color:npvClr(leg.pv),fontWeight:700}}>{fmtAmt(leg.pv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Full cashflow transparency */}
              <CfTransparencyTable legs={result.legs} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
