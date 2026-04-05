const fs  = require('fs')
const TBW = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx'
let src = fs.readFileSync(TBW, 'utf8')

// Tab label
src = src.replace(`{ id:'scenario', label:'SCENARIO' }`, `{ id:'scenario', label:'CURVE SCENARIO' }`)

// Also the notice bar text
src = src.replace(
  `⚠ Scenario mode \u2014 changes here are for analysis only and are not saved to Configurations.`,
  `⚠ Curve Scenario \u2014 changes are for analysis only and are not saved to Configurations.`
)

fs.writeFileSync(TBW, src, 'utf8')
console.log('✅ Renamed to CURVE SCENARIO')
