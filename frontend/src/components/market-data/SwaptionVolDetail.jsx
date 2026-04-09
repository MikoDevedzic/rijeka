// SwaptionVolDetail.jsx — Sprint 6A
// Swaption ATM Normal Vol Surface detail page.
// Mirrors OISDetail.jsx structure exactly:
//   Definition tab   — surface conventions, QuantLib note
//   Instruments tab  — 6×6 expiry×tenor grid, SNAP, MANUAL, IMPORT
//   Vol Config tab   — interpolation method, smile settings
// Pure Black theme — same CSS variables as rest of app.

import { useState, useEffect, useRef } from 'react';
import useXVAStore from '../../store/useXVAStore';
import { SWAPTION_EXPIRIES, SWAPTION_TENORS, HW1F_CALIBRATION_BASKET } from '../../data/swaptionVols';
import { InnerTabs, InnerBody, ParamGrid, SectionLabel } from './_DetailShared';

const BASKET_KEYS = new Set(HW1F_CALIBRATION_BASKET.map((b) => b.expiry + '|' + b.tenor));
const isBasket = (e, t) => BASKET_KEYS.has(e + '|' + t);

// ── Source badge — identical to OISDetail ────────────────────────────────────
function SourceBadge({ src }) {
  const map = {
    BLOOMBERG: { bg:'rgba(74,154,212,0.12)', bd:'rgba(74,154,212,0.3)', c:'#4a9ad4' },
    MANUAL:    { bg:'rgba(82,104,120,0.12)', bd:'rgba(82,104,120,0.3)', c:'#666666' },
    IMPORT:    { bg:'rgba(240,160,32,0.12)', bd:'rgba(240,160,32,0.3)', c:'#f0a020' },
  };
  const s = map[src] || map.MANUAL;
  return (
    <span style={{ background:s.bg, border:`1px solid ${s.bd}`, color:s.c,
      fontSize:'0.8125rem', fontWeight:700, letterSpacing:'0.06em',
      padding:'1px 5px', borderRadius:'2px',
      fontFamily:"'IBM Plex Mono',var(--mono)", whiteSpace:'nowrap' }}>
      {src}
    </span>
  );
}

// ── Vol surface heatmap sparkline ─────────────────────────────────────────────
function VolSurface({ grid, hasData }) {
  if (!hasData) return (
    <div style={{ background:'var(--panel)', border:'1px solid var(--border)',
      borderRadius:'2px', padding:'8px', marginTop:'6px', height:'96px',
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <span style={{ fontSize:'0.8125rem', color:'var(--text-dim)', letterSpacing:'0.08em' }}>
        SNAP OR SAVE TO VIEW SURFACE
      </span>
    </div>
  );

  const allVols = grid.flatMap((r) => r.cells.map((c) => c.vol_bp)).filter((v) => v !== null);
  if (!allVols.length) return null;
  const minV = Math.min(...allVols);
  const maxV = Math.max(...allVols);
  const rng  = maxV - minV || 1;

  return (
    <div style={{ background:'var(--panel)', border:'1px solid var(--border)',
      borderRadius:'2px', padding:'8px', marginTop:'6px' }}>
      <div style={{ fontSize:'0.8125rem', color:'var(--text-dim)', letterSpacing:'0.08em', marginBottom:'5px' }}>
        ATM NORMAL VOL SURFACE · bp · SOFR
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'28px repeat(' + SWAPTION_TENORS.length + ',1fr)', gap:'2px' }}>
        <div />
        {SWAPTION_TENORS.map((t) => (
          <div key={t} style={{ fontSize:'0.6875rem', color:'var(--text-dim)', textAlign:'center' }}>{t}</div>
        ))}
        {grid.map((row) => [
          <div key={row.expiry + '_lbl'} style={{ fontSize:'0.6875rem', color:'var(--text-dim)', textAlign:'right', paddingRight:'3px', display:'flex', alignItems:'center', justifyContent:'flex-end' }}>{row.expiry}</div>,
          ...row.cells.map((cell) => {
            const v = cell.vol_bp;
            const intensity = v !== null ? (v - minV) / rng : 0;
            const bg = v !== null
              ? `rgba(13,212,168,${0.06 + intensity * 0.35})`
              : 'transparent';
            return (
              <div key={cell.tenor} style={{ height:'18px', borderRadius:'1px', background:bg,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'0.625rem', color:v !== null ? 'var(--accent)' : 'var(--text-dim)',
                fontFamily:"'IBM Plex Mono',var(--mono)" }}>
                {v !== null ? v.toFixed(0) : '—'}
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

// ── Instruments tab ───────────────────────────────────────────────────────────
function SwvInstruments() {
  const { grid, updateVol, toggleCell, saveSnapshot, loadLatestSnapshot,
          snapshotSaving, snapshotSaved, snapshotError, filledCount } = useXVAStore();

  const [saveDate,      setSaveDate]      = useState(new Date().toISOString().slice(0, 10));
  const [source,        setSource]        = useState('MANUAL');
  const [blpStatus,     setBlpStatus]     = useState(null);
  const [blpSnapping,   setBlpSnapping]   = useState(false);
  const [blpSnapResult, setBlpSnapResult] = useState(null);
  const [blpSnapError,  setBlpSnapError]  = useState(null);
  const [snapDate,      setSnapDate]      = useState(new Date().toISOString().slice(0, 10));
  const [csvParsed,     setCsvParsed]     = useState([]);
  const [csvError,      setCsvError]      = useState(null);

  useEffect(() => { loadLatestSnapshot(); }, []);

  const fetchBlpStatus = async () => {
    try {
      const res = await fetch('/api/bloomberg/status');
      setBlpStatus(await res.json());
    } catch (e) {
      setBlpStatus({ connected: false, installed: false, error: 'Could not reach backend' });
    }
  };

  const handleSourceChange = (src) => {
    setSource(src);
    setBlpSnapResult(null);
    setBlpSnapError(null);
    if (src === 'BLOOMBERG') fetchBlpStatus();
  };

  const snapBloomberg = async () => {
    setBlpSnapping(true);
    setBlpSnapResult(null);
    setBlpSnapError(null);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session: sess } } = await supabase.auth.getSession();

      // Build ticker list from grid
      const tickers = grid.flatMap((row) =>
        row.cells.map((c) => ({
          expiry: row.expiry,
          tenor:  c.tenor,
          ticker: c.ticker,
        }))
      );

      const res = await fetch('/api/bloomberg/snap-swvol', {
        method: 'POST',
        headers: {
          Authorization:  'Bearer ' + sess.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snap_date: snapDate,
          tickers,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Snap failed');

      // Update store with snapped vols
      if (data.quotes?.length) {
        data.quotes.forEach((q) => updateVol(q.expiry, q.tenor, q.vol_bp));
      }

      // Auto-save to DB
      await saveSnapshot(snapDate, 'BLOOMBERG');
      setBlpSnapResult(data);
    } catch (e) {
      setBlpSnapError(e.message);
    } finally {
      setBlpSnapping(false);
    }
  };

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = ev.target.result.trim().split('\\n')
          .filter((l) => l.trim() && !l.startsWith('#'))
          .map((l) => {
            const [exp, ten, vol] = l.split(',').map((s) => s.trim());
            return { expiry: exp, tenor: ten, vol_bp: parseFloat(vol) };
          })
          .filter((r) => r.expiry && r.tenor && !isNaN(r.vol_bp));
        if (!rows.length) throw new Error('No valid rows. Format: expiry,tenor,vol_bp');
        setCsvParsed(rows); setCsvError(null);
      } catch (err) { setCsvError(err.message); setCsvParsed([]); }
    };
    reader.readAsText(file);
  };

  const saveCsvImport = async () => {
    if (!csvParsed.length) return;
    csvParsed.forEach((r) => updateVol(r.expiry, r.tenor, r.vol_bp));
    await saveSnapshot(snapDate, 'IMPORT');
    setCsvParsed([]);
  };

  const filled = filledCount();
  const total  = SWAPTION_EXPIRIES.length * SWAPTION_TENORS.length;

  // Column header style
  const thStyle = {
    fontSize:'0.8125rem', fontWeight:400, letterSpacing:'0.08em',
    color:'var(--text-dim)', padding:'3px 6px 5px',
    borderBottom:'1px solid var(--border)', textAlign:'right',
  };

  return (
    <div>
      <SectionLabel sub={filled + ' / ' + total + ' cells filled'}>Instruments</SectionLabel>

      {/* ── Vol grid table ── */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'540px' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign:'left', width:'40px' }}>EXP</th>
              {SWAPTION_TENORS.map((t) => (
                <th key={t} style={thStyle}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.expiry}>
                <td style={{ fontSize:'0.875rem', color:'var(--accent)',
                  fontFamily:"'IBM Plex Mono',var(--mono)", fontWeight:600,
                  padding:'4px 6px 4px 0', borderBottom:'1px solid var(--panel-2)' }}>
                  {row.expiry}
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.tenor}
                    style={{ padding:'2px',
                      borderBottom:'1px solid var(--panel-2)',
                      background: isBasket(row.expiry, cell.tenor)
                        ? 'rgba(13,212,168,0.03)' : 'transparent' }}>
                    <div style={{ fontSize:'0.6875rem', color:'var(--text-dim)',
                      fontFamily:"'IBM Plex Mono',var(--mono)", padding:'1px 4px 0',
                      letterSpacing:'0.02em', lineHeight:1 }}>
                      {cell.ticker.replace(' Curncy', '')}
                    </div>
                    <input
                      type="text" inputMode="decimal"
                      value={cell.vol_bp !== null && cell.vol_bp !== undefined ? cell.vol_bp : ''}
                      placeholder="—"
                      onChange={(e) => updateVol(row.expiry, cell.tenor, e.target.value)}
                      style={{ width:'100%', background:'transparent', border:'none',
                        borderBottom:'1px solid transparent', outline:'none',
                        textAlign:'right', padding:'1px 4px 3px',
                        fontFamily:"'IBM Plex Mono',var(--mono)",
                        fontSize:'0.875rem', color:'var(--accent)',
                        caretColor:'var(--accent)' }}
                      onFocus={(e) => e.target.style.borderBottom='1px solid var(--accent)'}
                      onBlur={(e)  => e.target.style.borderBottom='1px solid transparent'}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Basket legend ── */}
      <div style={{ display:'flex', alignItems:'center', gap:'6px', marginTop:'6px',
        fontSize:'0.8125rem', color:'var(--text-dim)' }}>
        <div style={{ width:'10px', height:'10px', borderRadius:'1px',
          background:'rgba(13,212,168,0.15)', border:'1px solid rgba(13,212,168,0.3)', flexShrink:0 }} />
        HW1F calibration basket — co-terminal + diagonal + long-end anchors
      </div>

      {/* ── Vol surface heatmap ── */}
      <VolSurface grid={grid} hasData={!!snapshotSaved} />

      {/* ── Snap / save controls ── */}
      <div style={{ marginTop:'10px', borderTop:'1px solid var(--border)', paddingTop:'10px' }}>

        {/* Source selector */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
          {['MANUAL','BLOOMBERG','IMPORT'].map((src) => (
            <button key={src} onClick={() => handleSourceChange(src)} style={{
              flex:1, padding:'5px 0', fontSize:'0.875rem', fontWeight:700,
              letterSpacing:'0.08em', cursor:'pointer',
              fontFamily:"'IBM Plex Mono',var(--mono)", background:'transparent', borderRadius:'2px',
              border: source===src ? '1px solid var(--accent)' : '1px solid var(--border)',
              color:  source===src ? 'var(--accent)' : 'var(--text-dim)',
            }}>{src}</button>
          ))}
        </div>

        {/* MANUAL */}
        {source === 'MANUAL' && (
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
            <input type="date" value={saveDate} onChange={(e) => setSaveDate(e.target.value)}
              style={{ background:'var(--panel-2)', border:'1px solid var(--border)',
                color:'var(--text)', fontFamily:"'IBM Plex Mono',var(--mono)",
                fontSize:'1rem', padding:'0.25rem 0.45rem', borderRadius:2, outline:'none' }} />
            <button
              onClick={() => saveSnapshot(saveDate, 'MANUAL')}
              disabled={snapshotSaving || filled === 0}
              style={{ padding:'0.25rem 0.85rem', background:'rgba(14,201,160,0.07)',
                border:'1px solid var(--accent)', borderRadius:2,
                fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'1rem',
                fontWeight:700, letterSpacing:'0.1em', color:'var(--accent)',
                cursor: filled > 0 ? 'pointer' : 'not-allowed',
                opacity: filled > 0 ? 1 : 0.4 }}>
              {snapshotSaving ? 'SAVING...' : '▶ SAVE TO DB'}
            </button>
            {snapshotSaved && (
              <span style={{ fontSize:'0.9375rem', color:'var(--accent)',
                fontFamily:"'IBM Plex Mono',var(--mono)" }}>
                ✔ saved {snapshotSaved.date}
              </span>
            )}
            {snapshotError && (
              <span style={{ fontSize:'0.9375rem', color:'var(--red)',
                fontFamily:"'IBM Plex Mono',var(--mono)" }}>
                ✘ {snapshotError}
              </span>
            )}
          </div>
        )}

        {/* BLOOMBERG */}
        {source === 'BLOOMBERG' && (
          <div style={{ border:'1px solid var(--border)', borderRadius:'2px', padding:'8px' }}>
            <div style={{ fontSize:'0.875rem', color:'var(--blue)',
              background:'rgba(74,158,255,0.06)', border:'1px solid rgba(74,158,255,0.2)',
              borderRadius:'2px', padding:'4px 7px', marginBottom:'8px', lineHeight:1.6 }}>
              Tickers: <strong>USSNA[expiry][tenor] Curncy</strong> · Normal vol bp · ATM straddle ·
              Leave source blank — Bloomberg picks first available (BVOL/FMCA/GIRO/TRPU).
              Field: <strong>MID</strong>
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'8px' }}>
              <div style={{ width:'6px', height:'6px', borderRadius:'50%', flexShrink:0,
                background: blpStatus===null ? 'var(--text-dim)'
                  : blpStatus.connected ? 'var(--accent)' : 'var(--red)' }} />
              <span style={{ fontSize:'0.875rem',
                color: blpStatus?.connected ? 'var(--accent)' : 'var(--text-dim)' }}>
                {blpStatus===null ? 'CHECKING...'
                  : blpStatus.connected ? 'BLOOMBERG CONNECTED'
                  : blpStatus.installed ? 'TERMINAL NOT CONNECTED'
                  : 'BLPAPI NOT INSTALLED'}
              </span>
              <button onClick={fetchBlpStatus}
                style={{ marginLeft:'auto', fontSize:'0.875rem', background:'transparent',
                  border:'1px solid var(--border)', color:'var(--text-dim)',
                  padding:'2px 6px', cursor:'pointer',
                  fontFamily:"'IBM Plex Mono',var(--mono)", borderRadius:'2px' }}>
                REFRESH
              </button>
            </div>

            <div style={{ display:'flex', gap:'6px', alignItems:'center', marginBottom:'8px' }}>
              <input type="date" value={snapDate} onChange={(e) => setSnapDate(e.target.value)}
                style={{ background:'var(--panel)', border:'1px solid var(--border)',
                  color:'var(--text)', fontFamily:"'IBM Plex Mono',var(--mono)",
                  fontSize:'1rem', padding:'4px 6px', borderRadius:'2px', outline:'none' }} />
              <button onClick={snapBloomberg}
                disabled={!blpStatus?.connected || blpSnapping}
                style={{ flex:1, padding:'6px 0', fontSize:'0.875rem', fontWeight:700,
                  letterSpacing:'0.08em',
                  cursor: blpStatus?.connected ? 'pointer' : 'not-allowed',
                  background:'transparent', borderRadius:'2px',
                  fontFamily:"'IBM Plex Mono',var(--mono)",
                  border:'1px solid var(--accent)', color:'var(--accent)',
                  opacity: blpStatus?.connected ? 1 : 0.4 }}>
                {blpSnapping ? 'SNAPPING...' : '▶ SNAP LIVE'}
              </button>
            </div>

            {blpSnapResult && (
              <div style={{ fontSize:'0.875rem', color:'var(--accent)', marginBottom:'6px',
                background:'rgba(13,212,168,0.05)', border:'1px solid rgba(13,212,168,0.2)',
                padding:'5px 7px', borderRadius:'2px', lineHeight:1.7 }}>
                ✔ SNAPPED & SAVED · {blpSnapResult.quotes_saved} CELLS · {blpSnapResult.snap_date}
                {blpSnapResult.failed?.length > 0 && (
                  <span style={{ color:'var(--amber)', marginLeft:'8px' }}>
                    {blpSnapResult.failed.length} FAILED: {blpSnapResult.failed.join(', ')}
                  </span>
                )}
              </div>
            )}
            {blpSnapError && (
              <div style={{ fontSize:'0.875rem', color:'var(--red)',
                background:'rgba(224,80,64,0.05)', border:'1px solid rgba(224,80,64,0.2)',
                padding:'5px 7px', borderRadius:'2px' }}>
                ✘ {blpSnapError}
              </div>
            )}
          </div>
        )}

        {/* IMPORT */}
        {source === 'IMPORT' && (
          <div style={{ border:'1px solid var(--border)', borderRadius:'2px', padding:'8px' }}>
            <div style={{ fontSize:'0.875rem', color:'var(--text-dim)', marginBottom:'6px', lineHeight:1.6 }}>
              Format: <span style={{ color:'var(--text)' }}>expiry,tenor,vol_bp</span> per line ·
              Example: <span style={{ color:'var(--accent)' }}>1Y,5Y,88.4</span>
            </div>
            <div style={{ display:'flex', gap:'6px', alignItems:'center', marginBottom:'8px' }}>
              <input type="date" value={snapDate} onChange={(e) => setSnapDate(e.target.value)}
                style={{ background:'var(--panel)', border:'1px solid var(--border)',
                  color:'var(--text)', fontFamily:"'IBM Plex Mono',var(--mono)",
                  fontSize:'1rem', padding:'4px 6px', borderRadius:'2px', outline:'none' }} />
              <input type="file" accept=".csv,.txt" onChange={handleCsvUpload}
                style={{ flex:1, fontSize:'0.875rem', color:'var(--text-dim)', cursor:'pointer' }} />
            </div>
            {csvError && (
              <div style={{ fontSize:'0.875rem', color:'var(--red)', marginBottom:'6px' }}>✘ {csvError}</div>
            )}
            {csvParsed.length > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <span style={{ fontSize:'0.875rem', color:'var(--accent)' }}>
                  ✔ {csvParsed.length} rows parsed
                </span>
                <button onClick={saveCsvImport}
                  style={{ padding:'5px 14px', fontSize:'0.875rem', fontWeight:700,
                    letterSpacing:'0.08em', cursor:'pointer', background:'transparent',
                    border:'1px solid var(--accent)', color:'var(--accent)',
                    borderRadius:'2px', fontFamily:"'IBM Plex Mono',var(--mono)" }}>
                  SAVE IMPORT
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Definition tab ────────────────────────────────────────────────────────────
function SwvDef() {
  const code = `# USD ATM Normal Swaption Vol Surface
# Bloomberg tickers: USSNA[expiry_code][tenor_code] Curncy
# Field: MID (bp normal vol) · ATM straddle · European exercise
# SOFR OIS discounting · Physical settlement
# 10Y expiry code: J (e.g. USSNAJ10 Curncy)
# Source: leave blank → Bloomberg picks first available
#         (BVOL / FMCA / GIRO / TRPU)

import blpapi
session = blpapi.Session()
session.start()
session.openService("//blp/refdata")
ref_service = session.getService("//blp/refdata")

request = ref_service.createRequest("ReferenceDataRequest")
request.append("securities", "USSNA55 Curncy")   # 5Yx5Y
request.append("fields", "MID")
session.sendRequest(request)`;

  return (
    <div>
      <SectionLabel>Conventions</SectionLabel>
      <ParamGrid items={[
        { label:'Vol Type',        value:'Normal (Bachelier · bp)',      cls:'bl' },
        { label:'Strike',          value:'ATM — forward swap rate' },
        { label:'Style',           value:'Straddle (payer + receiver)' },
        { label:'Exercise',        value:'European' },
        { label:'Settlement',      value:'Physical' },
        { label:'Discounting',     value:'OIS/SOFR',                    cls:'am' },
        { label:'Underlying',      value:'USD Fixed vs SOFR OIS' },
        { label:'Day Count',       value:'Actual/360 (swap convention)' },
        { label:'Ticker Format',   value:'USSNA[exp][ten] Curncy',      cls:'bl' },
        { label:'Field',           value:'MID' },
        { label:'Source',          value:'BVOL / FMCA / GIRO / TRPU' },
        { label:'BGN Note',        value:'BGN not available — leave blank' },
      ]} />
      <SectionLabel>Bloomberg Python (blpapi)</SectionLabel>
      <div className="cb">
        <button className="cb-copy" onClick={() => navigator.clipboard.writeText(code)}>copy</button>
        <pre style={{ margin:0, fontSize:'9px', lineHeight:1.8 }}>{code}</pre>
      </div>
    </div>
  );
}

// ── Vol Config tab ────────────────────────────────────────────────────────────
const VOL_INTERP = [
  { id:'bilinear',  name:'Bilinear',      desc:'Linear interpolation in both expiry and tenor. Fast, no overshooting. Standard for sparse surfaces.',          tags:['Recommended','Fast'] },
  { id:'bicubic',   name:'Bicubic Spline',desc:'Smooth C2 surface. Better for dense grids. Can overshoot at boundary.',                                        tags:['Smooth'] },
  { id:'flat_exp',  name:'Flat Expiry',   desc:'Flat extrapolation in expiry direction. Conservative for short-dated options.',                                 tags:['Conservative'] },
  { id:'sabr_atm',  name:'SABR ATM',      desc:'SABR-implied ATM vol interpolation. Arbitrage-free. Requires SABR calibration per expiry slice. Sprint 7.',   tags:['Sprint 7'] },
];

function SwvConfig() {
  const [interp, setInterp] = useState('bilinear');
  return (
    <div>
      <SectionLabel>Interpolation Method</SectionLabel>
      <div className="interp-grid">
        {VOL_INTERP.map((m) => (
          <div key={m.id} className={'icard' + (interp===m.id ? ' sel' : '')}
            onClick={() => m.id !== 'sabr_atm' && setInterp(m.id)}
            style={{ opacity: m.id === 'sabr_atm' ? 0.35 : 1,
              cursor: m.id === 'sabr_atm' ? 'not-allowed' : 'pointer' }}>
            <div className="icard-name">{m.name}</div>
            <div className="icard-desc">{m.desc}</div>
            <div className="icard-tags">
              {m.tags.map((t) => (
                <span key={t} className={'itag' + (t==='Recommended' ? ' rec' : '')}>{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <SectionLabel>Parameters</SectionLabel>
      <div className="bp-row">
        <div className="bp-lbl">Moneyness</div>
        <select className="bp-sel"><option>ATM only</option><option>Full smile (Sprint 7)</option></select>
      </div>
      <div className="bp-row">
        <div className="bp-lbl">Expiry extrapolation</div>
        <select className="bp-sel"><option>Flat</option><option>Linear</option></select>
      </div>
      <div className="bp-row">
        <div className="bp-lbl">Tenor extrapolation</div>
        <select className="bp-sel"><option>Flat</option><option>Linear</option></select>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SwaptionVolDetail() {
  const { filledCount, snapshotSaved } = useXVAStore();
  const filled = filledCount();
  const total  = SWAPTION_EXPIRIES.length * SWAPTION_TENORS.length;

  const tabs = [
    { id:'def',  label:'Definition' },
    { id:'inst', label:'Instruments', badge: filled },
    { id:'vol',  label:'Vol Config' },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div className="crv-hdr">
        <div className="crv-hdr-row">
          <div className="crv-hdr-info">
            <div className="crv-hdr-name">USD ATM Normal Swaption Vol Surface</div>
            <div className="crv-hdr-sub">
              USSNA[expiry][tenor] Curncy · Normal vol bp · SOFR discounting · ATM straddle
            </div>
          </div>
          <div className="crv-rate-block">
            <div className="crv-rate-val" style={{ color:'var(--accent)' }}>
              {filled}/{total}
            </div>
            <div className="crv-rate-lbl">cells filled</div>
          </div>
        </div>
        <div className="crv-pills">
          <span className="pill p-green">RATE OPTIONS</span>
          <span className="pill p-green">RiskClass.IR</span>
          <span className="pill p-blue">Normal Vol · bp</span>
          <span className="pill p-dim">ATM Straddle</span>
          <span className="pill p-dim">European</span>
          <span className="pill p-dim">Physical Settlement</span>
          <span className="pill p-amber">{filled}/{total} active</span>
          <span className="pill p-purple">HW1F Calibration Surface</span>
        </div>
      </div>
      <InnerTabs tabs={tabs} />
      <InnerBody tabs={tabs} panels={{
        def:  <SwvDef />,
        inst: <SwvInstruments />,
        vol:  <SwvConfig />,
      }} />
    </div>
  );
}