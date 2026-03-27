import { useState, useEffect } from 'react';
import useMarketDataStore from '../../store/useMarketDataStore';
import { INTERP_METHODS, TENOR_TO_YEARS } from '../../data/ratesCurves';
import { InnerTabs, InnerBody, ParamGrid, SectionLabel, DescBox } from './_DetailShared';

// ── Tenor → years helper ────────────────────────────────────
function tenorToYears(t) {
  return TENOR_TO_YEARS[t] ?? 1;
}

// ── Mini sparkline SVG ──────────────────────────────────────
function CurveSparkline({ instruments, color }) {
  const active = instruments.filter((i) => i.en).slice(0, 12);
  if (!active.length) return null;

  const pts = active.map((i) => ({ t: tenorToYears(i.tenor), r: i.quote / 100 }));
  const times = pts.map((p) => p.t);
  const rates = pts.map((p) => p.r * 100);
  const rmin = Math.min(...rates), rmax = Math.max(...rates);
  const rrange = rmax - rmin || 0.01;
  const tmax = Math.max(...times) || 1;
  const W = 186, H = 68;

  const px = (i) => (times[i] / tmax) * (W - 16) + 8;
  const py = (i) => H - 8 - ((rates[i] - rmin) / rrange) * (H - 18);

  const polyPoints = pts.map((_, i) => `${px(i)},${py(i)}`).join(' ');
  const fillPoints = pts.map((_, i) => `${px(i)},${py(i)}`).join(' ') +
    ` ${px(pts.length - 1)},${H - 8} ${px(0)},${H - 8}`;

  return (
    <div className="crv-chart">
      <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
        <polygon points={fillPoints} fill={color} fillOpacity="0.07" />
        <polyline points={polyPoints} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {pts.map((_, i) => (
          <circle key={i} cx={px(i)} cy={py(i)} r="2" fill={color} fillOpacity="0.8" />
        ))}
        <text x="4" y="11" fill="#344e62" fontSize="7" fontFamily="monospace">{rmax.toFixed(2)}%</text>
        <text x="4" y={H - 2} fill="#344e62" fontSize="7" fontFamily="monospace">{rmin.toFixed(2)}%</text>
      </svg>
    </div>
  );
}

// ── Curve output strip ──────────────────────────────────────
function CurveOutputStrip({ curve }) {
  const { instruments, color } = curve;
  const active = instruments.filter((i) => i.en).slice(0, 12);
  if (!active.length) return null;

  const pts = active.map((i) => ({
    tenor: i.tenor,
    t: tenorToYears(i.tenor),
    r: i.quote / 100,
  }));

  return (
    <div className="crv-out">
      <div className="crv-out-hdr">
        <span>Curve Preview</span>
        <span style={{ color: 'var(--text-mute)', letterSpacing: 0, textTransform: 'none', fontSize: '8.5px' }}>
          simulated · real QL bootstrap wired Sprint 3
        </span>
      </div>
      <div className="crv-out-body">
        <div className="out-tbl-wrap">
          <table className="out-tbl">
            <thead>
              <tr>
                <th>Tenor</th>
                <th>Zero (%)</th>
                <th>DF</th>
                <th>Fwd (%)</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => {
                const df = Math.exp(-p.r * p.t);
                const fwd = (p.r * 100 * (1 + 0.08 * (p.t / 10))).toFixed(4);
                return (
                  <tr key={p.tenor}>
                    <td className="di">{p.tenor}</td>
                    <td className="ac">{(p.r * 100).toFixed(4)}</td>
                    <td className="bl">{df.toFixed(6)}</td>
                    <td className="am">{fwd}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CurveSparkline instruments={instruments} color={color} />
      </div>
    </div>
  );
}

// ── Definition tab ──────────────────────────────────────────
function OISDef({ curve }) {
  const dc = curve.dayCounter === 'Actual/360' ? 'Actual360' : 'Actual365Fixed';
  const code = `# ${curve.fullName}
import QuantLib as ql
index = ${curve.qlIndex}
helpers = []
# ON deposit
helpers.append(ql.OISRateHelper(${curve.settlementDays}, ql.Period('1D'), quote_handle, index))
# OIS swaps
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
        { label: 'QL Index',        value: curve.qlIndex,          cls: 'bl' },
        { label: 'Day Count',       value: curve.dayCounter },
        { label: 'Calendar',        value: curve.calendar },
        { label: 'Settlement Days', value: `T+${curve.settlementDays}`, cls: 'am' },
        { label: 'BDC',             value: curve.bdc },
        { label: 'Pay Frequency',   value: curve.payFreq },
        { label: 'Payment Lag',     value: `${curve.payLag}d`,     cls: 'am' },
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

// ── Instruments tab ─────────────────────────────────────────
function OISInstruments({ curve }) {
  const { toggleInstrument, updateQuote, saveSnapshot, loadLatestSnapshot, snapshotSaving, snapshotSaved, snapshotError } = useMarketDataStore();
  const [saveDate, setSaveDate] = useState(new Date().toISOString().slice(0, 10));

  // Auto-load latest snapshot on mount
  useEffect(() => {
    loadLatestSnapshot(curve.id);
  }, [curve.id]);
  const active = curve.instruments.filter((i) => i.en).length;

  return (
    <div>
      <SectionLabel sub={`${active} active / ${curve.instruments.length}`}>
        Instruments
      </SectionLabel>
      <div className="inst-wrap">
        <table className="inst-table">
          <thead>
            <tr>
              <th>Active</th>
              <th>Type</th>
              <th>Tenor</th>
              <th>BBG Ticker</th>
              <th style={{ textAlign: 'right' }}>Quote</th>
              <th>QL Helper</th>
            </tr>
          </thead>
          <tbody>
            {curve.instruments.map((inst, i) => (
              <tr key={i} className={inst.en ? '' : 'dis'}>
                <td>
                  <input
                    type="checkbox"
                    className="tog"
                    checked={inst.en}
                    onChange={(e) => toggleInstrument(curve.id, i, e.target.checked)}
                  />
                </td>
                <td className="di">{inst.type}</td>
                <td className="ac mo">{inst.tenor}</td>
                <td className="mo">{inst.ticker}</td>
                <td className="ac mo" style={{ textAlign: 'right' }}>
                  <input
                    className="qi"
                    defaultValue={inst.quote.toFixed(3)}
                    onBlur={(e) => updateQuote(curve.id, i, e.target.value)}
                  />%
                </td>
                <td className="bl mo">OISRateHelper</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sprint 4F: Save to DB */}
      <div style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.6rem 0',borderTop:'1px solid var(--border)',marginTop:'0.5rem'}}>
        <input
          type="date"
          value={saveDate}
          onChange={e => setSaveDate(e.target.value)}
          style={{background:'var(--panel-2)',border:'1px solid var(--border)',color:'var(--text)',fontFamily:'var(--mono)',fontSize:'0.68rem',padding:'0.25rem 0.45rem',borderRadius:2,outline:'none'}}
        />
        <button
          onClick={async () => { try { await saveSnapshot(curve.id, saveDate); } catch(_){} }}
          disabled={snapshotSaving?.[curve.id]}
          style={{padding:'0.25rem 0.85rem',background:'rgba(14,201,160,0.07)',border:'1px solid var(--accent)',borderRadius:2,fontFamily:'var(--mono)',fontSize:'0.62rem',fontWeight:700,letterSpacing:'0.1em',color:'var(--accent)',cursor:'pointer'}}
        >
          {snapshotSaving?.[curve.id] ? 'SAVING...' : '▶ SAVE TO DB'}
        </button>
        {snapshotSaved?.[curve.id] && (
          <span style={{fontSize:'0.6rem',color:'var(--accent)',fontFamily:'var(--mono)'}}>
            ✓ saved {snapshotSaved[curve.id].date}
          </span>
        )}
        {snapshotError?.[curve.id] && (
          <span style={{fontSize:'0.6rem',color:'var(--red)',fontFamily:'var(--mono)'}}>
            ✗ {snapshotError[curve.id]}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Bootstrap config tab ────────────────────────────────────
function OISBootstrap({ curve }) {
  const { curveInterp, setInterp } = useMarketDataStore();
  const currentInterp = curveInterp[curve.id] || curve.defaultInterp;

  return (
    <div>
      <SectionLabel>Interpolation Method</SectionLabel>
      <div className="interp-grid">
        {INTERP_METHODS.map((m) => (
          <div
            key={m.id}
            className={`icard${currentInterp === m.id ? ' sel' : ''}`}
            onClick={() => setInterp(curve.id, m.id)}
          >
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
      <div className="bp-row">
        <div className="bp-lbl">Pillar Choice</div>
        <select className="bp-sel">
          <option>LastRelevantDate</option>
          <option>MaturityDate</option>
        </select>
      </div>
      <div className="bp-row">
        <div className="bp-lbl">Bootstrap Accuracy</div>
        <div className="bp-val">{curve.accuracy}</div>
      </div>
      <div className="bp-row">
        <div className="bp-lbl">Max Iterations</div>
        <div className="bp-val">{curve.maxIter}</div>
      </div>
      <div className="bp-row">
        <div className="bp-lbl">Extrapolation</div>
        <input type="checkbox" className="bp-tog" defaultChecked={curve.extrapolation} />
      </div>
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────
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
      {/* Header */}
      <div className="crv-hdr">
        <div className="crv-hdr-row">
          <div className="crv-flag-lg">{curve.flag}</div>
          <div className="crv-hdr-info">
            <div className="crv-hdr-name">{curve.fullName}</div>
            <div className="crv-hdr-sub">{curve.qlIndex} · {curve.dayCounter} · {curve.calendar}</div>
          </div>
          <div className="crv-rate-block">
            <div className="crv-rate-val" style={{ color: 'var(--accent)' }}>{onRate.toFixed(3)}%</div>
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

      {/* Inner tabs */}
      <InnerTabs tabs={tabs} />

      {/* Tab bodies */}
      <InnerBody
        tabs={tabs}
        panels={{
          def:  <OISDef curve={curve} />,
          inst: <OISInstruments curve={curve} />,
          boot: <OISBootstrap curve={curve} />,
        }}
      />

      {/* Curve output strip */}
      <CurveOutputStrip curve={curve} />
    </div>
  );
}
