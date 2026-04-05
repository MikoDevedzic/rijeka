const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')

// Find the analytics section and show 400 chars before it
const analyticsRef = s.indexOf('<div ref={analyticsRef}/>')
console.log('=== 600 CHARS BEFORE ANALYTICS ===')
console.log(s.slice(analyticsRef-600, analyticsRef))

// Find what comes after analytics section - show 200 chars after
console.log('\n=== 200 CHARS AFTER ANALYTICS HDR ===')
console.log(JSON.stringify(s.slice(analyticsRef+200, analyticsRef+400)))

// Find the outer scroll container — look for overflowY auto near the trade form
const overflowIdx = s.indexOf("overflowY:'auto'", analyticsRef-5000)
console.log('\noverflowY auto near analytics at:', overflowIdx)
console.log(JSON.stringify(s.slice(overflowIdx-100, overflowIdx+100)))
