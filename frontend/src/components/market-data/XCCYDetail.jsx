import { InnerTabs, InnerBody, ParamGrid, SectionLabel, DescBox } from './_DetailShared';

// ── Definition tab ──────────────────────────────────────────
function XCCYDef({ curve }) {
  const stub = `# XCCY curve = domestic OIS + foreign OIS + FX spot + XCCY basis
# Bootstrapped simultaneously — CIP arbitrage constraint
# ql.CrossCurrencyBasisSwapRateHelper
# Spread is added to the domestic (non-USD) leg
# Full implementation: on the roadmap`;

  return (
    <div>
      <SectionLabel>XCCY Basis Curve</SectionLabel>
      <ParamGrid items={[
        { label: 'Curve Class',   value: 'XCCY_BASIS',                cls: 'pu' },
        { label: 'Domestic OIS',  value: curve.parentCurves[0],       cls: 'ac' },
        { label: 'Foreign OIS',   value: curve.parentCurves[1],       cls: 'bl' },
        { label: 'FX Spot',       value: 'Provided externally' },
      ]} />
      <DescBox>{curve.description}</DescBox>
      <SectionLabel>Bootstrap logic (roadmap)</SectionLabel>
      <div className="cb">
        <pre style={{ margin: 0, fontSize: '12px', lineHeight: 1.8, color: 'var(--text-dim)' }}>
          {stub}
        </pre>
      </div>
    </div>
  );
}

// ── Instruments tab ─────────────────────────────────────────
function XCCYInstruments({ curve }) {
  return (
    <div>
      <SectionLabel>XCCY Basis Instruments</SectionLabel>
      <div className="inst-wrap">
        <table className="inst-table">
          <thead>
            <tr>
              <th>Active</th>
              <th>Type</th>
              <th>Tenor</th>
              <th>Ticker</th>
              <th style={{ textAlign: 'right' }}>Basis (bp)</th>
            </tr>
          </thead>
          <tbody>
            {curve.instruments.map((inst, i) => (
              <tr key={i}>
                <td>
                  <input type="checkbox" className="tog" defaultChecked={inst.en} readOnly />
                </td>
                <td className="di">{inst.type}</td>
                <td className="pu mo">{inst.tenor}</td>
                <td className="mo">{inst.ticker}</td>
                <td className="pu mo" style={{ textAlign: 'right' }}>{inst.quote.toFixed(1)}bp</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: '12px', color: 'var(--text-mute)', padding: '6px 0' }}>
        Roadmap · ql.CrossCurrencyBasisSwapRateHelper · CIP arbitrage constraint
      </div>
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────
export default function XCCYDetail({ curve }) {
  const firstInst = curve.instruments[0];
  const tabs = [
    { id: 'def',  label: 'Definition' },
    { id: 'inst', label: 'Instruments' },
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
              <span style={{ color: 'var(--accent)' }}>{curve.parentCurves[0]}</span>
              {' ↔ '}
              <span style={{ color: 'var(--blue)' }}>{curve.parentCurves[1]}</span>
              {' · roadmap'}
            </div>
          </div>
          <div className="crv-rate-block">
            <div className="crv-rate-val" style={{ color: 'var(--purple)' }}>
              {firstInst?.quote.toFixed(1)}bp
            </div>
            <div className="crv-rate-lbl">{firstInst?.tenor} basis</div>
          </div>
        </div>
        <div className="crv-pills">
          <span className="pill p-purple">XCCY_BASIS</span>
          <span className="pill p-purple">RiskClass.FX</span>
          <span className="pill p-green">{curve.parentCurves[0]}</span>
          <span className="pill p-blue">{curve.parentCurves[1]}</span>
          <span className="pill p-dim">Roadmap</span>
        </div>
      </div>

      <InnerTabs tabs={tabs} />
      <InnerBody
        tabs={tabs}
        panels={{
          def:  <XCCYDef curve={curve} />,
          inst: <XCCYInstruments curve={curve} />,
        }}
      />
    </div>
  );
}
