const {execSync} = require('child_process')
// Use node to try parsing the file
try {
  require('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx')
} catch(e) {
  console.log(e.message)
}

// Also check line count and last few lines
const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')
const lines = s.split('\n')
console.log('Total lines:', lines.length)
// Find unmatched braces - count them
let open=0,close=0
for(const c of s){if(c==='{')open++;if(c==='}')close++}
console.log('Open braces:', open, 'Close braces:', close, 'Diff:', open-close)
