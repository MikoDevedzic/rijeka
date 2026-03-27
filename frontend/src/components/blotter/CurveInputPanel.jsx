// CurveInputPanel.jsx — Sprint 4E
// Curve input UI for PRICING tab.
// FLAT mode (Sprint 3 compat): single rate slider per curve.
// MARKET DATA mode (Sprint 4): pillar-by-pillar quote grid → bootstrapped curve.

import { useState } from 'react';
import usePricerStore from '../../store/usePricerStore';
import './CurveInputPanel.css';

const QUOTE_TYPES = ['DEPOSIT', 'OIS_SWAP', 'IRS', 'FRA', 'FUTURES'];

// ── Single curve block ───────────────────────────────────────────────────────

function CurveBlock({ curveId }) {
  const { curveStates, setCurveMode, setFlatRate, setPillarRate, setPillarType } =
    usePricerStore();
  const cs = curveStates[curveId];
  const [open, setOpen] = useState(true);

  if (!cs) return null;
  const { mode, flat_rate, pillars } = cs;
  const flatPct = flat_rate != null ? (flat_rate * 100).toFixed(4) : '';

  const filledCount = mode === 'market'
    ? pillars.filter(p => p.rate !== '' && !isNaN(parseFloat(p.rate))).length
    : null;

  return (
    <div className="cip-curve-block">
      {/* ── Header ── */}
      <div className="cip-curve-header" onClick={() => setOpen(o => !o)}>
        <span className="cip-chevron">{open ? '▾' : '▸'}</span>
        <span className="cip-curve-id">{curveId}</span>

        {mode === 'flat' && flat_rate != null && (
          <span className="cip-curve-badge flat">{(flat_rate * 100).toFixed(3)}%</span>
        )}
        {mode === 'market' && filledCount !== null && (
          <span className={
            `cip-curve-badge ${filledCount >= 2 ? 'market-ok' : 'market-warn'}`
          }>
            {filledCount} pillars
          </span>
        )}

        <div className="cip-mode-toggle" onClick={e => e.stopPropagation()}>
          <button
            className={`cip-mode-btn ${mode === 'flat' ? 'active' : ''}`}
            onClick={() => setCurveMode(curveId, 'flat')}
          >FLAT</button>
          <button
            className={`cip-mode-btn ${mode === 'market' ? 'active' : ''}`}
            onClick={() => setCurveMode(curveId, 'market')}
          >MARKET</button>
        </div>
      </div>

      {/* ── Flat mode body ── */}
      {open && mode === 'flat' && (
        <div className="cip-flat-body">
          <label className="cip-label">FLAT RATE</label>
          <div className="cip-flat-row">
            <input
              className="cip-flat-input"
              type="text"
              inputMode="decimal"
              value={flatPct}
              onChange={e => setFlatRate(curveId, e.target.value)}
            />
            <span className="cip-unit">%</span>
          </div>
        </div>
      )}

      {/* ── Market data mode body ── */}
      {open && mode === 'market' && (
        <div className="cip-market-body">
          <table className="cip-table">
            <thead>
              <tr>
                <th>TENOR</th>
                <th>TYPE</th>
                <th className="right">RATE (%)</th>
              </tr>
            </thead>
            <tbody>
              {pillars.map((p, i) => (
                <tr key={p.tenor} className={p.rate !== '' && !isNaN(parseFloat(p.rate)) ? 'filled' : ''}>
                  <td className="cip-tenor">{p.tenor}</td>
                  <td>
                    <select
                      className="cip-type-sel"
                      value={p.quote_type}
                      onChange={e => setPillarType(curveId, i, e.target.value)}
                    >
                      {QUOTE_TYPES.map(qt => (
                        <option key={qt} value={qt}>{qt}</option>
                      ))}
                    </select>
                  </td>
                  <td className="right">
                    <input
                      className="cip-rate-input"
                      type="text" inputMode="decimal" placeholder="—"
                      value={p.rate}
                      onChange={e => setPillarRate(curveId, i, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filledCount < 2 && (
            <p className="cip-warn">⚠ Fill at least 2 pillars, or switch to FLAT mode.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel root ───────────────────────────────────────────────────────────────

export default function CurveInputPanel({ curveIds, onRunPricer, isLoading, error }) {
  return (
    <div className="cip-root">
      <div className="cip-panel-header">
        <span className="cip-panel-title">CURVE INPUTS</span>
        <span className="cip-panel-sub">
          {curveIds.length} curve{curveIds.length !== 1 ? 's' : ''}
        </span>
      </div>

      {curveIds.length === 0 && (
        <div className="cip-empty">
          No discount or forecast curves assigned to this trade's legs.
        </div>
      )}

      {curveIds.map(id => (
        <CurveBlock key={id} curveId={id} />
      ))}

      {error && (
        <div className="cip-error-bar">⚠ {error}</div>
      )}

      <div className="cip-footer">
        <button
          className="cip-run-btn"
          onClick={onRunPricer}
          disabled={isLoading || curveIds.length === 0}
        >
          {isLoading ? '⟳  PRICING…' : '▶  RUN PRICER'}
        </button>
      </div>
    </div>
  );
}
