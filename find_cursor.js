const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const i = s.indexOf('ns-resize')
console.log(JSON.stringify(s.slice(i-20, i+200)))
