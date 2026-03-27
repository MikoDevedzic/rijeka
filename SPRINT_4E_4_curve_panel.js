// SPRINT_4E_4_curve_panel.js
// Writes: frontend/src/components/blotter/CurveInputPanel.jsx
//         frontend/src/components/blotter/CurveInputPanel.css
// Run from Rijeka root: node SPRINT_4E_4_curve_panel.js

const fs = require('fs');
const path = require('path');

const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const BLOTTER = path.join(RIJEKA, 'frontend', 'src', 'components', 'blotter');

// ── JSX ────────────────────────────────────────────────────────────────────

const jsx = `// CurveInputPanel.jsx — Sprint 4E
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
            \`cip-curve-badge \${filledCount >= 2 ? 'market-ok' : 'market-warn'}\`
          }>
            {filledCount} pillars
          </span>
        )}

        <div className="cip-mode-toggle" onClick={e => e.stopPropagation()}>
          <button
            className={\`cip-mode-btn \${mode === 'flat' ? 'active' : ''}\`}
            onClick={() => setCurveMode(curveId, 'flat')}
          >FLAT</button>
          <button
            className={\`cip-mode-btn \${mode === 'market' ? 'active' : ''}\`}
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
              type="number"
              step="0.01"
              min="-15"
              max="50"
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
                      type="number"
                      step="0.001"
                      placeholder="—"
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
`;

// ── CSS ────────────────────────────────────────────────────────────────────

const css = `/* CurveInputPanel.css — Sprint 4E */

.cip-root {
  background: var(--panel-2);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 4px;
  overflow: hidden;
}

/* Panel header */
.cip-panel-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 9px 14px;
  background: var(--panel-3);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.cip-panel-title {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.cip-panel-sub {
  font-family: var(--mono);
  font-size: 10px;
  color: #3a5a6a;
}

/* Curve block */
.cip-curve-block {
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.cip-curve-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}

.cip-curve-header:hover {
  background: rgba(255,255,255,0.02);
}

.cip-chevron {
  font-size: 11px;
  color: #3a5a6a;
  width: 12px;
}

.cip-curve-id {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  color: #c8d8e2;
  flex: 1;
}

.cip-curve-badge {
  font-family: var(--mono);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 2px;
  font-weight: 600;
}

.cip-curve-badge.flat {
  background: rgba(61,139,200,0.12);
  color: var(--blue);
}

.cip-curve-badge.market-ok {
  background: rgba(14,201,160,0.10);
  color: var(--accent);
}

.cip-curve-badge.market-warn {
  background: rgba(232,160,32,0.10);
  color: var(--amber);
}

/* Mode toggle */
.cip-mode-toggle {
  display: flex;
  gap: 3px;
}

.cip-mode-btn {
  padding: 2px 8px;
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  border: 1px solid rgba(255,255,255,0.08);
  background: transparent;
  color: #3a5a6a;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.12s;
}

.cip-mode-btn.active {
  background: rgba(14,201,160,0.12);
  border-color: var(--accent);
  color: var(--accent);
}

.cip-mode-btn:hover:not(.active) {
  border-color: rgba(255,255,255,0.2);
  color: #8aa8bc;
}

/* Flat body */
.cip-flat-body {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px 10px 36px;
}

.cip-label {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #3a5a6a;
  white-space: nowrap;
}

.cip-flat-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cip-flat-input {
  background: var(--bg-deep);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 3px;
  padding: 4px 8px;
  font-family: var(--mono);
  font-size: 14px;
  color: #cdd6e0;
  width: 90px;
  text-align: right;
}

.cip-flat-input:focus {
  outline: none;
  border-color: var(--accent);
}

.cip-unit {
  font-family: var(--mono);
  font-size: 12px;
  color: #5a7a8a;
}

/* Market body */
.cip-market-body {
  padding: 4px 14px 10px 14px;
}

.cip-table {
  width: 100%;
  border-collapse: collapse;
}

.cip-table th {
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #3a5a6a;
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.cip-table th.right { text-align: right; }

.cip-table td {
  padding: 2px 6px;
}

.cip-table tr.filled td {
  background: rgba(14,201,160,0.02);
}

.cip-tenor {
  font-family: var(--mono);
  font-size: 11px;
  color: #7a9aac;
  width: 42px;
}

.cip-type-sel {
  background: var(--bg-deep);
  border: 1px solid transparent;
  border-radius: 2px;
  padding: 2px 4px;
  font-family: var(--mono);
  font-size: 9px;
  color: #7a9aac;
  cursor: pointer;
  width: 90px;
  transition: border-color 0.1s;
}

.cip-type-sel:focus {
  outline: none;
  border-color: rgba(14,201,160,0.25);
}

.cip-rate-input {
  background: var(--bg-deep);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 2px;
  padding: 2px 6px;
  font-family: var(--mono);
  font-size: 12px;
  color: #cdd6e0;
  width: 76px;
  text-align: right;
  transition: border-color 0.1s, background 0.1s;
}

.cip-rate-input:focus {
  outline: none;
  border-color: var(--accent);
  background: rgba(14,201,160,0.03);
}

.cip-warn {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--amber);
  margin: 6px 0 0;
  padding-left: 4px;
}

/* Footer */
.cip-footer {
  display: flex;
  justify-content: flex-end;
  padding: 9px 14px;
  background: var(--panel-3);
  border-top: 1px solid rgba(255,255,255,0.04);
}

.cip-run-btn {
  padding: 7px 22px;
  background: rgba(14,201,160,0.08);
  border: 1px solid var(--accent);
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--accent);
  cursor: pointer;
  transition: background 0.12s;
}

.cip-run-btn:hover:not(:disabled) {
  background: rgba(14,201,160,0.18);
}

.cip-run-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cip-error-bar {
  padding: 6px 14px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--red);
  background: rgba(217,80,64,0.07);
  border-top: 1px solid rgba(217,80,64,0.2);
}

.cip-empty {
  padding: 16px 14px;
  font-family: var(--mono);
  font-size: 10px;
  color: #3a5a6a;
  text-align: center;
}
`;

fs.writeFileSync(path.join(BLOTTER, 'CurveInputPanel.jsx'), jsx, 'utf8');
console.log('✓ Written: CurveInputPanel.jsx');

fs.writeFileSync(path.join(BLOTTER, 'CurveInputPanel.css'), css, 'utf8');
console.log('✓ Written: CurveInputPanel.css');
