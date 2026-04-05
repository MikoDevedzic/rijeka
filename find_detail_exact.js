const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const tabStart = s.indexOf('function ScenarioTab(')
const tab = s.slice(tabStart, tabStart+32000)

// Find showDetail section
const i = tab.indexOf('showDetail&&(')
console.log('showDetail at:', i)
console.log(JSON.stringify(tab.slice(i, i+200)))

// Find what comes after
const j = tab.indexOf('scenarioBase||scenarioCalc')
console.log('\nscenarioBase at:', j)
console.log(JSON.stringify(tab.slice(j-100, j+50)))
