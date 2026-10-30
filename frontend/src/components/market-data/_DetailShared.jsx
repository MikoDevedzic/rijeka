// Shared inner-tab chrome shared across all detail panels
import useMarketDataStore from '../../store/useMarketDataStore';

export function InnerTabs({ tabs }) {
  const { innerTab, setInnerTab } = useMarketDataStore();
  return (
    <div className="inner-tabs">
      {tabs.map(({ id, label, badge }) => (
        <button
          key={id}
          className={`itab${innerTab === id ? ' active' : ''}`}
          onClick={() => setInnerTab(id)}
        >
          {label}
          {badge != null && <span className="badge">{badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function InnerBody({ tabs, panels }) {
  const innerTab = useMarketDataStore((s) => s.innerTab);
  return (
    <div className="inner-body">
      {tabs.map(({ id }) => (
        <div key={id} className={`itab-panel${innerTab === id ? ' active' : ''}`}>
          {panels[id]}
        </div>
      ))}
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────

export function ParamGrid({ items, cols = 2 }) {
  return (
    <div className={`pg${cols === 3 ? ' pg3' : ''}`}>
      {items.map(({ label, value, cls }) => (
        <div key={label} className="pc">
          <div className="pl">{label}</div>
          <div className={`pv${cls ? ' ' + cls : ''}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionLabel({ children, sub }) {
  return (
    <div className="sec-lbl">
      {children}
      {sub && <span>{sub}</span>}
    </div>
  );
}

export function CodeBlock({ children, onCopy }) {
  return (
    <div className="cb">
      <button className="cb-copy" onClick={onCopy}>copy</button>
      <pre style={{ margin: 0 }}>{children}</pre>
    </div>
  );
}

export function DescBox({ children }) {
  return (
    <div style={{
      fontSize: '12px', color: 'var(--text)', lineHeight: 1.7,
      marginBottom: 10, padding: '8px 10px',
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 2,
    }}>
      {children}
    </div>
  );
}
