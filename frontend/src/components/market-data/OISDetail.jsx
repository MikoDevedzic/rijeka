import { useState, useEffect, useRef } from 'react';
import useMarketDataStore from '../../store/useMarketDataStore';
import { INTERP_METHODS, TENOR_TO_YEARS } from '../../data/ratesCurves';
import { InnerTabs, InnerBody, ParamGrid, SectionLabel } from './_DetailShared';

function tenorToYears(t) { return TENOR_TO_YEARS[t] ?? 1; }

// ── Source badge ──────────────────────────────────────────────────────────────
function SourceBadge({ src }) {
  const map = {
    BLOOMBERG: { bg:'rgba(74,154,212,0.12)', bd:'rgba(74,154,212,0.3)', c:'#4a9ad4' },
    FED:       { bg:'rgba(144,96,204,0.12)', bd:'rgba(144,96,204,0.3)', c:'#9060cc' },
    MANUAL:    { bg:'rgba(82,104,120,0.12)', bd:'rgba(82,104,120,0.3)', c:'#666666' },
    IMPORT:    { bg:'rgba(240,160,32,0.12)', bd:'rgba(240,160,32,0.3)', c:'#f0a020' },
  };
  const s = map[src] || map.MANUAL;
  return (
    <span style={{background:s.bg,border:`1px solid ${s.bd}`,color:s.c,
      fontSize:'0.8125rem',fontWeight:700,letterSpacing:'0.06em',
      padding:'1px 5px',borderRadius:'2px',fontFamily:"'IBM Plex Mono',var(--mono)",whiteSpace:'nowrap'}}>
      {src}
    </span>
  );
}

// ── Curve sparkline canvas ────────────────────────────────────────────────────
function CurveCanvas({ instruments, hasData }) {
  if (!hasData) return (
    <div style={{background:"var(--panel)",border:"1px solid var(--border)",borderRadius:"2px",padding:"8px",marginTop:"6px",height:"96px",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontSize:"0.48rem",color:"var(--text-dim)",letterSpacing:"0.08em"}}>SNAP OR SAVE TO VIEW CURVE</span>
    </div>
  );
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 400;
    const H = 80;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const active = instruments.filter(i => i.en && i.quote > 0 && i.tenor !== 'ON');
    if (active.length < 2) return;

    const pts = active.map(i => ({ t: tenorToYears(i.tenor), r: i.quote }));
    const maxT = Math.max(...pts.map(p => p.t));
    const minR = Math.min(...pts.map(p => p.r));
    const maxR = Math.max(...pts.map(p => p.r));
    const rRange = maxR - minR || 0.5;
    const pad = { l: 6, r: 6, t: 6, b: 18 };

    const px = t => pad.l + (t / maxT) * (W - pad.l - pad.r);
    const py = r => H - pad.b - ((r - minR) / rRange) * (H - pad.t - pad.b);

    ctx.strokeStyle = '#0dd4a8';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.t), py(p.r)) : ctx.lineTo(px(p.t), py(p.r)));
    ctx.stroke();

    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.t), py(p.r)) : ctx.lineTo(px(p.t), py(p.r)));
    ctx.lineTo(px(maxT), H - pad.b);
    ctx.lineTo(px(pts[0].t), H - pad.b);
    ctx.closePath();
    ctx.fillStyle = 'rgba(13,212,168,0.06)';
    ctx.fill();

    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(px(p.t), py(p.r), 2, 0, Math.PI * 2);
      ctx.fillStyle = '#0dd4a8';
      ctx.fill();
    });

    ctx.fillStyle = '#666666';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    [1, 2, 3, 5, 7, 10, 15, 20].filter(t => t <= maxT).forEach(t => {
      ctx.fillText(t + 'Y', px(t), H - 4);
    });
  }, [instruments]);

  return (
    <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',padding:'8px',marginTop:'6px'}}>
      <div style={{fontSize:'0.8125rem',color:'var(--text-dim)',letterSpacing:'0.08em',marginBottom:'5px'}}>
        SOFR OIS CURVE · BGN MID
      </div>
      <canvas ref={ref} style={{width:'100%',display:'block'}} height="80" />
    </div>
  );
}

// ── Unified instruments panel ─────────────────────────────────────────────────
function OISInstruments({ curve }) {
  const {
    toggleInstrument, updateQuote, saveSnapshot, loadLatestSnapshot,
    snapshotSaving, snapshotSaved, snapshotError,
  } = useMarketDataStore();

  const [saveDate, setSaveDate]                 = useState(new Date().toISOString().slice(0, 10));
  const [blpSource, setBlpSource]               = useState('MANUAL');
  const [blpStatus, setBlpStatus]               = useState(null);
  const [blpTickers, setBlpTickers]             = useState({});
  const [blpTickersEdited, setBlpTickersEdited] = useState(false);
  const [blpSnapDate, setBlpSnapDate]           = useState(new Date().toISOString().slice(0, 10));
  const [blpSnapping, setBlpSnapping]           = useState(false);
  const [blpSnapResult, setBlpSnapResult]       = useState(null);
  const [blpSnapError, setBlpSnapError]         = useState(null);
  const [csvParsed, setCsvParsed]               = useState([]);
  const [csvError, setCsvError]                 = useState(null);
  const [quoteSources, setQuoteSources]         = useState({});
  const [snapshotReady, setSnapshotReady]       = useState(false);
  const storeCurve = useMarketDataStore(s => s.curves.find(c => c.id === curve.id));
  const liveInstruments = storeCurve?.instruments || curve.instruments;

  useEffect(() => { loadLatestSnapshot(curve.id).finally(() => setSnapshotReady(true)); }, [curve.id]);

  // Derived zeros/DFs/fwds from quotes (simplified flat-forward approximation for display)
  const computeBootstrap = (instruments) => {
    const result = {};
    const active = instruments.filter(i => i.en && i.quote > 0);
    active.forEach(inst => {
      const t = tenorToYears(inst.tenor);
      const r = inst.quote / 100;
      const df = t > 0 ? Math.exp(-r * t) : 1;
      const zero = t > 0 ? (-Math.log(df) / t * 100) : inst.quote;
      result[inst.tenor] = { mid: inst.quote, zero: zero.toFixed(4), df: df.toFixed(6) };
    });
    // Compute forwards
    const tenors = Object.keys(result).sort((a, b) => tenorToYears(a) - tenorToYears(b));
    tenors.forEach((tenor, i) => {
      if (i === 0) { result[tenor].fwd = result[tenor].zero; return; }
      const t1 = tenorToYears(tenors[i-1]);
      const t2 = tenorToYears(tenor);
      const df1 = parseFloat(result[tenors[i-1]].df);
      const df2 = parseFloat(result[tenor].df);
      const dt = t2 - t1;
      if (dt > 0 && df1 > 0 && df2 > 0) {
        const fwdDf = df2 / df1;
        const fwd = (-Math.log(fwdDf) / dt * 100);
        result[tenor].fwd = fwd.toFixed(4);
      } else {
        result[tenor].fwd = result[tenor].zero;
      }
    });
    return result;
  };

  const bootstrap = computeBootstrap(liveInstruments);

  // Bloomberg
  const fetchBlpStatus = async () => {
    try { setBlpStatus(await (await fetch('/api/bloomberg/status')).json()); }
    catch (e) { setBlpStatus({ connected: false, installed: false, error: 'Could not reach backend' }); }
  };

  const fetchBlpTickers = async (curveId) => {
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session: sess } } = await supabase.auth.getSession();
      const data = await (await fetch('/api/bloomberg/tickers/' + curveId, {
        headers: { Authorization: 'Bearer ' + sess.access_token },
      })).json();
      setBlpTickers(data.tickers || {});
    } catch (e) { console.error('fetchBlpTickers', e); }
  };

  const handleBlpSourceChange = (src) => {
    setBlpSource(src);
    setBlpSnapResult(null);
    setBlpSnapError(null);
    if (src === 'BLOOMBERG') { fetchBlpStatus(); fetchBlpTickers(curve.id); }
  };

  const saveTickerOverrides = async () => {
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session: sess } } = await supabase.auth.getSession();
      await fetch('/api/bloomberg/tickers/override', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ curve_id: curve.id, overrides: Object.entries(blpTickers).map(([tenor, ticker]) => ({ tenor, ticker })) }),
      });
      setBlpTickersEdited(false);
    } catch (e) { console.error('saveTickerOverrides', e); }
  };

  const snapBloomberg = async (mode) => {
    setBlpSnapping(true);
    setBlpSnapResult(null);
    setBlpSnapError(null);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session: sess } } = await supabase.auth.getSession();

      const newSources = { ...quoteSources };

      // All tenors including ON (SOFRRATE Index) snapped from Bloomberg
      const tickerList = Object.entries(blpTickers)
        .map(([tenor, ticker]) => ({ tenor, ticker }));

      if (!tickerList.length) {
        setBlpSnapError('Tickers not loaded yet — wait a moment and retry.');
        setBlpSnapping(false);
        return;
      }

      const res = await fetch('/api/bloomberg/snap', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ curve_id: curve.id, snap_date: blpSnapDate, tickers: tickerList, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Snap failed');

      if (data.quotes?.length > 0) {
        data.quotes.forEach(q => {
          const idx = curve.instruments.findIndex(i => i.tenor === q.tenor);
          if (idx !== -1) { updateQuote(curve.id, idx, String(q.rate)); newSources[idx] = q.tenor === 'ON' ? 'FED' : 'BLOOMBERG'; }
        });
      }
      setQuoteSources(newSources);
      setBlpSnapResult(data);
    } catch (e) {
      setBlpSnapError(e.message);
    } finally { setBlpSnapping(false); }
  };

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = ev.target.result.trim().split('\n')
          .filter(l => l.trim() && !l.startsWith('#'))
          .map(l => { const [tenor, rate] = l.split(',').map(s => s.trim()); return { tenor, rate: parseFloat(rate) }; })
          .filter(r => r.tenor && !isNaN(r.rate));
        if (!parsed.length) throw new Error('No valid rows. Format: tenor,rate');
        setCsvParsed(parsed); setCsvError(null);
      } catch (err) { setCsvError(err.message); setCsvParsed([]); }
    };
    reader.readAsText(file);
  };

  const saveCsvImport = async () => {
    if (!csvParsed.length) return;
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session: sess } } = await supabase.auth.getSession();
      const quotes = csvParsed.map(r => ({ tenor: r.tenor, quote_type: 'SWAP', rate: r.rate, ticker: 'CSV_IMPORT', enabled: true }));
      const res = await fetch('/api/market-data/snapshots', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ curve_id: curve.id, valuation_date: blpSnapDate, quotes, source: 'IMPORT' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Import failed');
      const newSources = { ...quoteSources };
      csvParsed.forEach(q => {
        const idx = curve.instruments.findIndex(i => i.tenor === q.tenor);
        if (idx !== -1) { updateQuote(curve.id, idx, String(q.rate)); newSources[idx] = 'IMPORT'; }
      });
      setQuoteSources(newSources);
      setBlpSnapResult({ quotes_saved: quotes.length, snap_date: blpSnapDate, source: 'IMPORT' });
    } catch (e) { setBlpSnapError(e.message); }
  };

  const active = curve.instruments.filter(i => i.en).length;

  // Column widths
  const colW = { tog:'32px', tenor:'44px', ticker:'1fr', src:'88px', mid:'68px', zero:'68px', df:'80px', fwd:'68px' };
  const gridTemplate = `${colW.tog} ${colW.tenor} ${colW.ticker} ${colW.src} ${colW.mid} ${colW.zero} ${colW.df} ${colW.fwd}`;

  const thStyle = { fontSize:'0.8125rem', fontWeight:400, letterSpacing:'0.08em', color:'var(--text-dim)',
    padding:'3px 4px 5px 0', borderBottom:'1px solid var(--border)', textAlign:'left' };
  const thR = { ...thStyle, textAlign:'right' };

  return (
    <div>
      <SectionLabel sub={`${active} active / ${curve.instruments.length}`}>Instruments</SectionLabel>

      {/* ── Unified table ─────────────────────────────────────────────────── */}
      <div style={{overflowX:'auto'}}>
        <div style={{display:'grid',gridTemplateColumns:gridTemplate,minWidth:'560px'}}>

          {/* Header */}
          <div style={thStyle}></div>
          <div style={thStyle}>TENOR</div>
          <div style={thStyle}>TICKER / SOURCE</div>
          <div style={thStyle}>SRC</div>
          <div style={thR}>MID %</div>
          <div style={thR}>ZERO %</div>
          <div style={thR}>DF</div>
          <div style={thR}>FWD %</div>

          {/* Rows */}
          {curve.instruments.map((inst, i) => {
            const isOn = inst.tenor === 'ON';
            const src = quoteSources[i] || (isOn ? 'FED' : 'MANUAL');
            const bs = bootstrap[inst.tenor] || {};
            const rowBg = isOn ? 'rgba(144,96,204,0.06)' : 'transparent';
            const tdBase = { fontSize:'0.875rem', color:'var(--text)', padding:'5px 4px 5px 0',
              borderBottom:'1px solid var(--panel-2)', background:rowBg };
            const tdR = { ...tdBase, textAlign:'right', fontVariantNumeric:'tabular-nums' };

            return [
              <div key={`tog-${i}`} style={tdBase}>
                <input type="checkbox" checked={inst.en}
                  onChange={e => toggleInstrument(curve.id, i, e.target.checked)}
                  style={{cursor:'pointer', accentColor:'#0dd4a8'}} />
              </div>,
              <div key={`t-${i}`} style={{...tdBase, color: isOn?'#9060cc':'var(--accent)', fontWeight: isOn?700:400}}>
                {inst.tenor}
              </div>,
              <div key={`tk-${i}`} style={{...tdBase, fontSize:'0.8125rem', color:'var(--text-dim)'}}>
                {blpTickers[inst.tenor] ? blpTickers[inst.tenor].replace(' BGN Curncy','') : inst.ticker}
              </div>,
              <div key={`src-${i}`} style={tdBase}><SourceBadge src={src} /></div>,
              <div key={`mid-${i}`} style={{...tdR, color:'#0dd4a8'}}>{bs.mid ? parseFloat(bs.mid).toFixed(8) : '—'}</div>,
              <div key={`z-${i}`} style={{...tdR, color:'#8ab0c8'}}>{bs.zero || '—'}</div>,
              <div key={`df-${i}`} style={{...tdR, color:'#8ab0c8'}}>{bs.df || '—'}</div>,
              <div key={`fw-${i}`} style={{...tdR, color:'#f0a020'}}>{bs.fwd || '—'}</div>,
            ];
          })}
        </div>
      </div>

      {/* ── Curve chart ───────────────────────────────────────────────────── */}
      <CurveCanvas instruments={liveInstruments} hasData={!!snapshotSaved?.[curve.id]} />

      {/* ── Snap controls ─────────────────────────────────────────────────── */}
      <div style={{marginTop:'10px',borderTop:'1px solid var(--border)',paddingTop:'10px'}}>

        {/* Source selector */}
        <div style={{display:'flex',gap:'4px',marginBottom:'8px'}}>
          {['MANUAL','BLOOMBERG','IMPORT'].map(src => (
            <button key={src} onClick={() => handleBlpSourceChange(src)} style={{
              flex:1,padding:'5px 0',fontSize:'0.875rem',fontWeight:700,letterSpacing:'0.08em',
              cursor:'pointer',fontFamily:"'IBM Plex Mono',var(--mono)",background:'transparent',borderRadius:'2px',
              border:blpSource===src?'1px solid var(--accent)':'1px solid var(--border)',
              color:blpSource===src?'var(--accent)':'var(--text-dim)',
            }}>{src}</button>
          ))}
        </div>

        {/* MANUAL */}
        {blpSource === 'MANUAL' && (
          <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
            <input type="date" value={saveDate} onChange={e => setSaveDate(e.target.value)}
              style={{background:'var(--panel-2)',border:'1px solid var(--border)',color:'var(--text)',
                fontFamily:"'IBM Plex Mono',var(--mono)",fontSize:'1rem',padding:'0.25rem 0.45rem',borderRadius:2,outline:'none'}} />
            <button
              onClick={async () => { try { await saveSnapshot(curve.id, saveDate); } catch(_){} }}
              disabled={snapshotSaving?.[curve.id]}
              style={{padding:'0.25rem 0.85rem',background:'rgba(14,201,160,0.07)',
                border:'1px solid var(--accent)',borderRadius:2,fontFamily:"'IBM Plex Mono',var(--mono)",
                fontSize:'1rem',fontWeight:700,letterSpacing:'0.1em',color:'var(--accent)',cursor:'pointer'}}
            >{snapshotSaving?.[curve.id] ? 'SAVING...' : '▶ SAVE TO DB'}</button>
            {snapshotSaved?.[curve.id] && (
              <span style={{fontSize:'0.9375rem',color:'var(--accent)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                ✓ saved {snapshotSaved[curve.id].date}
              </span>
            )}
            {snapshotError?.[curve.id] && (
              <span style={{fontSize:'0.9375rem',color:'var(--red)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                ✗ {snapshotError[curve.id]}
              </span>
            )}
          </div>
        )}

        {/* BLOOMBERG */}
        {blpSource === 'BLOOMBERG' && (
          <div style={{border:'1px solid var(--border)',borderRadius:'2px',padding:'8px'}}>

            {/* ON fixing note */}
            {(() => {
              const onInst = curve.instruments.find(i => i.type === 'OISDeposit' || i.type === 'BasisDeposit')
              if (!onInst) return null
              return (
                <div style={{fontSize:'0.875rem',color:'#9060cc',background:'rgba(144,96,204,0.06)',
                  border:'1px solid rgba(144,96,204,0.2)',borderRadius:'2px',
                  padding:'4px 7px',marginBottom:'8px',lineHeight:1.6}}>
                  O/N fixing: <strong>{onInst.ticker}</strong>
                  {curve.description ? ' — ' + curve.description : ' — sourced via Bloomberg.'}
                </div>
              )
            })()}

            {/* Connection status */}
            <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'8px'}}>
              <div style={{width:'6px',height:'6px',borderRadius:'50%',flexShrink:0,
                background:blpStatus===null?'var(--text-dim)':blpStatus.connected?'var(--accent)':'var(--red)'}}/>
              <span style={{fontSize:'0.875rem',color:blpStatus?.connected?'var(--accent)':'var(--text-dim)'}}>
                {blpStatus===null?'CHECKING...':blpStatus.connected?'BLOOMBERG CONNECTED':
                  blpStatus.installed?'TERMINAL NOT CONNECTED':'BLPAPI NOT INSTALLED'}
              </span>
              <button onClick={fetchBlpStatus} style={{marginLeft:'auto',fontSize:'0.875rem',
                background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',
                padding:'2px 6px',cursor:'pointer',fontFamily:"'IBM Plex Mono',var(--mono)",borderRadius:'2px'}}>
                REFRESH
              </button>
            </div>

            {blpStatus && !blpStatus.connected && blpStatus.error && (
              <div style={{fontSize:'0.875rem',color:'var(--amber)',marginBottom:'8px',lineHeight:1.5}}>
                {blpStatus.error}
              </div>
            )}

            {/* Snap date + buttons */}
            <div style={{display:'flex',gap:'6px',alignItems:'center',marginBottom:'8px'}}>
              <input type="date" value={blpSnapDate} onChange={e => setBlpSnapDate(e.target.value)}
                style={{background:'var(--panel)',border:'1px solid var(--border)',color:'var(--text)',
                  fontFamily:"'IBM Plex Mono',var(--mono)",fontSize:'1rem',padding:'4px 6px',borderRadius:'2px',outline:'none'}} />
              <button onClick={() => snapBloomberg('live')} disabled={!blpStatus?.connected||blpSnapping}
                style={{flex:1,padding:'6px 0',fontSize:'0.875rem',fontWeight:700,letterSpacing:'0.08em',
                  cursor:blpStatus?.connected?'pointer':'not-allowed',background:'transparent',
                  borderRadius:'2px',fontFamily:"'IBM Plex Mono',var(--mono)",border:'1px solid var(--accent)',
                  color:'var(--accent)',opacity:blpStatus?.connected?1:0.4}}>
                {blpSnapping?'SNAPPING...':'▶ SNAP LIVE'}
              </button>
              <button onClick={() => snapBloomberg('historical')} disabled={!blpStatus?.connected||blpSnapping}
                style={{flex:1,padding:'6px 0',fontSize:'0.875rem',fontWeight:700,letterSpacing:'0.08em',
                  cursor:blpStatus?.connected?'pointer':'not-allowed',background:'transparent',
                  borderRadius:'2px',fontFamily:"'IBM Plex Mono',var(--mono)",border:'1px solid var(--border)',
                  color:'var(--text-dim)',opacity:blpStatus?.connected?1:0.4}}>
                SNAP HISTORICAL
              </button>
            </div>

            {/* Result / error */}
            {blpSnapResult && (
              <div style={{fontSize:'0.875rem',color:'var(--accent)',marginBottom:'6px',
                background:'rgba(13,212,168,0.05)',border:'1px solid rgba(13,212,168,0.2)',
                padding:'5px 7px',borderRadius:'2px',lineHeight:1.7}}>
                ✓ SNAPPED & SAVED TO DB · {blpSnapResult.quotes_saved} TENORS · {blpSnapResult.snap_date}
                
                {blpSnapResult.failed_tenors?.length > 0 && (
                  <span style={{color:'var(--amber)',marginLeft:'8px'}}>
                    {blpSnapResult.failed_tenors.length} FAILED: {blpSnapResult.failed_tenors.join(', ')}
                  </span>
                )}
              </div>
            )}
            {blpSnapError && (
              <div style={{fontSize:'0.875rem',color:'var(--red)',marginBottom:'6px',
                background:'rgba(224,80,64,0.05)',border:'1px solid rgba(224,80,64,0.2)',
                padding:'5px 7px',borderRadius:'2px'}}>✗ {blpSnapError}</div>
            )}

            {/* Tickers collapsible */}
            {Object.keys(blpTickers).length > 0 && (
              <details style={{marginTop:'6px'}}>
                <summary style={{fontSize:'0.875rem',color:'var(--text-dim)',cursor:'pointer',
                  letterSpacing:'0.08em',userSelect:'none',listStyle:'none',
                  display:'flex',justifyContent:'space-between'}}>
                  <span>TICKERS ({Object.keys(blpTickers).length}) — BGN Curncy mid</span>
                  {blpTickersEdited && (
                    <button onClick={e=>{e.preventDefault();saveTickerOverrides();}}
                      style={{fontSize:'0.875rem',background:'transparent',border:'1px solid var(--blue)',
                        color:'var(--blue)',padding:'1px 6px',cursor:'pointer',
                        fontFamily:"'IBM Plex Mono',var(--mono)",borderRadius:'2px'}}>SAVE OVERRIDES</button>
                  )}
                </summary>
                <div style={{marginTop:'6px',maxHeight:'180px',overflowY:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
                    <thead>
                      <tr>
                        <th style={{fontSize:'0.875rem',color:'var(--text-dim)',textAlign:'left',
                          paddingBottom:'3px',width:'22%',fontWeight:400}}>TENOR</th>
                        <th style={{fontSize:'0.875rem',color:'var(--text-dim)',textAlign:'left',
                          paddingBottom:'3px',fontWeight:400}}>TICKER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(blpTickers).map(([tenor, ticker]) => (
                        <tr key={tenor}>
                          <td style={{fontSize:'0.875rem',color:'var(--text-dim)',padding:'2px 0',
                            borderBottom:'1px solid var(--panel-2)'}}>{tenor}</td>
                          <td style={{padding:'2px 0',borderBottom:'1px solid var(--panel-2)'}}>
                            <input value={ticker}
                              onChange={e=>{setBlpTickers(prev=>({...prev,[tenor]:e.target.value}));setBlpTickersEdited(true);}}
                              style={{width:'100%',background:'transparent',border:'none',
                                borderBottom:'1px solid var(--border)',color:'var(--text)',
                                fontFamily:"'IBM Plex Mono',var(--mono)",fontSize:'0.875rem',padding:'1px 2px',outline:'none'}} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}

        {/* IMPORT */}
        {blpSource === 'IMPORT' && (
          <div style={{border:'1px solid var(--border)',borderRadius:'2px',padding:'8px'}}>
            <div style={{fontSize:'0.875rem',color:'var(--text-dim)',marginBottom:'6px',lineHeight:1.6}}>
              Format: <span style={{color:'var(--text)'}}>tenor,rate</span> per line &nbsp;·&nbsp;
              Example: <span style={{color:'var(--accent)'}}>5Y,3.641</span>
            </div>
            <div style={{display:'flex',gap:'6px',alignItems:'center',marginBottom:'8px'}}>
              <input type="date" value={blpSnapDate} onChange={e => setBlpSnapDate(e.target.value)}
                style={{background:'var(--panel)',border:'1px solid var(--border)',color:'var(--text)',
                  fontFamily:"'IBM Plex Mono',var(--mono)",fontSize:'1rem',padding:'4px 6px',borderRadius:'2px',outline:'none'}} />
              <input type="file" accept=".csv,.txt" onChange={handleCsvUpload}
                style={{flex:1,fontSize:'0.875rem',color:'var(--text-dim)',cursor:'pointer'}} />
            </div>
            {csvError && <div style={{fontSize:'0.875rem',color:'var(--red)',marginBottom:'6px'}}>✗ {csvError}</div>}
            {csvParsed.length > 0 && (
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{fontSize:'0.875rem',color:'var(--accent)'}}>✓ {csvParsed.length} rows parsed</span>
                <button onClick={saveCsvImport}
                  style={{padding:'5px 14px',fontSize:'0.875rem',fontWeight:700,letterSpacing:'0.08em',
                    cursor:'pointer',background:'transparent',border:'1px solid var(--accent)',
                    color:'var(--accent)',borderRadius:'2px',fontFamily:"'IBM Plex Mono',var(--mono)"}}>SAVE IMPORT</button>
              </div>
            )}
            {blpSnapResult?.source === 'IMPORT' && (
              <div style={{fontSize:'0.875rem',color:'var(--accent)',marginTop:'6px'}}>
                ✓ SAVED {blpSnapResult.quotes_saved} TENORS · {blpSnapResult.snap_date}
              </div>
            )}
            {blpSnapError && <div style={{fontSize:'0.875rem',color:'var(--red)',marginTop:'6px'}}>✗ {blpSnapError}</div>}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Definition tab ────────────────────────────────────────────────────────────
function OISDef({ curve }) {
  const dc = curve.dayCounter === 'Actual/360' ? 'Actual360' : 'Actual365Fixed';
  const code = `# ${curve.fullName}
import QuantLib as ql
index = ${curve.qlIndex}
helpers = []
helpers.append(ql.OISRateHelper(${curve.settlementDays}, ql.Period('1D'), quote_handle, index))
for tenor, rate in quotes:
    helpers.append(ql.OISRateHelper(
        ${curve.settlementDays}, ql.Period(tenor), rate_handle, index,
        telescopicValueDates=${curve.telescopic}, paymentLag=${curve.payLag}))
curve = ql.PiecewiseLogLinearDiscount(settlement, helpers, ql.${dc}())
curve.enableExtrapolation()`;
  const handleCopy = () => navigator.clipboard.writeText(code);
  return (
    <div>
      <SectionLabel>Conventions</SectionLabel>
      <ParamGrid items={[
        { label: 'QL Index',        value: curve.qlIndex,                  cls: 'bl' },
        { label: 'Day Count',       value: curve.dayCounter },
        { label: 'Calendar',        value: curve.calendar },
        { label: 'Settlement Days', value: `T+${curve.settlementDays}`,    cls: 'am' },
        { label: 'BDC',             value: curve.bdc },
        { label: 'Pay Frequency',   value: curve.payFreq },
        { label: 'Payment Lag',     value: `${curve.payLag}d`,             cls: 'am' },
        { label: 'Telescopic',      value: curve.telescopic ? 'Yes' : 'No' },
      ]} />
      <SectionLabel>QuantLib Python</SectionLabel>
      <div className="cb">
        <button className="cb-copy" onClick={handleCopy}>copy</button>
        <pre style={{ margin: 0, fontSize: '9px', lineHeight: 1.8 }}>{code}</pre>
      </div>
    </div>
  );
}

// ── Bootstrap config tab ──────────────────────────────────────────────────────
function OISBootstrap({ curve }) {
  const { curveInterp, setInterp } = useMarketDataStore();
  const currentInterp = curveInterp[curve.id] || curve.defaultInterp;
  return (
    <div>
      <SectionLabel>Interpolation Method</SectionLabel>
      <div className="interp-grid">
        {INTERP_METHODS.map((m) => (
          <div key={m.id} className={`icard${currentInterp === m.id ? ' sel' : ''}`}
            onClick={() => setInterp(curve.id, m.id)}>
            <div className="icard-name">{m.name}</div>
            <div className="icard-ql">{m.ql}</div>
            <div className="icard-desc">{m.desc}</div>
            <div className="icard-tags">
              {m.tags.map((t) => (
                <span key={t} className={`itag${t === 'Recommended' ? ' rec' : ''}`}>{t}</span>
              ))}
              <span className="itag">{m.trait}</span>
            </div>
          </div>
        ))}
      </div>
      <SectionLabel>Parameters</SectionLabel>
      <div className="bp-row"><div className="bp-lbl">Pillar Choice</div>
        <select className="bp-sel"><option>LastRelevantDate</option><option>MaturityDate</option></select>
      </div>
      <div className="bp-row"><div className="bp-lbl">Bootstrap Accuracy</div><div className="bp-val">{curve.accuracy}</div></div>
      <div className="bp-row"><div className="bp-lbl">Max Iterations</div><div className="bp-val">{curve.maxIter}</div></div>
      <div className="bp-row"><div className="bp-lbl">Extrapolation</div>
        <input type="checkbox" className="bp-tog" defaultChecked={curve.extrapolation} />
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function OISDetail({ curve }) {
  const onRate = (curve.instruments.find((i) => i.type === 'OISDeposit') || curve.instruments[0])?.quote ?? 0;
  const activeCount = curve.instruments.filter((i) => i.en).length;
  const tabs = [
    { id: 'def',  label: 'Definition' },
    { id: 'inst', label: 'Instruments', badge: activeCount },
    { id: 'boot', label: 'Bootstrap Config' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="crv-hdr">
        <div className="crv-hdr-row">
          <div className="crv-flag-lg">{curve.flag}</div>
          <div className="crv-hdr-info">
            <div className="crv-hdr-name">{curve.fullName}</div>
            <div className="crv-hdr-sub">{curve.qlIndex} · {curve.dayCounter} · {curve.calendar}</div>
          </div>
          <div className="crv-rate-block">
            <div className="crv-rate-val" style={{ color: 'var(--accent)' }}>{onRate.toFixed(8)}%</div>
            <div className="crv-rate-lbl">ON rate</div>
          </div>
        </div>
        <div className="crv-pills">
          <span className="pill p-green">OIS Mother Curve</span>
          <span className="pill p-green">RiskClass.IR</span>
          <span className="pill p-blue">{curve.dayCounter}</span>
          <span className="pill p-dim">{curve.calendar.replace('()', '')}</span>
          <span className="pill p-dim">T+{curve.settlementDays}</span>
          <span className="pill p-amber">{activeCount}/{curve.instruments.length} active</span>
          <span className="pill p-purple">PiecewiseLogLinearDiscount</span>
        </div>
      </div>
      <InnerTabs tabs={tabs} />
      <InnerBody tabs={tabs} panels={{
        def:  <OISDef curve={curve} />,
        inst: <OISInstruments curve={curve} />,
        boot: <OISBootstrap curve={curve} />,
      }} />
    </div>
  );
}
