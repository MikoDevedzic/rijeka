import { useState } from 'react';
import useMarketDataStore from '../../store/useMarketDataStore';
import { TENOR_LABELS } from '../../data/ratesCurves';
import { InnerTabs, InnerBody, ParamGrid, SectionLabel, DescBox } from './_DetailShared';

// ── Toast (local, lightweight) ──────────────────────────────
function useToast() {
  const [msg, setMsg] = useState(null);
  const toast = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 2000);
  };
  return { msg, toast };
}

// ── Definition tab ──────────────────────────────────────────
function FundingDef({ curve }) {
  return (
    <div>
      <SectionLabel>Funding Curve Definition</SectionLabel>
      <ParamGrid items={[
        { label: 'Curve Class',  value: 'FUNDING',                      cls: 'am' },
        { label: 'Base Curve',   value: curve.baseLabel,                 cls: 'ac' },
        { label: 'Spread Model', value: 'Base OIS + term spread' },
        { label: 'Spread Source',value: 'Manual (firm input)',           cls: 'am' },
      ]} />
      <DescBox>{curve.description}</DescBox>
      <SectionLabel>XVA Usage</SectionLabel>
      <ParamGrid items={[
        { label: 'FVA',  value: 'E[exposure] × (funding_curve − OIS)', cls: 'bl' },
        { label: 'ColVA',value: 'E[exposure] × (col_curve − OIS)',     cls: 'bl' },
        { label: 'MVA',  value: 'E[SIMM_IM] × (funding_curve − OIS)', cls: 'bl' },
        { label: 'DVA',  value: 'Uses own credit curve (separate)',    cls: 'bl' },
      ]} />
      <SectionLabel>Future Connectivity</SectionLabel>
      <ParamGrid cols={3} items={[
        { label: 'CDS-Implied',      value: 'Sprint 8' },
        { label: 'Bond-Implied',     value: 'Sprint 8' },
        { label: 'Internal Treasury',value: 'Custom API' },
      ]} />
    </div>
  );
}

// ── Spreads editor tab ──────────────────────────────────────
function FundingSpreads({ curve }) {
  const { fundingMode, setFundingMode, updateSpread, applyFlatSpread, resetSpreads } =
    useMarketDataStore();
  const { msg, toast } = useToast();
  const mode = fundingMode[curve.id] || 'term';
  const [flatVal, setFlatVal] = useState(
    Math.round(Object.values(curve.spreads).reduce((a, b) => a + b, 0) / Object.values(curve.spreads).length)
  );

  const baseCcyLabel = curve.baseLabel.split(' ')[0];

  return (
    <div>
      {msg && (
        <div style={{
          fontSize: '9.5px', padding: '4px 10px', borderRadius: 2, marginBottom: 8,
          background: 'rgba(14,201,160,.10)', border: '1px solid var(--accent-dim)',
          color: 'var(--accent)',
        }}>
          {msg}
        </div>
      )}

      <div className="funding-note">
        ⚡ Firm funding spreads — input your institution's cost of funds above OIS.
        These drive FVA, ColVA and MVA calculations. Spreads change infrequently (weekly/monthly).
        Sample spreads shown are representative of a Tier 1 / A-rated bank.
      </div>

      {/* Source row */}
      <div className="spread-source-row">
        <span style={{ fontSize: '8.5px', color: 'var(--text-dim)' }}>Source:</span>
        <button className="source-btn active">Manual</button>
        <button className="source-btn disabled" title="Sprint 8">CDS-Implied</button>
        <button className="source-btn disabled" title="Sprint 8">Bond Market</button>
        <button className="source-btn disabled" title="Custom API">Treasury System</button>
        <span style={{ fontSize: '8px', color: 'var(--text-mute)', marginLeft: 'auto' }}>
          Last updated: 2025-01-15 17:00 EOD
        </span>
      </div>

      {/* Mode selector */}
      <div className="spread-mode-row">
        <button
          className={`smode-btn${mode === 'flat' ? ' on' : ''}`}
          onClick={() => setFundingMode(curve.id, 'flat')}
        >
          Flat Spread
        </button>
        <button
          className={`smode-btn${mode === 'term' ? ' on' : ''}`}
          onClick={() => setFundingMode(curve.id, 'term')}
        >
          Term Structure
        </button>
      </div>

      {mode === 'flat' ? (
        <div className="flat-spread-row">
          <span className="flat-spread-lbl">Single spread applied to all tenors</span>
          <input
            className="flat-spread-inp"
            value={flatVal}
            onChange={(e) => setFlatVal(e.target.value)}
            onBlur={(e) => applyFlatSpread(curve.id, e.target.value)}
          />
          <span className="flat-spread-unit">bp</span>
        </div>
      ) : (
        <table className="spread-tbl">
          <thead>
            <tr>
              <th>Tenor</th>
              <th style={{ textAlign: 'right' }}>Spread (bp)</th>
              <th>Over</th>
              <th>All-in Rate</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(curve.spreads).map(([k, v]) => {
              const oisRate = curve.oisRef?.[k];
              const allIn = oisRate != null
                ? `${(oisRate + v / 100).toFixed(3)}%`
                : '—';
              return (
                <tr key={k}>
                  <td className="am mo">{TENOR_LABELS[k] || k}</td>
                  <td className="am mo" style={{ textAlign: 'right' }}>
                    <input
                      className="spread-inp"
                      defaultValue={v}
                      onBlur={(e) => updateSpread(curve.id, k, e.target.value)}
                    />
                  </td>
                  <td className="di" style={{ fontSize: '8.5px' }}>bp over {baseCcyLabel}</td>
                  <td className="di" style={{ fontSize: '8.5px' }}>{allIn}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button
          className="btn"
          onClick={() => { resetSpreads(curve.id); toast('Spreads reset to sample'); }}
        >
          Reset to Sample
        </button>
        <button
          className="btn primary"
          onClick={() => toast('Spreads saved to session')}
        >
          Save Spreads
        </button>
      </div>
    </div>
  );
}

// ── Preview tab ─────────────────────────────────────────────
function FundingPreview({ curve }) {
  const baseCcyLabel = curve.baseLabel;

  return (
    <div>
      <SectionLabel>Funding Curve = {baseCcyLabel} + Spreads</SectionLabel>
      <div className="inst-wrap">
        <table className="inst-table">
          <thead>
            <tr>
              <th>Tenor</th>
              <th>OIS Rate (%)</th>
              <th>Firm Spread</th>
              <th>Funding Rate (%)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(curve.spreads).map(([k, sp]) => {
              const oisRate = curve.oisRef?.[k];
              const fundingRate = oisRate != null
                ? `${(oisRate + sp / 100).toFixed(4)}%`
                : '—';
              return (
                <tr key={k}>
                  <td className="di">{TENOR_LABELS[k] || k}</td>
                  <td className="ac">
                    {oisRate != null ? `${oisRate.toFixed(4)}%` : '—'}
                  </td>
                  <td className="am">+{sp}bp</td>
                  <td style={{ color: '#f0a030', fontFamily:"'IBM Plex Mono',var(--mono)" }}>{fundingRate}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '8.5px', color: 'var(--text-mute)', marginTop: 6 }}>
        Funding rate = OIS rate + firm credit spread.
        Used directly in FVA = −Σₜ D(t)·(EE−ENE)·(funding−OIS).
        Sprint 15 wires this to the XVA engine.
      </div>
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────
export default function FundingDetail({ curve }) {
  const spreads = Object.values(curve.spreads);
  const avgSpread = (spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1);

  const tabs = [
    { id: 'def',     label: 'Definition' },
    { id: 'spreads', label: 'Spreads' },
    { id: 'preview', label: 'Preview' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="crv-hdr">
        <div className="crv-hdr-row">
          <div className="crv-flag-lg">{curve.flag}</div>
          <div className="crv-hdr-info">
            <div className="crv-hdr-name">{curve.fullName}</div>
            <div className="crv-hdr-sub">
              = {curve.baseLabel} + firm credit spread · Used for FVA, ColVA, MVA
            </div>
          </div>
          <div className="crv-rate-block">
            <div className="crv-rate-val" style={{ color: 'var(--amber)' }}>{avgSpread}bp</div>
            <div className="crv-rate-lbl">avg spread</div>
          </div>
        </div>
        <div className="crv-pills">
          <span className="pill p-amber">FUNDING</span>
          <span className="pill p-amber">Firm Spreads</span>
          <span className="pill p-green">Base: {curve.baseLabel}</span>
          <span className="pill p-blue">FVA · ColVA · MVA</span>
        </div>
      </div>

      <InnerTabs tabs={tabs} />
      <InnerBody
        tabs={tabs}
        panels={{
          def:     <FundingDef     curve={curve} />,
          spreads: <FundingSpreads curve={curve} />,
          preview: <FundingPreview curve={curve} />,
        }}
      />
    </div>
  );
}
