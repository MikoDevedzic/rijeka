// DIAG_workspace.js — find tab rendering pattern in TradeWorkspace.jsx
const fs = require('fs');
const path = require('path');

const FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeWorkspace.jsx';
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// Print every line that contains tab-related keywords
const keywords = ['PRICING', 'activeTab', 'tab ===', 'tab=', 'pricing', 'pricer', 'npv', 'NPV', 'priceTrade', 'resultsByTrade', 'flat_rate', 'flatRate', 'curveInput'];

keywords.forEach(kw => {
  lines.forEach((line, i) => {
    if (line.includes(kw)) {
      console.log(`L${i+1}: ${line}`);
    }
  });
  console.log('---');
});
