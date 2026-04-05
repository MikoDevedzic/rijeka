const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const i = s.indexOf('curveDragTip&&')
console.log(JSON.stringify(s.slice(i, i+400)))
