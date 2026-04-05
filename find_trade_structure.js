const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')

// Find trade tab body
const tradeTab = s.indexOf("activeTab==='trade'")
console.log('Trade tab at:', tradeTab)
console.log(JSON.stringify(s.slice(tradeTab, tradeTab+200)))

// Find analytics SectionHdr
const analyticsHdr = s.indexOf('<div ref={analyticsRef}/>')
console.log('\nAnalytics ref div at:', analyticsHdr)
console.log(JSON.stringify(s.slice(analyticsHdr-100, analyticsHdr+200)))

// Find the tbw-body className that wraps the trade tab
const tbwBody = s.indexOf("className='tbw-body tbw-no-drag'")
console.log('\ntbw-body at:', tbwBody)
console.log(JSON.stringify(s.slice(tbwBody, tbwBody+300)))
