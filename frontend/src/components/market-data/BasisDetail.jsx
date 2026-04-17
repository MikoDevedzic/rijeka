import { useState, useRef, useEffect } from 'react';
import useMarketDataStore from '../../store/useMarketDataStore';
import { INTERP_METHODS } from '../../data/ratesCurves';
import { InnerTabs, InnerBody, ParamGrid, SectionLabel, DescBox } from './_DetailShared';

const TENOR_TO_Y = {
  'ON':0.003,'1W':0.02,'2W':0.04,'3W':0.06,
  '1M':0.083,'2M':0.167,'3M':0.25,'6M':0.5,'9M':0.75,
  '1Y':1,'18M':1.5,'2Y':2,'3Y':3,'4Y':4,'5Y':5,
  '6Y':6,'7Y':7,'8Y':8,'9Y':9,'10Y':10,
  '12Y':12,'15Y':15,'20Y':20,'25Y':25,'30Y':30,
};

// Source badge (matches OISDetail)
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

// Basis sparkline — blue line, bp values
function BasisCanvas({ instruments, hasData }) {
  const ref = useRef(null);
  const active = instruments.filter(i => i.en && i.unit === 'bp' && i.quote != null && TENOR_TO_Y[i.tenor]);

  if (!hasData) return (
    <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',
      padding:'8px',marginTop:'6px',height:'80px',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <span style={{fontSize:'0.75rem',color:'var(--text-dim)',letterSpacing:'0.08em'}}>SNAP OR SAVE TO VIEW CURVE</span>
    </div>
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || active.length < 2) return;
    const dpr = window.devicePixelRatio || 2;
    const W = canvas.parentElement.offsetWidth || 400;
    const H = 80;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr, dpr);

    const pts = active.map(i => ({ t: TENOR_TO_Y[i.tenor], v: i.quote })).sort((a,b) => a.t - b.t);
    const maxT = Math.max(...pts.map(p => p.t));
    const minV = Math.min(...pts.map(p => p.v));
    const maxV = Math.max(...pts.map(p => p.v));
    const range = maxV - minV || 1;
    const PAD = { l:8, r:8, t:10, b:22 };
    const CW = W - PAD.l - PAD.r, CH = H - PAD.t - PAD.b;
    const px = t => PAD.l + (t / maxT) * CW;
    const py = v => PAD.t + CH - ((v - minV) / range) * CH;

    ctx.fillStyle = '#0D0F17'; ctx.fillRect(0, 0, W, H);

    if (minV < 0 && maxV > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5;
      ctx.setLineDash([3,3]); ctx.beginPath();
      ctx.moveTo(PAD.l, py(0)); ctx.lineTo(W - PAD.r, py(0)); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    pts.forEach((p,i) => i===0 ? ctx.moveTo(px(p.t), py(p.v)) : ctx.lineTo(px(p.t), py(p.v)));
    ctx.lineTo(px(maxT), H - PAD.b); ctx.lineTo(px(pts[0].t), H - PAD.b); ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
    grad.addColorStop(0, 'rgba(74,158,255,0.15)'); grad.addColorStop(1, 'rgba(74,158,255,0)');
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    pts.forEach((p,i) => i===0 ? ctx.moveTo(px(p.t), py(p.v)) : ctx.lineTo(px(p.t), py(p.v)));
    ctx.strokeStyle = 'rgba(74,158,255,0.2)'; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath();
    pts.forEach((p,i) => i===0 ? ctx.moveTo(px(p.t), py(p.v)) : ctx.lineTo(px(p.t), py(p.v)));
    ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 2; ctx.stroke();
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(px(p.t), py(p.v), 5, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(74,158,255,0.25)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(px(p.t), py(p.v), 3, 0, Math.PI*2);
      ctx.fillStyle = '#4A9EFF'; ctx.fill();
    });
    ctx.fillStyle = '#666'; ctx.font = '9px DM Mono,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ['1Y','5Y','10Y','20Y','30Y'].forEach(t => {
      const y = TENOR_TO_Y[t]; if (!y || y > maxT * 1.05) return;
      ctx.fillText(t, px(y), H - PAD.b + 5);
    });
  }, [active.map(i => i.quote).join(',')]);

  return (
    <div style={{background:'#0D0F17',border:'1px solid var(--border)',borderRadius:'2px',
      overflow:'hidden',marginTop:'6px'}}>
      <canvas ref={ref} style={{display:'block'}}/>
    </div>
  );
}

// Definition tab
function BasisDef({ curve }) {
  const isBp = curve.instruments[0]?.unit === 'bp';
  const code = `# Basis curve bootstrap pattern
# 1. Bootstrap base OIS curve first (already done)
discount_curve = ql.RelinkableYieldTermStructureHandle()
discount_curve.linkTo(${curve.baseCurveId?.toLowerCase()}_curve)

# 2. Build basis helpers from market quotes
for tenor, spread in basis_quotes:
    helpers.append(ql.BasisSwapRateHelper(
        spread_handle, ql.Period(tenor),
        float_index, base_float_index,
        discount_curve))

# 3. Bootstrap simultaneous dual-curve
basis_curve = ql.PiecewiseLogLinearDiscount(
    settlement, helpers, ql.Actual360())`;

  return (
    <div>
      <SectionLabel>Basis Curve Definition</SectionLabel>
      <ParamGrid items={[
        { label: 'Curve Class',  value: 'BASIS',              cls: 'bl' },
        { label: 'Base Curve',   value: curve.baseLabel,      cls: 'ac' },
        { label: 'QL Helper',    value: curve.qlHelper,       cls: 'bl' },
        { label: 'Spread Unit',  value: isBp ? 'basis points (bp)' : '% rate', cls: 'am' },
      ]} />
      <SectionLabel>Description</SectionLabel>
      <DescBox>{curve.description}</DescBox>
      {curve.blpConventions && (
        <>
          <SectionLabel>Bloomberg Instrument Conventions</SectionLabel>
          <ParamGrid items={[
            { label: 'Base Leg Index',   value: curve.blpConventions.baseLeg?.index,   cls: 'ac' },
            { label: 'Spread Leg Index', value: curve.blpConventions.spreadLeg?.index, cls: 'bl' },
            { label: 'Pay Frequency',    value: curve.blpConventions.baseLeg?.payFreq, cls: 'am' },
            { label: 'Settlement',       value: curve.blpConventions.settlement,        cls: 'am' },
            { label: 'Discounting',      value: curve.blpConventions.discounting,       cls: 'bl' },
            { label: 'Quote Convention', value: curve.blpConventions.quoteConvention,   cls: 'di' },
          ]} />
        </>
      )}
      <SectionLabel>Bootstrap Logic</SectionLabel>
      <div className="cb">
        <button className="cb-copy" onClick={() => navigator.clipboard.writeText(code)}>copy</button>
        <pre style={{ margin: 0, fontSize: '9px', lineHeight: 1.8 }}>{code}</pre>
      </div>
    </div>
  );
}

// Instruments tab — full snap/save parity with OISDetail
function BasisInstruments({ curve }) {
  const {
    toggleInstrument, updateQuote, saveSnapshot, loadLatestSnapshot,
    snapshotSaving, snapshotSaved, snapshotError,
  } = useMarketDataStore();

  const [saveDate,          setSaveDate]          = useState(new Date().toISOString().slice(0,10));
  const [blpSource,         setBlpSource]         = useState('MANUAL');
  const [blpStatus,         setBlpStatus]         = useState(null);
  const [blpTickers,        setBlpTickers]        = useState({});
  const [blpTickersEdited,  setBlpTickersEdited]  = useState(false);
  const [blpSnapDate,       setBlpSnapDate]       = useState(new Date().toISOString().slice(0,10));
  const [blpSnapping,       setBlpSnapping]       = useState(false);
  const [blpSnapResult,     setBlpSnapResult]     = useState(null);
  const [blpSnapError,      setBlpSnapError]      = useState(null);
  const [quoteSources,      setQuoteSources]      = useState({});

  const storeCurve = useMarketDataStore(s => s.curves.find(c => c.id === curve.id));
  const liveInstruments = storeCurve?.instruments || curve.instruments;
  const isBp = liveInstruments[0]?.unit === 'bp';
  const active = liveInstruments.filter(i => i.en).length;

  useEffect(() => { loadLatestSnapshot(curve.id); }, [curve.id]);

  const fetchBlpStatus = async () => {
    try { setBlpStatus(await (await fetch('/api/bloomberg/status')).json()); }
    catch { setBlpStatus({ connected:false, installed:false, error:'Could not reach backend' }); }
  };

  const fetchBlpTickers = async () => {
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data:{ session:sess } } = await supabase.auth.getSession();
      const data = await (await fetch('/api/bloomberg/tickers/' + curve.id, {
        headers:{ Authorization:'Bearer '+sess.access_token },
      })).json();
      setBlpTickers(data.tickers || {});
    } catch(e) { console.error('fetchBlpTickers', e); }
  };

  const handleBlpSourceChange = (src) => {
    setBlpSource(src); setBlpSnapResult(null); setBlpSnapError(null);
    if (src === 'BLOOMBERG') { fetchBlpStatus(); fetchBlpTickers(); }
  };

  const saveTickerOverrides = async () => {
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data:{ session:sess } } = await supabase.auth.getSession();
      await fetch('/api/bloomberg/tickers/override', {
        method:'POST',
        headers:{ Authorization:'Bearer '+sess.access_token, 'Content-Type':'application/json' },
        body:JSON.stringify({ curve_id:curve.id, overrides:Object.entries(blpTickers).map(([tenor,ticker])=>({tenor,ticker})) }),
      });
      setBlpTickersEdited(false);
    } catch(e) { console.error('saveTickerOverrides', e); }
  };

  const snapBloomberg = async (mode) => {
    setBlpSnapping(true); setBlpSnapResult(null); setBlpSnapError(null);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data:{ session:sess } } = await supabase.auth.getSession();
      const tickerList = Object.entries(blpTickers).map(([tenor,ticker]) => ({ tenor, ticker }));
      if (!tickerList.length) { setBlpSnapError('Tickers not loaded — wait and retry.'); return; }
      const res = await fetch('/api/bloomberg/snap', {
        method:'POST',
        headers:{ Authorization:'Bearer '+sess.access_token, 'Content-Type':'application/json' },
        body:JSON.stringify({ curve_id:curve.id, snap_date:blpSnapDate, tickers:tickerList, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Snap failed');
      const newSources = { ...quoteSources };
      if (data.quotes?.length > 0) {
        data.quotes.forEach(q => {
          const idx = liveInstruments.findIndex(i => i.tenor === q.tenor);
          if (idx !== -1) {
            // Basis quotes come back in bp — store directly (no /100)
            updateQuote(curve.id, idx, String(q.rate));
            newSources[idx] = 'BLOOMBERG';
          }
        });
      }
      setQuoteSources(newSources);
      setBlpSnapResult(data);
    } catch(e) { setBlpSnapError(e.message); }
    finally { setBlpSnapping(false); }
  };

  const thS = { fontSize:'0.8125rem', fontWeight:400, letterSpacing:'0.08em', color:'var(--text-dim)',
    padding:'3px 4px 5px 0', borderBottom:'1px solid var(--border)', textAlign:'left' };
  const thR = { ...thS, textAlign:'right' };
  const gridTemplate = '32px 44px 1fr 88px 80px';

  return (
    <div>
      <SectionLabel sub={`${active} active / ${liveInstruments.length}`}>
        Basis Swap Instruments
      </SectionLabel>

      {/* Instrument table */}
      <div style={{overflowX:'auto'}}>
        <div style={{display:'grid', gridTemplateColumns:gridTemplate, minWidth:'460px'}}>
          <div style={thS}></div>
          <div style={thS}>TENOR</div>
          <div style={thS}>BBG TICKER</div>
          <div style={thS}>SRC</div>
          <div style={thR}>SPREAD</div>
          {liveInstruments.map((inst, i) => {
            const src = quoteSources[i] || 'MANUAL';
            const tdS = { fontSize:'0.875rem', color:'var(--text)', padding:'5px 4px 5px 0',
              borderBottom:'1px solid var(--panel-2)' };
            const tdR = { ...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums' };
            return [
              <div key={`tog-${i}`} style={tdS}>
                <input type="checkbox" checked={inst.en}
                  onChange={e => toggleInstrument(curve.id, i, e.target.checked)}
                  style={{cursor:'pointer', accentColor:'#0dd4a8'}} />
              </div>,
              <div key={`t-${i}`} style={{...tdS, color:'var(--blue)', fontWeight:400}}>{inst.tenor}</div>,
              <div key={`tk-${i}`} style={{...tdS, fontSize:'0.8125rem', color:'var(--text-dim)'}}>
                {blpTickers[inst.tenor]
                  ? blpTickers[inst.tenor].replace(' BGN Curncy','').replace(' Curncy','')
                  : inst.ticker}
              </div>,
              <div key={`src-${i}`} style={tdS}><SourceBadge src={src} /></div>,
              <div key={`sp-${i}`} style={{...tdR, color:'#4A9EFF'}}>
                <input
                  className="qi bp"
                  defaultValue={isBp ? inst.quote.toFixed(1) : inst.quote.toFixed(3)}
                  onBlur={e => updateQuote(curve.id, i, e.target.value)}
                  style={{width:'52px', textAlign:'right'}}
                />{inst.unit}
              </div>,
            ];
          })}
        </div>
      </div>

      {/* Sparkline */}
      <BasisCanvas instruments={liveInstruments} hasData={!!snapshotSaved?.[curve.id]} />

      {/* Snap / Save controls */}
      <div style={{marginTop:'10px', borderTop:'1px solid var(--border)', paddingTop:'10px'}}>
        <div style={{display:'flex', gap:'4px', marginBottom:'8px'}}>
          {['MANUAL','BLOOMBERG'].map(src => (
            <button key={src} onClick={() => handleBlpSourceChange(src)} style={{
              flex:1, padding:'5px 0', fontSize:'0.875rem', fontWeight:700, letterSpacing:'0.08em',
              cursor:'pointer', fontFamily:"'IBM Plex Mono',var(--mono)", background:'transparent', borderRadius:'2px',
              border:blpSource===src?'1px solid var(--accent)':'1px solid var(--border)',
              color:blpSource===src?'var(--accent)':'var(--text-dim)',
            }}>{src}</button>
          ))}
        </div>

        {/* MANUAL */}
        {blpSource === 'MANUAL' && (
          <div style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
            <input type="date" value={saveDate} onChange={e => setSaveDate(e.target.value)}
              style={{background:'var(--panel-2)', border:'1px solid var(--border)', color:'var(--text)',
                fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'1rem', padding:'0.25rem 0.45rem',
                borderRadius:2, outline:'none'}} />
            <button
              onClick={async () => { try { await saveSnapshot(curve.id, saveDate); } catch(_){} }}
              disabled={snapshotSaving?.[curve.id]}
              style={{padding:'0.25rem 0.85rem', background:'rgba(14,201,160,0.07)',
                border:'1px solid var(--accent)', borderRadius:2,
                fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'1rem', fontWeight:700,
                letterSpacing:'0.1em', color:'var(--accent)', cursor:'pointer'}}
            >{snapshotSaving?.[curve.id] ? 'SAVING...' : '▶ SAVE TO DB'}</button>
            {snapshotSaved?.[curve.id] && (
              <span style={{fontSize:'0.9375rem', color:'var(--accent)', fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                ✓ saved {snapshotSaved[curve.id].date}
              </span>
            )}
            {snapshotError?.[curve.id] && (
              <span style={{fontSize:'0.9375rem', color:'var(--red)', fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                ✗ {snapshotError[curve.id]}
              </span>
            )}
          </div>
        )}

        {/* BLOOMBERG */}
        {blpSource === 'BLOOMBERG' && (
          <div style={{border:'1px solid var(--border)', borderRadius:'2px', padding:'8px'}}>
            <div style={{display:'flex', alignItems:'center', gap:'6px', marginBottom:'8px'}}>
              <div style={{width:'6px', height:'6px', borderRadius:'50%', flexShrink:0,
                background:blpStatus===null?'var(--text-dim)':blpStatus.connected?'var(--accent)':'var(--red)'}}/>
              <span style={{fontSize:'0.875rem', color:blpStatus?.connected?'var(--accent)':'var(--text-dim)'}}>
                {blpStatus===null?'CHECKING...':blpStatus.connected?'BLOOMBERG CONNECTED':
                  blpStatus.installed?'TERMINAL NOT CONNECTED':'BLPAPI NOT INSTALLED'}
              </span>
              <button onClick={fetchBlpStatus} style={{marginLeft:'auto', fontSize:'0.875rem',
                background:'transparent', border:'1px solid var(--border)', color:'var(--text-dim)',
                padding:'2px 6px', cursor:'pointer', fontFamily:"'IBM Plex Mono',var(--mono)", borderRadius:'2px'}}>
                REFRESH
              </button>
            </div>
            {blpStatus && !blpStatus.connected && blpStatus.error && (
              <div style={{fontSize:'0.875rem', color:'var(--amber)', marginBottom:'8px', lineHeight:1.5}}>
                {blpStatus.error}
              </div>
            )}
            <div style={{display:'flex', gap:'6px', alignItems:'center', marginBottom:'8px'}}>
              <input type="date" value={blpSnapDate} onChange={e => setBlpSnapDate(e.target.value)}
                style={{background:'var(--panel)', border:'1px solid var(--border)', color:'var(--text)',
                  fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'1rem', padding:'4px 6px',
                  borderRadius:'2px', outline:'none'}} />
              <button onClick={() => snapBloomberg('live')} disabled={!blpStatus?.connected||blpSnapping}
                style={{flex:1, padding:'6px 0', fontSize:'0.875rem', fontWeight:700, letterSpacing:'0.08em',
                  cursor:blpStatus?.connected?'pointer':'not-allowed', background:'transparent', borderRadius:'2px',
                  fontFamily:"'IBM Plex Mono',var(--mono)", border:'1px solid var(--accent)',
                  color:'var(--accent)', opacity:blpStatus?.connected?1:0.4}}>
                {blpSnapping?'SNAPPING...':'▶ SNAP LIVE'}
              </button>
              <button onClick={() => snapBloomberg('historical')} disabled={!blpStatus?.connected||blpSnapping}
                style={{flex:1, padding:'6px 0', fontSize:'0.875rem', fontWeight:700, letterSpacing:'0.08em',
                  cursor:blpStatus?.connected?'pointer':'not-allowed', background:'transparent', borderRadius:'2px',
                  fontFamily:"'IBM Plex Mono',var(--mono)", border:'1px solid var(--border)',
                  color:'var(--text-dim)', opacity:blpStatus?.connected?1:0.4}}>
                SNAP HISTORICAL
              </button>
            </div>
            {blpSnapResult && (
              <div style={{fontSize:'0.875rem', color:'var(--accent)', marginBottom:'6px',
                background:'rgba(13,212,168,0.05)', border:'1px solid rgba(13,212,168,0.2)',
                padding:'5px 7px', borderRadius:'2px', lineHeight:1.7}}>
                ✓ SNAPPED & SAVED TO DB · {blpSnapResult.quotes_saved} TENORS · {blpSnapResult.snap_date}
              </div>
            )}
            {blpSnapError && (
              <div style={{fontSize:'0.875rem', color:'var(--red)', marginBottom:'6px',
                background:'rgba(224,80,64,0.05)', border:'1px solid rgba(224,80,64,0.2)',
                padding:'5px 7px', borderRadius:'2px'}}>✗ {blpSnapError}</div>
            )}
            {Object.keys(blpTickers).length > 0 && (
              <details style={{marginTop:'6px'}}>
                <summary style={{fontSize:'0.875rem', color:'var(--text-dim)', cursor:'pointer',
                  letterSpacing:'0.08em', userSelect:'none', listStyle:'none',
                  display:'flex', justifyContent:'space-between'}}>
                  <span>TICKERS ({Object.keys(blpTickers).length})</span>
                  {blpTickersEdited && (
                    <button onClick={e=>{e.preventDefault();saveTickerOverrides();}}
                      style={{fontSize:'0.875rem', background:'transparent', border:'1px solid var(--blue)',
                        color:'var(--blue)', padding:'1px 6px', cursor:'pointer',
                        fontFamily:"'IBM Plex Mono',var(--mono)", borderRadius:'2px'}}>SAVE OVERRIDES</button>
                  )}
                </summary>
                <div style={{marginTop:'6px', display:'grid', gridTemplateColumns:'44px 1fr', gap:'2px 8px'}}>
                  {Object.entries(blpTickers).map(([tenor, ticker]) => (
                    <>
                      <span key={tenor+'-t'} style={{fontSize:'0.8125rem', color:'var(--blue)', fontFamily:"'IBM Plex Mono',var(--mono)"}}>{tenor}</span>
                      <input key={tenor+'-v'} defaultValue={ticker}
                        onBlur={e=>{ setBlpTickers(p=>({...p,[tenor]:e.target.value})); setBlpTickersEdited(true); }}
                        style={{fontSize:'0.8125rem', fontFamily:"'IBM Plex Mono',var(--mono)",
                          background:'var(--panel-2)', border:'1px solid var(--border)', color:'var(--text)',
                          padding:'1px 4px', borderRadius:'2px', outline:'none'}} />
                    </>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Bootstrap config tab
function BasisBootstrap({ curve }) {
  const { curveInterp, setInterp } = useMarketDataStore();
  const currentInterp = curveInterp[curve.id] || 'LogLinearDiscount';
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
              {m.tags.map((t) => (<span key={t} className={`itag${t === 'Recommended' ? ' rec' : ''}`}>{t}</span>))}
              <span className="itag">{m.trait}</span>
            </div>
          </div>
        ))}
      </div>
      <SectionLabel>Parameters</SectionLabel>
      <div className="bp-row"><div className="bp-lbl">Pillar Choice</div>
        <select className="bp-sel"><option>LastRelevantDate</option><option>MaturityDate</option></select>
      </div>
      <div className="bp-row"><div className="bp-lbl">Extrapolation</div>
        <input type="checkbox" className="bp-tog" defaultChecked />
      </div>
    </div>
  );
}

// Main export
export default function BasisDetail({ curve }) {
  const firstInst = curve.instruments.find(i => i.en) || curve.instruments[0];
  const isBp = firstInst?.unit === 'bp';
  const displayVal = isBp ? `${firstInst.quote.toFixed(1)}bp` : `${firstInst.quote.toFixed(3)}%`;
  const activeCount = curve.instruments.filter(i => i.en).length;

  const tabs = [
    { id: 'def',  label: 'Definition' },
    { id: 'inst', label: 'Instruments', badge: activeCount },
    { id: 'boot', label: 'Bootstrap Config' },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div className="crv-hdr">
        <div className="crv-hdr-row">
          <div className="crv-flag-lg">{curve.flag}</div>
          <div className="crv-hdr-info">
            <div className="crv-hdr-name">{curve.fullName}</div>
            <div className="crv-hdr-sub">
              Basis over: <span style={{ color:'var(--accent)' }}>{curve.baseLabel}</span>
              {' · '}{curve.qlHelper}
            </div>
          </div>
          <div className="crv-rate-block">
            <div className="crv-rate-val" style={{ color:'var(--blue)' }}>{displayVal}</div>
            <div className="crv-rate-lbl">{firstInst?.tenor} spread</div>
          </div>
        </div>
        <div className="crv-pills">
          <span className="pill p-blue">BASIS</span>
          <span className="pill p-green">RiskClass.IR</span>
          <span className="pill p-green">Base: {curve.baseLabel}</span>
          <span className="pill p-dim">{curve.qlHelper}</span>
          <span className="pill p-amber">{activeCount}/{curve.instruments.length} active</span>
        </div>
      </div>
      <InnerTabs tabs={tabs} />
      <InnerBody
        tabs={tabs}
        panels={{
          def:  <BasisDef curve={curve} />,
          inst: <BasisInstruments curve={curve} />,
          boot: <BasisBootstrap curve={curve} />,
        }}
      />
    </div>
  );
}
