// CapVolDetail.jsx — Sprint 9
// USD Cap/Floor Normal Vol Surface detail page.
// Mirrors SwaptionVolDetail.jsx structure exactly:
//   Definition tab  — surface conventions, Bloomberg ticker logic
//   Instruments tab — tenor × strike grid, SNAP FULL SURFACE, heatmap
//   Vol Config tab  — interpolation method settings
// Pure Black theme — same CSS variables as rest of app.

import { useState, useEffect, useCallback } from 'react';
import { InnerTabs, InnerBody, ParamGrid, SectionLabel } from './_DetailShared';

// ── Constants ────────────────────────────────────────────────────────────────

const CAP_TENORS  = [1, 2, 3, 5, 7, 10];
const CAP_STRIKES = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500]; // above ATM only

function localToday() {
  return new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

// ── Vol surface heatmap ──────────────────────────────────────────────────────

function CapVolHeatmap({ atmRows, smileRows, hasData }) {
  if (!hasData) return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)',
      borderRadius: '2px', padding: '8px', marginTop: '6px', height: '60px',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', letterSpacing: '0.08em' }}>
        SNAP TO VIEW SURFACE
      </span>
    </div>
  );

  const allVols = atmRows.map(r => r.flat_vol_bp).filter(Boolean);
  if (!allVols.length) return null;
  const minV = Math.min(...allVols);
  const maxV = Math.max(...allVols);
  const rng  = maxV - minV || 1;

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)',
      borderRadius: '2px', padding: '8px', marginTop: '6px' }}>
      <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)',
        letterSpacing: '0.08em', marginBottom: '5px' }}>
        ATM NORMAL VOL SURFACE · bp · USD SOFR
      </div>
      <div style={{ display: 'grid',
        gridTemplateColumns: '28px repeat(' + CAP_TENORS.length + ', 1fr)', gap: '2px' }}>
        <div />
        {CAP_TENORS.map(t => (
          <div key={t} style={{ fontSize: '0.6875rem', color: 'var(--text-dim)',
            textAlign: 'center' }}>{t}Y</div>
        ))}
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)',
          textAlign: 'right', paddingRight: '3px', display: 'flex',
          alignItems: 'center', justifyContent: 'flex-end' }}>ATM</div>
        {CAP_TENORS.map(t => {
          const row = atmRows.find(r => Number(r.cap_tenor_y) === t);
          const v   = row?.flat_vol_bp ?? null;
          const intensity = v !== null ? (v - minV) / rng : 0;
          const bg  = v !== null
            ? `rgba(13,212,168,${0.06 + intensity * 0.35})`
            : 'transparent';
          return (
            <div key={t} style={{ height: '18px', borderRadius: '1px', background: bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.625rem',
              color: v !== null ? 'var(--accent)' : 'var(--text-dim)',
              fontFamily: "'IBM Plex Mono',var(--mono)" }}>
              {v !== null ? v.toFixed(0) : '—'}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Definition tab ────────────────────────────────────────────────────────────

function CapDef() {
  const code = `# USD Cap/Floor Normal Vol Surface
# Bloomberg tickers: USCNSQ{N} ICPL Curncy  (ATM, field: PX_MID)
#                    USCNQ{letter}{N} ICPL Curncy  (above ATM, field: MID)
# Strike letters: B=+25bp C=+50bp D=+75bp E=+100bp
#                 G=+150bp H=+200bp I=+250bp J=+300bp L=+400bp O=+500bp
# Vol type: Normal (bp/yr) · Underlying: USD SOFRRATE Index
# Reset: Quarterly · Day Count: ACT/360 · Settlement: T+2
# Discounting: OIS · Bus Adj: Modified Following
# In-arrears: SOFR compounded over accrual period

import blpapi
session = blpapi.Session()
session.start()
session.openService("//blp/refdata")
ref_service = session.getService("//blp/refdata")

# ATM example (PX_MID)
request = ref_service.createRequest("ReferenceDataRequest")
request.append("securities", "USCNSQ5 ICPL Curncy")   # 5Y ATM
request.append("fields", "PX_MID")
session.sendRequest(request)

# Skew example (MID)
request2 = ref_service.createRequest("ReferenceDataRequest")
request2.append("securities", "USCNQE5 ICPL Curncy")  # 5Y +100bp
request2.append("fields", "MID")
session.sendRequest(request2)`;

  return (
    <div>
      <SectionLabel>Conventions</SectionLabel>
      <ParamGrid items={[
        { label: 'Vol Type',       value: 'Normal (Bachelier · bp)',       cls: 'bl' },
        { label: 'Underlying',     value: 'USD SOFRRATE Index' },
        { label: 'Exercise',       value: 'European caplets' },
        { label: 'Settlement',     value: 'Physical · T+2' },
        { label: 'Pay Freq',       value: 'Quarterly (3M reset)' },
        { label: 'Day Count',      value: 'ACT/360',                       cls: 'am' },
        { label: 'Fixing',         value: 'In-arrears (SOFR compounded)' },
        { label: 'Bus Adj',        value: 'Modified Following' },
        { label: 'Discounting',    value: 'OIS',                           cls: 'am' },
        { label: 'Strikes',        value: 'ATM-relative spreads (bp)' },
        { label: 'ATM Ticker',     value: 'USCNSQ{N} ICPL · PX_MID',      cls: 'bl' },
        { label: 'Skew Ticker',    value: 'USCNQ{letter}{N} ICPL · MID',  cls: 'bl' },
        { label: 'Price',          value: 'MID' },
        { label: 'Pricing Model',  value: 'Direct table lookup · linear interp' },
      ]} />
      <SectionLabel>Bloomberg Python (blpapi)</SectionLabel>
      <div className="cb">
        <button className="cb-copy" onClick={() => navigator.clipboard.writeText(code)}>copy</button>
        <pre style={{ margin: 0, fontSize: '9px', lineHeight: 1.8 }}>{code}</pre>
      </div>
    </div>
  );
}

// ── Instruments tab ───────────────────────────────────────────────────────────

function CapInstruments() {
  const today = localToday();

  const [valuationDate, setValuationDate] = useState(today);
  const [surface,       setSurface]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [snapLoading,   setSnapLoading]   = useState(false);
  const [snapMsg,       setSnapMsg]       = useState(null);
  const [error,         setError]         = useState(null);

  const fetchSurface = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/market-data/cap-vol/${valuationDate}`);
      if (!res.ok) {
        if (res.status === 404) { setSurface([]); setLoading(false); return; }
        throw new Error((await res.json()).detail || 'Fetch failed');
      }
      const data = await res.json();
      setSurface(data.rows || []);
    } catch (e) {
      setError(e.message);
      setSurface([]);
    } finally {
      setLoading(false);
    }
  }, [valuationDate]);

  useEffect(() => { fetchSurface(); }, [fetchSurface]);

  const snapSurface = async () => {
    setSnapLoading(true);
    setSnapMsg(null);
    setError(null);
    try {
      const { supabase } = await import('../../lib/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/bloomberg/cap-vol/snap', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json',
                   'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({ valuation_date: valuationDate }),
      });
      const raw  = await res.text();
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.detail || 'Snap failed');
      setSnapMsg(`✓ Snapped ${data.rows_upserted} rows for ${data.valuation_date}`);
      await fetchSurface();
    } catch (e) {
      setError(`Snap failed: ${e.message}`);
    } finally {
      setSnapLoading(false);
    }
  };

  const atmRows   = surface.filter(r => r.is_atm === true || r.is_atm === 'true');
  const smileRows = surface.filter(r => !(r.is_atm === true || r.is_atm === 'true'));
  const hasData   = surface.length > 0;

  const getAtm = tenor =>
    atmRows.find(r => Number(r.cap_tenor_y) === tenor) || null;

  const getVol = (tenor, spread) =>
    smileRows.find(r =>
      Number(r.cap_tenor_y) === tenor && Number(r.strike_spread_bp) === spread
    ) || null;

  const fmtVol = v => v != null ? Number(v).toFixed(2) : '—';

  const thStyle = {
    fontSize: '0.8125rem', fontWeight: 400, letterSpacing: '0.08em',
    color: 'var(--text-dim)', padding: '3px 6px 5px',
    borderBottom: '1px solid var(--border)', textAlign: 'right',
  };

  return (
    <div>
      <SectionLabel sub={hasData ? `${surface.length} rows · ${valuationDate}` : 'No data'}>
        Instruments
      </SectionLabel>

      {/* Snap controls */}
      <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--border)',
        paddingBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <input
          type="date"
          value={valuationDate}
          onChange={e => setValuationDate(e.target.value)}
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
            color: 'var(--text)', fontFamily: "'IBM Plex Mono',var(--mono)",
            fontSize: '1rem', padding: '0.25rem 0.45rem', borderRadius: 2, outline: 'none' }}
        />
        <button
          onClick={snapSurface}
          disabled={snapLoading}
          style={{ padding: '0.25rem 0.85rem', background: 'rgba(14,201,160,0.07)',
            border: '1px solid var(--accent)', borderRadius: 2,
            fontFamily: "'IBM Plex Mono',var(--mono)", fontSize: '1rem',
            fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent)',
            cursor: snapLoading ? 'not-allowed' : 'pointer',
            opacity: snapLoading ? 0.5 : 1 }}>
          {snapLoading ? 'SNAPPING...' : '▶ SNAP FULL SURFACE'}
        </button>
        {snapMsg && (
          <span style={{ fontSize: '0.9375rem', color: 'var(--accent)',
            fontFamily: "'IBM Plex Mono',var(--mono)" }}>✓ {snapMsg}</span>
        )}
        {error && (
          <span style={{ fontSize: '0.9375rem', color: 'var(--red)',
            fontFamily: "'IBM Plex Mono',var(--mono)" }}>✗ {error}</span>
        )}
      </div>

      {/* ATM strip */}
      {hasData && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)',
            letterSpacing: '0.08em', marginBottom: '5px',
            fontFamily: "'IBM Plex Mono',var(--mono)" }}>
            ATM STRIP — USCNSQ
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {CAP_TENORS.map(t => {
              const row = getAtm(t);
              return (
                <div key={t} style={{ background: 'var(--panel)',
                  border: '1px solid var(--border)', borderRadius: '2px',
                  padding: '8px 12px', minWidth: '72px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)',
                    fontFamily: "'IBM Plex Mono',var(--mono)", marginBottom: '3px' }}>{t}Y</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700,
                    fontFamily: "'IBM Plex Mono',var(--mono)",
                    color: row ? 'var(--accent)' : 'var(--text-dim)' }}>
                    {row ? fmtVol(row.flat_vol_bp) : '—'}
                  </div>
                  {row && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)',
                      fontFamily: "'IBM Plex Mono',var(--mono)", marginTop: '2px' }}>
                      {row.source}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Smile surface table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '540px' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', width: '60px' }}>STRIKE</th>
              {CAP_TENORS.map(t => (
                <th key={t} style={thStyle}>{t}Y</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={CAP_TENORS.length + 1}
                  style={{ padding: '20px', textAlign: 'center',
                    color: 'var(--text-dim)', fontSize: '0.875rem',
                    fontFamily: "'IBM Plex Mono',var(--mono)" }}>
                  Loading...
                </td>
              </tr>
            ) : !hasData ? (
              <tr>
                <td colSpan={CAP_TENORS.length + 1}
                  style={{ padding: '20px', textAlign: 'center',
                    color: 'var(--text-dim)', fontSize: '0.875rem',
                    fontFamily: "'IBM Plex Mono',var(--mono)" }}>
                  No data for {valuationDate} — snap to populate
                </td>
              </tr>
            ) : (
              CAP_STRIKES.map(spread => (
                <tr key={spread}>
                  <td style={{ fontSize: '0.875rem', color: 'var(--accent)',
                    fontFamily: "'IBM Plex Mono',var(--mono)", fontWeight: 600,
                    padding: '4px 6px 4px 0', borderBottom: '1px solid var(--panel-2)' }}>
                    +{spread}bp
                  </td>
                  {CAP_TENORS.map(tenor => {
                    const row = getVol(tenor, spread);
                    return (
                      <td key={tenor}
                        style={{ padding: '2px', borderBottom: '1px solid var(--panel-2)',
                          textAlign: 'right' }}>
                        <div style={{ padding: '1px 4px 3px',
                          fontFamily: "'IBM Plex Mono',var(--mono)",
                          fontSize: '0.875rem',
                          color: row ? 'var(--accent)' : 'var(--text-dim)' }}>
                          {row ? fmtVol(row.flat_vol_bp) : '—'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Heatmap */}
      <CapVolHeatmap atmRows={atmRows} smileRows={smileRows} hasData={hasData} />

      {/* Ticker note */}
      <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)',
        fontFamily: "'IBM Plex Mono',var(--mono)", lineHeight: 1.7 }}>
        ATM: USCNSQ{'{N}'} ICPL Curncy · PX_MID&nbsp;&nbsp;
        Skew: USCNQ{'{letter}{N}'} ICPL Curncy · MID&nbsp;&nbsp;
        Strikes: above ATM only (below-ATM USCLQ not liquid in USD SOFR caps)
      </div>
    </div>
  );
}

// ── Vol Config tab ────────────────────────────────────────────────────────────

const VOL_INTERP = [
  { id: 'linear',  name: 'Linear',      desc: 'Linear interpolation between quoted strikes. Fast, no overshooting. Standard for sparse cap vol surfaces.',  tags: ['Recommended', 'Fast'] },
  { id: 'flat',    name: 'Flat',         desc: 'Use nearest quoted strike vol. Conservative. No interpolation artifacts.',                                    tags: ['Conservative'] },
  { id: 'cubic',   name: 'Cubic Spline', desc: 'Smooth interpolation. Better for dense grids. Can overshoot between sparse quoted strikes.',                  tags: ['Smooth'] },
];

function CapVolConfig() {
  const [interp, setInterp] = useState('linear');
  return (
    <div>
      <SectionLabel>Interpolation Method</SectionLabel>
      <div className="interp-grid">
        {VOL_INTERP.map(m => (
          <div key={m.id} className={'icard' + (interp === m.id ? ' sel' : '')}
            onClick={() => setInterp(m.id)} style={{ cursor: 'pointer' }}>
            <div className="icard-name">{m.name}</div>
            <div className="icard-desc">{m.desc}</div>
            <div className="icard-tags">
              {m.tags.map(t => (
                <span key={t} className={'itag' + (t === 'Recommended' ? ' rec' : '')}>{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <SectionLabel>Parameters</SectionLabel>
      <div className="bp-row">
        <div className="bp-lbl">Moneyness</div>
        <select className="bp-sel">
          <option>ATM-relative strikes (quoted)</option>
          <option>Absolute strikes</option>
        </select>
      </div>
      <div className="bp-row">
        <div className="bp-lbl">Strike extrapolation</div>
        <select className="bp-sel"><option>Flat</option><option>Linear</option></select>
      </div>
      <div className="bp-row">
        <div className="bp-lbl">Tenor extrapolation</div>
        <select className="bp-sel"><option>Flat</option><option>Linear</option></select>
      </div>
      <div style={{ marginTop: '12px', padding: '8px 10px',
        background: 'rgba(74,158,255,0.04)', border: '1px solid rgba(74,158,255,0.15)',
        borderRadius: '2px', fontSize: '0.8125rem', color: 'var(--text-dim)',
        fontFamily: "'IBM Plex Mono',var(--mono)", lineHeight: 1.7 }}>
        Cap/floor pricing uses direct table lookup from snapped Bloomberg flat vols.
        For standard strikes the quoted vol is used directly — no SABR required.
        Interpolation applies for strikes between quoted nodes only.
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function CapVolDetail() {
  const tabs = [
    { id: 'def',  label: 'Definition' },
    { id: 'inst', label: 'Instruments' },
    { id: 'vol',  label: 'Vol Config' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="crv-hdr">
        <div className="crv-hdr-row">
          <div className="crv-hdr-info">
            <div className="crv-hdr-name">USD CAP / FLOOR VOL SURFACE</div>
            <div className="crv-hdr-sub">
              USCNSQ{'{N}'} · USCNQ{'{letter}{N}'} ICPL Curncy · Normal vol bp · ATM-relative strikes · USD SOFR
            </div>
          </div>
        </div>
        <div className="crv-pills">
          <span className="pill p-green">RATE OPTIONS</span>
          <span className="pill p-green">RiskClass.IR</span>
          <span className="pill p-blue">Normal Vol · bp</span>
          <span className="pill p-dim">European caplets</span>
          <span className="pill p-dim">Physical Settlement</span>
          <span className="pill p-amber">Quarterly reset</span>
          <span className="pill p-dim">OIS discounting</span>
        </div>
      </div>
      <InnerTabs tabs={tabs} />
      <InnerBody tabs={tabs} panels={{
        def:  <CapDef />,
        inst: <CapInstruments />,
        vol:  <CapVolConfig />,
      }} />
    </div>
  );
}
