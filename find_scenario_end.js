const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')

// Find scenario IIFE start
const start = s.indexOf("activeTab==='scenario' && (() => {")
console.log('Start index:', start)

// Find the matching end - look for the pattern that ends the IIFE
// It ends with })()}  followed by a newline and the ALL-IN PRICE stub
const endMarker = "activeTab==='price'"
const end = s.indexOf(endMarker, start)
console.log('End marker index:', end)
console.log('Section length:', end - start)

// Show the end of the scenario block
console.log('--- END OF SCENARIO BLOCK ---')
console.log(JSON.stringify(s.slice(end-100, end+50)))
