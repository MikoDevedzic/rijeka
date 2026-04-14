// SwaptionVolDetail.jsx — Sprint 6A
// Swaption ATM Normal Vol Surface detail page.
// Mirrors OISDetail.jsx structure exactly:
//   Definition tab   — surface conventions, QuantLib note
//   Instruments tab  — 6×6 expiry×tenor grid, SNAP, MANUAL, IMPORT
//   Vol Config tab   — interpolation method, smile settings
// Pure Black theme — same CSS variables as rest of app.

import { useState, useEffect, useRef, useCallback } from 'react';
import useXVAStore from '../../store/useXVAStore';
import {
  SWAPTION_EXPIRIES, SWAPTION_TENORS,
  HW1F_CALIBRATION_BASKET,
  OTM_STRIKE_OFFSETS, OTM_STRIKE_LABELS,
  OTM_SNAP_TENORS, OTM_INTERP_TENORS,
  EXPIRY_YEARS, TENOR_YEARS,
  emptySkewGrid, VCUB_SKEW_NOTE,
  otmTicker, OTM_SMKO_PREFIX, OTM_POSITIVE_NOTE,
} from '../../data/swaptionVols';
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
  { id:'bilinear',  name:'Bilinear',      desc:'Linear interpolation in both expiry and tenor. Fast, no overshooting. Standard for sparse surfaces.',       tags:['Recommended','Fast'] },
  { id:'bicubic',   name:'Bicubic Spline',desc:'Smooth C2 surface. Better for dense grids. Can overshoot at boundary.',                                     tags:['Smooth'] },
  { id:'flat_exp',  name:'Flat Expiry',   desc:'Flat extrapolation in expiry direction. Conservative for short-dated options.',                             tags:['Conservative'] },
  { id:'sabr_atm',  name:'SABR (Normal)', desc:'β=0 Normal SABR: α, ρ, ν per bucket. Bilinear param interpolation. Full smile — OTM strikes use surface.', tags:['Full Smile','Active'] },
];

function SwvConfig() {
  const [interp, setInterp] = useState('bilinear');
  return (
    <div>
      <SectionLabel>Interpolation Method</SectionLabel>
      <div className="interp-grid">
        {VOL_INTERP.map((m) => (
          <div key={m.id} className={'icard' + (interp===m.id ? ' sel' : '')}
            onClick={() => setInterp(m.id)}
            style={{ cursor: 'pointer' }}>
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

// ── Editable SABR params panel ────────────────────────────────────────────────
function SabrParamsEditor({ sabrParams, activeExpiry, saveDate, onSaved }) {
  const mono = { fontFamily:"'IBM Plex Mono',var(--mono)" };
  const [show,    setShow]    = useState(false);
  const [edits,   setEdits]   = useState({});   // key: tenor_label → {alpha_bp, rho, nu}
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [err,     setErr]     = useState(null);

  // When sabrParams or activeExpiry changes, reset edits to current values
  useEffect(() => {
    if (!sabrParams) return;
    const next = {};
    sabrParams.params
      .filter(p => p.expiry_label === activeExpiry)
      .forEach(p => {
        next[p.tenor_label] = {
          alpha_bp: parseFloat((p.alpha * 10000).toFixed(4)),
          rho:      parseFloat(p.rho.toFixed(4)),
          nu:       parseFloat(p.nu.toFixed(4)),
          // keep original for dirty tracking
          _orig_alpha_bp: parseFloat((p.alpha * 10000).toFixed(4)),
          _orig_rho:      parseFloat(p.rho.toFixed(4)),
          _orig_nu:       parseFloat(p.nu.toFixed(4)),
          atm_vol_bp:     p.atm_vol_bp,
          expiry_y:       p.expiry_y,
          tenor_y:        p.tenor_y,
          source:         p.source,
          fit_rmse_bp:    p.fit_rmse_bp,
        };
      });
    setEdits(next);
    setSaved(false);
  }, [sabrParams, activeExpiry]);

  if (!sabrParams) return null;

  const rows = sabrParams.params.filter(p => p.expiry_label === activeExpiry);
  if (!rows.length) return null;

  const isDirty = (ten) => {
    const e = edits[ten];
    if (!e) return false;
    return (
      Math.abs(e.alpha_bp - e._orig_alpha_bp) > 0.001 ||
      Math.abs(e.rho      - e._orig_rho)      > 0.0001 ||
      Math.abs(e.nu       - e._orig_nu)        > 0.0001
    );
  };
  const anyDirty = Object.keys(edits).some(isDirty);

  const update = (tenor, field, val) => {
    setEdits(prev => ({
      ...prev,
      [tenor]: { ...prev[tenor], [field]: val },
    }));
    setSaved(false);
  };

  const reset = (tenor) => {
    const e = edits[tenor];
    if (!e) return;
    setEdits(prev => ({
      ...prev,
      [tenor]: {
        ...prev[tenor],
        alpha_bp: prev[tenor]._orig_alpha_bp,
        rho:      prev[tenor]._orig_rho,
        nu:       prev[tenor]._orig_nu,
      },
    }));
  };

  const saveManual = async () => {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();

      const params = Object.entries(edits)
        .filter(([ten]) => isDirty(ten))
        .map(([ten, e]) => ({
          expiry_label: activeExpiry,
          tenor_label:  ten,
          expiry_y:     e.expiry_y,
          tenor_y:      e.tenor_y,
          alpha:        parseFloat(e.alpha_bp) / 10000.0,
          rho:          parseFloat(e.rho),
          nu:           parseFloat(e.nu),
          atm_vol_bp:   e.atm_vol_bp,
        }));

      if (!params.length) { setSaving(false); return; }

      const res = await fetch('/api/market-data/sabr-params/manual', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ valuation_date: saveDate, params }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setSaved(true);
      if (onSaved) await onSaved();
    } catch(e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inpStyle = (dirty) => ({
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: `1px solid ${dirty ? 'var(--amber)' : 'transparent'}`,
    outline: 'none', textAlign: 'right', padding: '2px 4px',
    ...mono, fontSize: '0.875rem',
    color: dirty ? 'var(--amber)' : 'var(--blue)',
    caretColor: 'var(--accent)',
  });

  const thS = {
    ...mono, fontSize: '0.6875rem', fontWeight: 400, letterSpacing: '0.06em',
    color: 'var(--text-dim)', padding: '3px 5px', textAlign: 'right',
    borderBottom: '1px solid var(--border)',
  };

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
        <button onClick={() => setShow(!show)} style={{
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text-dim)', padding: '3px 10px', fontSize: '0.8125rem',
          ...mono, cursor: 'pointer', borderRadius: '2px',
        }}>
          {show ? '▲' : '▼'} SABR PARAMS · {sabrParams.valuation_date}
        </button>
        {anyDirty && (
          <span style={{ fontSize: '0.75rem', color: 'var(--amber)', ...mono }}>
            ● unsaved edits
          </span>
        )}
      </div>

      {show && (
        <div style={{ marginTop: '6px' }}>
          {/* Header note */}
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', ...mono,
            marginBottom: '6px', lineHeight: 1.6 }}>
            Edit α, ρ, ν directly. Amber = modified from calibrated value.
            AUTO = from SABR calibration · MANUAL = user override.
            Changes only affect the active expiry ({activeExpiry}).
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  {['TEN', 'α (bp)', 'ρ', 'ν', 'ATM vol', 'RMSE', 'SRC', ''].map(h => (
                    <th key={h} style={{ ...thS, textAlign: h === 'TEN' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(p => {
                  const e    = edits[p.tenor_label] || {};
                  const d_a  = Math.abs((e.alpha_bp||0) - (e._orig_alpha_bp||0)) > 0.001;
                  const d_r  = Math.abs((e.rho||0)      - (e._orig_rho||0))      > 0.0001;
                  const d_n  = Math.abs((e.nu||0)        - (e._orig_nu||0))        > 0.0001;
                  const dirt = d_a || d_r || d_n;
                  const rmse = p.fit_rmse_bp;
                  const src  = e.source || 'AUTO';
                  return (
                    <tr key={p.tenor_label}
                      style={{ background: dirt ? 'rgba(245,200,66,0.03)' : 'transparent' }}>
                      {/* Tenor */}
                      <td style={{ ...mono, fontSize:'0.875rem', fontWeight:600,
                        color:'var(--accent)', padding:'3px 5px',
                        borderBottom:'1px solid var(--panel-2)', textAlign:'left' }}>
                        {p.tenor_label}
                      </td>
                      {/* α (bp) — editable */}
                      <td style={{ padding:'2px 3px', borderBottom:'1px solid var(--panel-2)' }}>
                        <input
                          type="text" inputMode="decimal"
                          value={e.alpha_bp ?? ''}
                          onChange={ev => update(p.tenor_label, 'alpha_bp', ev.target.value)}
                          style={inpStyle(d_a)}
                          title="α — vol level in bp. Controls ATM vol height."
                          onFocus={ev => ev.target.style.borderBottom='1px solid var(--accent)'}
                          onBlur={ev  => ev.target.style.borderBottom=`1px solid ${d_a?'var(--amber)':'transparent'}`}
                        />
                      </td>
                      {/* ρ — editable */}
                      <td style={{ padding:'2px 3px', borderBottom:'1px solid var(--panel-2)' }}>
                        <input
                          type="text" inputMode="decimal"
                          value={e.rho ?? ''}
                          onChange={ev => update(p.tenor_label, 'rho', ev.target.value)}
                          style={{ ...inpStyle(d_r),
                            color: d_r ? 'var(--amber)' : parseFloat(e.rho) < 0 ? 'var(--red)' : 'var(--blue)' }}
                          title="ρ — rate-vol correlation. Negative = receiver skew (USD typical: -0.2 to -0.4)."
                          onFocus={ev => ev.target.style.borderBottom='1px solid var(--accent)'}
                          onBlur={ev  => ev.target.style.borderBottom=`1px solid ${d_r?'var(--amber)':'transparent'}`}
                        />
                      </td>
                      {/* ν — editable */}
                      <td style={{ padding:'2px 3px', borderBottom:'1px solid var(--panel-2)' }}>
                        <input
                          type="text" inputMode="decimal"
                          value={e.nu ?? ''}
                          onChange={ev => update(p.tenor_label, 'nu', ev.target.value)}
                          style={inpStyle(d_n)}
                          title="ν — vol-of-vol. Controls wing curvature. Typical: 0.15–0.35."
                          onFocus={ev => ev.target.style.borderBottom='1px solid var(--accent)'}
                          onBlur={ev  => ev.target.style.borderBottom=`1px solid ${d_n?'var(--amber)':'transparent'}`}
                        />
                      </td>
                      {/* ATM vol — read only */}
                      <td style={{ ...mono, padding:'3px 5px', textAlign:'right',
                        color:'var(--text-dim)', fontSize:'0.8125rem',
                        borderBottom:'1px solid var(--panel-2)' }}>
                        {p.atm_vol_bp?.toFixed(1)}
                      </td>
                      {/* RMSE */}
                      <td style={{ ...mono, padding:'3px 5px', textAlign:'right',
                        fontSize:'0.8125rem', borderBottom:'1px solid var(--panel-2)',
                        color: rmse == null ? 'var(--text-dim)'
                          : rmse < 0.5 ? 'var(--accent)'
                          : rmse < 2.0 ? 'var(--amber)'
                          : 'var(--red)' }}>
                        {rmse != null ? rmse.toFixed(3) : src === 'MANUAL' ? '—' : '—'}
                      </td>
                      {/* Source badge */}
                      <td style={{ ...mono, padding:'3px 5px', textAlign:'right',
                        fontSize:'0.6875rem', borderBottom:'1px solid var(--panel-2)',
                        color: dirt ? 'var(--amber)'
                             : src === 'MANUAL' ? 'var(--amber)'
                             : src === 'AUTO' ? 'var(--accent)'
                             : src === 'INTERPOLATED' ? 'var(--amber)'
                             : 'var(--text-dim)' }}>
                        {dirt ? 'MANUAL*' : src}
                      </td>
                      {/* Reset button — only if dirty */}
                      <td style={{ padding:'2px 4px', borderBottom:'1px solid var(--panel-2)',
                        textAlign:'center' }}>
                        {dirt && (
                          <button onClick={() => reset(p.tenor_label)} style={{
                            background:'transparent', border:'none',
                            color:'var(--text-dim)', cursor:'pointer',
                            fontSize:'0.75rem', padding:'0 2px',
                            ...mono,
                          }} title="Reset to calibrated value">↺</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Save / status bar */}
          <div style={{ display:'flex', alignItems:'center', gap:'10px', marginTop:'8px' }}>
            <button
              onClick={saveManual}
              disabled={saving || !anyDirty}
              style={{ padding:'4px 14px', background:'transparent', borderRadius:'2px',
                border: anyDirty ? '1px solid var(--amber)' : '1px solid var(--border)',
                color:  anyDirty ? 'var(--amber)' : 'var(--text-dim)',
                ...mono, fontSize:'0.875rem', fontWeight:700, letterSpacing:'0.08em',
                cursor: anyDirty ? 'pointer' : 'not-allowed', opacity: anyDirty ? 1 : 0.4 }}>
              {saving ? 'SAVING...' : '▶ SAVE MANUAL PARAMS'}
            </button>
            {saved && (
              <span style={{ fontSize:'0.875rem', color:'var(--accent)', ...mono }}>
                ✔ saved
              </span>
            )}
            {err && (
              <span style={{ fontSize:'0.875rem', color:'var(--red)', ...mono }}>
                ✘ {err}
              </span>
            )}
            {anyDirty && !saved && (
              <span style={{ fontSize:'0.75rem', color:'var(--text-dim)', ...mono }}>
                {Object.keys(edits).filter(isDirty).length} bucket(s) modified
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── β=0 Normal SABR formula in JS (mirrors sabr.py exactly) ─────────────────
function normalSabrVol(F, K, T, alpha, rho, nu) {
  if (T <= 0 || alpha <= 0) return alpha * 10000;
  const correction = 1.0 + ((2.0 - 3.0 * rho * rho) / 24.0 * nu * nu
                          + rho * nu * alpha / 4.0) * T;
  if (Math.abs(F - K) < 1e-8) return alpha * correction * 10000;
  const z    = (nu / alpha) * (F - K);
  const disc = Math.sqrt(1.0 - 2.0 * rho * z + z * z);
  const denom = 1.0 - rho;
  if (Math.abs(denom) < 1e-10) return alpha * correction * 10000;
  const arg = (disc + z - rho) / denom;
  if (arg <= 0) return alpha * correction * 10000;
  const chi = Math.log(arg);
  if (Math.abs(chi) < 1e-10) return alpha * correction * 10000;
  return alpha * (z / chi) * correction * 10000;
}

// Calibrate α from ATM analytically
function alphaFromAtm(atmVol, T, rho, nu) {
  const sig = atmVol / 10000.0;
  const a = rho * nu * T / 4.0;
  const b = 1.0 + (2.0 - 3.0 * rho * rho) / 24.0 * nu * nu * T;
  const c = -sig;
  if (Math.abs(a) < 1e-10) return Math.abs(b) > 1e-10 ? -c / b : sig;
  const disc = b * b - 4.0 * a * c;
  if (disc < 0) return sig;
  const r1 = (-b + Math.sqrt(disc)) / (2.0 * a);
  const r2 = (-b - Math.sqrt(disc)) / (2.0 * a);
  const cands = [r1, r2].filter(x => x > 0);
  if (!cands.length) return sig;
  return cands.reduce((a, b) => Math.abs(a - sig) < Math.abs(b - sig) ? a : b);
}

// ── Vol Smile Canvas Chart ────────────────────────────────────────────────────
const TENOR_COLORS = {
  '1Y': '#00D4A8', '2Y': '#4A9EFF', '3Y': '#F5C842',
  '5Y': '#FF6B6B', '7Y': '#C084FC', '9Y': '#34D399',
};

function VolSmileChart({ activeExpiry, skewGrid, atmGrid, sabrParams }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0D0F17';
    ctx.fillRect(0, 0, W, H);

    const PAD = { top:18, right:16, bottom:36, left:46 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top  - PAD.bottom;

    // Strike range: -220 to +220 bp
    const xMin = -220, xMax = 220;
    const xToCanvas = x => PAD.left + (x - xMin) / (xMax - xMin) * cW;

    // Collect all vol values to set y range
    let allVols = [];
    SWAPTION_TENORS.forEach(ten => {
      const atmVol = atmGrid?.find(r => r.expiry === activeExpiry)
                       ?.cells?.find(c => c.tenor === ten)?.vol_bp;
      if (!atmVol) return;
      allVols.push(atmVol);
      const rowData = skewGrid[activeExpiry]?.[ten] || {};
      OTM_STRIKE_OFFSETS.forEach(off => {
        const spread = rowData[String(off)];
        if (spread != null) allVols.push(atmVol + spread);
      });
    });
    if (!allVols.length) {
      ctx.fillStyle = '#444';
      ctx.font = `11px 'DM Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Enter vol data to view smile', W/2, H/2);
      return;
    }

    const yMin = Math.max(0, Math.min(...allVols) - 8);
    const yMax = Math.max(...allVols) + 8;
    const yToCanvas = y => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * cH;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = yMin + (yMax - yMin) * i / yTicks;
      const cy = yToCanvas(y);
      ctx.beginPath(); ctx.moveTo(PAD.left, cy); ctx.lineTo(PAD.left + cW, cy); ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.font = `9px 'DM Mono', monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(y.toFixed(1), PAD.left - 5, cy + 3);
    }

    // ATM vertical line
    const atmX = xToCanvas(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(atmX, PAD.top); ctx.lineTo(atmX, PAD.top + cH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = `8px 'DM Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('ATM', atmX, PAD.top + cH + 12);

    // X axis labels
    [-200, -100, 0, 100, 200].forEach(off => {
      const cx = xToCanvas(off);
      ctx.fillStyle = off === 0 ? '#666' : off < 0 ? '#FF6B6B88' : '#00D4A888';
      ctx.font = `9px 'DM Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.fillText((off > 0 ? '+' : '') + off, cx, PAD.top + cH + 22);
    });

    // Y axis label
    ctx.save();
    ctx.translate(11, PAD.top + cH/2);
    ctx.rotate(-Math.PI/2);
    ctx.fillStyle = '#555';
    ctx.font = `9px 'DM Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Vol (bp)', 0, 0);
    ctx.restore();

    // Draw one smile curve per tenor
    SWAPTION_TENORS.forEach(ten => {
      const color  = TENOR_COLORS[ten] || '#888';
      const atmVol = atmGrid?.find(r => r.expiry === activeExpiry)
                       ?.cells?.find(c => c.tenor === ten)?.vol_bp;
      if (!atmVol) return;

      const rowData  = skewGrid[activeExpiry]?.[ten] || {};
      const T        = { '1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10 }[activeExpiry] || 1;
      const F        = 0.037; // approximate forward — visual only
      const marketPts = [];

      // Collect market points
      OTM_STRIKE_OFFSETS.forEach(off => {
        const spread = rowData[String(off)];
        if (spread != null) marketPts.push({ off, vol: atmVol + spread });
      });
      marketPts.push({ off: 0, vol: atmVol }); // ATM point

      // Try to use calibrated SABR params if available
      let alpha = null, rho = -0.30, nu = 0.25;
      if (sabrParams?.params) {
        const p = sabrParams.params.find(
          p => p.expiry_label === activeExpiry && p.tenor_label === ten
        );
        if (p) { alpha = p.alpha; rho = p.rho; nu = p.nu; }
      }
      // If no calibrated params, derive alpha from ATM + use defaults
      if (!alpha) {
        alpha = alphaFromAtm(atmVol, T, rho, nu);
      }

      // Draw smooth SABR curve
      const steps = 120;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const off_bp = xMin + (xMax - xMin) * i / steps;
        const K = F + off_bp / 10000.0;
        const vol = normalSabrVol(F, K, T, alpha, rho, nu);
        if (vol > 0 && vol < 500) pts.push({ x: xToCanvas(off_bp), y: yToCanvas(vol) });
      }

      if (pts.length < 2) return;

      // Gradient fill
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
      grad.addColorStop(0, color + '22');
      grad.addColorStop(1, color + '00');
      ctx.beginPath();
      ctx.moveTo(pts[0].x, PAD.top + cH);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length-1].x, PAD.top + cH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Glow pass
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = color + '33';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Sharp line
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Market input dots with halos
      marketPts.forEach(({ off, vol }) => {
        const cx = xToCanvas(off);
        const cy = yToCanvas(vol);
        // Halo
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = color + '22';
        ctx.fill();
        // Dot
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      // Tenor label at right edge
      const lastPt = pts[pts.length - 1];
      ctx.fillStyle = color;
      ctx.font = `bold 9px 'DM Mono', monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(ten, lastPt.x + 2, lastPt.y + 3);
    });

    // Title
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `9px 'DM Mono', monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`SABR VOL SMILE · ${activeExpiry} EXPIRY · All Tenors · bp`, PAD.left, 12);

  }, [activeExpiry, skewGrid, atmGrid, sabrParams]);

  return (
    <canvas ref={canvasRef} style={{
      width:'100%', height:'200px', borderRadius:'2px',
      background:'#0D0F17', border:'1px solid var(--border)',
      display:'block', marginBottom:'10px',
    }} />
  );
}

// ── SABR calibration quality helpers ────────────────────────────────────────

// Classify calibration quality given which strike offsets are filled
function sabrQuality(offsets) {
  // offsets: array of offset integers that have non-null values e.g. [-100,-25,25,100]
  const hasNeg  = offsets.some(o => o < 0);
  const hasPos  = offsets.some(o => o > 0);
  const hasWing = offsets.some(o => Math.abs(o) >= 100);
  const hasNear = offsets.some(o => Math.abs(o) <= 50 && o !== 0);
  const n       = offsets.length;

  if (n === 0)                            return { level:'none',    color:'var(--text-dim)',  label:'NO DATA',    desc:'α from ATM only · ρ and ν are initial guesses · flat smile' };
  if (!hasNeg || !hasPos)                 return { level:'partial', color:'var(--amber)',      label:'SKEW ONLY',  desc:'Need points on both sides of ATM to identify ρ (skew)' };
  if (hasNeg && hasPos && !hasWing)       return { level:'ok',      color:'var(--blue)',       label:'SABR FIT',   desc:'ρ identified · add ±100bp or ±200bp to identify ν (curvature)' };
  if (hasNeg && hasPos && hasWing && n >= 4) return { level:'good', color:'var(--accent)',     label:'QUOTED',     desc:'Market quotes · α + ρ + ν fully identified · reliable smile' };
  return                                         { level:'ok',      color:'var(--blue)',       label:'SABR FIT',   desc:'Add more strike points for a full calibration' };
}

// Minimum requirement summary for the whole surface
function surfaceCompleteness(skewGrid, atmGrid) {
  let total = 0, goodBuckets = 0, okBuckets = 0, emptyBuckets = 0;
  SWAPTION_EXPIRIES.forEach(exp => {
    SWAPTION_TENORS.forEach(ten => {
      const atmVol = atmGrid?.find(r => r.expiry === exp)?.cells?.find(c => c.tenor === ten)?.vol_bp;
      if (!atmVol) return; // skip if no ATM vol
      total++;
      const rowData = skewGrid[exp]?.[ten] || {};
      const filled  = OTM_STRIKE_OFFSETS.filter(o => rowData[String(o)] != null);
      const q       = sabrQuality(filled);
      if (q.level === 'good')    goodBuckets++;
      else if (q.level === 'ok') okBuckets++;
      else                       emptyBuckets++;
    });
  });
  return { total, goodBuckets, okBuckets, emptyBuckets };
}

// ── OTM Skew / SABR tab ──────────────────────────────────────────────────────
function SwvOTMSkew({ atmGrid }) {
  const [skewGrid,     setSkewGrid]     = useState(emptySkewGrid);
  const [saveDate,     setSaveDate]     = useState(new Date().toISOString().slice(0,10));
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(null);
  const [saveErr,      setSaveErr]      = useState(null);
  const [loadedDate,   setLoadedDate]   = useState(null);
  const [sabrParams,   setSabrParams]   = useState(null);
  const [activeExpiry, setActiveExpiry] = useState(SWAPTION_EXPIRIES[3]); // 5Y default
  const [showSabr,     setShowSabr]     = useState(false);
  // Always absolute vol mode — Bloomberg SMKO tickers give absolute vols
  const absMode = true;
  // Bloomberg SMKO snap state
  const [blpSnapping,  setBlpSnapping]  = useState(false);
  const [blpSnapResult,setBlpSnapResult]= useState(null);
  const [blpSnapErr,   setBlpSnapErr]   = useState(null);

  // Load latest skew from DB on mount
  useEffect(() => {
    loadLatestSkew();
    loadSabrParams();
  }, []);

  const loadLatestSkew = async () => {
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/market-data/vol-skew/latest', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.exists) return;
      setLoadedDate(data.valuation_date);
      const newGrid = emptySkewGrid();
      data.cells.forEach(cell => {
        if (!newGrid[cell.expiry_label]) return;
        if (!newGrid[cell.expiry_label][cell.tenor_label]) return;
        newGrid[cell.expiry_label][cell.tenor_label] = {
          '-200': cell.spread_m200, '-100': cell.spread_m100,
          '-50':  cell.spread_m50,  '-25':  cell.spread_m25,
          '25':   cell.spread_p25,  '50':   cell.spread_p50,
          '100':  cell.spread_p100, '200':  cell.spread_p200,
        };
      });
      setSkewGrid(newGrid);
    } catch {}
  };

  const loadSabrParams = async () => {
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/market-data/sabr-params/latest', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.exists) setSabrParams(data);
    } catch {}
  };

  // Bloomberg SMKO snap — snaps absolute vols for negative OTM strikes
  const snapSmko = async () => {
    setBlpSnapping(true); setBlpSnapResult(null); setBlpSnapErr(null);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();

      // Build ticker list for all 8 OTM strikes — full surface snap
      const tickers = [];
      SWAPTION_EXPIRIES.forEach(exp => {
        SWAPTION_TENORS.forEach(ten => {
          const atmVol = atmGrid?.find(r => r.expiry === exp)?.cells?.find(c => c.tenor === ten)?.vol_bp;
          if (!atmVol) return;
          OTM_STRIKE_OFFSETS.forEach(off => {
            const ticker = otmTicker(off, exp, ten);
            if (ticker) tickers.push({ expiry: exp, tenor: ten, offset_bp: off, ticker });
          });
        });
      });

      const res = await fetch('/api/bloomberg/snap-otm-vol', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ snap_date: saveDate, tickers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'SMKO snap failed');

      // data.quotes: [{ expiry, tenor, offset_bp, abs_vol_bp }]
      // Fill grid in absolute mode — cells store abs vols, conversion on save
      if (data.quotes?.length) {
        const newGrid = { ...skewGrid };
        data.quotes.forEach(q => {
          if (!newGrid[q.expiry]?.[q.tenor]) return;
          newGrid[q.expiry][q.tenor][String(q.offset_bp)] = q.abs_vol_bp;
        });
        setSkewGrid(newGrid);
      }
      setBlpSnapResult({ count: data.quotes?.length || 0, failed: data.failed || [] });
    } catch(e) {
      setBlpSnapErr(e.message);
    } finally {
      setBlpSnapping(false);
    }
  };

  const updateCell = (expiry, tenor, offset, value) => {
    setSkewGrid(prev => ({
      ...prev,
      [expiry]: {
        ...prev[expiry],
        [tenor]: {
          ...prev[expiry][tenor],
          [offset]: value === '' ? null : parseFloat(value),
        },
      },
    }));
  };

  const saveSkew = async () => {
    setSaving(true); setSaved(null); setSaveErr(null);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();

      // Get ATM vols from atmGrid
      const getAtm = (exp, ten) => {
        const row = atmGrid?.find(r => r.expiry === exp);
        return row?.cells?.find(c => c.tenor === ten)?.vol_bp ?? null;
      };

      const cells = [];
      SWAPTION_EXPIRIES.forEach(exp => {
        SWAPTION_TENORS.forEach(ten => {
          const atm = getAtm(exp, ten);
          if (atm === null) return;
          const offsets = skewGrid[exp]?.[ten] || {};

          // In abs mode: stored values are absolute vols → convert to spreads
          // In spread mode: stored values are already spreads
          const toSpread = (val) => {
            if (val === null || val === undefined) return null;
            return absMode ? val - atm : val;
          };

          cells.push({
            expiry_label: exp,
            tenor_label:  ten,
            expiry_y:     EXPIRY_YEARS[exp],
            tenor_y:      TENOR_YEARS[ten],
            atm_vol_bp:   atm,
            spread_m200:  toSpread(offsets['-200'] ?? null),
            spread_m100:  toSpread(offsets['-100'] ?? null),
            spread_m50:   toSpread(offsets['-50']  ?? null),
            spread_m25:   toSpread(offsets['-25']  ?? null),
            spread_p25:   toSpread(offsets['25']   ?? null),
            spread_p50:   toSpread(offsets['50']   ?? null),
            spread_p100:  toSpread(offsets['100']  ?? null),
            spread_p200:  toSpread(offsets['200']  ?? null),
            source: 'MANUAL',
          });
        });
      });

      const res = await fetch('/api/market-data/vol-skew', {
        method: 'POST',
        headers: {
          Authorization:  'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ valuation_date: saveDate, cells }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setSaved({ date: saveDate, saved: data.saved, calibrated: data.calibrated, interpolated: data.interpolated || 0, errors: data.errors || [] });
      setLoadedDate(saveDate);
      await loadSabrParams();
    } catch (e) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Count filled cells
  let filledCells = 0;
  SWAPTION_EXPIRIES.forEach(exp =>
    SWAPTION_TENORS.forEach(ten =>
      OTM_STRIKE_OFFSETS.forEach(off => {
        if (skewGrid[exp]?.[ten]?.[off] != null) filledCells++;
      })
    )
  );
  const totalCells = SWAPTION_EXPIRIES.length * SWAPTION_TENORS.length * OTM_STRIKE_OFFSETS.length;

  const mono = { fontFamily:"'IBM Plex Mono',var(--mono)" };
  const dim  = { color:'var(--text-dim)' };
  const thS  = { ...mono, fontSize:'0.6875rem', fontWeight:400, letterSpacing:'0.06em',
                 ...dim, padding:'3px 5px', textAlign:'right',
                 borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' };

  // Current expiry row's skew
  const currentRow = skewGrid[activeExpiry] || {};

  return (
    <div>
      <SectionLabel sub={`${filledCells} / ${totalCells} cells filled · SABR auto-calibrates on save`}>
        OTM Skew / SABR
      </SectionLabel>

      {/* Model identity banner */}
      <div style={{ background:'rgba(13,212,168,0.04)', border:'1px solid rgba(13,212,168,0.15)',
        borderRadius:'2px', padding:'7px 12px', marginBottom:'10px',
        display:'flex', alignItems:'baseline', gap:'12px', flexWrap:'wrap' }}>
        <span style={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.12em',
          color:'var(--accent)', ...mono, whiteSpace:'nowrap' }}>RIJEKA β=0 NORMAL SABR</span>
        <span style={{ fontSize:'0.8125rem', color:'var(--text-dim)', ...mono }}>
          Market vol quotes snapped from Bloomberg SMKO tickers as
          <strong style={{color:'var(--text)'}}> input data.</strong>
          &nbsp;Rijeka calibrates α, ρ, ν independently.
          Spread = abs_vol − ATM computed automatically on save.
        </span>
      </div>

      {/* SABR minimum requirements panel */}
      <div style={{ background:'rgba(74,158,255,0.04)', border:'1px solid rgba(74,158,255,0.15)',
        borderRadius:'2px', padding:'8px 10px', marginBottom:'10px', lineHeight:1.8 }}>
        <div style={{ fontSize:'0.8125rem', fontWeight:700, color:'var(--blue)',
          letterSpacing:'0.08em', ...mono, marginBottom:'4px' }}>
          SABR CALIBRATION REQUIREMENTS
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'2px 12px',
          fontSize:'0.8125rem', ...mono }}>
          <span style={{ color:'var(--text-dim)' }}>α (vol level)</span>
          <span style={{ color:'var(--accent)' }}>ATM vol from Instruments tab — always available, no OTM data needed</span>
          <span style={{ color:'var(--text-dim)' }}>ρ (skew)</span>
          <span style={{ color:'var(--amber)' }}>Minimum: one point each side of ATM — e.g. -25bp AND +25bp</span>
          <span style={{ color:'var(--text-dim)' }}>ν (curvature)</span>
          <span style={{ color:'var(--red)' }}>Minimum: one wing — e.g. -100bp OR +100bp · wings needed to see smile shape</span>
        </div>
        <div style={{ marginTop:'6px', display:'flex', gap:'16px', fontSize:'0.8125rem', ...mono, flexWrap:'wrap' }}>
          <span style={{ color:'var(--text-dim)' }}>● NO DATA — flat smile</span>
          <span style={{ color:'var(--amber)' }}>● SKEW ONLY — one side missing</span>
          <span style={{ color:'var(--blue)' }}>● SABR FIT — ρ fit, ν guessed</span>
          <span style={{ color:'var(--accent)' }}>● QUOTED — market data, fully calibrated</span>
          <span style={{ color:'var(--amber)', opacity:0.8 }}>● INTERP — no market data, bilinear from anchors</span>
        </div>
        {/* Surface completeness summary */}
        {(() => {
          const { total, goodBuckets, okBuckets, emptyBuckets } = surfaceCompleteness(skewGrid, atmGrid);
          if (!total) return null;
          return (
            <div style={{ marginTop:'6px', paddingTop:'6px', borderTop:'1px solid rgba(74,158,255,0.1)',
              fontSize:'0.8125rem', ...mono, color:'var(--text-dim)' }}>
              Surface coverage: &nbsp;
              <span style={{ color:'var(--accent)' }}>{goodBuckets} QUOTED</span> &nbsp;·&nbsp;
              <span style={{ color:'var(--blue)' }}>{okBuckets} SABR FIT</span> &nbsp;·&nbsp;
              <span style={{ color:'var(--text-dim)' }}>{emptyBuckets} empty</span>
              &nbsp;of {total} ATM-filled buckets for {activeExpiry} expiry
            </div>
          );
        })()}
      </div>

      {loadedDate && (
        <div style={{ fontSize:'0.8125rem', color:'var(--accent)', ...mono, marginBottom:'6px' }}>
          ✔ loaded {loadedDate}
        </div>
      )}

      {/* Expiry selector */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
        {SWAPTION_EXPIRIES.map(exp => (
          <button key={exp} onClick={() => setActiveExpiry(exp)} style={{
            flex:1, padding:'4px 0', fontSize:'0.8125rem', fontWeight:700,
            letterSpacing:'0.06em', cursor:'pointer', borderRadius:'2px',
            ...mono, background:'transparent',
            border: activeExpiry===exp ? '1px solid var(--accent)' : '1px solid var(--border)',
            color:  activeExpiry===exp ? 'var(--accent)' : 'var(--text-dim)',
          }}>{exp}</button>
        ))}
      </div>

      {/* Skew grid for active expiry */}
      <div style={{ overflowX:'auto', marginBottom:'10px' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'680px' }}>
          <thead>
            <tr>
              <th colSpan={9 + 1} style={{ ...mono, fontSize:'0.6875rem', color:'var(--text-dim)',
                textAlign:'left', padding:'2px 0 4px', letterSpacing:'0.08em',
                borderBottom:'1px solid var(--border)' }}>
                SWAP TENOR ↓ &nbsp;·&nbsp; STRIKE vs ATM FORWARD (bp) →
                &nbsp;·&nbsp;
                <span style={{ color:'var(--blue)' }}>ATM = actual vol from Instruments tab</span>
                &nbsp;·&nbsp;
                <span style={{ color:'var(--text-dim)' }}>wings = spread vs ATM</span>
              </th>
            </tr>
            <tr>
              <th style={{ ...thS, textAlign:'left', width:'42px' }}>TENOR</th>
              {OTM_STRIKE_OFFSETS.map(off => (
                <th key={off} style={{ ...thS,
                  color: off < 0 ? 'var(--red)' : 'var(--accent)' }}>
                  {OTM_STRIKE_LABELS[String(off)]}
                </th>
              )).slice(0, 4)}
              {/* ATM column in the middle */}
              <th style={{ ...thS, color:'var(--blue)',
                background:'rgba(74,158,255,0.06)',
                borderLeft:'1px solid rgba(74,158,255,0.2)',
                borderRight:'1px solid rgba(74,158,255,0.2)' }}>
                ATM{absMode ? ' (bp)' : ''}
              </th>
              {OTM_STRIKE_OFFSETS.map(off => (
                <th key={off} style={{ ...thS,
                  color: off < 0 ? 'var(--red)' : 'var(--accent)' }}>
                  {OTM_STRIKE_LABELS[String(off)]}
                </th>
              )).slice(4)}
              <th style={{ ...thS, color:'var(--text-dim)', width:'72px' }}>SABR</th>
            </tr>
          </thead>
          <tbody>
            {/* Snap tenors — have SMKO tickers, fully editable */}
            {OTM_SNAP_TENORS.map(ten => {
              const rowData = currentRow[ten] || {};
              const atmVol  = atmGrid?.find(r => r.expiry === activeExpiry)
                                ?.cells?.find(c => c.tenor === ten)?.vol_bp ?? null;
              return (
                <tr key={ten}>
                  <td style={{ ...mono, fontSize:'0.875rem', fontWeight:600,
                    color:'var(--accent)', padding:'3px 6px 3px 0',
                    borderBottom:'1px solid var(--panel-2)' }}>
                    {ten}
                  </td>
                  {/* Left wings: -200, -100, -50, -25 */}
                  {[-200,-100,-50,-25].map(off => {
                    const stored = rowData[String(off)];
                    // Display: in abs mode show stored value as-is (abs vol)
                    //          in spread mode show stored value as-is (spread)
                    const displayVal = stored;
                    const isNeg = displayVal !== null && displayVal < 0;
                    // Abs mode: has Bloomberg ticker
                    const ticker = absMode ? otmTicker(off, activeExpiry, ten) : null;
                    return (
                      <td key={off} style={{ padding:'2px',
                        borderBottom:'1px solid var(--panel-2)' }}>
                        {ticker && (
                          <div style={{ fontSize:'0.5625rem', color:'rgba(74,158,255,0.5)',
                            ...mono, padding:'0 4px', lineHeight:1, letterSpacing:'0.01em' }}>
                            {ticker.replace(' SMKO Curncy','')}
                          </div>
                        )}
                        <input
                          type="text" inputMode="decimal"
                          value={displayVal !== null && displayVal !== undefined ? (typeof displayVal === 'number' ? parseFloat(displayVal.toFixed(4)) : displayVal) : ''}
                          placeholder="—"
                          onChange={e => updateCell(activeExpiry, ten, String(off), e.target.value)}
                          style={{ width:'100%', background:'transparent', border:'none',
                            borderBottom:'1px solid transparent', outline:'none',
                            textAlign:'right', padding:'2px 4px',
                            ...mono, fontSize:'0.875rem',
                            color: isNeg ? 'var(--red)' : displayVal !== null ? 'var(--accent)' : 'var(--text-dim)',
                            caretColor:'var(--accent)' }}
                          onFocus={e => e.target.style.borderBottom='1px solid var(--accent)'}
                          onBlur={e  => e.target.style.borderBottom='1px solid transparent'}
                        />
                      </td>
                    );
                  })}
                  {/* ATM column — read-only, shows actual vol */}
                  <td style={{ padding:'3px 6px', textAlign:'right',
                    borderBottom:'1px solid var(--panel-2)',
                    background:'rgba(74,158,255,0.04)',
                    borderLeft:'1px solid rgba(74,158,255,0.15)',
                    borderRight:'1px solid rgba(74,158,255,0.15)',
                    ...mono, fontSize:'0.875rem', fontWeight:700,
                    color: atmVol !== null ? 'var(--blue)' : 'var(--text-dim)' }}>
                    {atmVol !== null ? atmVol.toFixed(1) : '—'}
                  </td>
                  {/* Right wings: +25, +50, +100, +200 */}
                  {[25,50,100,200].map(off => {
                    const val = rowData[String(off)];
                    const ticker = absMode ? otmTicker(off, activeExpiry, ten) : null;
                    return (
                      <td key={off} style={{ padding:'2px',
                        borderBottom:'1px solid var(--panel-2)' }}>
                        {ticker && (
                          <div style={{ fontSize:'0.5625rem', color:'rgba(13,212,168,0.5)',
                            ...mono, padding:'0 4px', lineHeight:1, letterSpacing:'0.01em' }}>
                            {ticker.replace(' SMKO Curncy','')}
                          </div>
                        )}
                        <input
                          type="text" inputMode="decimal"
                          value={val !== null && val !== undefined ? (typeof val === 'number' ? parseFloat(val.toFixed(4)) : val) : ''}
                          placeholder="—"
                          onChange={e => updateCell(activeExpiry, ten, String(off), e.target.value)}
                          style={{ width:'100%', background:'transparent', border:'none',
                            borderBottom:'1px solid transparent', outline:'none',
                            textAlign:'right', padding:'2px 4px',
                            ...mono, fontSize:'0.875rem',
                            color: val !== null ? 'var(--accent)' : 'var(--text-dim)',
                            caretColor:'var(--accent)' }}
                          onFocus={e => e.target.style.borderBottom='1px solid var(--accent)'}
                          onBlur={e  => e.target.style.borderBottom='1px solid transparent'}
                        />
                      </td>
                    );
                  })}
                  {/* Per-row SABR quality indicator */}
                  {(() => {
                    const filled  = OTM_STRIKE_OFFSETS.filter(o => rowData[String(o)] != null);
                    const q       = sabrQuality(filled);
                    return (
                      <td style={{ padding:'3px 5px', borderBottom:'1px solid var(--panel-2)',
                        textAlign:'center', whiteSpace:'nowrap' }}
                        title={q.desc}>
                        <span style={{ ...mono, fontSize:'0.6875rem', fontWeight:700,
                          color: q.color,
                          padding:'1px 5px', borderRadius:'2px',
                          background: q.level==='good' ? 'rgba(13,212,168,0.08)'
                                    : q.level==='ok'   ? 'rgba(245,200,66,0.08)'
                                    : q.level==='partial' ? 'rgba(255,107,107,0.08)'
                                    : 'transparent',
                          border: `1px solid ${q.color}33`,
                        }}>
                          {q.label}
                        </span>
                      </td>
                    );
                  })()}
                </tr>
              );
            })}
            {/* Interpolated tenors — no SMKO tickers, SABR fills from anchor points */}
            <tr>
              <td colSpan={10 + 1} style={{ padding:'4px 6px',
                borderTop:'1px solid var(--border)', borderBottom:'1px solid var(--panel-2)',
                background:'rgba(74,158,255,0.03)' }}>
                <span style={{ fontSize:'0.6875rem', color:'var(--blue)',
                  fontFamily:"'IBM Plex Mono',var(--mono)", letterSpacing:'0.08em' }}>
                  SABR INTERPOLATED — no Bloomberg SMKO tickers for these tenors
                </span>
                <span style={{ fontSize:'0.6875rem', color:'var(--text-dim)',
                  fontFamily:"'IBM Plex Mono',var(--mono)", marginLeft:'8px' }}>
                  {OTM_INTERP_TENORS.join(' · ')} — params derived from {OTM_SNAP_TENORS.join('/')} anchor points
                </span>
              </td>
            </tr>
            {OTM_INTERP_TENORS.map(ten => {
              const atmVol = atmGrid?.find(r => r.expiry === activeExpiry)
                               ?.cells?.find(c => c.tenor === ten)?.vol_bp ?? null;
              // Find interpolated SABR params for this bucket
              const sp = sabrParams?.params?.find(
                p => p.expiry_label === activeExpiry && p.tenor_label === ten
              );
              return (
                <tr key={ten} style={{ background:'rgba(74,158,255,0.02)', opacity:0.7 }}>
                  <td style={{ fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'0.875rem',
                    fontWeight:600, color:'var(--blue)', padding:'3px 6px 3px 0',
                    borderBottom:'1px solid var(--panel-2)' }}>
                    {ten}
                  </td>
                  {/* ATM col */}
                  <td colSpan={4} style={{ padding:'3px 6px', textAlign:'right',
                    borderBottom:'1px solid var(--panel-2)',
                    fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'0.75rem',
                    color:'var(--text-dim)' }}>
                    {sp ? `α=${(sp.alpha*10000).toFixed(1)}bp  ρ=${sp.rho.toFixed(3)}  ν=${sp.nu.toFixed(3)}` : '—'}
                  </td>
                  <td style={{ padding:'3px 6px', textAlign:'right',
                    borderBottom:'1px solid var(--panel-2)',
                    background:'rgba(74,158,255,0.04)',
                    borderLeft:'1px solid rgba(74,158,255,0.15)',
                    borderRight:'1px solid rgba(74,158,255,0.15)',
                    fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'0.875rem',
                    fontWeight:700, color:'var(--blue)' }}>
                    {atmVol !== null ? atmVol.toFixed(1) : '—'}
                  </td>
                  <td colSpan={4} style={{ padding:'3px 6px',
                    borderBottom:'1px solid var(--panel-2)',
                    fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'0.75rem',
                    color:'var(--text-dim)', textAlign:'center' }}>
                    SABR interpolated from {OTM_SNAP_TENORS[0]} + {OTM_SNAP_TENORS[OTM_SNAP_TENORS.length-1]} anchors
                  </td>
                  <td style={{ padding:'3px 5px', borderBottom:'1px solid var(--panel-2)',
                    textAlign:'center' }}>
                    <span style={{ fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'0.6875rem',
                      color:'var(--blue)', padding:'1px 5px', borderRadius:'2px',
                      background:'rgba(74,158,255,0.08)', border:'1px solid rgba(74,158,255,0.2)' }}>
                      INTERP
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Vol smile chart — updates live as you type */}
      <VolSmileChart
        activeExpiry={activeExpiry}
        skewGrid={skewGrid}
        atmGrid={atmGrid}
        sabrParams={sabrParams}
      />

      {/* SABR params — editable */}
      <SabrParamsEditor
        sabrParams={sabrParams}
        activeExpiry={activeExpiry}
        saveDate={saveDate}
        onSaved={loadSabrParams}
      />

      {/* Bloomberg SMKO snap — abs vol mode only */}
      {absMode && (
        <div style={{ border:'1px solid rgba(74,158,255,0.2)', borderRadius:'2px',
          padding:'8px 10px', marginBottom:'8px',
          background:'rgba(74,158,255,0.04)' }}>
          <div style={{ fontSize:'0.8125rem', fontWeight:700, color:'var(--blue)',
            letterSpacing:'0.08em', ...mono, marginBottom:'6px' }}>
            SNAP MARKET DATA — Full OTM Surface (all 8 strikes)
          </div>
          <div style={{ fontSize:'0.75rem', color:'var(--text-dim)', ...mono, marginBottom:'6px', lineHeight:1.6 }}>
            Snaps absolute vol quotes (bp) for all 8 OTM strikes (±25/±50/±100/±200bp).
            These are <strong style={{color:'var(--text)'}}>market input quotes</strong> — Rijeka's SABR calibration runs on save.<br/>
            Data source: Bloomberg SMKO · Field: MID · Normal vol bp absolute
            <span style={{color:'var(--text-dim)',marginLeft:'8px'}}>
              Prefixes: USWB(-25) · USWC(-50) · USWE(-100) · USWG(-200) · USWL(+25) · USWM(+50) · USWO(+100) · USWR(+200)
            </span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <button onClick={snapSmko} disabled={blpSnapping} style={{
              padding:'5px 14px', background:'transparent', borderRadius:'2px',
              border:'1px solid var(--blue)', color:'var(--blue)',
              ...mono, fontSize:'0.875rem', fontWeight:700, letterSpacing:'0.08em',
              cursor: blpSnapping ? 'not-allowed' : 'pointer',
              opacity: blpSnapping ? 0.5 : 1,
            }}>
              {blpSnapping ? 'FETCHING QUOTES...' : '▶ SNAP MARKET QUOTES'}
            </button>
            {blpSnapResult && (
              <span style={{ fontSize:'0.875rem', color:'var(--accent)', ...mono }}>
                ✔ {blpSnapResult.count} vols snapped
                {blpSnapResult.failed?.length > 0 && (
                  <span style={{ color:'var(--amber)', marginLeft:'6px' }}>
                    · {blpSnapResult.failed.length} failed
                  </span>
                )}
              </span>
            )}
            {blpSnapErr && (
              <span style={{ fontSize:'0.875rem', color:'var(--red)', ...mono }}>
                ✘ {blpSnapErr}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Save controls */}
      <div style={{ borderTop:'1px solid var(--border)', paddingTop:'10px',
        display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
        <input type="date" value={saveDate} onChange={e => setSaveDate(e.target.value)}
          style={{ background:'var(--panel-2)', border:'1px solid var(--border)',
            color:'var(--text)', ...mono, fontSize:'1rem',
            padding:'0.25rem 0.45rem', borderRadius:2, outline:'none' }} />
        <button
          onClick={saveSkew}
          disabled={saving || filledCells === 0}
          style={{ padding:'0.25rem 0.85rem', background:'rgba(14,201,160,0.07)',
            border:'1px solid var(--accent)', borderRadius:2,
            ...mono, fontSize:'1rem', fontWeight:700,
            letterSpacing:'0.1em', color:'var(--accent)',
            cursor: filledCells > 0 ? 'pointer' : 'not-allowed',
            opacity: filledCells > 0 ? 1 : 0.4 }}>
          {saving ? 'SAVING + CALIBRATING...' : '▶ SAVE TO DB + CALIBRATE SABR'}
        </button>
        {saved && (
          <span style={{ fontSize:'0.9375rem', color:'var(--accent)', ...mono }}>
            ✔ saved {saved.date} · {saved.saved} cells · {saved.calibrated} SABR fits · {saved.interpolated} interpolated
          </span>
        )}
        {saved && saved.errors?.length > 0 && (
          <div style={{ fontSize:'0.75rem', color:'var(--red)', ...mono, marginTop:'4px' }}>
            ✘ {saved.errors.length} errors: {saved.errors.slice(0,2).join(' | ')}
          </div>
        )}
        {saveErr && (
          <span style={{ fontSize:'0.9375rem', color:'var(--red)', ...mono }}>
            ✘ {saveErr}
          </span>
        )}
      </div>
      <div style={{ fontSize:'0.75rem', color:'var(--text-dim)', marginTop:'6px', ...mono }}>
        SABR calibration runs automatically on save — α, ρ, ν fitted per (expiry, tenor) bucket.
        OTM swaption pricing uses SABR vol when surface is loaded.
        Falls back to user-entered ATM vol if surface not available.
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SwaptionVolDetail() {
  const { grid, filledCount, snapshotSaved, updateVol, saveSnapshot } = useXVAStore();
  const filled = filledCount();
  const total  = SWAPTION_EXPIRIES.length * SWAPTION_TENORS.length;

  // ── Unified snap state ────────────────────────────────────────────────────
  const [masterSnapping, setMasterSnapping] = useState(false);
  const [masterResult,   setMasterResult]   = useState(null);
  const [masterErr,      setMasterErr]       = useState(null);
  const snapDate = new Date().toISOString().slice(0, 10);

  const handleMasterSnap = async () => {
    setMasterSnapping(true);
    setMasterResult(null);
    setMasterErr(null);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();
      const h = { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };

      // ── Step 1: Snap ATM surface ────────────────────────────────────────
      const atmTickers = grid.flatMap(row =>
        row.cells.map(c => ({ expiry: row.expiry, tenor: c.tenor, ticker: c.ticker }))
      );
      const atmRes = await fetch('/api/bloomberg/snap-swvol', {
        method: 'POST', headers: h,
        body: JSON.stringify({ snap_date: snapDate, tickers: atmTickers }),
      });
      const atmData = await atmRes.json();
      if (!atmRes.ok) throw new Error(`ATM snap failed: ${atmData.detail}`);

      // Update store + save ATM to DB
      const atmVols = {};
      atmData.quotes?.forEach(q => {
        updateVol(q.expiry, q.tenor, q.vol_bp);
        atmVols[`${q.expiry}|${q.tenor}`] = q.vol_bp;
      });
      await saveSnapshot(snapDate, 'BLOOMBERG');

      // ── Step 2: Snap OTM surface ────────────────────────────────────────
      const otmTickers = [];
      SWAPTION_EXPIRIES.forEach(exp => {
        OTM_SNAP_TENORS.forEach(ten => {
          const atm = atmVols[`${exp}|${ten}`] ||
            grid.find(r => r.expiry === exp)?.cells?.find(c => c.tenor === ten)?.vol_bp;
          if (!atm) return;
          OTM_STRIKE_OFFSETS.forEach(off => {
            const ticker = otmTicker(off, exp, ten);
            if (ticker) otmTickers.push({ expiry: exp, tenor: ten, offset_bp: off, ticker });
          });
        });
      });

      const otmRes = await fetch('/api/bloomberg/snap-otm-vol', {
        method: 'POST', headers: h,
        body: JSON.stringify({ snap_date: snapDate, tickers: otmTickers }),
      });
      const otmData = await otmRes.json();
      if (!otmRes.ok) throw new Error(`OTM snap failed: ${otmData.detail}`);

      // ── Step 3: Build skew cells — abs→spread using SAME ATM from this snap
      const cells = [];
      const otmByKey = {};
      otmData.quotes?.forEach(q => {
        if (!otmByKey[q.expiry]) otmByKey[q.expiry] = {};
        if (!otmByKey[q.expiry][q.tenor]) otmByKey[q.expiry][q.tenor] = {};
        otmByKey[q.expiry][q.tenor][String(q.offset_bp)] = q.abs_vol_bp;
      });

      SWAPTION_EXPIRIES.forEach(exp => {
        OTM_SNAP_TENORS.forEach(ten => {
          const atm = atmVols[`${exp}|${ten}`];
          if (!atm) return;
          const offs = otmByKey[exp]?.[ten] || {};
          const toSpread = v => v != null ? v - atm : null;
          cells.push({
            expiry_label: exp, tenor_label: ten,
            expiry_y: EXPIRY_YEARS[exp], tenor_y: TENOR_YEARS[ten],
            atm_vol_bp: atm,
            spread_m200: toSpread(offs['-200']), spread_m100: toSpread(offs['-100']),
            spread_m50:  toSpread(offs['-50']),  spread_m25:  toSpread(offs['-25']),
            spread_p25:  toSpread(offs['25']),   spread_p50:  toSpread(offs['50']),
            spread_p100: toSpread(offs['100']),  spread_p200: toSpread(offs['200']),
            source: 'BLOOMBERG',
          });
        });
      });

      // ── Step 4: Save OTM skew + calibrate SABR ─────────────────────────
      const skewRes = await fetch('/api/market-data/vol-skew', {
        method: 'POST', headers: h,
        body: JSON.stringify({ valuation_date: snapDate, cells }),
      });
      const skewData = await skewRes.json();
      if (!skewRes.ok) throw new Error(`Skew save failed: ${skewData.detail}`);

      setMasterResult({
        snapDate,
        atm:          atmData.quotes?.length || 0,
        atmFailed:    atmData.failed?.length || 0,
        otm:          otmData.quotes?.length || 0,
        otmFailed:    otmData.failed?.length || 0,
        sabrFits:     skewData.calibrated || 0,
        interpolated: skewData.interpolated || 0,
      });

    } catch(e) {
      setMasterErr(e.message);
    } finally {
      setMasterSnapping(false);
    }
  };

  const tabs = [
    { id:'def',  label:'Definition' },
    { id:'inst', label:'Instruments', badge: filled },
    { id:'otm',  label:'OTM Skew / SABR' },
    { id:'vol',  label:'Vol Config' },
  ];

  const mono = { fontFamily:"'IBM Plex Mono',var(--mono)" };

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

        {/* ── Master snap bar ───────────────────────────────────────────── */}
        <div style={{ margin:'6px 0 2px', padding:'8px 10px',
          background:'rgba(13,212,168,0.04)', border:'1px solid rgba(13,212,168,0.15)',
          borderRadius:'2px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'1px' }}>
            <span style={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.12em',
              color:'var(--accent)', ...mono }}>UNIFIED SURFACE SNAP</span>
            <span style={{ fontSize:'0.75rem', color:'var(--text-dim)', ...mono }}>
              ATM + OTM from same timestamp → spread = abs_vol − ATM → Rijeka SABR calibration
            </span>
          </div>
          <button onClick={handleMasterSnap} disabled={masterSnapping} style={{
            padding:'6px 16px', background:'rgba(13,212,168,0.07)',
            border:'1px solid var(--accent)', borderRadius:'2px',
            ...mono, fontSize:'0.875rem', fontWeight:700, letterSpacing:'0.10em',
            color:'var(--accent)', cursor: masterSnapping ? 'not-allowed' : 'pointer',
            opacity: masterSnapping ? 0.6 : 1, whiteSpace:'nowrap', flexShrink:0,
          }}>
            {masterSnapping ? '⟳  SNAPPING...' : '▶  SNAP FULL SURFACE'}
          </button>
          {masterSnapping && (
            <span style={{ fontSize:'0.8125rem', color:'var(--text-dim)', ...mono }}>
              Step 1: ATM vols → Step 2: OTM vols → Step 3: SABR calibration
            </span>
          )}
          {masterResult && (
            <div style={{ fontSize:'0.8125rem', color:'var(--accent)', ...mono, lineHeight:1.8 }}>
              ✔ {masterResult.snapDate} &nbsp;·&nbsp;
              <span style={{ color:'var(--accent)' }}>{masterResult.atm} ATM</span>
              {masterResult.atmFailed > 0 && <span style={{ color:'var(--amber)' }}> ({masterResult.atmFailed} failed)</span>}
              &nbsp;·&nbsp;
              <span style={{ color:'var(--blue)' }}>{masterResult.otm} OTM quotes</span>
              {masterResult.otmFailed > 0 && <span style={{ color:'var(--amber)' }}> ({masterResult.otmFailed} not in SMKO)</span>}
              &nbsp;·&nbsp;
              <span style={{ color:'var(--accent)' }}>{masterResult.sabrFits} SABR fits</span>
              &nbsp;·&nbsp;
              <span style={{ color:'var(--amber)' }}>{masterResult.interpolated} interpolated</span>
            </div>
          )}
          {masterErr && (
            <span style={{ fontSize:'0.8125rem', color:'var(--red)', ...mono }}>✘ {masterErr}</span>
          )}
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
        otm:  <SwvOTMSkew atmGrid={grid} />,
        vol:  <SwvConfig />,
      }} />
    </div>
  );
}