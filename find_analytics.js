const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')

// Find where analytics renders
const i = s.indexOf('tbw-body')
console.log('tbw-body at:', i, JSON.stringify(s.slice(i, i+120)))

// Find analytics section
const j = s.indexOf('ANALYTICS')
console.log('\nANALYTICS at:', j, JSON.stringify(s.slice(j-50, j+100)))

// Find where setAnalytics is called (after pricing)
const k = s.indexOf('setAnalytics(')
console.log('\nsetAnalytics at:', k, JSON.stringify(s.slice(k-20, k+60)))

// Find the analytics display container
const l = s.indexOf('analytics &&')
console.log('\nanalytics && at:', l, JSON.stringify(s.slice(l-30, l+100)))
