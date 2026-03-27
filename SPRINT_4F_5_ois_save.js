// SPRINT_4F_5_ois_save.js
// Patches OISDetail.jsx to add:
//   - SAVE TO DB button in the Instruments tab
//   - Auto-load latest snapshot on mount
//   - Save status badge (saved date, error)
// Run from Rijeka root: node SPRINT_4F_5_ois_save.js

const fs = require('fs');
const path = require('path');
const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const FILE = path.join(RIJEKA, 'frontend', 'src', 'components', 'market-data', 'OISDetail.jsx');

let src = fs.readFileSync(FILE, 'utf8');
const orig = src;

if (src.includes('saveSnapshot')) {
  console.log('i Already patched'); process.exit(0);
}

// 1. Add useState + useEffect imports
src = src.replace(
  "import { useState } from 'react';",
  "import { useState, useEffect } from 'react';"
);

// 2. Add saveSnapshot + loadLatestSnapshot to store import
src = src.replace(
  'const { toggleInstrument, updateQuote } = useMarketDataStore();',
  `const { toggleInstrument, updateQuote, saveSnapshot, loadLatestSnapshot, snapshotSaving, snapshotSaved, snapshotError } = useMarketDataStore();
  const [saveDate, setSaveDate] = useState(new Date().toISOString().slice(0, 10));

  // Auto-load latest snapshot on mount
  useEffect(() => {
    loadLatestSnapshot(curve.id);
  }, [curve.id]);`
);

// 3. Add SAVE button + status below the SectionLabel in OISInstruments
// Find the SectionLabel with "Instruments" and inject after the closing </div> of inst-wrap
const saveBar = `
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
      </div>`;

// Inject save bar after closing </div> of inst-wrap
src = src.replace(
  `      </div>
    </div>
  );
}

// â"€â"€ Option form components`,  // This likely isn't OISDetail — use a unique anchor
  `      </div>
    </div>
  );
}

// â"€â"€ Option form components`
);

// Better anchor — find the closing of OISInstruments return
const instEndMarker = `        </table>
      </div>
    </div>
  );
}`;

// Find the last occurrence of this pattern in OISInstruments
const instEndIdx = src.lastIndexOf('        </table>\n      </div>\n    </div>\n  );\n}');
if (instEndIdx !== -1) {
  src = src.slice(0, instEndIdx) +
    `        </table>\n      </div>\n` + saveBar + `\n    </div>\n  );\n}` +
    src.slice(instEndIdx + instEndMarker.length);
  console.log('  ✓ SAVE button injected in OISInstruments');
} else {
  console.log('  i Could not find OISInstruments closing — try manual injection');
}

if (src === orig) {
  console.log('No changes made.');
  process.exit(1);
}

fs.writeFileSync(FILE, src, 'utf8');
console.log('✓ OISDetail.jsx patched');
