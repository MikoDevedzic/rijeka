const fs = require('fs');
const path = require('path');

const twPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeWorkspace.jsx';
let src = fs.readFileSync(twPath, 'utf8');

// Fix onSave to update both the tab store AND the trades store
src = src.replace(
  `        {editing && (
          <EditPanel
            trade={trade}
            onSave={(updated) => refreshTrade(trade.id, updated)}
            onClose={() => setEditing(false)}
          />
        )}`,
  `        {editing && (
          <EditPanel
            trade={trade}
            onSave={(updated) => {
              // Update tab state
              refreshTrade(trade.id, updated)
              // Update trades store so blotter list also reflects change
              useTradesStore.getState().fetchTrades()
              setEditing(false)
            }}
            onClose={() => setEditing(false)}
          />
        )}`
);

fs.writeFileSync(twPath, src, 'utf8');
console.log('✅  TradeWorkspace — onSave now refreshes both tab and trades store immediately');
