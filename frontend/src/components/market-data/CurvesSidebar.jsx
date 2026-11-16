import { useEffect, useState } from 'react';
import useMarketDataStore from '../../store/useMarketDataStore';
import { CCY_GROUPS } from '../../data/ratesCurves';

const TYPE_FILTERS = ['all', 'OIS', 'BASIS', 'XCCY', 'FUNDING'];

const TYPE_BADGE_CLASS = {
  OIS:     'tb-ois',
  BASIS:   'tb-basis',
  XCCY:    'tb-xccy',
  FUNDING: 'tb-funding',
};

const TYPE_SEL_BORDER = {
  OIS:     'var(--accent)',
  BASIS:   'var(--blue)',
  XCCY:    'var(--purple)',
  FUNDING: 'var(--amber)',
};

const TYPE_LABEL = {
  OIS:     'OIS',
  BASIS:   'BASIS',
  XCCY:    'XCCY',
  FUNDING: 'FUND',
};

// The curves whose quotes are stored (a snapshot per curve): the rate the list prints for one of these is the
// stored one, so it is asked for before it is printed. Until the answer is in, the row shows an ellipsis and not
// the built-in starting quote, which is not the desk's rate (the list said 3.65% for a curve stored at 3.88%).
const STORED = new Set(['OIS', 'BASIS']);
const AT_ONCE = 4;                     // requests in flight while the list fills
const AGAIN_MS = 1500, ROUNDS = 4;     // a session not ready when the page opened: the list asks again, a few times

function curveDisplayVal(c) {
  if (c.curve_class === 'FUNDING') {
    const sp = Object.values(c.spreads);
    const avg = (sp.reduce((a, b) => a + b, 0) / sp.length).toFixed(0);
    return { val: `${avg}bp`, cls: 'am' };
  }
  if (c.curve_class === 'XCCY') {
    return { val: `${c.instruments[0].quote.toFixed(1)}bp`, cls: 'pu' };
  }
  if (c.curve_class === 'BASIS') {
    const inst = c.instruments[0];
    return inst.unit === 'bp'
      ? { val: `${inst.quote.toFixed(1)}bp`, cls: 'bl' }
      : { val: `${inst.quote.toFixed(2)}%`,  cls: 'bl' };
  }
  const on = c.instruments.find((i) => i.type === 'OISDeposit') || c.instruments[0];
  return { val: `${on.quote.toFixed(2)}%`, cls: 'ac' };
}

export default function CurvesSidebar() {
  const [search, setSearch] = useState('');
  const { curves, selectedCurveId, typeFilter, openGroups, selectCurve, setTypeFilter, toggleGroup } =
    useMarketDataStore();

  const tried = useMarketDataStore((s) => s.snapshotTried);
  const flt = search.toUpperCase();

  // the stored quotes of every curve in an open group, a few at a time, each asked for until the API has answered
  // for it (a session that was not ready is not an answer); never over what the user has begun to type
  const [round, setRound] = useState(0);
  useEffect(() => {
    let stop = false, again = null;
    const waiting = () => {
      const st = useMarketDataStore.getState();
      return CCY_GROUPS.filter((g) => openGroups[g.ccy]).flatMap((g) => g.ids).filter((id) => {
        const c = st.curves.find((x) => x.id === id);
        return c && STORED.has(c.curve_class) && !st.snapshotTried[id];
      });
    };
    (async () => {
      const ids = waiting(), load = useMarketDataStore.getState().loadLatestSnapshot;
      for (let i = 0; i < ids.length && !stop; i += AT_ONCE) await Promise.all(ids.slice(i, i + AT_ONCE).map((id) => load(id, { keepEdits: true })));
      if (!stop && round < ROUNDS && waiting().length) again = setTimeout(() => setRound((r) => r + 1), AGAIN_MS);
    })();
    return () => { stop = true; clearTimeout(again); };
  }, [openGroups, round]);

  return (
    <div className="crv-sidebar">
      {/* Search + filter */}
      <div className="sb-top">
        <div className="sb-search">
          <input
            type="text"
            placeholder="Search curves…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="sb-filters">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              className={`sf${typeFilter === f ? ' on' : ''}`}
              onClick={() => setTypeFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'FUNDING' ? 'Funding' : f}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <SidebarStats curves={curves} typeFilter={typeFilter} search={flt} />

      {/* Groups */}
      <div className="sb-list">
        {CCY_GROUPS.map((g) => {
          const groupCurves = g.ids
            .map((id) => curves.find((c) => c.id === id))
            .filter(Boolean)
            .filter((c) => {
              if (typeFilter !== 'all') {
                // Always show base OIS curve when BASIS filter is active
                if (typeFilter === 'BASIS' && c.curve_class === 'OIS') {
                  // Only show if this group has at least one visible basis curve that references it
                  const hasRelatedBasis = g.ids.some(id => {
                    const bc = curves.find(x => x.id === id)
                    return bc && bc.curve_class === 'BASIS' && bc.baseCurveId === c.id
                  })
                  if (!hasRelatedBasis) return false
                } else if (c.curve_class !== typeFilter) {
                  return false
                }
              }
              if (flt && !c.fullName.toUpperCase().includes(flt) &&
                  !c.ccy.toUpperCase().includes(flt) &&
                  !c.name.toUpperCase().includes(flt)) return false;
              return true;
            });

          if (!groupCurves.length) return null;

          const isOpen = openGroups[g.ccy];

          return (
            <div key={g.ccy} className={`ccy-group${isOpen ? ' open' : ''}`}>
              <div className="ccy-hdr" onClick={() => toggleGroup(g.ccy)}>
                <span className="ccy-flag">{g.flag}</span>
                <span className="ccy-lbl">{g.label}</span>
                <span className="ccy-count">{groupCurves.length}</span>
                <span className="ccy-chevron">▶</span>
              </div>

              <div className="ccy-items">
                {groupCurves.map((c) => {
                  const dv = STORED.has(c.curve_class) && !tried[c.id] ? { val: '…', cls: 'ci-wait' } : curveDisplayVal(c);
                  const isSel = selectedCurveId === c.id;
                  const selBorder = isSel ? TYPE_SEL_BORDER[c.curve_class] : 'transparent';

                  return (
                    <div
                      key={c.id}
                      className={`crv-item${isSel ? ' sel' : ''}`}
                      style={{ borderLeftColor: selBorder }}
                      onClick={() => selectCurve(c.id)}
                    >
                      <span className={`type-badge ${TYPE_BADGE_CLASS[c.curve_class]}`}>
                        {TYPE_LABEL[c.curve_class]}
                      </span>
                      <div className="ci-body">
                        <div className="ci-name">{c.name}</div>
                      </div>
                      <div className={`ci-val ${dv.cls}`} data-testid={`crv-val-${c.id}`}>{dv.val}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidebarStats({ curves, typeFilter, search }) {
  const flt = search.toUpperCase();
  let count = 0;
  CCY_GROUPS.forEach((g) => {
    g.ids.forEach((id) => {
      const c = curves.find((x) => x.id === id);
      if (!c) return;
      if (typeFilter !== 'all' && c.curve_class !== typeFilter) return;
      if (flt && !c.fullName.toUpperCase().includes(flt) &&
          !c.ccy.toUpperCase().includes(flt) &&
          !c.name.toUpperCase().includes(flt)) return;
      count++;
    });
  });
  return <div className="sb-stats">{count} curves</div>;
}
