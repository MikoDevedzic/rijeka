const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const tabStart = s.indexOf('function ScenarioTab(')
const tabEnd   = s.indexOf('\nexport default function TradeBookingWindow(')
const tab = s.slice(tabStart, tabEnd)
console.log('Tab length:', tab.length)
// Show last 500 chars of tab
console.log('\n=== LAST 500 CHARS OF SCENARIOTAB ===')
console.log(tab.slice(-500))
