const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const tabStart = s.indexOf('function ScenarioTab(')
const tabEnd   = s.indexOf('\nexport default function TradeBookingWindow(')
const tab = s.slice(tabStart, tabEnd)

// Find all ctx.font lines
const lines = tab.split('\n')
lines.forEach((l,i) => {
  if (l.includes('ctx.font') || l.includes("fontSize:'")) {
    console.log(i+1, l.trim().substring(0,80))
  }
})
