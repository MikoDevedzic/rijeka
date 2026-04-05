const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const start = s.indexOf('function ScenarioTab(')
const end = s.indexOf('\nexport default function TradeBookingWindow')
console.log('ScenarioTab starts at:', start)
console.log('ScenarioTab ends at:', end)
console.log('Length:', end - start)
// Show first 300 chars
console.log('\n--- START ---')
console.log(s.slice(start, start+300))
// Show last 300 chars
console.log('\n--- END ---')
console.log(s.slice(end-300, end))
