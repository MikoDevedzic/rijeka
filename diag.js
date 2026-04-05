const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const lines = s.split('\n')

console.log('=== LINES 1000-1010 ===')
lines.slice(999,1010).forEach((l,i) => console.log(1000+i+':', l))

console.log('\n=== LINES 1250-1260 ===')
lines.slice(1249,1260).forEach((l,i) => console.log(1250+i+':', l))

console.log('\n=== Search for useState inside conditional ===')
// Find any useState calls that appear after an if/conditional
const iife = s.indexOf('activeTab===')
console.log('First activeTab=== at char:', iife)
console.log('Context:', JSON.stringify(s.slice(iife, iife+100)))

console.log('\n=== All useState occurrences after line 800 ===')
let lineNum = 0
lines.forEach((l,i) => {
  if (i > 800 && l.includes('useState(')) {
    console.log('Line', i+1, ':', l.trim().substring(0,80))
  }
})
