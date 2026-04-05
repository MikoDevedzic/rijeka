const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const tabStart = s.indexOf('function ScenarioTab(')
const tab = s.slice(tabStart, tabStart+30000)
// Find curve detail end
const i = tab.indexOf('Confirm bar')
console.log('=== 400 chars before Confirm bar ===')
console.log(tab.slice(i-400, i+50))
